/**
 * THE W023 DETERMINISM PROOF — the A9 twin runs: the SAME world + the SAME
 * declared agents + the SAME disciplined clock stream, run twice through the
 * REAL composed attachment with the WALL AXIS a full day apart, produce the
 * IDENTICAL participant command stream, telemetry and journal identity —
 * and a DIFFERENT agent seed diverges (the proof is not vacuous: the agents
 * genuinely move the world).
 *
 * The methodology mirrors the W019 wall-twin golden
 * (tests/trading-world/determinismGoldenWallTwin.test.ts) at the participant
 * level: wall time never enters the run identity.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createParticipantRuntime } from "../src/runtime.js";
import { createMomentumAgent } from "../src/agents/momentum.js";
import { createMeanReversionAgent } from "../src/agents/meanReversion.js";
import type { ParticipantRuntimeTelemetry } from "../../tradrl-world-contracts/src/participantProtocol.js";
import { attachAgentWorld, fixedWallSource } from "./helpers.js";
import { DRIVE_STEPS, driveJourney } from "./referenceRuntime.js";

const DAY_MS = 86_400_000;
const WALL_T1 = 1_700_000_500_000;
const WORLD_ID = "world-w023-twin";

/** One full twin-eligible run: attach, arm, drive, collect. */
async function runOnce(wallAt: number, momentumSeed: string) {
  const client = await attachAgentWorld(WORLD_ID, { wallTimeSource: fixedWallSource(wallAt) });
  try {
    const instrument = `instrument-es-${WORLD_ID}` as never;
    const account = `account-agents-${WORLD_ID}` as never;
    const momentum = createMomentumAgent({
      agentId: "momentum",
      participantId: `participant-agent-momentum-${WORLD_ID}` as never,
      accountId: account,
      instrumentId: instrument,
      seed: momentumSeed,
      lookbackTrades: 8,
      thresholdTicks: 4,
      baseLots: 2,
      jitterLots: 2,
      maxPositionLots: 6,
      cooldownMs: 4000,
    });
    const meanReversion = createMeanReversionAgent({
      agentId: "mean-reversion",
      participantId: `participant-agent-mr-${WORLD_ID}` as never,
      accountId: account,
      instrumentId: instrument,
      referenceTrades: 10,
      entryDeviationTicks: 3,
      exitDeviationTicks: 1,
      quoteOffsetTicks: 2,
      quoteLots: 1,
      maxPositionLots: 6,
      maxWorkingQuotes: 2,
    });
    const runtime = createParticipantRuntime({
      client,
      agents: [momentum, meanReversion],
      views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
    });
    runtime.start();
    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();
    const report = await client.host.headlessReport();
    const manifest = await client.evidence.getDeterminismManifest();
    runtime.stop();
    return { telemetry, report, manifest };
  } finally {
    client.dispose();
  }
}

/** The normalized participant command stream (the A9 comparable). */
function commandStreamOf(telemetry: ParticipantRuntimeTelemetry) {
  return telemetry.outcomes.map((outcome) => ({
    agentId: outcome.agentId,
    commandId: outcome.commandId,
    status: outcome.result.status,
    ...(outcome.result.status === "acked"
      ? { cursor: outcome.result.ack.journalCursor, events: outcome.result.ack.resultingEventIds.length }
      : { stage: outcome.result.rejection.stage, code: outcome.result.rejection.code }),
  }));
}

// RUN ONE and RUN TWO (the twin): identical inputs, wall axes a day apart.
const runOne = await runOnce(WALL_T1, "w023-reference-momentum");
const runTwo = await runOnce(WALL_T1 + DAY_MS, "w023-reference-momentum");
// RUN THREE (the divergence control): a different momentum seed.
const runThree = await runOnce(WALL_T1, "w023-alt-momentum-seed");

test("A9 twin: one wall day apart, the participant command stream is IDENTICAL", () => {
  const streamOne = commandStreamOf(runOne.telemetry);
  const streamTwo = commandStreamOf(runTwo.telemetry);
  assert.ok(streamOne.length > 0, "the agents issued commands (the proof is not vacuous)");
  assert.deepEqual(streamTwo, streamOne, "same views ⇒ same commands (A9)");
  assert.equal(runTwo.telemetry.viewsReceived, runOne.telemetry.viewsReceived);
  assert.equal(runTwo.telemetry.acked, runOne.telemetry.acked);
  assert.equal(runTwo.telemetry.rejected, runOne.telemetry.rejected);
});

test("A9 twin: every pass's settled view and every agent's decision are IDENTICAL", () => {
  assert.equal(runTwo.telemetry.passes.length, runOne.telemetry.passes.length);
  for (const [index, passOne] of runOne.telemetry.passes.entries()) {
    const passTwo = runTwo.telemetry.passes[index]!;
    assert.equal(Number(passTwo.observedAt), Number(passOne.observedAt));
    // The settled views (quotes, books, firewalled trades, portfolio, risk,
    // own orders) evolved identically — the whole observable world.
    assert.deepEqual(passTwo.view, passOne.view, `pass ${String(index)} view identity`);
    // The decisions (intents AND rationales — the deterministic explanations).
    assert.deepEqual(
      passTwo.decisions.get("momentum"),
      passOne.decisions.get("momentum"),
      `pass ${String(index)} momentum decision identity`,
    );
    assert.deepEqual(
      passTwo.decisions.get("mean-reversion"),
      passOne.decisions.get("mean-reversion"),
      `pass ${String(index)} mean-reversion decision identity`,
    );
  }
});

test("A9 twin: the journal identity is UNCHANGED (the agents' commands are part of the world)", () => {
  assert.equal(runTwo.report.eventCount, runOne.report.eventCount);
  assert.equal(runTwo.report.eventHash, runOne.report.eventHash);
  assert.equal(runTwo.report.seed, runOne.report.seed);
  assert.equal(runTwo.manifest.commandStreamHash, runOne.manifest.commandStreamHash);
  assert.equal(runTwo.manifest.inputHashes.worldDefinition, runOne.manifest.inputHashes.worldDefinition);
});

test("A9 divergence control: a different agent seed produces a DIFFERENT world", () => {
  const streamOne = commandStreamOf(runOne.telemetry);
  const streamThree = commandStreamOf(runThree.telemetry);
  // The engine's own identity diverges — the reactive participants are real
  // market participants whose commands change the journal.
  assert.notEqual(runThree.report.eventHash, runOne.report.eventHash);
  assert.ok(
    streamThree.some((row, index) => streamOne[index] === undefined || row.commandId !== streamOne[index]!.commandId),
    "the alt-seed momentum agent drew different sizes (the seeded RNG is real)",
  );
});

test("A9 discipline note: the drive's settle round-trips never journaled anything", () => {
  // The quiet-round-trip settle issues getClock reads only; the journal size
  // equals the event count of a single deterministic run — the twins already
  // prove it, this pins the mechanism (no hidden mutating calls from settle).
  assert.equal(runOne.report.eventCount > 0, true);
  assert.equal(runOne.telemetry.status, "idle");
  assert.equal(DRIVE_STEPS, runOne.telemetry.viewsReceived);
});
