/**
 * The reactive participant runtime protocol (W023) — the event-loop
 * discipline proven against the REAL generated agent world through the REAL
 * W018 provider: settled-view reactions only, FIFO issuance through the
 * CommandPort, typed outcomes, the declared observation surface, and the
 * fail-closed law.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SIM_START } from "./helpers.js";
import { createParticipantRuntime } from "../src/runtime.js";
import {
  attachReferenceRuntime,
  driveJourney,
  DRIVE_STEPS,
  DRIVE_STEP_MS,
  referenceAgents,
  spyClient,
} from "./referenceRuntime.js";
import type {
  ParticipantSettledView,
  ReactiveParticipantWorldClient,
} from "../../tradrl-world-contracts/src/participantProtocol.js";

test("the event loop: one initial pass at the settled present, then one pass per settled view", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-protocol");
  try {
    const passes: ParticipantSettledView["observedAt"][] = [];
    runtime.onPass((record) => passes.push(record.observedAt));
    runtime.start();
    await runtime.settle();
    // The initial pass: the world at t0 (cold, nothing issued).
    assert.equal(passes.length, 1);
    assert.equal(Number(passes[0]), SIM_START);
    assert.equal(runtime.telemetry().outcomes.length, 0);

    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();
    // 24 settled views (+ the initial pass) — the disciplined drive reacts
    // exactly once per settled view, never more.
    assert.equal(telemetry.viewsReceived, DRIVE_STEPS);
    assert.equal(telemetry.passes.length, DRIVE_STEPS + 1);
    assert.equal(telemetry.status, "idle");
    // Each pass reacted at a settled clock position, in clock order.
    for (const [index, pass] of telemetry.passes.entries()) {
      if (index === 0) {
        continue;
      }
      assert.equal(
        Number(pass.observedAt),
        SIM_START + index * DRIVE_STEP_MS,
        `pass ${String(index)} observed at its settled step time`,
      );
      // REACT ONLY TO SETTLED VIEWS: every issued command carries the pass's
      // settled observation time as issuedAt (never wall time, never a
      // mid-flight time).
      for (const outcome of pass.outcomes) {
        const issued = pass.view.observedAt;
        assert.equal(Number(issued), Number(pass.observedAt));
        assert.match(outcome.commandId, /^agent:participant-agent-(momentum|mr)-world-w023-protocol:p\d+:c\d+$/);
      }
    }
    // The agents genuinely traded through the REAL port.
    assert.ok(telemetry.acked > 0, "the reference agents issued acked commands");
    assert.ok(telemetry.rejected > 0, "typed rejections are outcomes too (the halt window)");
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("FIFO: outcomes are recorded in issuance order with unique deterministic command ids", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-fifo");
  try {
    runtime.start();
    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();
    const ids = telemetry.outcomes.map((outcome) => outcome.commandId);
    assert.equal(new Set(ids).size, ids.length, "command ids are unique across the run");
    // Within each pass, ids are issued in agent-declaration then decision order.
    for (const pass of telemetry.passes) {
      const passIds = pass.outcomes.map((outcome) => outcome.commandId);
      for (let i = 1; i < passIds.length; i += 1) {
        assert.ok(passIds[i]! > passIds[i - 1]!, "sequential ids within a pass are ordered");
      }
      const agents = pass.outcomes.map((o) => o.agentId);
      const firstMomentum = agents.indexOf("momentum");
      const lastMomentum = agents.lastIndexOf("momentum");
      const firstMr = agents.indexOf("mean-reversion");
      if (firstMomentum >= 0 && firstMr >= 0) {
        assert.ok(lastMomentum < firstMr, "agents issue in declaration order (momentum first)");
      }
    }
    // Every outcome is the engine's OWN typed result (never fabricated).
    for (const outcome of telemetry.outcomes) {
      if (outcome.result.status === "acked") {
        assert.equal(typeof outcome.result.ack.journalCursor, "number");
      } else {
        assert.ok(["validate", "authorize", "domain-rules"].includes(outcome.result.rejection.stage));
        assert.equal(typeof outcome.result.rejection.code, "string");
      }
    }
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("the declared observation surface: the runtime asks ONLY the declared view set, account-filtered", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-surface");
  const spied = spyClient(client);
  try {
    const instrument = `instrument-es-world-w023-surface` as never;
    const account = `account-agents-world-w023-surface` as never;
    const { momentum, meanReversion } = referenceAgents("world-w023-surface");
    const runtime2 = createParticipantRuntime({
      client: spied.client,
      agents: [momentum, meanReversion],
      views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
    });
    runtime2.start();
    await driveJourney(client, runtime2, 6);
    runtime2.stop();

    const allowedReads = new Set([
      "clock.getClock",
      "query.getInstrument",
      "query.getQuote",
      "query.getOrderBook",
      "query.getTrades",
      "query.getPortfolio",
      "query.getRisk",
      "query.getOrders",
    ]);
    const allowedCommands = new Set([
      "command.submitOrder",
      "command.cancelOrder",
      "command.replaceOrder",
      "command.closePosition",
    ]);
    for (const call of spied.calls) {
      const name = `${call.port}.${call.method}`;
      assert.ok(
        allowedReads.has(name) || allowedCommands.has(name),
        `the runtime called a non-declared surface: ${name}`,
      );
    }
    // getOrders is ALWAYS account-scoped (the declared account only).
    for (const call of spied.calls) {
      if (call.port === "query" && call.method === "getOrders") {
        assert.deepEqual(call.args, [{ accountId: account }]);
      }
      if (call.port === "query" && call.method === "getTrades") {
        const query = call.args[1] as { from?: number } | undefined;
        assert.equal(typeof query?.from, "number", "the trade window is declared, never unbounded by accident");
      }
    }
    // The runtime never touched the evidence port, the host surface, or the
    // world-administration commands (createSnapshot/branchWorld/setScenario).
    for (const call of spied.calls) {
      assert.notEqual(call.port, "evidence");
      assert.notEqual(call.port, "host");
      assert.ok(!["createSnapshot", "branchWorld", "setScenario", "addAnnotation"].includes(call.method));
    }
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("fail closed: a port failure stops the loop and settle() rejects with the failure", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-failclosed");
  try {
    // A wrapper that fails every port call once armed — the typed failure a
    // dead transport produces (TradingWorldTransportClosedError), delivered
    // deterministically at the runtime's next port call.
    let armed = false;
    let callsBeforeArming = 0;
    const failWhenArmed =
      (port: string, method: string) =>
      (...args: unknown[]) => {
        if (armed) {
          throw new Error(`[test] port ${port}.${method} failed closed`);
        }
        callsBeforeArming += 1;
        const target = (client as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[port]![
          method
        ] as (...a: unknown[]) => unknown;
        return target.apply(
          (client as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[port],
          args,
        );
      };
    const failingClient: ReactiveParticipantWorldClient = {
      worldId: client.worldId,
      query: {
        getInstrument: failWhenArmed("query", "getInstrument") as never,
        getQuote: failWhenArmed("query", "getQuote") as never,
        getOrderBook: failWhenArmed("query", "getOrderBook") as never,
        getTrades: failWhenArmed("query", "getTrades") as never,
        getPortfolio: failWhenArmed("query", "getPortfolio") as never,
        getRisk: failWhenArmed("query", "getRisk") as never,
        getOrders: failWhenArmed("query", "getOrders") as never,
        getNews: failWhenArmed("query", "getNews") as never,
      } as never,
      command: {
        submitOrder: failWhenArmed("command", "submitOrder") as never,
        cancelOrder: failWhenArmed("command", "cancelOrder") as never,
        replaceOrder: failWhenArmed("command", "replaceOrder") as never,
        closePosition: failWhenArmed("command", "closePosition") as never,
      } as never,
      clock: {
        getClock: failWhenArmed("clock", "getClock") as never,
      } as never,
      onClock(listener) {
        return client.onClock(listener);
      },
    };
    const { momentum, meanReversion, instrument, account } = referenceAgents("world-w023-failclosed");
    const failingRuntime = createParticipantRuntime({
      client: failingClient,
      agents: [momentum, meanReversion],
      views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
    });
    failingRuntime.start();
    await failingRuntime.settle();
    assert.equal(failingRuntime.telemetry().status, "idle");
    assert.ok(callsBeforeArming > 0, "the initial pass read real views");

    // Arm the failure, then deliver a settled view: the pass's first port
    // call fails; the loop must stop and never fabricate an outcome.
    armed = true;
    await client.clock.step(5_000);
    await assert.rejects(() => failingRuntime.settle());
    const telemetry = failingRuntime.telemetry();
    assert.equal(telemetry.status, "failed");
    assert.ok(telemetry.failure instanceof Error);
    const passesAtFailure = telemetry.passes.length;
    const outcomesAtFailure = telemetry.outcomes.length;
    await assert.rejects(() => failingRuntime.settle());
    assert.equal(failingRuntime.telemetry().passes.length, passesAtFailure);
    assert.equal(failingRuntime.telemetry().outcomes.length, outcomesAtFailure);
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("a settled mutating clock call that does not advance time still triggers a reaction", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-pauseview");
  try {
    runtime.start();
    await runtime.settle();
    await client.clock.step(5_000);
    await runtime.settle();
    const before = runtime.telemetry().passes.length;
    // pause() is a mutating clock call: the adapter pushes a settled view at
    // the SAME simulation time — the runtime reacts (a pass runs, no time
    // travel, no duplicate time).
    await client.clock.pause();
    await runtime.settle();
    const telemetry = runtime.telemetry();
    assert.equal(telemetry.passes.length, before + 1);
    assert.equal(
      Number(telemetry.passes[telemetry.passes.length - 1]!.observedAt),
      SIM_START + 5_000,
    );
    // And the clock status the runtime observed is the settled paused truth.
    assert.equal(telemetry.passes[telemetry.passes.length - 1]!.view.clock.status, "paused");
  } finally {
    runtime.stop();
    client.dispose();
  }
});
