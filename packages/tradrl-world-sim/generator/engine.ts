/**
 * The generated world engine (W017) — the composition that makes the world
 * COME ALIVE: a headless world engine whose CLOCK DRIVES the deterministic
 * synthetic market generator.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine ├─ synthetic
 * market`) and "Synthetic regimes" (seeded regimes; regime schedules are
 * world metadata). Spec: spec/ARCHITECTURE-LOCK.md A6 (every mutation is a
 * journaled, reduced event), A7 (availableAt discipline), A9 (determinism:
 * fixed definition + seed + clock/command stream ⇒ identical journal),
 * A4/A13 (participants act through the same typed CommandPort as humans —
 * venue/account/risk contracts apply to generated orders exactly).
 *
 * INTEGRATION MODEL (the W013 note resolved — clock advance now produces
 * market events):
 * - The wrapper owns the ClockPort surface: every advancing operation
 *   (step / seek / jump-to-event) walks the generator's merged timeline for
 *   the covered interval (A, B] IN ORDER — regime announcements, halt and
 *   reopen transitions at their exact scheduled times, participant actions
 *   at the action-grid times — driving the UNDERLYING clock forward to each
 *   event time first, so every generated event (structural AND the matching
 *   events of generated orders) carries its true simulation time.
 * - Structural market events (regime/halt/reopen/quote) journal through the
 *   engine's typed W017 seam (`applyGeneratorEvents`) — the single
 *   journal→reduce path commands use (A6).
 * - Participant actions are REAL COMMANDS from the synthetic participants
 *   through the real CommandPort: same validation, authorization, venue
 *   policy, fees, latency. The generator never fabricates an order fact.
 *
 * DETERMINISM: the generator's decisions are pure functions of (definition
 * seed, regime schedule in force, simulation time) — see rng.ts/regime.ts.
 * The only wrapper-held derived state is the last emitted quote per
 * instrument (change detection), rehydrated from the journal on restore, so
 * a restored engine continues exactly where the journal left off.
 */

import type { ClockPort, EventId, RegimeScheduleEntry, SequenceNumber } from "tradrl-world-contracts";
import type { MarketHaltPayload, MarketReopenPayload, QuoteUpdatePayload, RegimeChangePayload } from "tradrl-world-contracts/time";
import { isValidStepDeltaMs } from "tradrl-world-contracts/time";
import type { PendingEventDraft } from "../journal/eventJournal.js";
import { fillAvailableAt, resolveVenuePolicy } from "../matching/index.js";
import {
  createHeadlessWorldEngine,
  type EngineRestore,
  type HeadlessWorldEngine,
  type HeadlessWorldEngineOptions,
} from "../world/index.js";
import type { WorldDefinition } from "../world/index.js";
import {
  GENERATOR_EVENT_SCHEMA_VERSION,
  MARKET_GENERATOR_PRODUCER,
  generatorTurnId,
} from "./events.js";
import { planGeneratorTurn } from "./participants.js";
import {
  activeEntryAt,
  gridTimesForInterval,
  haltReopenEventsForInterval,
  regimeAnnouncementsForInterval,
  regimeProfileOf,
  scheduleEntriesOf,
  shockHaltEventsForInterval,
} from "./regime.js";
import { quotePayloadOf, sameQuote, topOfBook } from "./quotes.js";
import type { TopOfBook } from "./quotes.js";

/** Options for {@link createGeneratedWorldEngine} (the engine options verbatim). */
export interface GeneratedWorldEngineOptions
  extends Omit<HeadlessWorldEngineOptions, "definition" | "restore"> {
  readonly definition: WorldDefinition;
  readonly restore?: EngineRestore;
}

/** A generated world engine: the full headless engine surface, clock-driven. */
export type GeneratedWorldEngine = HeadlessWorldEngine;

interface TimelinePass {
  readonly at: number;
  readonly announcements: readonly RegimeChangePayload[];
  readonly halts: readonly (MarketHaltPayload | MarketReopenPayload)[];
  readonly isGrid: boolean;
}

/** Mutable building shape of one timeline pass (frozen into TimelinePass). */
interface MutableTimelinePass {
  readonly at: number;
  readonly announcements: RegimeChangePayload[];
  readonly halts: (MarketHaltPayload | MarketReopenPayload)[];
  isGrid: boolean;
}

/** Merge the interval's structural events and grid times into one ordered pass list. */
function buildTimeline(input: {
  readonly definition: WorldDefinition;
  readonly entries: readonly RegimeScheduleEntry[];
  readonly intervalFrom: number;
  readonly intervalTo: number;
  readonly worldStart: number;
}): readonly TimelinePass[] {
  const { definition, entries } = input;
  const passes = new Map<number, MutableTimelinePass>();
  const passAt = (at: number): MutableTimelinePass => {
    const existing = passes.get(at);
    if (existing !== undefined) {
      return existing;
    }
    const created: MutableTimelinePass = { at, announcements: [], halts: [], isGrid: false };
    passes.set(at, created);
    return created;
  };
  for (const announcement of regimeAnnouncementsForInterval(
    entries,
    input.intervalFrom,
    input.intervalTo,
    input.worldStart,
  )) {
    const payload: RegimeChangePayload = {
      type: "market.regime.changed",
      ...(announcement.from === undefined ? {} : { from: announcement.from }),
      to: announcement.to,
      ...(announcement.parameters === undefined ? {} : { parameters: announcement.parameters }),
    };
    passAt(announcement.at).announcements.push(payload);
  }
  const haltEvents = [
    ...haltReopenEventsForInterval(entries, definition.instruments, input.intervalFrom, input.intervalTo),
    ...shockHaltEventsForInterval(
      entries,
      definition.instruments,
      definition.venues ?? [],
      input.intervalFrom,
      input.intervalTo,
    ),
  ];
  for (const scheduled of haltEvents) {
    if (scheduled.kind === "halt") {
      const payload: MarketHaltPayload = {
        type: "market.halted",
        scope: { kind: "instrument", instrumentId: scheduled.instrumentId },
        reason: scheduled.reason,
      };
      passAt(scheduled.at).halts.push(payload);
    } else {
      const payload: MarketReopenPayload = {
        type: "market.reopened",
        scope: { kind: "instrument", instrumentId: scheduled.instrumentId },
      };
      passAt(scheduled.at).halts.push(payload);
    }
  }
  for (const at of gridTimesForInterval(entries, input.intervalFrom, input.intervalTo)) {
    passAt(at).isGrid = true;
  }
  return [...passes.values()]
    .sort((a, b) => a.at - b.at)
    .map((pass): TimelinePass => ({
      at: pass.at,
      announcements: [...pass.announcements],
      halts: [...pass.halts],
      isGrid: pass.isGrid,
    }));
}

/** Rehydrate the last emitted quote per instrument from a journal's tail. */
function rehydrateLastQuotes(
  engine: HeadlessWorldEngine,
): Map<string, TopOfBook | undefined> {
  const lastQuotes = new Map<string, TopOfBook | undefined>();
  const records = engine.journal.records();
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const envelope = records[i]!.envelope;
    if (envelope.eventType !== "market.quote.updated") {
      continue;
    }
    const payload = envelope.payload as QuoteUpdatePayload;
    const key = String(payload.instrumentId);
    if (lastQuotes.has(key)) {
      continue;
    }
    lastQuotes.set(key, {
      ...(payload.bid === undefined ? {} : { bid: payload.bid }),
      ...(payload.bidSize === undefined ? {} : { bidSize: payload.bidSize }),
      ...(payload.ask === undefined ? {} : { ask: payload.ask }),
      ...(payload.askSize === undefined ? {} : { askSize: payload.askSize }),
      ...(payload.last === undefined ? {} : { last: payload.last }),
    });
  }
  return lastQuotes;
}

/**
 * Create the generated world engine. The definition is validated by the
 * underlying engine (fails fast); the regime schedule in force starts as the
 * definition's `regimeSchedule` (world metadata) and follows
 * `CommandPort.setScenario` like every other world fact.
 */
export function createGeneratedWorldEngine(
  options: GeneratedWorldEngineOptions,
): GeneratedWorldEngine {
  const { definition } = options;
  const engine = createHeadlessWorldEngine({
    definition,
    ...(options.wallTimeSource === undefined ? {} : { wallTimeSource: options.wallTimeSource }),
    ...(options.onPublished === undefined ? {} : { onPublished: options.onPublished }),
    ...(options.restore === undefined
      ? {}
      : {
          restore: options.restore,
        }),
  });
  const lastQuotes = rehydrateLastQuotes(engine);

  function draft(
    at: number,
    eventType: string,
    payload: unknown,
    availableAt?: number,
  ): PendingEventDraft {
    return {
      eventType,
      occurredAt: at as never,
      ...(availableAt === undefined ? {} : { availableAt: availableAt as never }),
      causationId: generatorTurnId(String(definition.scope.worldId), at as never) as never,
      correlationId: generatorTurnId(String(definition.scope.worldId), at as never) as never,
      producer: MARKET_GENERATOR_PRODUCER,
      schemaVersion: GENERATOR_EVENT_SCHEMA_VERSION,
      payload,
    };
  }

  async function seekInnerTo(at: number): Promise<void> {
    if (engine.clockState().simulationTime < at) {
      await engine.clock.seek(at as never);
    }
  }

  /**
   * Walk the generator's merged timeline for one clock interval (A, B]:
   * structural market events at their exact scheduled times, participant
   * actions at the grid times, quote projections after each turn — leaving
   * the clock at B.
   */
  async function driveInterval(intervalFrom: number, intervalTo: number): Promise<void> {
    if (!(intervalTo > intervalFrom)) {
      return;
    }
    // The scenario in force as of this pass; a setScenario that lands mid-pass
    // takes effect at the next pass (documented, arrival-order deterministic).
    const entries = scheduleEntriesOf(engine.worldState().currentScenario);
    const timeline = buildTimeline({
      definition,
      entries,
      intervalFrom,
      intervalTo,
      worldStart: definition.clock.start,
    });
    for (const pass of timeline) {
      await seekInnerTo(pass.at);
      const drafts: PendingEventDraft[] = [];
      for (const announcement of pass.announcements) {
        drafts.push(draft(pass.at, "market.regime.changed", announcement));
      }
      for (const halt of pass.halts) {
        let payload: MarketHaltPayload | MarketReopenPayload = halt;
        if (halt.type === "market.reopened" && halt.scope.kind === "instrument") {
          const book = engine.worldState().matching.books[String(halt.scope.instrumentId)];
          if (book?.lastTradePrice !== undefined) {
            payload = { ...halt, referencePrice: book.lastTradePrice };
          }
        }
        drafts.push(draft(pass.at, payload.type, payload));
      }
      if (drafts.length > 0) {
        engine.applyGeneratorEvents(drafts);
      }
      if (!pass.isGrid) {
        continue;
      }
      for (const instrument of definition.instruments) {
        if (instrument.tradable === false) {
          continue;
        }
        // Actions: only while a regime window is in force and the book trades.
        const active = activeEntryAt(entries, pass.at);
        const book = engine.worldState().matching.books[String(instrument.instrumentId)];
        if (book === undefined) {
          continue;
        }
        if (active !== undefined && book.tradingState === "open") {
          const commands = planGeneratorTurn({
            definition,
            matching: engine.worldState().matching,
            instrument,
            book,
            entry: active,
            profile: regimeProfileOf(active),
            entries,
            at: pass.at as never,
            seed: definition.seed,
          });
          for (const command of commands) {
            if (command.kind === "submit-order") {
              await engine.command.submitOrder(command);
            } else {
              await engine.command.cancelOrder(command);
            }
          }
        }
        // The quote projection: sampled at every grid turn (the book may
        // have moved through human commands too), emitted only on change.
        const bookAfter = engine.worldState().matching.books[String(instrument.instrumentId)];
        if (bookAfter === undefined) {
          continue;
        }
        const key = String(instrument.instrumentId);
        const quote = topOfBook(bookAfter);
        if (!sameQuote(lastQuotes.get(key), quote)) {
          const policy = resolveVenuePolicy(definition, instrument);
          const availableAt = fillAvailableAt(policy, pass.at as never);
          engine.applyGeneratorEvents([
            draft(
              pass.at,
              "market.quote.updated",
              quotePayloadOf(instrument.instrumentId, bookAfter),
              availableAt,
            ),
          ]);
          lastQuotes.set(key, quote);
        }
      }
    }
    await seekInnerTo(intervalTo);
  }

  // One serialization point for the wrapper's clock surface: wrapper clock
  // operations apply in arrival order (commands and queries delegate to the
  // engine's own queue and interleave at await points — true arrival order).
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work) as Promise<T>;
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const clockState = () => engine.clockState();

  const wrappedClock: ClockPort = {
    play: () => engine.clock.play(),
    pause: () => engine.clock.pause(),
    step: (deltaMs?: number) =>
      enqueue(async () => {
        const from = clockState().simulationTime;
        if (deltaMs !== undefined && !isValidStepDeltaMs(deltaMs)) {
          // delegate the typed rejection verbatim (no advance, no events)
          await engine.clock.step(deltaMs);
          return;
        }
        const delta = deltaMs ?? clockState().defaultStepMs;
        const end = clockState().bounds?.end;
        const to = end === undefined ? from + delta : Math.min(from + delta, end);
        await driveInterval(from, to);
      }),
    seek: (to: number) =>
      enqueue(async () => {
        const from = clockState().simulationTime;
        const start = clockState().bounds?.start;
        const end = clockState().bounds?.end;
        const rejected =
          !Number.isFinite(to) ||
          to < from ||
          (start !== undefined && to < start) ||
          (end !== undefined && to > end);
        if (rejected) {
          await engine.clock.seek(to as never); // typed rejection verbatim
          return;
        }
        await driveInterval(from, to);
      }),
    jumpToEvent: (target: EventId | SequenceNumber) =>
      enqueue(async () => {
        const found = engine.journal.findEvent(target);
        if (found === undefined) {
          await engine.clock.jumpToEvent(target); // typed rejection verbatim
          return;
        }
        const from = clockState().simulationTime;
        if (found.occurredAt <= from) {
          await engine.clock.jumpToEvent(target); // rewind rejection verbatim
          return;
        }
        await driveInterval(from, found.occurredAt);
      }),
    setSpeed: (speed: number) => engine.clock.setSpeed(speed),
    followRealtime: (enabled: boolean) => engine.clock.followRealtime(enabled),
    getClock: () => engine.clock.getClock(),
  };

  return {
    ...engine,
    clock: wrappedClock,
    protocol: { ...engine.protocol, clock: wrappedClock },
  };
}
