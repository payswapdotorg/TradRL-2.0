/**
 * The action protocol laws (W035) — the admission gate (commands outside
 * the embodiment/scope NEVER issue, never a partial stream) and the FIFO
 * issuance with typed outcomes — proven against the REAL compact protocol
 * world through the REAL W018 provider (the spy records every command-port
 * call; the outcomes are the engine's own).
 *
 * Run: ../../node_modules/.bin/tsx --test test/action.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { DecisionStream } from "tradrl-world-contracts/cognitiveSubstrate";
import { issueDecisionStream } from "../action.js";
import type { AgentWorldClient } from "../contracts.js";
import {
  INSTRUMENT_NQ,
  PROTOCOL_WORLD_ID,
  SUBSTRATE_MR,
  agentEmbodiment,
  lawfulStream,
  possessionOf,
  spyCommandsOn,
  widePossession,
  wideStream,
} from "./fixtures.js";
import { attachProtocolWorld, fixedWallSource } from "./helpers.js";
import { SIM_START } from "./fixtures.js";
import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";

/** The default possession + live substrate (the ES desk MR mind). */
function mrFixture() {
  const substrate = createMeanReversionSubstrate({
    substrateId: SUBSTRATE_MR,
    seed: "w035-mr-1",
    instrumentId: `instrument-es-${PROTOCOL_WORLD_ID}` as never,
    threshold: "0.75",
    quantity: "1",
  });
  return { possession: possessionOf(substrate.descriptor), substrate };
}

/** A real client over the compact protocol world, command-spied. */
async function spiedClient(worldId: string): Promise<{
  readonly client: AgentWorldClient;
  readonly calls: { readonly port: string; readonly method: string; readonly args: readonly unknown[] }[];
  readonly dispose: () => void;
}> {
  const engine = await attachProtocolWorld(worldId, {
    wallTimeSource: fixedWallSource(SIM_START + 5000),
  });
  const spy = spyCommandsOn(engine);
  return { client: spy.client, calls: spy.calls, dispose: () => engine.dispose() };
}

test("the admission gate: a command outside the embodiment NEVER issues (the port untouched)", async () => {
  const { possession } = mrFixture();
  // A body embodying market/limit only — the stream proposes a STOP order
  // (an order kind outside the narrowed embodiment).
  const narrowBody = {
    ...possession.body,
    embodiment: { ...agentEmbodiment(), orderKinds: ["market", "limit"] as never },
  };
  const base = lawfulStream().decisions[0]!;
  assert.equal(base.command.kind, "submit-order");
  const stream = lawfulStream({
    decisions: [
      {
        ...base,
        command: {
          ...base.command,
          kind: "submit-order",
          submission: {
            kind: "stop",
            side: "buy",
            quantity: "1" as never,
            stopPrice: "4810.00" as never,
            constraints: { timeInForce: "GTC" },
          },
        },
      },
    ],
  });
  const harness = await spiedClient("world-w035-act-embodiment");
  try {
    const result = await issueDecisionStream(harness.client, { ...possession, body: narrowBody }, stream);
    assert.equal(result.admission.ok, false);
    if (result.admission.ok) return;
    const streamInvalid = result.admission.incompatibilities.find((one) => one.code === "stream-invalid");
    assert.ok(streamInvalid !== undefined, "the refusal carries the stream-invalid incompatibility");
    assert.deepEqual(
      streamInvalid?.streamErrors?.map((one) => one.code),
      ["order-kind-not-in-embodiment"],
      "the W033 errors are carried verbatim",
    );
    assert.deepEqual(result.outcomes, [], "nothing issued — the whole stream is the unit of admission");
    assert.equal(
      harness.calls.filter((one) => one.port === "command").length,
      0,
      "the command port was never touched",
    );
  } finally {
    harness.dispose();
  }
});

test("the admission gate: the possession-scope layer (in embodiment, beyond scope) refuses", async () => {
  const { possession } = mrFixture();
  // NQ is inside the body's embodiment but OUTSIDE the possession scope.
  const base = lawfulStream().decisions[0]!;
  assert.equal(base.command.kind, "submit-order");
  const stream: DecisionStream = lawfulStream({
    decisions: [
      {
        ...base,
        decisionId: "decision-w035-ns" as never,
        command: {
          ...base.command,
          kind: "submit-order",
          commandId: "command-w035-ns" as never,
          instrumentId: INSTRUMENT_NQ,
        },
      },
    ],
  });
  const harness = await spiedClient("world-w035-act-scope");
  try {
    const result = await issueDecisionStream(harness.client, possession, stream);
    assert.equal(result.admission.ok, false);
    if (result.admission.ok) return;
    assert.deepEqual(
      result.admission.incompatibilities.map((one) => one.code),
      ["instrument-not-in-scope"],
      "the W034 scope layer names the exact mismatch",
    );
    assert.deepEqual(result.outcomes, []);
    assert.equal(harness.calls.filter((one) => one.port === "command").length, 0);
  } finally {
    harness.dispose();
  }
});

test("the admission gate: a rate-beyond-grant stream refuses (never truncated)", async () => {
  const { possession } = mrFixture();
  const one = lawfulStream().decisions[0]!;
  const stream: DecisionStream = lawfulStream({
    decisions: [
      one,
      {
        ...one,
        decisionId: "decision-w035-rate-2" as never,
        command: { ...one.command, commandId: "command-w035-rate-2" as never },
      },
    ],
  });
  const harness = await spiedClient("world-w035-act-rate");
  try {
    const result = await issueDecisionStream(harness.client, possession, stream);
    assert.equal(result.admission.ok, false);
    if (result.admission.ok) return;
    const streamInvalid = result.admission.incompatibilities.find((one) => one.code === "stream-invalid");
    assert.deepEqual(
      streamInvalid?.streamErrors?.map((one) => one.code),
      ["rate-envelope-breach"],
    );
    assert.ok(
      streamInvalid?.streamErrors?.[0]?.rate !== undefined &&
        streamInvalid.streamErrors[0].rate.count === 2 &&
        streamInvalid.streamErrors[0].rate.max === 1,
      "the rate evidence carries the count and the cap",
    );
    assert.deepEqual(result.outcomes, []);
    assert.equal(harness.calls.filter((one) => one.port === "command").length, 0);
  } finally {
    harness.dispose();
  }
});

test("FIFO: the eight command kinds dispatch through the REAL port in stream order, with typed outcomes", async () => {
  const worldId = "world-w035-act-dispatch";
  const possession = widePossession(worldId);
  const stream = wideStream(worldId);
  const harness = await spiedClient(worldId);
  try {
    const result = await issueDecisionStream(harness.client, possession, stream);
    assert.equal(result.admission.ok, true, "the wide lawful stream admits");
    assert.equal(result.outcomes.length, 8);
    // The port calls: exactly the eight command methods, in stream order.
    assert.deepEqual(
      harness.calls.map((one) => one.method),
      [
        "submitOrder",
        "cancelOrder",
        "replaceOrder",
        "closePosition",
        "addAnnotation",
        "createSnapshot",
        "branchWorld",
        "setScenario",
      ],
    );
    // Every outcome is the port's own typed result, verbatim, in order,
    // carrying the stream's own command ids and kinds (the protocol
    // invents no identity and reorders nothing).
    for (const [index, outcome] of result.outcomes.entries()) {
      assert.equal(outcome.commandKind, stream.decisions[index]?.command.kind);
      assert.equal(String(outcome.commandId), String(stream.decisions[index]?.command.commandId));
      assert.equal(String(outcome.decisionId), String(stream.decisions[index]?.decisionId));
      assert.ok(
        outcome.result.status === "acked" ||
          (outcome.result.status === "rejected" && typeof outcome.result.rejection.code === "string"),
        `outcome ${String(index)} is the port's own typed result`,
      );
    }
    // The engine's own rejections are honest outcomes (an unknown order id
    // cannot be cancelled — a typed rejection, never fabricated success).
    const cancelOutcome = result.outcomes[1]!;
    assert.equal(cancelOutcome.result.status, "rejected");
  } finally {
    harness.dispose();
  }
});

test("the protocol stamps nothing: the issued commands are the stream's own, byte for byte", async () => {
  const worldId = "world-w035-act-identity";
  const possession = widePossession(worldId);
  const stream = wideStream(worldId);
  const harness = await spiedClient(worldId);
  try {
    const result = await issueDecisionStream(harness.client, possession, stream);
    assert.equal(result.admission.ok, true);
    for (const [index, call] of harness.calls.entries()) {
      assert.deepEqual(
        call.args[0],
        stream.decisions[index]?.command,
        `command ${String(index)} crossed the port exactly as the substrate proposed it`,
      );
    }
  } finally {
    harness.dispose();
  }
});

test("an inadmissible stream never reaches the port even mid-lifecycle (the gate is per stream)", async () => {
  const { possession } = mrFixture();
  const good = lawfulStream();
  const goodCommand = good.decisions[0]!.command;
  assert.equal(goodCommand.kind, "submit-order");
  const bad: DecisionStream = lawfulStream({
    decisions: [
      {
        ...good.decisions[0]!,
        command: {
          ...goodCommand,
          kind: "submit-order",
          issuedBy: "participant-someone-else" as never,
        },
      },
    ],
  });
  const harness = await spiedClient("world-w035-act-issuedby");
  try {
    const first = await issueDecisionStream(harness.client, possession, good);
    assert.equal(first.admission.ok, true);
    assert.equal(first.outcomes.length, 1);
    const second = await issueDecisionStream(harness.client, possession, bad);
    assert.equal(second.admission.ok, false);
    if (second.admission.ok) return;
    const streamInvalid = second.admission.incompatibilities.find((one) => one.code === "stream-invalid");
    assert.ok(
      streamInvalid?.streamErrors?.some((one) => one.code === "issued-by-mismatch"),
      "a proposal as anyone else is refused (A4/A15: the seat is the body's own)",
    );
    assert.equal(harness.calls.filter((one) => one.port === "command").length, 1);
  } finally {
    harness.dispose();
  }
});
