/**
 * Live simulation-clock projection tests (W012) — the controller laws
 * against the REAL engine, through the REAL W018 provider.
 *
 * Guards `src/trading-world/simulation/clockTimelineProjection.ts`: the
 * framework-free controller behind the clock strip. Runs against the REAL
 * W017 generated alpha world (the TL wiring, `runtime/engineAttachment.ts`)
 * and a scratch FINITE world (a declared `clock.end`) through the REAL
 * in-process transport:
 * - honest states: unattached (fail-closed noop), loading, ready (the
 *   engine's ClockView), error (typed, fail-closed on transport death);
 * - LIVE updates: the W018 clock channel pushes the SETTLED view after
 *   acked mutating clock calls (poll disabled — pushes are the only path);
 * - the announced-regime timeline: empty at the origin (the W017 ORIGIN
 *   RULE fires on the FIRST advance), the origin announcement after the
 *   first step, multi-regime entries after crossing a boundary;
 * - typed outcomes: the engine's OWN rejections — backward seek → the A8
 *   `rewind-requires-branch` (visible, typed, never swallowed, clock
 *   UNCHANGED), seek-before-start, seek-beyond-end (finite world),
 *   unknown-event jumps, and the step-clamp-at-end law;
 * - play/pause/setSpeed through the REAL port (the settled views arrive
 *   by push); the polling fallback for push-less clients.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldSimulationClockProjection.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import {
  createAlphaEngineTransport,
} from "../src/trading-world/runtime/engineAttachment.js";
import { createSimulatedNoopWorldClient } from "../src/trading-world/runtime/worldClient.js";
import type { TradingWorldClient } from "../src/trading-world/runtime/worldClient.js";
import {
  createClockTimelineProjectionController,
  type ClockTimelineProjectionController,
  type ClockTimelineProjectionSnapshot,
} from "../src/trading-world/simulation/clockTimelineProjection.js";
import type { SimulationClockView } from "../src/trading-world/simulation/clockTimelineData.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import { fixedWallTimeSource } from "../../tradrl-world-sim/world/test/helpers.js";
import type { WorldDefinition } from "../../tradrl-world-sim/world/definition.js";

/** The alpha world's simulation origin (runtime/engineAttachment.ts). */
const SIM_START = 1_700_000_000_000;
const MIN = 60_000;

/** Wait until the snapshot satisfies the predicate (bounded, no hangs). */
async function until(
  controller: ClockTimelineProjectionController,
  predicate: (snapshot: ClockTimelineProjectionSnapshot) => boolean,
): Promise<ClockTimelineProjectionSnapshot> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const snapshot = controller.getSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return controller.getSnapshot();
}

/** A scratch FINITE world (declared clock.end) over the plain engine. */
function finiteDefinition(): WorldDefinition {
  const worldId = "world-w012-clock" as WorldDefinition["scope"]["worldId"];
  const venueId = "venue-w012" as never;
  return {
    scope: {
      tenantId: "tenant-w012" as never,
      projectId: "project-w012" as never,
      worldId,
    },
    mode: "reactive-replay",
    seed: "w012-clock-scratch",
    worldDefinitionVersion: "w012-scratch@1",
    inputDataSource: "synthetic://w012-clock",
    regimeSchedule: [
      {
        regime: "mean-reversion",
        from: SIM_START as never,
        to: (SIM_START + 5 * MIN) as never,
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      { regime: "trend", from: (SIM_START + 5 * MIN) as never },
    ] as never,
    clock: {
      start: SIM_START as never,
      // A FINITE replay world: seeks past this end are typed rejections.
      end: (SIM_START + 10 * MIN) as never,
      defaultStepMs: 1000,
      initialWallTime: (SIM_START + 500_000) as never,
    },
    instruments: [
      {
        instrumentId: "inst-w012" as never,
        worldId,
        venueId,
        symbol: "W012-SCRATCH",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
    ] as never,
    venues: [
      {
        venueId,
        worldId,
        name: "w012-scratch-venue",
        matchingModel: "price-time-priority",
        allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
        feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        calendar: { sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }] },
        haltPolicy: { haltOnShock: false },
      },
    ] as never,
    accounts: [
      {
        accountId: "account-w012" as never,
        worldId,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
    ] as never,
    participants: [
      {
        participantId: "participant-w012" as never,
        worldId,
        kind: "human",
        accountId: "account-w012" as never,
      },
    ] as never,
  };
}

async function attachFinite(): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: finiteDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
    expectedWorldId: "world-w012-clock",
  });
}

/** A push-less READY client (poll-fallback path): ports over mutable state. */
function stubPollClient(state: {
  clock: SimulationClockView;
  events: readonly unknown[];
}): TradingWorldClient {
  const base = createSimulatedNoopWorldClient("world-w012-stub");
  return {
    ...base,
    status: "ready",
    clock: {
      ...base.clock,
      step: async (deltaMs?: number) => {
        state.clock = {
          ...state.clock,
          simulationTime: state.clock.simulationTime + (deltaMs ?? 1000),
        };
      },
      getClock: async () => state.clock,
    },
    query: {
      ...base.query,
      getTimeline: async () => ({
        from: SIM_START,
        to: state.clock.simulationTime,
        events: state.events,
        hasMore: false,
      }),
    },
  };
}

test("the controller stays honestly unattached on the fail-closed noop client", async () => {
  const controller = createClockTimelineProjectionController({
    client: createSimulatedNoopWorldClient("world-x"),
    pollMs: 0,
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(controller.getSnapshot(), { status: "unattached" });
  // No subscription crash on stop; SSR snapshot is the same honest state.
  controller.stop();
  assert.deepEqual(controller.getServerSnapshot(), { status: "unattached" });
});

test("ready at the world origin: the engine's ClockView, paused, empty timeline (the ORIGIN RULE)", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  const snapshot = await until(controller, (current) => current.status === "ready");
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  // The sim axis is the ENGINE's view — never a client-side timer.
  assert.deepEqual(snapshot.clock, {
    simulationTime: SIM_START,
    status: "paused",
    speed: 1,
    followingRealtime: false,
  });
  // Before the first clock advance the journal has announced nothing: the
  // origin-rule announcement fires on the FIRST advance (W017) — the
  // honest empty timeline, never a fabricated regime.
  assert.equal(snapshot.timeline.length, 0);
  assert.equal(snapshot.outcome, undefined);
  controller.stop();
  client.dispose();
});

test("step: acked, the clock channel pushes the SETTLED view, the origin-rule announcement lands", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  // pollMs 0: ONLY the push channels + the post-command refresh can settle
  // this — the LIVE path is what this test proves.
  await controller.step(10_000);
  const snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.clock.simulationTime === SIM_START + 10_000 &&
      current.timeline.length >= 1,
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  // The outcome capsule: the engine ACKED (visible, never swallowed).
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "step +10000 ms" });
  // The W017 ORIGIN RULE: the regime in force AT the origin is announced
  // on the first advance — journal truth, with its parameters, world-scoped.
  const first = snapshot.timeline[0]!;
  assert.deepEqual(first.announcement, {
    at: SIM_START,
    to: "mean-reversion",
    parameters: { anchorPrice: 4800, direction: 1 },
  });
  assert.ok(first.sequence >= 1);
  assert.ok(first.eventId.length > 0);
  controller.stop();
  client.dispose();
});

test("forward seek across a regime boundary: acked, the timeline gains the from→to announcement", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  // Seek across the mean-reversion→trend boundary (+30 min) plus 1 s.
  const target = SIM_START + 30 * MIN + 1_000;
  await controller.seek(target);
  const snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.clock.simulationTime === target &&
      current.timeline.some((entry) => entry.announcement.to === "trend"),
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: `seek ${String(target)}` });
  const trend = snapshot.timeline.find((entry) => entry.announcement.to === "trend")!;
  assert.deepEqual(trend.announcement, {
    at: SIM_START + 30 * MIN,
    from: "mean-reversion",
    to: "trend",
  });
  // Journal order: the origin announcement precedes the trend boundary.
  assert.equal(snapshot.timeline[0]!.announcement.to, "mean-reversion");
  assert.ok(snapshot.timeline[0]!.announcement.at <= trend.announcement.at);
  controller.stop();
  client.dispose();
});

test("backward seek: the engine's typed rewind-requires-branch rejection — visible, clock UNCHANGED (A8)", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  const forward = SIM_START + 30_000;
  await controller.seek(forward);
  await until(
    controller,
    (current) => current.status === "ready" && current.clock.simulationTime === forward,
  );
  // The backward target is SENT — the ENGINE refuses it (never a client-side
  // pre-rejection): the typed A8 outcome must surface, never be swallowed.
  await controller.seek(SIM_START);
  const snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.outcome !== undefined &&
      current.outcome.kind === "rejected",
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready" || snapshot.outcome === undefined) {
    throw new Error("unreachable");
  }
  assert.equal(snapshot.outcome.label, `seek ${String(SIM_START)}`);
  assert.equal(snapshot.outcome.rejection?.code, "rewind-requires-branch");
  assert.match(snapshot.outcome.rejection?.message ?? "", /backward move/);
  assert.match(snapshot.outcome.rejection?.explanation ?? "", /A8/);
  // The engine refused IN PLACE: the sim axis is unchanged (no rewind, no
  // fabricated move) — history is immutable.
  assert.equal(snapshot.clock.simulationTime, forward);
  controller.stop();
  client.dispose();
});

test("seek before the world origin: the engine's typed seek-before-start rejection", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  await controller.seek(SIM_START - 1_000);
  const snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.outcome !== undefined &&
      current.outcome.kind === "rejected",
  );
  if (snapshot.status !== "ready" || snapshot.outcome === undefined) {
    throw new Error("unreachable");
  }
  assert.equal(snapshot.outcome.rejection?.code, "seek-before-start");
  assert.equal(snapshot.clock.simulationTime, SIM_START);
  controller.stop();
  client.dispose();
});

test("finite world: seek beyond the declared end is the typed seek-beyond-end; step clamps at the end", async () => {
  const client = await attachFinite();
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  const end = SIM_START + 10 * MIN;
  await controller.seek(end + 1_000);
  let snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.outcome !== undefined &&
      current.outcome.kind === "rejected",
  );
  if (snapshot.status !== "ready" || snapshot.outcome === undefined) {
    throw new Error("unreachable");
  }
  assert.equal(snapshot.outcome.rejection?.code, "seek-beyond-end");
  assert.equal(snapshot.clock.simulationTime, SIM_START);

  // Seek to 1 s before the end, then step 5 s: a step NEVER rejects on a
  // finite timeline — it advances to (at most) the end (the W013 clock law).
  await controller.seek(end - 1_000);
  await until(
    controller,
    (current) => current.status === "ready" && current.clock.simulationTime === end - 1_000,
  );
  await controller.step(5_000);
  snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.simulationTime === end,
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "step +5000 ms" });
  assert.equal(snapshot.clock.simulationTime, end);
  controller.stop();
  client.dispose();
});

test("jump-to-event: unknown targets are the typed unknown-event; journaled targets are A8 rejections (backward)", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  await controller.step(10_000);
  const stepped = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.clock.simulationTime === SIM_START + 10_000 &&
      current.timeline.length >= 1,
  );
  if (stepped.status !== "ready") {
    throw new Error("unreachable");
  }
  // Unknown journal target: the engine's typed answer.
  await controller.jumpToEvent(999_999);
  let snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.outcome !== undefined &&
      current.outcome.kind === "rejected",
  );
  if (snapshot.status !== "ready" || snapshot.outcome === undefined) {
    throw new Error("unreachable");
  }
  assert.equal(snapshot.outcome.rejection?.code, "unknown-event");

  // A REAL journaled event — the origin announcement. Journal events are
  // at-or-before the clock position, so the jump is a backward move: the
  // honest A8 outcome (branch creation is a later work order's command).
  const originSequence = stepped.timeline[0]!.sequence;
  await controller.jumpToEvent(originSequence);
  snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      current.outcome !== undefined &&
      current.outcome.kind === "rejected" &&
      current.outcome.rejection?.code === "rewind-requires-branch",
  );
  assert.equal(snapshot.clock.simulationTime, SIM_START + 10_000);
  controller.stop();
  client.dispose();
});

test("play/pause/setSpeed through the REAL port: the pushed settled views carry the engine's own status/speed", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  await controller.play();
  let snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.status === "playing",
  );
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "play" });
  await controller.setSpeed(10);
  snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.speed === 10,
  );
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "set speed 10×" });
  await controller.pause();
  snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.status === "paused",
  );
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "pause" });
  // playing never auto-advanced time: headless engines advance only on
  // step/seek (A9 determinism) — the strip's honest headless note.
  assert.equal(snapshot.clock.simulationTime, SIM_START);
  controller.stop();
  client.dispose();
});

test("polling fallback: a push-less client still settles commands and picks up external clock moves", async () => {
  const state = {
    clock: {
      simulationTime: SIM_START,
      status: "paused" as const,
      speed: 1,
      followingRealtime: false,
    },
    events: [] as readonly unknown[],
  };
  const client = stubPollClient(state);
  const controller = createClockTimelineProjectionController({ client, pollMs: 10 });
  controller.start();
  const ready = await until(controller, (current) => current.status === "ready");
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.equal(ready.clock.simulationTime, SIM_START);
  // A command on the push-less client: the post-ack refresh settles it.
  await controller.step(1_000);
  let snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.simulationTime === SIM_START + 1_000,
  );
  assert.deepEqual(snapshot.outcome, { kind: "acked", label: "step +1000 ms" });
  // An EXTERNAL move (another surface driving the same world): the honest
  // poll picks it up — the strip never claims push liveness it does not have.
  state.clock = { ...state.clock, simulationTime: SIM_START + 5_000 };
  snapshot = await until(
    controller,
    (current) => current.status === "ready" && current.clock.simulationTime === SIM_START + 5_000,
  );
  assert.equal(snapshot.clock.simulationTime, SIM_START + 5_000);
  controller.stop();
});

test("transport death fails closed: the typed error replaces the clock (never a stale live strip)", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  client.dispose(); // the transport dies under the controller
  await controller.refresh();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "error");
  if (snapshot.status === "error") {
    assert.match(snapshot.message, /transport is closed/);
  }
  controller.stop();
});

test("a dead transport fails commands closed too (the typed outcome is not fabricated as an ack)", async () => {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createClockTimelineProjectionController({ client, pollMs: 0 });
  controller.start();
  await until(controller, (current) => current.status === "ready");
  client.dispose();
  await controller.step(1_000);
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "error");
  if (snapshot.status === "error") {
    assert.match(snapshot.message, /transport is closed/);
  }
  controller.stop();
});
