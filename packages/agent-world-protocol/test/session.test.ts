/**
 * The agent-world session laws (W035) — the composed lifecycle (attach →
 * observe → decide → act → detach), fail-closed at every seam, every state
 * transition typed, telemetry as data — proven against the REAL compact
 * protocol world through the REAL W018 provider (the W023 runtime-protocol
 * suite pattern), with the two disclosed deterministic seams a lawful
 * engine cannot produce (the armed port-failure wrapper; the scripted
 * substrate that refuses its granted view).
 *
 * Run: ../../node_modules/.bin/tsx --test test/session.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";
import type {
  CognitiveSubstrate,
  SubstrateError,
} from "tradrl-world-contracts/cognitiveSubstrate";
import type { ReactiveParticipantWorldClient } from "tradrl-world-contracts/participantProtocol";
import type { PossessionDescriptor } from "possession/contracts";
import { createAgentWorldSession, AgentProtocolBreachError } from "../session.js";
import type { AgentSession } from "../contracts.js";
import {
  PROTOCOL_WORLD_ID,
  SIM_START,
  SUBSTRATE_MR,
  agentEnvelope,
  possessionOf,
  protocolWorldDefinition,
} from "./fixtures.js";
import { attachProtocolWorld, driveSession, fixedWallSource } from "./helpers.js";
import type { EngineWorldClient } from "../../ui/src/trading-world/runtime/engineWorldClient.js";

/** The default possession + live substrate (the ES desk MR mind). */
function mrFixture(worldId: string = PROTOCOL_WORLD_ID): {
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

/** Create + attach + start a session over a fresh compact-world attachment. */
async function liveSession(worldId: string): Promise<{
  readonly client: EngineWorldClient;
  readonly session: AgentSession;
  readonly possession: PossessionDescriptor;
}> {
  const { possession, substrate } = mrFixture(worldId);
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  const session = createAgentWorldSession({
    client,
    possession,
    substrate,
    world: protocolWorldDefinition(worldId),
  });
  const attach = await session.attach();
  assert.equal(attach.ok, true, `attach must pass (${attach.ok ? "" : attach.message})`);
  session.start();
  await session.settle();
  return { client, session, possession };
}

test("attach: the composed gates pass and both machines turn active", async () => {
  const worldId = "world-w035-ses-attach";
  const { client, session } = await liveSession(worldId);
  try {
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "attached");
    assert.equal(telemetry.worldId, worldId);
    assert.deepEqual(telemetry.attachment, {
      bodyId: telemetry.attachment.bodyId,
      worldId: telemetry.attachment.worldId,
      state: "active",
    });
    assert.deepEqual(telemetry.possession, {
      possessionId: telemetry.possession.possessionId,
      bodyId: telemetry.possession.bodyId,
      substrateId: telemetry.possession.substrateId,
      worldId: telemetry.possession.worldId,
      state: "possessed",
    });
    assert.ok(telemetry.effectiveAgent !== undefined, "the effective agent is projected");
    assert.equal(
      String(telemetry.effectiveAgent?.participantId),
      `participant-agent-${worldId}`,
    );
    // The initial pass already ran at the settled present.
    assert.equal(telemetry.passes.length, 1);
    assert.equal(Number(telemetry.passes[0]?.observedAt), SIM_START);
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("attach fails closed: an envelope beyond the world's limits (W032 verbatim)", async () => {
  const worldId = "world-w035-ses-envelope";
  const { possession, substrate } = mrFixture(worldId);
  const loose = {
    ...possession,
    body: {
      ...possession.body,
      riskEnvelope: agentEnvelope({ maxOrderQuantity: "50" as never }),
    },
  };
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession: loose,
      substrate,
      world: protocolWorldDefinition(worldId),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, false);
    if (attach.ok) return;
    assert.equal(attach.code, "possession-incompatible");
    assert.ok(attach.incompatibilities !== undefined);
    const bodyFailure = attach.incompatibilities?.find(
      (one) => one.code === "body-attachment-failed",
    );
    assert.ok(bodyFailure !== undefined, "the W034 gate carries the W032 attach failure");
    assert.ok(
      bodyFailure?.bodyErrors?.some((one) => one.code === "envelope-exceeds-world-limits"),
      "the W032 envelope breach is carried verbatim",
    );
    // Fail-closed: nothing turned.
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "created");
    assert.equal(telemetry.attachment.state, "unattached");
    assert.equal(telemetry.possession.state, "unpossessed");
    assert.equal(telemetry.passes.length, 0);
  } finally {
    client.dispose();
  }
});

test("attach fails closed: the live substrate is not the declared one", async () => {
  const worldId = "world-w035-ses-substrate";
  const { possession } = mrFixture(worldId);
  const impostor = createMeanReversionSubstrate({
    substrateId: SUBSTRATE_MR,
    seed: "w035-mr-DIFFERENT-seed",
    instrumentId: `instrument-es-${worldId}` as never,
    threshold: "0.75",
    quantity: "1",
  });
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession,
      substrate: impostor,
      world: protocolWorldDefinition(worldId),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, false);
    if (attach.ok) return;
    assert.equal(attach.code, "substrate-descriptor-mismatch");
    assert.equal(session.telemetry().status, "created");
    assert.equal(session.telemetry().attachment.state, "unattached");
  } finally {
    client.dispose();
  }
});

test("attach fails closed: the client serves another world", async () => {
  const worldId = "world-w035-ses-worldmismatch";
  const { possession, substrate } = mrFixture(worldId);
  const client = await attachProtocolWorld("world-w035-ses-other-world", {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession,
      substrate,
      world: protocolWorldDefinition(worldId),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, false);
    if (attach.ok) return;
    assert.equal(attach.code, "client-world-mismatch");
    assert.equal(session.telemetry().status, "created");
  } finally {
    client.dispose();
  }
});

test("attach fails closed: an observation config beyond the effective view", async () => {
  const worldId = "world-w035-ses-config";
  const { possession, substrate } = mrFixture(worldId);
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession,
      substrate,
      world: protocolWorldDefinition(worldId),
      observation: {
        kinds: ["market-quote", "market-book", "own-orders", "own-risk", "no-such-kind"] as never,
      },
    });
    const attach = await session.attach();
    assert.equal(attach.ok, false);
    if (attach.ok) return;
    assert.equal(attach.code, "invalid-observation-config");
    assert.deepEqual(
      attach.configErrors?.map((one) => one.code),
      ["unknown-observation-kind"],
      "the config is validated against the effective view (own-* are admitted; the unknown kind is not)",
    );
    assert.equal(session.telemetry().status, "created");
  } finally {
    client.dispose();
  }
});

test("the event loop: the initial pass at the settled present, then one pass per settled view", async () => {
  const worldId = "world-w035-ses-loop";
  const { client, session } = await liveSession(worldId);
  try {
    await driveSession(client, session, 6, 5_000);
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "attached");
    assert.equal(telemetry.viewsReceived, 6);
    assert.equal(telemetry.observationsSkipped, 0, "5s steps honor the 1s declared spacing");
    assert.equal(telemetry.passes.length, 7, "the initial pass + one per settled view");
    for (const [index, pass] of telemetry.passes.entries()) {
      assert.equal(
        Number(pass.observedAt),
        SIM_START + index * 5_000,
        `pass ${String(index)} observed at its settled step time`,
      );
      // REACT ONLY TO SETTLED VIEWS: every issued command carries the
      // stream's asOf — the pass's own settled observation time.
      for (const _outcome of pass.outcomes) {
        assert.equal(pass.observation.asOf, pass.stream.asOf);
      }
    }
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("the declared rate spacing: closer settled views are skipped and counted, never observed", async () => {
  const worldId = "world-w035-ses-rate";
  const { client, session } = await liveSession(worldId);
  try {
    // The MR mind declares a 1000ms minimum view spacing (the effective
    // rate, the tighter-of): 500ms steps therefore alternate
    // observe/skip — a deterministic function of the clock stream alone.
    await driveSession(client, session, 6, 500);
    const telemetry = session.telemetry();
    assert.equal(telemetry.viewsReceived, 6);
    assert.equal(telemetry.observationsSkipped, 3);
    assert.equal(telemetry.passes.length, 4, "the initial pass + every other 500ms view");
    assert.deepEqual(
      telemetry.passes.map((one) => Number(one.observedAt)),
      [SIM_START, SIM_START + 1_000, SIM_START + 2_000, SIM_START + 3_000],
    );
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("a settled view at the same instant (the pause law) is rate-skipped, not re-observed", async () => {
  const worldId = "world-w035-ses-pause";
  const { client, session } = await liveSession(worldId);
  try {
    await driveSession(client, session, 1, 5_000);
    const before = session.telemetry();
    // pause() is a mutating clock call: the adapter pushes a settled view
    // at the SAME simulation time. The declared 1000ms spacing refuses the
    // re-observation (a same-instant view is 0ms apart) — the W023
    // counterpart reacted to the pause view; the agent protocol honors
    // the substrate's declared spacing instead (disclosed design choice).
    await client.clock.pause();
    await session.settle();
    const after = session.telemetry();
    assert.equal(after.viewsReceived, before.viewsReceived + 1);
    assert.equal(after.observationsSkipped, before.observationsSkipped + 1);
    assert.equal(after.passes.length, before.passes.length, "no pass at the same instant");
  } finally {
    session.detach("operator-request");
    client.dispose();
  }
});

test("fail closed: a port failure stops the session, both machines release, settle rejects", async () => {
  const worldId = "world-w035-ses-failclosed";
  const { possession, substrate } = mrFixture(worldId);
  const engine = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    // The armed-failure wrapper (the W023 pattern): every port call fails
    // once armed — the typed failure a dead transport produces, delivered
    // deterministically at the session's next port call.
    let armed = false;
    const failWhenArmed =
      (port: string, method: string) =>
      (...args: unknown[]) => {
        if (armed) {
          throw new Error(`[test] port ${port}.${method} failed closed`);
        }
        const ports = engine as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
        const target = ports[port]![method] as (...a: unknown[]) => unknown;
        return target.apply(ports[port], args);
      };
    const failing: ReactiveParticipantWorldClient = {
      worldId: engine.worldId,
      query: {
        getWorldMeta: failWhenArmed("query", "getWorldMeta") as never,
        getSnapshot: failWhenArmed("query", "getSnapshot") as never,
        getInstrument: failWhenArmed("query", "getInstrument") as never,
        getQuote: failWhenArmed("query", "getQuote") as never,
        getOrderBook: failWhenArmed("query", "getOrderBook") as never,
        getTrades: failWhenArmed("query", "getTrades") as never,
        getOrders: failWhenArmed("query", "getOrders") as never,
        getPositions: failWhenArmed("query", "getPositions") as never,
        getPortfolio: failWhenArmed("query", "getPortfolio") as never,
        getRisk: failWhenArmed("query", "getRisk") as never,
        getNews: failWhenArmed("query", "getNews") as never,
        getTimeline: failWhenArmed("query", "getTimeline") as never,
      } as never,
      command: {
        submitOrder: failWhenArmed("command", "submitOrder") as never,
        cancelOrder: failWhenArmed("command", "cancelOrder") as never,
        replaceOrder: failWhenArmed("command", "replaceOrder") as never,
        closePosition: failWhenArmed("command", "closePosition") as never,
        addAnnotation: failWhenArmed("command", "addAnnotation") as never,
        createSnapshot: failWhenArmed("command", "createSnapshot") as never,
        branchWorld: failWhenArmed("command", "branchWorld") as never,
        setScenario: failWhenArmed("command", "setScenario") as never,
      } as never,
      clock: {
        getClock: failWhenArmed("clock", "getClock") as never,
      } as never,
      onClock(listener) {
        return engine.onClock(listener);
      },
    };
    const session = createAgentWorldSession({
      client: failing,
      possession,
      substrate,
      world: protocolWorldDefinition(worldId),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, true);
    session.start();
    await session.settle();
    assert.equal(session.telemetry().status, "attached");
    assert.ok(session.telemetry().passes.length === 1, "the initial pass read real views");

    armed = true;
    await engine.clock.step(5_000);
    await assert.rejects(() => session.settle());
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "failed");
    assert.ok(telemetry.failure instanceof Error);
    // Both composed machines released with the protocol-error reason.
    assert.equal(telemetry.attachment.state, "detached");
    assert.equal(telemetry.attachment.detachReason, "protocol-error");
    assert.equal(telemetry.possession.state, "released");
    assert.equal(telemetry.possession.releaseReason, "protocol-error");
    // Never fabricate: the failure froze the pass/outcome counts.
    const passesAtFailure = telemetry.passes.length;
    const outcomesAtFailure = telemetry.outcomes.length;
    await assert.rejects(() => session.settle());
    assert.equal(session.telemetry().passes.length, passesAtFailure);
    assert.equal(session.telemetry().outcomes.length, outcomesAtFailure);
    // And the kill switch refuses on a terminal session.
    const detach = session.detach("operator-request");
    assert.equal(detach.ok, false);
    if (!detach.ok) {
      assert.equal(detach.code, "session-terminal");
    }
  } finally {
    engine.dispose();
  }
});

test("fail closed: a substrate refusing its granted view is a protocol breach", async () => {
  const worldId = "world-w035-ses-breach";
  const { possession } = mrFixture(worldId);
  // The scripted substrate (a disclosed deterministic seam): the SAME
  // descriptor (the identity check passes) but a decide that refuses its
  // view — the session guarantees valid granted views, so a refusal is a
  // protocol breach and fails the session closed.
  const refusing: CognitiveSubstrate = {
    descriptor: possession.substrate,
    decide: () => ({
      ok: false,
      errors: [
        { code: "state-required", message: "[scripted] the refusing substrate refuses" } satisfies SubstrateError,
      ],
    }),
  };
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession,
      substrate: refusing,
      world: protocolWorldDefinition(worldId),
    });
    const attach = await session.attach();
    assert.equal(attach.ok, true);
    session.start();
    await assert.rejects(() => session.settle());
    const telemetry = session.telemetry();
    assert.equal(telemetry.status, "failed");
    assert.ok(telemetry.failure instanceof AgentProtocolBreachError);
    assert.equal(telemetry.attachment.state, "detached");
    assert.equal(telemetry.possession.state, "released");
    assert.equal(telemetry.passes.length, 0, "the breached pass never recorded");
  } finally {
    client.dispose();
  }
});

test("detach: the kill switch composes both machines and telemetry stays honest after", async () => {
  const worldId = "world-w035-ses-detach";
  const { client, session } = await liveSession(worldId);
  await driveSession(client, session, 3, 5_000);
  const detach = session.detach("operator-request");
  assert.deepEqual(detach, { ok: true, status: "detached" });
  const telemetry = session.telemetry();
  assert.equal(telemetry.status, "detached");
  assert.equal(telemetry.attachment.state, "detached");
  assert.equal(telemetry.attachment.detachReason, "operator-request");
  assert.equal(telemetry.possession.state, "released");
  assert.equal(telemetry.possession.releaseReason, "operator-request");
  const passesAtDetach = telemetry.passes.length;
  const viewsAtDetach = telemetry.viewsReceived;
  // No new passes after the kill switch (the steps still advance the
  // world — the session simply never reacts again).
  await client.clock.step(5_000);
  await session.settle();
  const after = session.telemetry();
  assert.equal(after.passes.length, passesAtDetach);
  assert.equal(after.viewsReceived, viewsAtDetach, "even the clock channel is unsubscribed");
  // Terminal is terminal.
  const again = session.detach("operator-request");
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.equal(again.code, "session-terminal");
  }
  // The detach telemetry is a complete, honest record of the session.
  assert.ok(after.passes.length > 0);
  assert.ok(after.outcomes.length > 0 || after.passes.every((one) => one.stream.decisions.length === 0));
  client.dispose();
});

test("detach from created: the discard path both machines honor", async () => {
  const worldId = "world-w035-ses-discard";
  const { possession, substrate } = mrFixture(worldId);
  const client = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  try {
    const session = createAgentWorldSession({
      client,
      possession,
      substrate,
      world: protocolWorldDefinition(worldId),
    });
    const detach = session.detach("world-closed");
    assert.deepEqual(detach, { ok: true, status: "detached" });
    const telemetry = session.telemetry();
    assert.equal(telemetry.attachment.state, "detached");
    assert.equal(telemetry.attachment.detachReason, "world-closed");
    assert.equal(telemetry.possession.state, "released");
    assert.equal(telemetry.possession.releaseReason, "body-detached");
    assert.equal(telemetry.passes.length, 0);
    // And a detached session never attaches.
    const attach = await session.attach();
    assert.equal(attach.ok, false);
    if (!attach.ok) {
      assert.equal(attach.code, "session-terminal");
    }
  } finally {
    client.dispose();
  }
});
