/**
 * The consumer-run machinery (split from helpers.ts — the 400-line law):
 * the drain recorder, the raw vs coalesced consumers, and the run helpers.
 */
import assert from "node:assert/strict";
import type { TimestampMs } from "tradrl-world-contracts";
import type { HeadlessWorldEngine } from "../../world/index.js";
import { createProjectionCoalescer, type ProjectionCoalescer, type CoalescedDrain } from "../coalescer.js";
import { readCoalescedDrain, type CoalescedProjection } from "../reads.js";
import { countingQueryPort, type ConsumerRun } from "./helpers.js";

interface Recorder {
  readonly counter: ReturnType<typeof countingQueryPort>;
  readonly states: Record<string, number>;
  readonly latest: Map<string, CoalescedProjection["value"]>;
  drains: number;
}

async function recordDrain(
  recorder: Recorder,
  drain: CoalescedDrain,
): Promise<readonly CoalescedProjection[]> {
  recorder.drains += 1;
  const values = await readCoalescedDrain(drain, { query: recorder.counter.port }, {});
  const seenSurfaces = new Set<string>();
  for (const value of values) {
    recorder.latest.set(`${value.surface}:${String(value.key)}`, value.value);
    if (!seenSurfaces.has(value.surface)) {
      seenSurfaces.add(value.surface);
      recorder.states[value.surface] = (recorder.states[value.surface] ?? 0) + 1;
    }
  }
  return values;
}

function finishRun(recorder: Recorder): ConsumerRun {
  return {
    reads: recorder.counter.counts(),
    readTotal: recorder.counter.total(),
    statesPerSurface: { ...recorder.states },
    latest: recorder.latest,
    drains: recorder.drains,
  };
}

function ingestSignal(
  coalescer: ProjectionCoalescer,
  signal: StreamSignal,
): readonly SurfaceOverflow[] {
  if (signal.kind === "publication") {
    return coalescer.ingestPublication(signal.events);
  }
  coalescer.ingestClock();
  return [];
}

/** A live consumer wrapper: `factory` for runHighRateStream, `finish` after. */
export interface ConsumerHandle {
  readonly factory: (
    engine: HeadlessWorldEngine,
  ) => Promise<LiveSignalConsumer> | LiveSignalConsumer;
  /** Live view of the latest values (valid mid-run for ordered consumers). */
  readonly latest: () => ReadonlyMap<string, CoalescedProjection["value"]>;
  /** The final forced drain (coalesced) / pass-through (raw); returns the run. */
  finish: () => Promise<ConsumerRun>;
}

/**
 * The RAW consumer: after EVERY signal it re-reads every configured surface
 * key (the W009 projection-feed behavior — one refresh per engine signal).
 * This is the baseline the coalesced path must be equivalent to.
 */
export function createRawConsumer(
  config: ProjectionCoalescerConfig,
): ConsumerHandle {
  let recorder: Recorder | undefined;
  let coalescer: ProjectionCoalescer | undefined;
  return {
    async factory(engine) {
      assert.ok(recorder === undefined, "raw consumer factory runs once");
      recorder = {
        counter: countingQueryPort(engine.query),
        states: {},
        latest: new Map(),
        drains: 0,
      };
      coalescer = createProjectionCoalescer(config);
      // The attach fetch: the declared keys' initial refresh.
      await recordDrain(recorder, coalescer.drain());
      return {
        async onSignal(signal) {
          ingestSignal(coalescer!, signal); // discovery bookkeeping (no reads)
          await recordDrain(recorder!, coalescer!.drain({ force: true }));
        },
      };
    },
    latest: () => recorder?.latest ?? new Map(),
    async finish() {
      assert.ok(recorder !== undefined && coalescer !== undefined);
      return finishRun(recorder);
    },
  };
}

export interface CoalescedPolicy {
  /** Drain at every `drainEvery`-th signal (>= 1). */
  readonly drainEvery: number;
  /** Also drain immediately whenever a window overflows. */
  readonly drainOnOverflow?: boolean;
}

/**
 * The COALESCED consumer: ingests every signal, drains at the policy's
 * observation points; only dirty (surface, key) pairs are re-read. `finish`
 * performs the final forced drain (the last observation point).
 */
export function createCoalescedConsumer(
  config: ProjectionCoalescerConfig,
  policy: CoalescedPolicy,
): ConsumerHandle {
  let recorder: Recorder | undefined;
  let coalescer: ProjectionCoalescer | undefined;
  let signalIndex = 0;
  return {
    async factory(engine) {
      assert.ok(recorder === undefined, "coalesced consumer factory runs once");
      recorder = {
        counter: countingQueryPort(engine.query),
        states: {},
        latest: new Map(),
        drains: 0,
      };
      coalescer = createProjectionCoalescer(config);
      await recordDrain(recorder, coalescer.drain());
      return {
        async onSignal(signal) {
          const overflow = ingestSignal(coalescer!, signal);
          signalIndex += 1;
          const scheduled = signalIndex % policy.drainEvery === 0;
          const overflowed = policy.drainOnOverflow === true && overflow.length > 0;
          if (scheduled || overflowed) {
            await recordDrain(recorder!, coalescer!.drain());
          }
        },
      };
    },
    latest: () => recorder?.latest ?? new Map(),
    async finish() {
      assert.ok(recorder !== undefined && coalescer !== undefined);
      await recordDrain(recorder, coalescer.drain({ force: true }));
      return finishRun(recorder);
    },
  };
}

/** Compare helper: the latest-value key for one surface value. */
export function valueKey(surface: string, key: string | undefined): string {
  return `${surface}:${String(key)}`;
}

/** Sim time helper (readability). */
export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}
