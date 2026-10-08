/**
 * THE REAL ALPHA WORLD cases (W035): the full agent session driving the
 * REAL market — the EXACT composed binding the Trading World pane mounts
 * (`createAlphaEngineTransport` + `attachEngineWorldClient`, the generated
 * alpha market behind the W018 transport), with REAL bodies (the trader
 * seat), REAL substrates (W033's momentum and mean-revision minds), REAL
 * possession (W034) and the REAL engine: observe → decide → act → the
 * world moves → the next observation sees it (the closed loop).
 *
 * Run: ../../node_modules/.bin/tsx --test test/alphaWorld.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { alphaWorldDefinition } from "../../ui/src/trading-world/runtime/engineAttachment.js";
import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";
import { createMomentumSubstrate } from "cognitive-substrate/momentum";
import type { CognitiveSubstrate } from "tradrl-world-contracts/cognitiveSubstrate";
import type { BodyDescriptor, BodyId } from "tradrl-world-contracts/agentBody";
import type { SubstrateId } from "tradrl-world-contracts/cognitiveSubstrate";
import type { PossessionDescriptor } from "possession/contracts";
import { createAgentWorldSession } from "../session.js";
import type { AgentSession } from "../contracts.js";
import {
  newsArtifact,
  type InformationArtifactFixture,
} from "./fixtures.js";
import { attachAlphaWorld, attachAlphaWorldWithArtifacts, driveSession } from "./helpers.js";

const SIM_START = 1_700_000_000_000;

/** The REAL alpha world's ES instrument (the alpha definition's only desk). */
function alphaInstrument(worldId: string) {
  return `instrument-es-${worldId}` as never;
}

/** A trader-seat Body on the REAL alpha world (the W034 alpha pattern). */
function alphaTraderBody(worldId: string): BodyDescriptor {
  return {
    bodyId: "body-w035-alpha" as BodyId,
    scope: alphaWorldDefinition(worldId).scope,
    participantId: `participant-trader-${worldId}` as never,
    accountId: `account-trader-${worldId}` as never,
    participantKind: "human",
    embodiment: {
      instruments: [alphaInstrument(worldId)],
      venues: ["venue-alpha-sim" as never],
      orderKinds: ["market", "limit", "stop", "stop-limit"],
      timeInForce: ["GTC", "IOC", "FOK"],
      commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
    },
    riskEnvelope: {
      maxOrderQuantity: "8" as never,
      maxPositionQuantity: "32" as never,
      maxLeverage: 2,
      maxGrossExposure: { amount: "120000" as never, currency: "USD" as never },
      maxDrawdown: { amount: "4000" as never, currency: "USD" as never },
      minBuyingPowerAfterOrder: { amount: "12000" as never, currency: "USD" as never },
    },
  };
}

/** The REAL mean-reversion mind's possession of the alpha body. */
function alphaMrPossession(worldId: string): {
  readonly possession: PossessionDescriptor;
  readonly substrate: CognitiveSubstrate;
} {
  const substrate = createMeanReversionSubstrate({
    substrateId: "substrate-w035-alpha-mr" as SubstrateId,
    seed: "w035-alpha-mr-1",
    instrumentId: alphaInstrument(worldId),
    threshold: "0.75",
    quantity: "1",
  });
  return { possession: alphaPossessionOf(substrate, worldId), substrate };
}

/** The REAL momentum mind's possession of the alpha body. */
function alphaMomentumPossession(worldId: string, threshold = "0.75"): {
  readonly possession: PossessionDescriptor;
  readonly substrate: CognitiveSubstrate;
} {
  const substrate = createMomentumSubstrate({
    substrateId: "substrate-w035-alpha-momentum" as SubstrateId,
    seed: "w035-alpha-momentum-1",
    instrumentId: alphaInstrument(worldId),
    lookback: 4,
    threshold,
    quantity: "1",
  });
  return { possession: alphaPossessionOf(substrate, worldId), substrate };
}

function alphaPossessionOf(
  substrate: CognitiveSubstrate,
  worldId: string,
): PossessionDescriptor {
  return {
    possessionId: "possession-w035-alpha" as never,
    body: alphaTraderBody(worldId),
    substrate: substrate.descriptor,
    grant: {
      grantedBy: "principal-w035-alpha-operator" as never,
      channel: "operator",
      grantedAt: SIM_START as never,
      basis: "operator-reviewed reference mind for the REAL alpha ES desk",
    },
    scope: {
      instruments: [alphaInstrument(worldId)],
      observations: [
        "market-quote",
        "market-book",
        "market-trades",
        "own-orders",
        "own-positions",
        "own-portfolio",
        "own-risk",
        "information-artifacts",
      ] as PossessionDescriptor["scope"]["observations"],
      commandKinds: ["submit-order", "close-position"] as PossessionDescriptor["scope"]["commandKinds"],
      decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    },
  };
}

/** Attach + start a session over the REAL alpha binding. */
async function liveAlphaSession(
  worldId: string,
  fixture: { readonly possession: PossessionDescriptor; readonly substrate: CognitiveSubstrate },
  wallAt = SIM_START + 5000,
): Promise<{ readonly client: Awaited<ReturnType<typeof attachAlphaWorld>>; readonly session: AgentSession }> {
  const client = await attachAlphaWorld(worldId, wallAt);
  const session = createAgentWorldSession({
    client,
    possession: fixture.possession,
    substrate: fixture.substrate,
    world: alphaWorldDefinition(worldId),
  });
  const attach = await session.attach();
  assert.equal(attach.ok, true, `attach must pass (${attach.ok ? "" : attach.message})`);
  session.start();
  await session.settle();
  return { client, session };
}

test("the REAL alpha binding: the full session drives the real market (the closed loop)", async () => {
  const worldId = "world-w035-alpha-mr";
  const { client, session } = await liveAlphaSession(worldId, alphaMrPossession(worldId));
  try {
    await driveSession(client, session, 24, 5_000);
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "attached");
    assert.ok(telemetry.passes.length === 25, "the initial pass + 24 settled views");
    // The observations are REAL: the market moved and printed.
    const mids = telemetry.passes.map(
      (one) => one.observation.view.quotes?.[0]?.bid ?? "0",
    );
    assert.ok(new Set(mids).size > 1, "the REAL alpha market evolved under the session");
    const tapeSeen = telemetry.passes.some((one) => (one.observation.view.trades?.length ?? 0) > 0);
    assert.ok(tapeSeen, "the REAL market printed trades the session observed");
    // The mind PROPOSED on the real market, the proposals traversed the
    // admission gate, and the REAL port issued them.
    const proposals = telemetry.passes.filter((one) => one.stream.decisions.length > 0);
    assert.ok(proposals.length > 0, "the REAL mean-reversion mind proposed on the real market");
    assert.equal(telemetry.admissionRefused, 0, "every real stream proved lawful (never refused)");
    assert.ok(telemetry.outcomes.length > 0, "commands were issued through the REAL CommandPort");
    const acked = telemetry.outcomes.filter((one) => one.result.status === "acked");
    assert.ok(acked.length > 0, "at least one command was acked by the real engine");
    // THE CLOSED LOOP: an acked entry ⇒ the account's position is visible
    // in a LATER observed view — observe → decide → act → world → observe.
    const entry = acked.find((one) => one.commandKind === "submit-order");
    assert.ok(entry !== undefined, "an entry proposal was acked");
    const entryPass = telemetry.passes.find((one) =>
      one.outcomes.some((outcome) => outcome.decisionId === entry.decisionId),
    );
    assert.ok(entryPass !== undefined);
    const afterEntry = telemetry.passes.find(
      (one) =>
        Number(one.observedAt) > Number(entryPass.observedAt) &&
        (one.observation.view.ownPositions?.some(
          (position) =>
            String(position.instrumentId) === String(alphaInstrument(worldId)) &&
            position.quantity !== "0",
        ) ??
          false),
    );
    assert.ok(
      afterEntry !== undefined,
      "a later observed view sees the position the session's own command created",
    );
    if (afterEntry !== undefined) {
      const position = afterEntry.observation.view.ownPositions?.find(
        (one) => String(one.instrumentId) === String(alphaInstrument(worldId)),
      );
      assert.notEqual(position?.quantity, "0");
    }
    // Every pass's grant was honest (the lawful config never denied).
    assert.ok(telemetry.passes.every((one) => one.observation.grant.denials.length === 0));
    // The issued commands' ids are the substrate's own deterministic ids.
    for (const outcome of telemetry.outcomes) {
      const decision = telemetry.passes
        .flatMap((one) => one.stream.decisions)
        .find((one) => one.decisionId === outcome.decisionId);
      assert.ok(decision !== undefined);
      assert.equal(String(outcome.commandId), String(decision.command.commandId));
    }
    // The composed lifecycle ends honestly.
    const detach = session.detach("operator-request");
    assert.deepEqual(detach, { ok: true, status: "detached" });
    const after = session.telemetry();
    assert.equal(after.status, "detached");
    assert.equal(after.attachment.state, "detached");
    assert.equal(after.attachment.detachReason, "operator-request");
    assert.equal(after.possession.state, "released");
    assert.equal(after.possession.releaseReason, "operator-request");
  } finally {
    client.dispose();
  }
});

test("the REAL momentum mind (declared-state): warm-up, then the trend regime proposes", async () => {
  const worldId = "world-w035-alpha-momentum";
  const { client, session } = await liveAlphaSession(worldId, alphaMomentumPossession(worldId, "0.25"));
  try {
    // 40 minutes of simulation: the alpha day's calm mean-reversion regime
    // (30min) then the trend regime — the momentum mind's 4-view window
    // (spaced 60s) crosses its 0.25 threshold as the trend carries the mid.
    await driveSession(client, session, 40, 60_000);
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "attached");
    const proposals = telemetry.passes.filter((one) => one.stream.decisions.length > 0);
    assert.ok(proposals.length > 0, "the momentum mind proposed on the real alpha market");
    // The warm-up law: the first views (fewer than lookback=4 mids) propose
    // nothing — insufficient history is honest, not a signal.
    assert.equal(
      telemetry.passes.findIndex((one) => one.stream.decisions.length > 0) > 3,
      true,
      "no proposal before the 4-view window warmed up",
    );
    // Every momentum stream proved lawful at the decision level.
    assert.equal(telemetry.admissionRefused, 0);
    // The declared-state mind's proposals carry its window state forward:
    // entries and exits are both visible across the run (or honest empty
    // streams — whatever the real market dictated, deterministically).
    for (const pass of telemetry.passes) {
      assert.equal(pass.admission.ok, true);
    }
    session.detach("operator-request");
  } finally {
    client.dispose();
  }
});

test("the A7 boundary over the REAL alpha wiring with declared artifacts", async () => {
  const worldId = "world-w035-alpha-a7";
  const availableAt = (SIM_START + 60_000) as never;
  const artifacts: readonly InformationArtifactFixture[] = [
    newsArtifact(worldId, "artifact-w035-alpha-future" as never, "the future alpha wire story", availableAt),
  ];
  const client = await attachAlphaWorldWithArtifacts(worldId, SIM_START + 5000, artifacts);
  try {
    const { possession, substrate } = alphaMrPossession(worldId);
    const session = createAgentWorldSession({
      client,
      possession,
      substrate,
      world: { ...alphaWorldDefinition(worldId), informationArtifacts: artifacts },
    });
    const attach = await session.attach();
    assert.equal(attach.ok, true, `attach must pass (${attach.ok ? "" : attach.message})`);
    session.start();
    await session.settle();
    // At t0 the future artifact is WITHHELD AND NAMED — never in the view.
    const first = session.telemetry().passes[0]!;
    assert.deepEqual(first.observation.grant.withheldArtifacts, ["artifact-w035-alpha-future" as never]);
    assert.equal(first.observation.view.artifacts?.length ?? 0, 0);
    // Drive past availableAt: it becomes visible and enters the view.
    await driveSession(client, session, 13, 5_000);
    const last = session.telemetry().passes.at(-1)!;
    assert.ok(Number(last.observedAt) >= Number(availableAt));
    assert.deepEqual(last.observation.grant.withheldArtifacts, []);
    assert.ok(
      last.observation.view.artifacts?.some(
        (one) => String(one.artifactId) === "artifact-w035-alpha-future",
      ),
      "the artifact enters the observed view once availableAt is reached",
    );
    session.detach("operator-request");
  } finally {
    client.dispose();
  }
});
