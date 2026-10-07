/**
 * Command lifecycle contract tests.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" (validate → authorize →
 * apply domain rules → ack), R011 (typed auditable commands), acceptance K
 * (explicit typed denial for live-only actions).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplyDomainRulesResult,
  AuthorizeCommandResult,
  CommandAck,
  CommandRejection,
  CommandResult,
  SubmitOrderCommand,
  ValidateCommandResult,
  WorldCommand,
} from "../src/commands.js";
import type {
  AccountId,
  CommandId,
  ParticipantId,
  WorldId,
} from "../src/ids.js";
import { asId, asPrice, asQuantity, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

const ALL_COMMAND_KINDS = [
  "submit-order",
  "cancel-order",
  "replace-order",
  "close-position",
  "add-annotation",
  "create-snapshot",
  "branch-world",
  "set-scenario",
] as const;

// The command union is exactly the eight CommandPort payload kinds.
type _commandKinds = Expect<
  Equal<WorldCommand["kind"], (typeof ALL_COMMAND_KINDS)[number]>
>;

// Ack shape: command id, acceptance time, resulting events, journal cursor.
type _ackKeys = Expect<
  Equal<
    | "commandId"
    | "worldId"
    | "acceptedAt"
    | "resultingEventIds"
    | "journalCursor" extends RequiredKeys<CommandAck>
      ? true
      : false,
    true
  >
>;

// Rejections name their lifecycle stage.
type _rejectionStage = Expect<
  Equal<CommandRejection["stage"], "validate" | "authorize" | "domain-rules">
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const participantId = asId<ParticipantId>("participant-human");
const accountId = asId<AccountId>("account-1");

const submit: SubmitOrderCommand = {
  kind: "submit-order",
  commandId: asId<CommandId>("command-1"),
  worldId,
  issuedBy: participantId,
  issuedAt: asTimestamp(1_000),
  accountId,
  instrumentId: "instr-1" as SubmitOrderCommand["instrumentId"],
  submission: {
    kind: "limit",
    side: "buy",
    quantity: asQuantity("10"),
    limitPrice: asPrice("100.25"),
    constraints: { timeInForce: "GTC", postOnly: true },
  },
};

const acked: CommandResult = {
  status: "acked",
  ack: {
    commandId: submit.commandId,
    worldId,
    acceptedAt: asTimestamp(1_005),
    resultingEventIds: ["event-11" as CommandAck["resultingEventIds"][number]],
    journalCursor: 11 as CommandAck["journalCursor"],
  },
};

const rejected: CommandResult = {
  status: "rejected",
  rejection: {
    stage: "authorize",
    code: "live-execution-not-permitted",
    message: "World Alpha has no live execution authority",
  },
};

// --- runtime invariants --------------------------------------------------------

test("commands are typed, auditable and identify their issuer", () => {
  assert.equal(submit.kind, "submit-order");
  assert.equal(submit.issuedBy, participantId);
  assert.equal(submit.submission.constraints.timeInForce, "GTC");
  assert.equal(submit.submission.constraints.postOnly, true);
});

test("an ack closes the lifecycle with events and a journal cursor", () => {
  if (acked.status === "acked") {
    assert.equal(acked.ack.commandId, submit.commandId);
    assert.equal(acked.ack.resultingEventIds.length, 1);
    assert.ok(acked.ack.journalCursor >= 0);
    assert.ok(acked.ack.acceptedAt >= submit.issuedAt);
  } else {
    assert.fail("expected acked result");
  }
});

test("rejections name their lifecycle stage and a reason code", () => {
  if (rejected.status === "rejected") {
    assert.equal(rejected.rejection.stage, "authorize");
    assert.equal(rejected.rejection.code, "live-execution-not-permitted");
  } else {
    assert.fail("expected rejected result");
  }
});

test("validate and authorize have distinct typed result shapes", () => {
  const validateOk: ValidateCommandResult = { ok: true };
  const validateBad: ValidateCommandResult = {
    ok: false,
    errors: [{ code: "unknown-instrument", message: "no such instrument", field: "instrumentId" }],
  };
  const authorizeOk: AuthorizeCommandResult = { ok: true };
  const authorizeBad: AuthorizeCommandResult = {
    ok: false,
    denial: { code: "permission-denied", message: "read-only account" },
  };
  assert.equal(validateOk.ok, true);
  if (!validateBad.ok) {
    assert.equal(validateBad.errors.length, 1);
  }
  assert.equal(authorizeOk.ok, true);
  if (!authorizeBad.ok) {
    assert.equal(authorizeBad.denial.code, "permission-denied");
  }

  const domain: ApplyDomainRulesResult = {
    ok: false,
    failure: { rule: "post-only-would-take", message: "post-only would cross the book" },
  };
  if (!domain.ok) {
    assert.equal(domain.failure.rule, "post-only-would-take");
  }
});
