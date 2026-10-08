/**
 * W030 A9 (determinism): coalescing never changes determinism — identical
 * event streams + identical drain schedules produce IDENTICAL coalesced
 * outputs (drain batches AND read values, bit-for-bit), and wall time never
 * enters (twin runs with wall axes a day apart coalesce identically — the
 * coalescer's inputs are journal events + clock observations only).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { readCoalescedDrain, type CoalescedProjection } from "../reads.js";
import {
  createProjectionCoalescer,
  type CoalescedDrain,
  type ProjectionCoalescerConfig,
} from "../coalescer.js";
import {
  allSurfacesConfig,
  runHighRateStream,
  WALL_START,
  type HighRateStreamOptions,
} from "./helpers.js";

/** One recorded observation: the drain batch + the read values. */
interface ObservationLog {
  readonly drains: readonly CoalescedDrain[];
  readonly values: readonly (readonly CoalescedProjection[])[];
}

/**
 * Run the stream with a FIXED drain schedule (every N-th signal) and record
 * every drain + every coalesced value — the full observable output.
 */
async function recordCoalesced(options: HighRateStreamOptions): Promise<ObservationLog> {
  const config: ProjectionCoalescerConfig = allSurfacesConfig();
  const drains: CoalescedDrain[] = [];
  const values: (readonly CoalescedProjection[])[] = [];
  let coalescer: ReturnType<typeof createProjectionCoalescer> | undefined;
  let signalIndex = 0;
  await runHighRateStream({
    ...options,
    consumers: [
      async (engine) => {
        coalescer = createProjectionCoalescer(config);
        drains.push(coalescer.drain());
        values.push(await readCoalescedDrain(drains[0]!, { query: engine.query }));
        return {
          async onSignal(signal: { kind: string; events?: readonly WorldEventEnvelope[] }) {
            if (signal.kind === "publication") {
              coalescer!.ingestPublication(signal.events ?? []);
            } else {
              coalescer!.ingestClock();
            }
            signalIndex += 1;
            if (signalIndex % 3 === 0) {
              const drain = coalescer!.drain();
              drains.push(drain);
              values.push(await readCoalescedDrain(drain, { query: engine.query }));
            }
          },
        };
      },
    ],
  });
  const finalDrain = coalescer!.drain({ force: true });
  drains.push(finalDrain);
  return { drains, values };
}

test("A9: twin runs produce identical coalesced outputs (drains + values, bit-for-bit)", async () => {
  const options: HighRateStreamOptions = { steps: 24, stepMs: 1_000, humanOrderEvery: 3 };
  const first = await recordCoalesced(options);
  const second = await recordCoalesced(options);
  assert.ok(first.drains.length > 5, "the schedule produced multiple drains");
  assert.deepEqual(first.drains, second.drains, "identical drain batches");
  assert.deepEqual(first.values, second.values, "identical coalesced values");
});

test("A9: wall axes a day apart coalesce identically (wall time never enters)", async () => {
  const base: HighRateStreamOptions = { steps: 18, stepMs: 1_000, humanOrderEvery: 4 };
  const dayMs = 24 * 60 * 60 * 1_000;
  const early = await recordCoalesced({ ...base, wallTime: WALL_START });
  const late = await recordCoalesced({ ...base, wallTime: WALL_START + dayMs });
  assert.deepEqual(early.drains, late.drains, "the drain batches ignore the wall axis");
  assert.deepEqual(early.values, late.values, "the coalesced values ignore the wall axis");
});

test("A9: the coalesced journal parity — every published event was ingested", async () => {
  // The published channel is lossless THROUGH the coalescer's inputs: the
  // total ingested event count equals the journal's event count (the W019
  // projection-law invariant preserved on the consumption side).
  const options: HighRateStreamOptions = { steps: 20, stepMs: 1_000, humanOrderEvery: 3 };
  let ingested = 0;
  const coalescer = createProjectionCoalescer(allSurfacesConfig());
  const stream = await runHighRateStream({
    ...options,
    consumers: [
      async () => ({
        onSignal(signal: { kind: string; events?: readonly WorldEventEnvelope[] }) {
          if (signal.kind === "publication") {
            coalescer.ingestPublication(signal.events ?? []);
            ingested += (signal.events ?? []).length;
          } else {
            coalescer.ingestClock();
          }
        },
      }),
    ],
  });
  assert.equal(ingested, stream.engine.journal.records().length);
  assert.equal(
    ingested,
    stream.publishedEventCount,
    "every published event crossed the coalescer exactly once",
  );
});
