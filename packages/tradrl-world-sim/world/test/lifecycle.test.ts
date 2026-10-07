/**
 * Tests for the command lifecycle stages (W013 `world` module).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — validate → authorize →
 * apply domain rules (the engine then mutates, emits, journals, publishes,
 * acks). Spec/ARCHITECTURE-LOCK.md A6/A13, spec/ACCEPTANCE-WORLD-ALPHA.md K.
 *
 * The skeleton boundary is asserted per command kind: implemented kinds
 * (add-annotation, set-scenario) produce event drafts; domain-ruled kinds
 * reject at the documented stage with honest codes (unknown-order for
 * cancel/replace today, not-implemented-in-skeleton naming the owning work
 * order for the rest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BranchWorldCommand,
  CancelOrderCommand,
  CommandRejection,
  CreateSnapshotCommand,
} from "tradrl-world-contracts";
import {
  applyCommand,
  authorizeCommand,
  initialWorldState,
  runCommandLifecycle,
  validateCommand,
  type LifecycleContext,
} from "../index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  WORLD,
  addAnnotationCommand,
  closePositionCommand,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "./helpers.js";

function ctx(): LifecycleContext {
  return {
    definition: testDefinition(),
    state: initialWorldState(testDefinition()),
    simulationTime: (START + 10_000) as never,
  };
}

function rejectionOf(outcome: { kind: string }): CommandRejection | undefined {
  return outcome.kind === "rejected"
    ? (outcome as unknown as { rejection: CommandRejection }).rejection
    : undefined;
}

test("validate: a sound command passes", () => {
  assert.deepEqual(validateCommand(addAnnotationCommand(), ctx()), { ok: true });
});

test("validate: structural malformations are typed malformed-command", () => {
  // base-field problems are reported first and short-circuit kind checks
  const base = validateCommand(addAnnotationCommand({ commandId: "" as never }), ctx());
  assert.equal(base.ok, false);
  assert.deepEqual(
    base.ok === false && base.errors.map((error) => error.code),
    ["malformed-command"],
  );
  // per-kind problems are collected once the base fields are sound
  const kind = validateCommand(addAnnotationCommand({ text: "  " }), ctx());
  assert.equal(kind.ok, false);
  assert.deepEqual(
    kind.ok === false && kind.errors.map((error) => error.code),
    ["malformed-command"],
  );
});

test("validate: a foreign world is unknown-world", () => {
  const result = validateCommand(
    addAnnotationCommand({ worldId: "world-elsewhere" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-world");
});

test("validate: an undeclared issuer is unknown-participant", () => {
  const result = validateCommand(
    addAnnotationCommand({ issuedBy: "participant-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-participant");
});

test("validate: submit-order needs a limit for limit orders and a stop for stops", () => {
  const limitless = submitOrderCommand({
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "10" as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  const result = validateCommand(limitless, ctx());
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "malformed-command");
  assert.match(
    result.ok === false ? (result.errors[0]?.message ?? "") : "",
    /limitPrice/,
  );

  const stopless = submitOrderCommand({
    submission: {
      kind: "stop",
      side: "buy",
      quantity: "10" as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  const stoplessResult = validateCommand(stopless, ctx());
  assert.equal(stoplessResult.ok, false);
  assert.match(
    stoplessResult.ok === false ? (stoplessResult.errors[0]?.message ?? "") : "",
    /stopPrice/,
  );
});

test("validate: unknown instruments and accounts are typed rejections", () => {
  const instrument = validateCommand(
    submitOrderCommand({ instrumentId: "instrument-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(instrument.ok === false && instrument.errors[0]?.code, "unknown-instrument");

  const account = validateCommand(
    submitOrderCommand({ accountId: "account-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(account.ok === false && account.errors[0]?.code, "unknown-account");
});

test("validate: cancel/replace on any order id is the honest unknown-order today", () => {
  const cancel: CancelOrderCommand = {
    kind: "cancel-order",
    commandId: "cmd-cancel-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    orderId: "order-1" as never,
  };
  const result = validateCommand(cancel, ctx());
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-order");
});

test("validate: scenario entries are structurally checked", () => {
  const result = validateCommand(
    setScenarioCommand({
      scenario: { entries: [{ regime: "nonsense" as never, from: START as never }] },
    }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "malformed-command");
});

test("validate: an acked command id is duplicate-command", () => {
  const command = addAnnotationCommand();
  const applied = applyCommand(command, ctx());
  assert.equal(applied.kind, "applied");
  const context = ctx();
  // simulate the post-append state: the reducer registers the ack
  const withAck = {
    ...context.state,
    ackedCommandIds: new Set([command.commandId as never]),
  };
  const result = validateCommand(command, { ...context, state: withAck });
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "duplicate-command");
});

test("authorize: participants act only through their declared account", () => {
  const result = authorizeCommand(
    submitOrderCommand({ accountId: "account-other" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.denial.code, "permission-denied");
});

test("authorize: the trader's own tradable account passes", () => {
  const own = authorizeCommand(submitOrderCommand({ accountId: TRADER_ACCOUNT }), ctx());
  assert.deepEqual(own, { ok: true });
});

test("authorize: a canTrade=false account is account-not-tradable", () => {
  const definition = testDefinition();
  const account = definition.accounts[1]!; // account-other: canTrade=false
  const participants = [
    { participantId: TRADER, worldId: WORLD, kind: "human" as const, accountId: account.accountId },
  ];
  const context: LifecycleContext = {
    definition: { ...definition, participants },
    state: initialWorldState(definition),
    simulationTime: START as never,
  };
  const result = authorizeCommand(
    submitOrderCommand({ accountId: account.accountId }),
    context,
  );
  assert.deepEqual(result.ok === false && result.denial.code, "account-not-tradable");
});

test("authorize: world-ops are permissive for declared participants", () => {
  assert.deepEqual(authorizeCommand(addAnnotationCommand(), ctx()), { ok: true });
  assert.deepEqual(authorizeCommand(setScenarioCommand(), ctx()), { ok: true });
});

test("apply: add-annotation builds the deterministic event draft", () => {
  const command = addAnnotationCommand({ instrumentId: INSTRUMENT });
  const outcome = applyCommand(command, ctx());
  assert.equal(outcome.kind, "applied");
  if (outcome.kind === "applied") {
    assert.equal(outcome.draft.eventType, "world.annotation.added");
    assert.equal(outcome.draft.occurredAt, START + 10_000);
    assert.equal(outcome.draft.causationId, command.commandId);
    assert.equal(outcome.draft.correlationId, command.commandId, "uncorrelated commands correlate with themselves");
    assert.deepEqual(outcome.draft.payload, {
      type: "world.annotation.added",
      annotationId: "ann:world-w013-tests:1",
      issuedBy: TRADER,
      instrumentId: INSTRUMENT,
      at: START + 500,
      text: "golden region start",
    });
  }
});

test("apply: set-scenario builds the scenario event draft", () => {
  const command = setScenarioCommand();
  const outcome = applyCommand(command, ctx());
  assert.equal(outcome.kind, "applied");
  if (outcome.kind === "applied") {
    assert.equal(outcome.draft.eventType, "world.scenario.set");
    assert.deepEqual(outcome.draft.payload, {
      type: "world.scenario.set",
      issuedBy: TRADER,
      label: command.scenario.label,
      entries: command.scenario.entries,
    });
  }
});

test("stub boundary: submit-order rejects not-implemented-in-skeleton naming W014/W015", () => {
  const outcome = runCommandLifecycle(submitOrderCommand(), ctx());
  const rejection = rejectionOf(outcome);
  assert.deepEqual(rejection, {
    stage: "domain-rules",
    code: "not-implemented-in-skeleton",
    message:
      "submit-order: requires the matching engine (W014: packages/tradrl-world-sim/matching) " +
      "and account/risk gating (W015: packages/tradrl-world-sim/account, risk); " +
      "the W013 skeleton implements the command lifecycle, not the domain rules",
  });
});

test("stub boundary: close-position rejects not-implemented-in-skeleton naming W015/W014", () => {
  const outcome = runCommandLifecycle(closePositionCommand(), ctx());
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "domain-rules");
  assert.equal(rejection?.code, "not-implemented-in-skeleton");
  assert.match(rejection?.message ?? "", /W015/);
});

test("stub boundary: create-snapshot and branch-world reject naming W016", () => {
  const snapshot: CreateSnapshotCommand = {
    kind: "create-snapshot",
    commandId: "cmd-snap-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
  };
  const branch: BranchWorldCommand = {
    kind: "branch-world",
    commandId: "cmd-branch-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: "snap-1" as never,
  };
  for (const command of [snapshot, branch]) {
    const outcome = runCommandLifecycle(command, ctx());
    const rejection = rejectionOf(outcome);
    assert.equal(rejection?.stage, "domain-rules");
    assert.equal(rejection?.code, "not-implemented-in-skeleton");
    assert.match(rejection?.message ?? "", /W016/);
  }
});

test("lifecycle ordering: validation precedes authorization precedes domain rules", () => {
  // unknown participant (validate) wins even though the domain op is stubbed
  const outcome = runCommandLifecycle(
    submitOrderCommand({ issuedBy: "participant-ghost" as never }),
    ctx(),
  );
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "validate");
  assert.equal(rejection?.code, "unknown-participant");

  // permission-denied (authorize) wins before the domain stub
  const denied = runCommandLifecycle(
    submitOrderCommand({ accountId: "account-other" as never }),
    ctx(),
  );
  assert.equal(rejectionOf(denied)?.stage, "authorize");
  assert.equal(rejectionOf(denied)?.code, "permission-denied");
});

test("lifecycle: rejected outcomes never build drafts", () => {
  const outcome = runCommandLifecycle(
    addAnnotationCommand({ text: "" }),
    ctx(),
  );
  assert.equal(outcome.kind, "rejected");
  assert.equal(rejectionOf(outcome)?.stage, "validate");
});
