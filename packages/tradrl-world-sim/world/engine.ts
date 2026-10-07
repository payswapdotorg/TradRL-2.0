/**
 * The headless world engine — the W013 composition root.
 *
 * Spec: spec/SIMULATION.md ("Phase 1" deterministic TypeScript runtime, Node
 * headless target; "Runtime topology" — the engine composes clock, world
 * core and journal) and "Headless report".
 * Spec: spec/WORLD-PROTOCOL.md "Ports" — the engine EXPOSES the four ports
 * (QueryPort, CommandPort, ClockPort, EvidencePort); no engine-specific type
 * crosses a port (ADR-003). The members below the ports are engine-surface
 * APIs for W016/W018/W031, documented per member.
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — command → validate →
 * authorize → apply domain rules → mutate authoritative state → emit ordered
 * events → append journal → publish projections → ack. State is mutated ONLY
 * by reducing journaled events, so live runs and replays advance state
 * through the same code path (A6/A9).
 *
 * Determinism: every state input is (definition, journaled events, command
 * stream). Wall time is recorded on the clock axis only and never enters
 * events, digests or the manifest.
 */

import type {
  ClockPort,
  CommandPort,
  CommandResult,
  DeterminismManifest,
  EventId,
  EvidencePort,
  QueryPort,
  SequenceNumber,
  TimestampMs,
  WorldCommand,
  WorldEventEnvelope,
  WorldId,
  WorldProtocol,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type { ClockState } from "tradrl-world-contracts/time";
import { asClockPort, createSimulationClock, type SimulationClock } from "../clock/index.js";
import type { EventJournal } from "../journal/index.js";
import { createEventJournal, replayJournal } from "../journal/index.js";
import { assertValidWorldDefinition, type WorldDefinition } from "./definition.js";
import { runCommandLifecycle } from "./lifecycle.js";
import { buildDeterminismManifest, buildHeadlessReport, type HeadlessRunReport } from "./manifest.js";
import { createFnv1aHasher } from "./hashing.js";
import {
  createEvidencePort,
  createQueryPort,
  journalEventLookup,
  type EngineReadModel,
} from "./projections.js";
import { initialWorldState, reduceWorldEvent, type WorldState } from "./state.js";

/** Restore parameters: rebuild an engine from a preloaded journal. */
export interface EngineRestore {
  /** A journal preloaded via `createEventJournalFromRecords`. */
  readonly journal: EventJournal;
  /** Clock position after restore; defaults to the last replayed event time. */
  readonly clockAt?: SimulationTimeMs;
  readonly speed?: number;
}

/** Options for `createHeadlessWorldEngine`. */
export interface HeadlessWorldEngineOptions {
  readonly definition: WorldDefinition;
  /**
   * Host-axis clock source (A7). Default: the real host clock. Inject a
   * fixed source for tests/deterministic replays — wall time never enters
   * events, digests or the manifest, so this affects only the clock's
   * wall-axis readout.
   */
  readonly wallTimeSource?: () => WallTimeMs;
  readonly restore?: EngineRestore;
  /**
   * The explicit `publish projections` lifecycle step: called after the
   * state mutation, synchronously, with the ack and the ordered events.
   * Side-channel only — it must not mutate engine state (determinism); the
   * W018 adapter subscribes here to stream projections to the UI.
   */
  readonly onPublished?: (published: {
    readonly ack: CommandResult & { status: "acked" };
    readonly events: readonly WorldEventEnvelope[];
  }) => void;
}

/** The headless engine: the four ports plus the engine-surface extras. */
export interface HeadlessWorldEngine {
  readonly worldId: WorldId;
  /** The four ports, grouped (A5). */
  readonly protocol: WorldProtocol;
  readonly query: QueryPort;
  readonly command: CommandPort;
  readonly clock: ClockPort;
  readonly evidence: EvidencePort;
  /** The authoritative history (records + digest + cursor for W016). */
  readonly journal: EventJournal;
  /** Full clock state (W004's ClockState — what W012/W018 consume). */
  clockState(): ClockState;
  /** Snapshot of the authoritative world state (engine surface, not a port). */
  worldState(): WorldState;
  determinismManifest(): DeterminismManifest;
  headlessReport(): HeadlessRunReport;
}

function defaultWallTimeSource(): WallTimeMs {
  return asWallTime(Date.now());
}

/**
 * Create the headless deterministic world engine. Without `restore`, the
 * engine starts at the definition's clock origin with the initial state.
 * With `restore.journal`, state is recomputed by replaying the journal
 * (deterministic replay) and the clock defaults to the last event time.
 */
export function createHeadlessWorldEngine(
  options: HeadlessWorldEngineOptions,
): HeadlessWorldEngine {
  const { definition } = options;
  assertValidWorldDefinition(definition);

  const wallTimeSource = options.wallTimeSource ?? defaultWallTimeSource;
  const journal = options.restore?.journal ?? createEventJournal(definition.scope.worldId);

  // Deterministic replay: recompute state from the journal (A9 core).
  const replay = replayJournal(journal.records(), reduceWorldEvent, initialWorldState(definition));
  let state: WorldState = replay.state;

  const clockInitial =
    options.restore?.clockAt !== undefined
      ? options.restore.clockAt
      : replay.lastEventTime !== undefined
        ? asSimulationTime(replay.lastEventTime)
        : definition.clock.start;

  const clock: SimulationClock = createSimulationClock({
    worldId: definition.scope.worldId,
    simulationTime: clockInitial,
    wallTime: definition.clock.initialWallTime,
    bounds: {
      start: definition.clock.start,
      ...(definition.clock.end === undefined ? {} : { end: definition.clock.end }),
    },
    defaultStepMs: definition.clock.defaultStepMs,
    speed: options.restore?.speed ?? definition.clock.speed,
    eventLookup: journalEventLookup(journal),
  });

  const commandStreamHasher = createFnv1aHasher();

  const readModel = (): EngineReadModel => ({
    definition,
    state,
    clockState: clock.state(),
    journal,
  });

  // The single serialization point: commands and clock operations apply in
  // arrival order. The chain swallows individual failures — every caller
  // owns its own rejection (the queue itself never breaks).
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => T): Promise<Awaited<T>> {
    const run = tail.then(work, work) as Promise<Awaited<T>>;
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function executeCommand(command: WorldCommand): CommandResult {
    // The command stream hash covers every submitted command, in order,
    // rejected ones included (A9: the full input stream).
    commandStreamHasher.update(command);
    const outcome = runCommandLifecycle(command, {
      definition,
      state,
      simulationTime: clock.state().simulationTime,
      // W014 seam: the matcher reserves the journal's next dense sequences
      // so its fill drafts can cite the trade events that generated them.
      nextSequence: (journal.getCursor() + 1) as SequenceNumber,
    });
    if (outcome.kind === "rejected") {
      return { status: "rejected", rejection: outcome.rejection };
    }
    const occurredAt = clock.state().simulationTime as TimestampMs;
    const sealed = journal.append(outcome.drafts, { recordedAt: occurredAt });
    // Mutate authoritative state by reducing exactly what was journaled —
    // the same path replay uses.
    const records = journal.records();
    for (const record of records.slice(records.length - sealed.length)) {
      state = reduceWorldEvent(state, record);
    }
    const ack: CommandResult & { status: "acked" } = {
      status: "acked",
      ack: {
        commandId: command.commandId,
        worldId: definition.scope.worldId,
        acceptedAt: occurredAt,
        resultingEventIds: sealed.map(
          (envelope: WorldEventEnvelope): EventId => envelope.eventId,
        ),
        journalCursor: journal.getCursor(),
      },
    };
    options.onPublished?.({ ack, events: sealed });
    return ack;
  }

  const queryPort: QueryPort = createQueryPort(readModel);
  const evidencePort: EvidencePort = createEvidencePort(readModel, () =>
    buildDeterminismManifest({ definition, commandStreamHasher }),
  );
  const innerClockPort: ClockPort = asClockPort(clock, wallTimeSource);
  // Clock operations queue with commands: one authoritative ordering.
  const clockPort: ClockPort = {
    play: () => enqueue(() => innerClockPort.play()),
    pause: () => enqueue(() => innerClockPort.pause()),
    step: (deltaMs?: number) => enqueue(() => innerClockPort.step(deltaMs)),
    seek: (to) => enqueue(() => innerClockPort.seek(to)),
    jumpToEvent: (target) => enqueue(() => innerClockPort.jumpToEvent(target)),
    setSpeed: (speed: number) => enqueue(() => innerClockPort.setSpeed(speed)),
    followRealtime: (enabled: boolean) => enqueue(() => innerClockPort.followRealtime(enabled)),
    getClock: () => innerClockPort.getClock(),
  };

  const commandPort: CommandPort = {
    submitOrder: (command) => enqueue(() => executeCommand(command)),
    cancelOrder: (command) => enqueue(() => executeCommand(command)),
    replaceOrder: (command) => enqueue(() => executeCommand(command)),
    closePosition: (command) => enqueue(() => executeCommand(command)),
    addAnnotation: (command) => enqueue(() => executeCommand(command)),
    createSnapshot: (command) => enqueue(() => executeCommand(command)),
    branchWorld: (command) => enqueue(() => executeCommand(command)),
    setScenario: (command) => enqueue(() => executeCommand(command)),
  };

  const protocol: WorldProtocol = {
    query: queryPort,
    command: commandPort,
    clock: clockPort,
    evidence: evidencePort,
  };

  return {
    worldId: definition.scope.worldId,
    protocol,
    query: queryPort,
    command: commandPort,
    clock: clockPort,
    evidence: evidencePort,
    journal,
    clockState: () => clock.state(),
    worldState: () => state,
    determinismManifest: () => buildDeterminismManifest({ definition, commandStreamHasher }),
    headlessReport: () =>
      buildHeadlessReport({
        worldId: definition.scope.worldId,
        mode: definition.mode,
        seed: definition.seed,
        finalSimulationTime: clock.state().simulationTime,
        journal,
      }),
  };
}
