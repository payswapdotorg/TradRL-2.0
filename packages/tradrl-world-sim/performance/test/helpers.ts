/**
 * Shared fixtures for the W030 performance module tests: a deterministic
 * high-rate stream over the REAL W017 generated market (one engine, clock
 * steps drive generator turns through the real matching engine, human market
 * orders interleave to dirty the financial surfaces), a counting QueryPort
 * proxy (honest read COUNTS — never wall-clock claims), a seeded PRNG for
 * deterministic drain schedules, and the raw-path emulator (reads every
 * configured surface key after every signal) the equivalence and compression
 * laws compare against.
 */

import type {
  Account,
  Instrument,
  Participant,
  SubmitOrderCommand,
  Venue,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { WallTimeMs } from "tradrl-world-contracts/time";
import type { HeadlessWorldEngine } from "../../world/index.js";
import { createGeneratedWorldEngine } from "../../generator/engine.js";
import type { WorldDefinition } from "../../world/index.js";
import { type ProjectionCoalescerConfig } from "../coalescer.js";

export const WORLD = "world-w030-perf" as WorldDefinition["scope"]["worldId"];
export const INSTRUMENT = "instrument-es-w030" as Instrument["instrumentId"];
export const VENUE_ID = "venue-w030" as Venue["venueId"];
export const TRADER = "participant-trader-w030" as Participant["participantId"];
export const TRADER_ACCOUNT = "account-trader-w030" as Account["accountId"];
export const MM_ACCOUNT = "account-mm-w030" as Account["accountId"];
export const SYNTH_ACCOUNT = "account-synth-w030" as Account["accountId"];
export const START = 1_700_000_000_000;
export const WALL_START = 1_700_000_500_000;

function accountOf(accountId: Account["accountId"]): Account {
  return {
    accountId,
    worldId: WORLD,
    balances: { USD: { amount: "10000000.00", currency: "USD" } } as never,
    buyingPower: { amount: "10000000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "10000000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

export function performanceDefinition(): WorldDefinition {
  return {
    scope: { tenantId: "tenant-alpha" as never, projectId: "project-w030" as never, worldId: WORLD },
    mode: "reactive-replay",
    seed: "w030-perf-seed",
    worldDefinitionVersion: "w030-perf@1",
    inputDataSource: "synthetic://w030",
    regimeSchedule: [
      {
        regime: "mean-reversion",
        from: START as never,
        to: (START + 25_000) as never,
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      { regime: "trend", from: (START + 25_000) as never, to: (START + 50_000) as never },
    ],
    clock: {
      start: START as never,
      defaultStepMs: 1_000,
      initialWallTime: WALL_START as never,
    },
    instruments: [
      {
        instrumentId: INSTRUMENT,
        worldId: WORLD,
        venueId: VENUE_ID,
        symbol: "ES-W030",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
    ],
    venues: [
      {
        venueId: VENUE_ID,
        worldId: WORLD,
        name: "w030-sim-venue",
        matchingModel: "price-time-priority",
        allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
        feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        calendar: {
          sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }],
        },
        haltPolicy: { haltOnShock: false },
      },
    ],
    accounts: [accountOf(TRADER_ACCOUNT), accountOf(MM_ACCOUNT), accountOf(SYNTH_ACCOUNT)],
    participants: [
      { participantId: TRADER, worldId: WORLD, kind: "human", accountId: TRADER_ACCOUNT },
      {
        participantId: "participant-mm-1-w030" as never,
        worldId: WORLD,
        kind: "passive-market-maker",
        accountId: MM_ACCOUNT,
      },
      {
        participantId: "participant-taker-w030" as never,
        worldId: WORLD,
        kind: "liquidity-taker",
        accountId: SYNTH_ACCOUNT,
      },
      {
        participantId: "participant-noise-w030" as never,
        worldId: WORLD,
        kind: "noise-trader",
        accountId: SYNTH_ACCOUNT,
      },
    ],
  } as const as WorldDefinition;
}

/** A wall-time source fixed at an arbitrary origin (determinism discipline). */
export function fixedWallSource(at: number): () => WallTimeMs {
  return () => at as WallTimeMs;
}

/** Deterministic seeded PRNG (mulberry32) — schedules are reproducible (A9). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A human market order (alternating side) — fills on generated liquidity.
 * Deterministic: a pure function of the step index (A9 twin runs identical). */
function humanMarketOrder(stepIndex: number): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: `cmd-human-w030-${String(stepIndex)}` as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: (START + stepIndex * 1_000) as never,
    accountId: TRADER_ACCOUNT,
    instrumentId: INSTRUMENT,
    submission: {
      kind: "market",
      side: stepIndex % 2 === 0 ? "buy" : "sell",
      quantity: "1" as never,
      constraints: { timeInForce: "IOC" },
    },
  } as const as SubmitOrderCommand;
}

export interface HighRateStream {
  readonly engine: HeadlessWorldEngine;
  /** The unified signal sequence a streaming consumer sees, in order. */
  readonly signals: readonly StreamSignal[];
  /** Every published batch's events, in publication order. */
  readonly publications: readonly (readonly WorldEventEnvelope[])[];
  /** Journal parity: total events seen on the published channel. */
  readonly publishedEventCount: number;
  /** One settled clock observation per acked clock step. */
  readonly clockObservations: number;
}

/** One streaming signal: an engine publication or a settled clock view. */
export type StreamSignal =
  | { readonly kind: "publication"; readonly events: readonly WorldEventEnvelope[] }
  | { readonly kind: "clock" };

export interface HighRateStreamOptions {
  readonly steps: number;
  readonly stepMs: number;
  /** Submit a human market order every N steps (0: never). */
  readonly humanOrderEvery?: number;
  readonly wallTime?: number;
  /**
   * Consumer factories: each receives the LIVE engine (at its initial state,
   * before any step) and returns a consumer fed every signal IN ORDER —
   * consumers read the engine at the stream's own clock position (the honest
   * live-consumption shape; no post-hoc replay against a finished engine).
   */
  readonly consumers?: readonly ((
    engine: HeadlessWorldEngine,
  ) => Promise<LiveSignalConsumer> | LiveSignalConsumer)[];
}

/** One streaming consumer: fed every signal in order (may read the engine). */
export interface LiveSignalConsumer {
  onSignal(signal: StreamSignal): Promise<void> | void;
}

/**
 * Drive a deterministic high-rate stream: each clock step is one generator
 * turn (a publication) followed by its settled clock view; human orders
 * interleave on the given cadence (publications of their own). Consumers are
 * fed every signal in order, live — the publication signals an operation
 * produced are flushed (awaited) after the operation settles, exactly the
 * order the W018 transport delivers them to a client.
 */
export async function runHighRateStream(
  options: HighRateStreamOptions,
): Promise<HighRateStream> {
  const publications: (readonly WorldEventEnvelope[])[] = [];
  const signals: StreamSignal[] = [];
  let publishedEventCount = 0;
  let clockObservations = 0;
  let pending: StreamSignal[] = [];
  const emit = async (signal: StreamSignal): Promise<void> => {
    signals.push(signal);
    if (signal.kind === "publication") {
      publishedEventCount += signal.events.length;
    } else {
      clockObservations += 1;
    }
    for (const consumer of consumers) {
      await consumer.onSignal(signal);
    }
  };
  const flushPending = async (): Promise<void> => {
    const queued = pending;
    pending = [];
    for (const signal of queued) {
      await emit(signal);
    }
  };
  const engine = createGeneratedWorldEngine({
    definition: performanceDefinition(),
    wallTimeSource: fixedWallSource(options.wallTime ?? WALL_START),
    onPublished: (published) => {
      publications.push(published.events);
      pending.push({ kind: "publication", events: published.events });
    },
  });
  const consumers: LiveSignalConsumer[] = [];
  for (const factory of options.consumers ?? []) {
    consumers.push(await factory(engine));
  }
  for (let step = 0; step < options.steps; step += 1) {
    await engine.clock.step(options.stepMs);
    await flushPending();
    await emit({ kind: "clock" });
    if (
      options.humanOrderEvery !== undefined &&
      options.humanOrderEvery > 0 &&
      step % options.humanOrderEvery === 0 &&
      step > 0
    ) {
      await engine.command.submitOrder(humanMarketOrder(step));
      await flushPending();
    }
  }
  return {
    engine,
    signals,
    publications,
    publishedEventCount,
    clockObservations,
  };
}

/** A QueryPort proxy that counts reads per method (honest counts only). */
export function countingQueryPort(query: QueryPort): {
  readonly port: QueryPort;
  readonly counts: () => Readonly<Record<string, number>>;
  readonly total: () => number;
} {
  const counts: Record<string, number> = {};
  const handler: ProxyHandler<QueryPort> = {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value === "function" && typeof property === "string") {
        counts[property] = (counts[property] ?? 0);
        return (...args: unknown[]) => {
          counts[property] = (counts[property] ?? 0) + 1;
          return (value as (...fnArgs: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  };
  return {
    port: new Proxy(query, handler),
    counts: () => ({ ...counts }),
    total: () => Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

/** The all-surfaces test config: every surface, declared keys, permissive windows. */
export function allSurfacesConfig(
  overrides: Partial<ProjectionCoalescerConfig> = {},
): ProjectionCoalescerConfig {
  const window = { maxEvents: 1_000, maxSimMs: 10_000 };
  return {
    surfaces: {
      quote: { window, keys: [INSTRUMENT] },
      orderbook: { window, keys: [INSTRUMENT] },
      trades: { window, keys: [INSTRUMENT] },
      orders: { window, keys: [TRADER_ACCOUNT, MM_ACCOUNT, SYNTH_ACCOUNT] },
      positions: { window, keys: [TRADER_ACCOUNT, MM_ACCOUNT, SYNTH_ACCOUNT] },
      portfolio: { window, keys: [TRADER_ACCOUNT, MM_ACCOUNT, SYNTH_ACCOUNT] },
      risk: { window, keys: [TRADER_ACCOUNT, MM_ACCOUNT, SYNTH_ACCOUNT] },
      news: { window },
      timeline: { window },
    },
    ...overrides,
  };
}

/** The observable outcome of one stream consumption run (counts only). */
export interface ConsumerRun {
  /** Port reads per QueryPort method (honest COUNTS — never wall-clock). */
  readonly reads: Readonly<Record<string, number>>;
  readonly readTotal: number;
  /** Intermediate states delivered per surface (one per emitted refresh). */
  readonly statesPerSurface: Readonly<Record<string, number>>;
  /** The latest value per `${surface}:${key}` at the end of the run. */
  readonly latest: ReadonlyMap<string, CoalescedProjection["value"]>;
  readonly drains: number;
}


export * from "./consumers.js";