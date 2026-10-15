/**
 * THE W024 DETERMINISM PROOF (A9): the SAME world definition + engine +
 * seed + agent declarations + clock stream, run twice, produce the
 * IDENTICAL journal, per-agent W023 telemetry and delivery counts —
 * deep-equal, run twice. Step-partition changes (the same total advance,
 * different step sizes) produce the same journal. And a different world
 * seed DIVERGES (the proof is not vacuous: the seed genuinely moves the
 * reactive market through the latency draws).
 *
 * The methodology mirrors the W023 twin test
 * (tradrl-market-participants/test/determinism.twin.test.ts) at the
 * adapter level: wall time never enters the run identity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAbidesKernel, type AbidesAgentDeclaration } from "../kernel.js";
import type { AbidesWorldDefinition } from "../definition.js";
import {
  abidesWorld,
  driveSteps,
  marketMakerDeclaration,
  noiseTraderDeclaration,
  rangeLatencyWorld,
  settleMicrotasks,
} from "./fixtures.js";

const STEPS = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];

/** One complete twin-eligible run: construct, drive, settle, collect. */
async function runOnce(
  definition: AbidesWorldDefinition,
  declarations: () => readonly AbidesAgentDeclaration[],
  steps: readonly number[],
): Promise<{
  now: number;
  delivered: number;
  queued: number;
  events: unknown;
  mm: unknown;
  noise: unknown;
}> {
  const kernel = createAbidesKernel({ definition, agents: declarations() });
  try {
    await driveSteps(kernel, steps);
    await settleMicrotasks(12);
    return {
      now: Number(kernel.now()),
      delivered: kernel.deliveredMessages(),
      queued: kernel.queuedMessages(),
      events: kernel.events(),
      mm: kernel.telemetry("mm-1"),
      noise: kernel.telemetry("noise-1"),
    };
  } finally {
    kernel.dispose();
  }
}

test("twin runs: same definition + seed + stream ⇒ deep-equal everything", async () => {
  const runA = await runOnce(abidesWorld(), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  const runB = await runOnce(abidesWorld(), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  // The runs are non-trivial: the reactive market genuinely moved.
  assert.ok(runA.delivered > 50, `a rich run (delivered ${String(runA.delivered)})`);
  assert.ok((runA.events as { length: number }).length > 20, "a rich journal");
  assert.ok((runA.noise as { outcomes: unknown[] }).outcomes.length > 0, "the noise agent traded");
  // A9: identical results, deep-equal, run twice.
  assert.deepEqual(runA, runB);
});

test("step-partition invariance: the same total advance, same journal", async () => {
  const fine = await runOnce(abidesWorld(), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  const coarse = await runOnce(
    abidesWorld(),
    () => [marketMakerDeclaration(), noiseTraderDeclaration()],
    [300, 300, 300, 300],
  );
  const single = await runOnce(abidesWorld(), () => [marketMakerDeclaration(), noiseTraderDeclaration()], [1_200]);
  assert.deepEqual(fine.events, coarse.events, "four 300ms steps ≡ twelve 100ms steps");
  assert.deepEqual(fine.events, single.events, "one 1200ms step ≡ twelve 100ms steps");
  assert.equal(fine.now, coarse.now);
  assert.equal(fine.now, single.now);
});

test("a different world seed diverges (the proof is not vacuous)", async () => {
  const seedA = await runOnce(rangeLatencyWorld("w024-seed-a"), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  const seedB = await runOnce(rangeLatencyWorld("w024-seed-b"), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  assert.notDeepEqual(seedA.events, seedB.events, "range latency draws key off the world seed");
  assert.equal(seedA.now, seedB.now);
});

test("twin runs under RANGE latencies stay deep-equal (seeded draws, no cursor)", async () => {
  const runA = await runOnce(rangeLatencyWorld("w024-seed-a"), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  const runB = await runOnce(rangeLatencyWorld("w024-seed-a"), () => [marketMakerDeclaration(), noiseTraderDeclaration()], STEPS);
  assert.deepEqual(runA, runB);
});
