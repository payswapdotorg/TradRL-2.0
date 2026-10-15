/**
 * W030 EQUIVALENCE (the product law): for any event stream, reading through
 * the coalescer yields the SAME state per surface as reading raw.
 *
 * Property tests over LIVE streams on the REAL W017 generated market (clock
 * steps drive generator turns through the real matching engine; human market
 * orders interleave; consumers read the engine at the stream's own clock
 * position — no post-hoc replay): for several seeded drain schedules,
 * - at EVERY observation point, each dirty entry's coalesced value deep-equals
 *   the raw consumer's current value for that (surface, key);
 * - after the final forced drain, EVERY configured (surface, key) deep-equals
 *   the raw final value — the coalesced view IS the latest projection, never
 *   a blend, never dropped (a coalescer that dropped or merged state fails
 *   here);
 * - the A7 firewall holds through the coalescer: a trade whose availableAt is
 *   beyond the observation point never appears in the coalesced tape.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { readCoalescedDrain } from "../reads.js";
import { createProjectionCoalescer, type ProjectionCoalescerConfig } from "../coalescer.js";
import {
  INSTRUMENT,
  allSurfacesConfig,
  createRawConsumer,
  runHighRateStream,
  seededRandom,
  valueKey,
  type HighRateStream,
  type HighRateStreamOptions,
} from "./helpers.js";

/** One live property run: a raw consumer + a randomly-draining coalesced
 * consumer over the SAME live stream, compared at every observation point. */
async function assertLiveEquivalence(
  options: HighRateStreamOptions,
  config: ProjectionCoalescerConfig,
  drainProbability: number,
  seed: number,
): Promise<HighRateStream> {
  const random = seededRandom(seed);
  const raw = createRawConsumer(config);
  let observationPoints = 0;
  let checkedValues = 0;
  let coalesced: ReturnType<typeof createProjectionCoalescer> | undefined;

  const stream = await runHighRateStream({
    ...options,
    consumers: [
      raw.factory, // FIRST: raw reads every signal before the coalesced consumer sees it
      async (engine) => {
        coalesced = createProjectionCoalescer(config);
        // The attach drain: the declared keys' initial refresh.
        const initial = await readCoalescedDrain(coalesced.drain(), { query: engine.query });
        for (const value of initial) {
          assert.deepEqual(
            value.value,
            raw.latest().get(valueKey(value.surface, value.key)),
            `initial: ${value.surface}:${String(value.key)} diverged from the raw read`,
          );
        }
        return {
          async onSignal(signal: { kind: string; events?: readonly WorldEventEnvelope[] }) {
            if (signal.kind === "publication") {
              coalesced!.ingestPublication(signal.events ?? []);
            } else {
              coalesced!.ingestClock();
            }
            if (random() < drainProbability) {
              observationPoints += 1;
              const batch = await readCoalescedDrain(coalesced!.drain(), {
                query: engine.query,
              });
              for (const value of batch) {
                checkedValues += 1;
                assert.deepEqual(
                  value.value,
                  raw.latest().get(valueKey(value.surface, value.key)),
                  `observation ${observationPoints}: ${value.surface}:${String(value.key)} diverged from the raw read`,
                );
              }
            }
          },
        };
      },
    ],
  });
  await raw.finish();
  assert.ok(coalesced !== undefined, "the coalesced consumer attached");
  // The final forced drain: EVERY configured key equals the raw final state —
  // the equivalence law's strongest form (drops and blends fail here).
  const finalBatch = await readCoalescedDrain(coalesced.drain({ force: true }), {
    query: stream.engine.query,
  });
  const finalKeys = finalBatch.map((value) => valueKey(value.surface, value.key)).sort();
  const rawKeys = [...raw.latest().keys()].sort();
  assert.deepEqual(finalKeys, rawKeys, "the forced final drain covers every raw key");
  for (const value of finalBatch) {
    assert.deepEqual(
      value.value,
      raw.latest().get(valueKey(value.surface, value.key)),
      `final: ${value.surface}:${String(value.key)} — the coalesced view is NOT the raw final projection`,
    );
  }
  assert.ok(observationPoints > 0, "the schedule produced at least one observation point");
  assert.ok(checkedValues > 0, "at least one intermediate value was compared");
  return stream;
}

test("EQUIVALENCE property: coalesced reads equal raw reads across seeded drain schedules", async () => {
  const config = allSurfacesConfig();
  for (const [seed, drainProbability] of [
    [11, 0.2],
    [29, 0.5],
    [47, 0.9],
  ] as const) {
    await assertLiveEquivalence(
      { steps: 25, stepMs: 1_000, humanOrderEvery: 3 },
      config,
      drainProbability,
      seed,
    );
  }
});

test("EQUIVALENCE holds for tight windows (frequent forced overflows) too", async () => {
  const config = allSurfacesConfig({
    surfaces: {
      quote: { window: { maxEvents: 2 } },
      orderbook: { window: { maxEvents: 2 } },
      trades: { window: { maxEvents: 1 } },
      orders: { window: { maxSimMs: 1 } },
      positions: { window: { maxEvents: 3 } },
      portfolio: { window: { maxEvents: 3 } },
      risk: { window: { maxEvents: 3 } },
      news: { window: { maxSimMs: 5_000 } },
      timeline: { window: { maxEvents: 4 } },
    },
  });
  await assertLiveEquivalence(
    { steps: 20, stepMs: 1_000, humanOrderEvery: 2 },
    config,
    0.3,
    5,
  );
});

test("EQUIVALENCE holds for the degenerate no-coalescing config (maxEvents 1 everywhere)", async () => {
  const config = allSurfacesConfig({
    surfaces: {
      quote: { window: { maxEvents: 1 } },
      orderbook: { window: { maxEvents: 1 } },
      trades: { window: { maxEvents: 1 } },
      orders: { window: { maxEvents: 1 } },
      positions: { window: { maxEvents: 1 } },
      portfolio: { window: { maxEvents: 1 } },
      risk: { window: { maxEvents: 1 } },
      news: { window: { maxEvents: 1 } },
      timeline: { window: { maxEvents: 1 } },
    },
  });
  await assertLiveEquivalence(
    { steps: 15, stepMs: 1_000, humanOrderEvery: 4 },
    config,
    0.6,
    7,
  );
});

test("A7 through the coalescer: the tape never shows an unobservable print", async () => {
  const config = allSurfacesConfig();
  let coalesced: ReturnType<typeof createProjectionCoalescer> | undefined;
  const stream = await runHighRateStream({
    steps: 30,
    stepMs: 1_000,
    humanOrderEvery: 3,
    consumers: [
      async (_engine) => {
        coalesced = createProjectionCoalescer(config);
        return {
          async onSignal(signal: { kind: string; events?: readonly WorldEventEnvelope[] }) {
            if (signal.kind === "publication") {
              coalesced!.ingestPublication(signal.events ?? []);
            } else {
              coalesced!.ingestClock();
            }
          },
        };
      },
    ],
  });
  assert.ok(coalesced !== undefined);
  const finalBatch = await readCoalescedDrain(coalesced.drain({ force: true }), {
    query: stream.engine.query,
  });
  const tape = finalBatch.find((value) => value.surface === "trades" && value.key === INSTRUMENT);
  assert.ok(tape !== undefined, "the final drain read the tape");
  const clock = await stream.engine.clock.getClock();
  const prints = stream.engine.journal
    .records()
    .map((record) => record.envelope)
    .filter((envelope) => envelope.eventType === "market.trade.printed");
  const observablePrints = prints.filter(
    (print) => (print.availableAt ?? print.occurredAt) <= clock.simulationTime,
  );
  assert.ok(prints.length > 0, "the stream printed trades");
  assert.equal(
    (tape.value as readonly unknown[]).length,
    observablePrints.length,
    "the coalesced tape is exactly the observable prints at the observation point (A7)",
  );
  assert.ok(
    (tape.value as readonly { tradeId?: string }[]).every((trade) =>
      observablePrints.some(
        (print) => (print.payload as { tradeId?: string }).tradeId === trade.tradeId,
      ),
    ),
    "every coalesced tape row is a journaled, observable print",
  );
});
