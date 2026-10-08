/**
 * The observation grant protocol laws (W035) — proven against the REAL
 * compact protocol world through the REAL W018 provider (the settled
 * reads, the A7 artifact boundary, the narrowed config), plus the two
 * protocol guards a lawful engine can never produce (the never-settling
 * clock; the port serving an artifact the grant withholds), proven against
 * the disclosed deterministic scripted client.
 *
 * Run: ../../node_modules/.bin/tsx --test test/observation.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";
import type { CognitiveSubstrate } from "tradrl-world-contracts/cognitiveSubstrate";
import type { ObservedBodyView } from "tradrl-world-contracts/cognitiveSubstrate";
import { projectEffectiveAgent } from "possession/projection";
import type { PossessionDescriptor } from "possession/contracts";
import { createAgentWorldSession } from "../session.js";
import { observeAgentView, resolveObservationProtocol } from "../observation.js";
import type { ObservationFailure } from "../contracts.js";
import {
  ARTIFACT_EARLY,
  ARTIFACT_LATER,
  ARTIFACT_LATER_AT,
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  PROTOCOL_WORLD_ID,
  SIM_START,
  SUBSTRATE_MR,
  lawfulStream,
  newsArtifact,
  possessionOf,
  protocolWorldDefinition,
  scriptedAgentWorldClient,
  type ScriptedCall,
} from "./fixtures.js";
import { attachProtocolWorld, fixedWallSource, driveSession } from "./helpers.js";

/** A canonical fixed quote (the scripted-client fixture data). */
function fixtureQuote() {
  return {
    instrumentId: INSTRUMENT_ES,
    asOf: SIM_START as never,
    bid: "4799.75",
    ask: "4800.25",
    last: "4800.00",
    bidSize: "10",
    askSize: "10",
  } as never;
}

/** The REAL mean-revision mind's possession of the agent body (the ES desk). */
function mrPossession(worldId: string = PROTOCOL_WORLD_ID): {
  readonly possession: PossessionDescriptor;
  readonly substrate: CognitiveSubstrate;
} {
  const substrate = createMeanReversionSubstrate({
    substrateId: SUBSTRATE_MR,
    seed: "w035-mr-1",
    instrumentId: `instrument-es-${worldId}` as never,
    threshold: "0.75",
    quantity: "1",
  });
  return { possession: possessionOf(substrate.descriptor, worldId), substrate };
}

/** Attach + start + settle a session over the compact protocol world. */
async function startedSession(worldId: string, observation?: Parameters<typeof createAgentWorldSession>[0]["observation"]) {
  const { possession, substrate } = mrPossession(worldId);
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  const session = createAgentWorldSession({
    client,
    possession,
    substrate,
    world: protocolWorldDefinition(worldId),
    ...(observation === undefined ? {} : { observation }),
  });
  const attach = await session.attach();
  assert.equal(attach.ok, true, `attach must pass (${attach.ok ? "" : attach.message})`);
  session.start();
  await session.settle();
  return { client, session, possession };
}

test("the observation config resolution: the defaults, and only narrowing is legal", () => {
  const { possession } = mrPossession();
  const projection = projectEffectiveAgent(possession, protocolWorldDefinition());
  assert.equal(projection.ok, true);
  if (!projection.ok) return;
  const agent = projection.agent;

  // Defaults: everything the view grants.
  const defaults = resolveObservationProtocol(undefined, agent, []);
  assert.equal(defaults.ok, true);
  if (!defaults.ok) return;
  assert.deepEqual(defaults.protocol.kinds, agent.view.observations);
  assert.deepEqual(defaults.protocol.instruments, agent.view.instruments);

  // Beyond the view: every violation collected loudly.
  const beyond = resolveObservationProtocol(
    {
      kinds: ["market-quote", "no-such-kind"] as never,
      instruments: [INSTRUMENT_NQ, "instrument-elsewhere"] as never,
      bookDepth: 0,
      tradeWindowMs: -1,
    },
    agent,
    [],
  );
  assert.equal(beyond.ok, false);
  if (beyond.ok) return;
  assert.deepEqual(
    beyond.errors.map((one) => one.code),
    [
      "unknown-observation-kind",
      "instrument-beyond-view",
      "instrument-beyond-view",
      "invalid-book-depth",
      "invalid-trade-window",
    ],
  );

  // A kind inside the closed set but outside THIS view (NQ is inside the
  // body's embodiment but outside the possession scope's view).
  const scoped = resolveObservationProtocol(
    { kinds: ["market-quote"], instruments: [INSTRUMENT_NQ] },
    agent,
    [],
  );
  assert.equal(scoped.ok, false);
  if (scoped.ok) return;
  assert.deepEqual(
    scoped.errors.map((one) => one.code),
    ["instrument-beyond-view"],
  );
});

test("the settled read: the observed view carries the granted families at the settled instant", async () => {
  const worldId = "world-w035-obs-settled";
  const { client, session } = await startedSession(worldId);
  try {
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "attached");
    assert.equal(telemetry.passes.length, 1, "the initial pass at the settled present");
    const first = telemetry.passes[0]!;
    assert.equal(Number(first.observedAt), SIM_START, "the initial pass observed at t0");
    const { observation } = first;
    // The grant: everything requested was granted; nothing denied. The
    // later artifact is correctly WITHHELD AND NAMED at t0 (its availableAt
    // is +30s — the A7 test below drives the boundary).
    assert.deepEqual(observation.grant.denials, []);
    assert.deepEqual(observation.grant.withheldArtifacts, [ARTIFACT_LATER]);
    assert.ok(observation.grant.visibleArtifacts.includes(ARTIFACT_EARLY), "the early artifact is visible at t0");
    // The view: the granted families present, the identity fields right.
    const view: ObservedBodyView = observation.view;
    assert.equal(view.participantId, `participant-agent-${worldId}` as never);
    assert.equal(Number(view.asOf), SIM_START);
    assert.ok(view.quotes !== undefined, "market-quote granted and present");
    assert.ok(view.books !== undefined, "market-book granted and present");
    assert.ok(view.trades !== undefined, "market-trades granted and present");
    assert.ok(view.ownOrders !== undefined, "own-orders granted and present");
    assert.ok(view.ownPositions !== undefined, "own-positions granted and present");
    assert.ok(view.portfolio !== undefined, "own-portfolio granted and present");
    assert.ok(view.riskState !== undefined, "own-risk granted and present");
    assert.ok(view.artifacts !== undefined, "information-artifacts granted and present");
    // The digest is the W033 content address of exactly this view.
    assert.equal(observation.viewDigest, first.observation.viewDigest);
    // The W033 firewall inside decide re-proved the view (the session never
    // saw a validation error) — and the pass carried no commands (t0 is
    // cold: an empty tape means no proposal for the MR mind).
    assert.equal(first.stream.decisions.length, 0);
    assert.equal(first.admission.ok, true);
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("the narrowed config: unrequested families never enter the observed view", async () => {
  const worldId = "world-w035-obs-narrow";
  const { client, session } = await startedSession(worldId, {
    kinds: ["market-quote", "own-positions", "information-artifacts"],
  });
  try {
    const first = session.telemetry().passes[0]!;
    const { observation } = first;
    assert.deepEqual(
      observation.grant.kinds,
      ["market-quote", "own-positions", "information-artifacts"],
      "the grant carries exactly the declared kinds",
    );
    const view = observation.view;
    assert.ok(view.quotes !== undefined, "the requested market-quote is present");
    assert.ok(view.ownPositions !== undefined, "the requested own-positions is present");
    assert.ok(view.artifacts !== undefined, "the requested artifacts are present");
    assert.equal(view.books, undefined, "the unrequested market-book never enters the view");
    assert.equal(view.trades, undefined, "the unrequested market-trades never enters the view");
    assert.equal(view.ownOrders, undefined, "the unrequested own-orders never enters the view");
    assert.equal(view.portfolio, undefined, "the unrequested own-portfolio never enters the view");
    assert.equal(view.riskState, undefined, "the unrequested own-risk never enters the view");
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("A7: future-dated artifacts are WITHHELD AND NAMED, then visible after availableAt", async () => {
  const worldId = "world-w035-obs-a7";
  const { client, session } = await startedSession(worldId);
  try {
    // At t0: the later artifact is withheld and named; only the early one is visible.
    const first = session.telemetry().passes[0]!;
    assert.deepEqual(first.observation.grant.withheldArtifacts, [ARTIFACT_LATER]);
    assert.deepEqual(
      first.observation.view.artifacts?.map((one) => one.artifactId),
      [ARTIFACT_EARLY],
      "the withheld artifact NEVER enters the observed view",
    );
    // Drive past availableAt: the later artifact becomes visible.
    await driveSession(client, session, 7, 5_000);
    const last = session.telemetry().passes.at(-1)!;
    assert.ok(Number(last.observedAt) >= Number(ARTIFACT_LATER_AT));
    assert.deepEqual(last.observation.grant.withheldArtifacts, []);
    assert.ok(
      last.observation.grant.visibleArtifacts.includes(ARTIFACT_LATER),
      "the artifact is visible once availableAt is reached",
    );
    assert.ok(
      last.observation.view.artifacts?.some((one) => one.artifactId === ARTIFACT_LATER),
      "the now-available artifact enters the observed view",
    );
    // The substrate never saw it early: every recorded view lacks it before availableAt.
    for (const pass of session.telemetry().passes) {
      const at = Number(pass.observation.asOf);
      const seen = pass.observation.view.artifacts?.some((one) => one.artifactId === ARTIFACT_LATER) ?? false;
      assert.equal(seen, at >= Number(ARTIFACT_LATER_AT), `the A7 boundary held at ${String(at)}`);
    }
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("the torn-read guard: a clock that never settles fails closed (torn-read-exhausted)", async () => {
  const { possession } = mrPossession();
  const projection = projectEffectiveAgent(possession, protocolWorldDefinition());
  assert.equal(projection.ok, true);
  if (!projection.ok) return;
  let ticks = 0;
  const { client } = scriptedAgentWorldClient({
    worldId: PROTOCOL_WORLD_ID,
    clock: () => (SIM_START + (ticks += 1)) as never,
    quote: fixtureQuote(),
  });
  const resolved = resolveObservationProtocol(
    { kinds: ["market-quote"] },
    projection.agent,
    [],
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  // The clock advances under EVERY read: each attempt is torn (the trailing
  // re-read never matches) — the guard discards and retries, then fails
  // closed with the typed failure rather than recording a torn view.
  await assert.rejects(
    () => observeAgentView(client, resolved.protocol),
    (failure: ObservationFailure) => {
      assert.equal(failure.code, "torn-read-exhausted");
      assert.ok(failure.message.includes("refusing to record a torn view"));
      return true;
    },
  );
});

test("the grant-inconsistency guard: a port serving an artifact the grant withholds fails closed", async () => {
  const { possession } = mrPossession();
  const projection = projectEffectiveAgent(possession, protocolWorldDefinition());
  assert.equal(projection.ok, true);
  if (!projection.ok) return;
  // The scripted port serves the LATER artifact at t0 — before its
  // availableAt. The grant (over the declared universe) withholds it; the
  // port/grant disagreement is a definition/engine inconsistency.
  const { client, calls } = scriptedAgentWorldClient({
    worldId: PROTOCOL_WORLD_ID,
    clock: () => SIM_START as never,
    quote: fixtureQuote(),
    news: [
      newsArtifact(PROTOCOL_WORLD_ID, ARTIFACT_LATER, "the later wire story", ARTIFACT_LATER_AT),
    ],
  });
  const resolved = resolveObservationProtocol(
    { kinds: ["market-quote", "information-artifacts"] },
    projection.agent,
    protocolWorldDefinition().informationArtifacts ?? [],
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  await assert.rejects(
    () => observeAgentView(client, resolved.protocol),
    (failure: ObservationFailure) => {
      assert.equal(failure.code, "grant-inconsistency");
      assert.ok(failure.message.includes(String(ARTIFACT_LATER)));
      return true;
    },
  );
  const newsCalls: ScriptedCall[] = calls.filter((one) => one.method === "getNews");
  assert.equal(newsCalls.length, 1, "the inconsistency was caught at the read itself");
});

test("the lawful fixture stream proves the protocol's admission (the W034 lawfulStream pattern holds here too)", () => {
  // A cross-check that the fixtures' lawfulStream really is lawful for the
  // default possession — the action tests below rely on it.
  const { possession } = mrPossession();
  const projection = projectEffectiveAgent(possession, protocolWorldDefinition());
  assert.equal(projection.ok, true);
  const command = lawfulStream().decisions[0]?.command;
  assert.equal(command?.kind, "submit-order");
  if (command?.kind !== "submit-order") return;
  assert.equal(String(command.instrumentId), String(INSTRUMENT_ES));
});
