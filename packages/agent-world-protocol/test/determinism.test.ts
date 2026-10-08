/**
 * THE W035 DETERMINISM PROOF — the A9 twin runs: the SAME world + the SAME
 * possessed agent + the SAME disciplined clock stream, run twice through
 * the REAL composed attachment with the WALL AXIS a full day apart, produce
 * the IDENTICAL session telemetry (every pass: grant, observed view, view
 * digest, decision stream, admission, outcomes — the whole observable
 * world and everything the agent did about it) and the IDENTICAL journal —
 * and a DIFFERENT agent (a different declared threshold) diverges (the
 * proof is not vacuous: the agent genuinely moves the world).
 *
 * The methodology mirrors the W023 determinism twin at the participant
 * level: wall time never enters the run identity.
 *
 * Run: ../../node_modules/.bin/tsx --test test/determinism.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";
import type { CognitiveSubstrate } from "tradrl-world-contracts/cognitiveSubstrate";
import type { PossessionDescriptor } from "possession/contracts";
import { createAgentWorldSession } from "../session.js";
import type { AgentSessionTelemetry } from "../contracts.js";
import { possessionOf, protocolWorldDefinition, SUBSTRATE_MR } from "./fixtures.js";
import { attachProtocolWorld, driveSession, fixedWallSource } from "./helpers.js";

const SIM_START = 1_700_000_000_000;
const DAY_MS = 86_400_000;
const WORLD_ID = "world-w035-twin";

/** The twin fixture: the MR mind with a configurable threshold. */
function mrFixture(threshold: string): {
  readonly possession: PossessionDescriptor;
  readonly substrate: CognitiveSubstrate;
} {
  const substrate = createMeanReversionSubstrate({
    substrateId: SUBSTRATE_MR,
    seed: "w035-mr-1",
    instrumentId: `instrument-es-${WORLD_ID}` as never,
    threshold,
    quantity: "1",
  });
  return { possession: possessionOf(substrate.descriptor, WORLD_ID), substrate };
}

/** One full twin-eligible run: attach, arm, drive, collect. */
async function runOnce(wallAt: number, threshold: string) {
  const client = await attachProtocolWorld(WORLD_ID, {
    wallTimeSource: fixedWallSource(wallAt),
  });
  try {
    const { possession, substrate } = mrFixture(threshold);
    const session = createAgentWorldSession({
      client,
      possession,
      substrate,
      world: protocolWorldDefinition(WORLD_ID),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, true, `attach must pass (${attach.ok ? "" : attach.message})`);
    session.start();
    await session.settle();
    // 24 steps = 120s of simulation: the calm mean-reversion regime (30s)
    // then the trend regime — the proposing regime pair, so the twin
    // exercises real decisions, real fills and real exits.
    await driveSession(client, session, 24, 5_000);
    const telemetry = session.telemetry();
    session.detach("operator-request");
    const report = await client.host.headlessReport();
    const manifest = await client.evidence.getDeterminismManifest();
    return { telemetry, report, manifest };
  } finally {
    client.dispose();
  }
}

/** The normalized command stream (the A9 comparable). */
function commandStreamOf(telemetry: AgentSessionTelemetry) {
  return telemetry.outcomes.map((outcome) => ({
    decisionId: String(outcome.decisionId),
    commandId: String(outcome.commandId),
    kind: outcome.commandKind,
    status: outcome.result.status,
    ...(outcome.result.status === "acked"
      ? { cursor: outcome.result.ack.journalCursor, events: outcome.result.ack.resultingEventIds.length }
      : { stage: outcome.result.rejection.stage, code: outcome.result.rejection.code }),
  }));
}

// RUN ONE and RUN TWO (the twin): identical inputs, wall axes a day apart.
const runOne = await runOnce(SIM_START + 5000, "0.75");
const runTwo = await runOnce(SIM_START + 5000 + DAY_MS, "0.75");
// RUN THREE (the divergence control): a different agent (a wider threshold).
const runThree = await runOnce(SIM_START + 5000, "1.25");

test("A9 twin: one wall day apart, the session telemetry is IDENTICAL", () => {
  assert.ok(runOne.telemetry.passes.length > 1, "the session ran (the proof is not vacuous)");
  assert.deepEqual(runTwo.telemetry, runOne.telemetry, "same world + agent + clock stream ⇒ identical telemetry (A9)");
  assert.equal(runTwo.telemetry.viewsReceived, runOne.telemetry.viewsReceived);
  assert.equal(runTwo.telemetry.observationsSkipped, runOne.telemetry.observationsSkipped);
});

test("A9 twin: every pass's observation and decision and outcome are IDENTICAL", () => {
  assert.equal(runTwo.telemetry.passes.length, runOne.telemetry.passes.length);
  for (const [index, passOne] of runOne.telemetry.passes.entries()) {
    const passTwo = runTwo.telemetry.passes[index]!;
    assert.equal(Number(passTwo.observedAt), Number(passOne.observedAt));
    // The whole observable world evolved identically.
    assert.deepEqual(passTwo.observation.grant, passOne.observation.grant, `pass ${String(index)} grant identity`);
    assert.deepEqual(passTwo.observation.view, passOne.observation.view, `pass ${String(index)} view identity`);
    assert.equal(passTwo.observation.viewDigest, passOne.observation.viewDigest);
    // The mind decided identically (rationale-as-data included).
    assert.deepEqual(passTwo.stream, passOne.stream, `pass ${String(index)} stream identity`);
    // The world's own typed outcomes are identical.
    assert.deepEqual(passTwo.outcomes, passOne.outcomes, `pass ${String(index)} outcome identity`);
  }
  assert.deepEqual(commandStreamOf(runTwo.telemetry), commandStreamOf(runOne.telemetry));
});

test("A9 twin: the journal identity and the determinism manifest hold", () => {
  assert.ok(runOne.telemetry.outcomes.length > 0, "the agent genuinely moved the world");
  assert.deepEqual(runTwo.report, runOne.report, "identical journals — the engine's own A9 at the session level");
  assert.deepEqual(runTwo.manifest, runOne.manifest);
});

test("A9 divergence control: a different agent diverges (the proof is not vacuous)", () => {
  assert.notDeepEqual(
    commandStreamOf(runThree.telemetry),
    commandStreamOf(runOne.telemetry),
    "a different declared threshold is a different agent — different commands",
  );
  // WHERE the minds first differed, the observed world was still IDENTICAL
  // (both runs saw the same market; the divergence is the agent's own
  // decision, not a world difference) — and after the divergent commands
  // issued, the agent's own different trades moved the world differently
  // (the divergence reaches the world itself: the agent genuinely acts).
  const firstDivergence = runOne.telemetry.passes.findIndex(
    (pass, index) => pass.streamDigest !== runThree.telemetry.passes[index]?.streamDigest,
  );
  assert.ok(firstDivergence > 0, "the runs diverged at a real pass");
  for (let index = 0; index <= firstDivergence; index += 1) {
    assert.deepEqual(
      runThree.telemetry.passes[index]?.observation.view,
      runOne.telemetry.passes[index]?.observation.view,
      `pass ${String(index)}: the same observed world, only the mind differs`,
    );
  }
  const worldDivergedAfter = runOne.telemetry.passes.some(
    (pass, index) =>
      index > firstDivergence &&
      JSON.stringify(pass.observation.view) !==
        JSON.stringify(runThree.telemetry.passes[index]?.observation.view),
  );
  assert.ok(
    worldDivergedAfter,
    "after the divergent decisions, the agent's own trades moved the two worlds apart",
  );
});
