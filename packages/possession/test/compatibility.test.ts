/**
 * The compatibility checker (W034): can THIS substrate possess THIS body?
 * Every incompatibility names the exact field/limit mismatch (the W032
 * envelope-breach style); every ok carries the checked evidence list
 * (R051 — exactly what was proven, no more).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDecisionStreamCompatibility,
  checkPossessionCompatibility,
} from "../index.js";
import { decisionStreamDigestOf } from "cognitive-substrate/validate";
import { validateBodyAttachment } from "agent-body/validate";
import {
  ACCOUNT_TRADER,
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  PARTICIPANT_TRADER,
  WORLD,
  lawfulStream,
  possessionOne,
  fixtureWorld,
  momentumSubstrate,
} from "./fixtures.js";

test("a compatible possession is ok with exactly the checks that ran (no world, no rate grant)", () => {
  const descriptor = possessionOne({
    scope: { ...possessionOne().scope, decisionRate: undefined },
  });
  const outcome = checkPossessionCompatibility(descriptor);
  assert.deepEqual(outcome, {
    ok: true,
    checked: ["descriptor-structure", "embodied-command-kinds"],
  });
});

test("a compatible possession with a rate grant claims the rate check", () => {
  const outcome = checkPossessionCompatibility(possessionOne());
  assert.deepEqual(outcome, {
    ok: true,
    checked: ["descriptor-structure", "embodied-command-kinds", "rate-grant"],
  });
});

test("a compatible possession against a REAL world claims the attach check", () => {
  const outcome = checkPossessionCompatibility(possessionOne(), fixtureWorld());
  assert.deepEqual(outcome, {
    ok: true,
    checked: [
      "descriptor-structure",
      "embodied-command-kinds",
      "rate-grant",
      "body-attachment",
    ],
  });
});

test("a substrate command kind beyond the embodiment is incompatible, per kind, with the exact mismatch", () => {
  const outcome = checkPossessionCompatibility(
    possessionOne({
      substrate: momentumSubstrate({
        commandKinds: ["submit-order", "close-position", "branch-world"],
      }),
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => [one.code, one.field]),
    [["command-kind-not-embodied", "substrate.commandKinds"]],
  );
  const incompatibility = outcome.incompatibilities[0];
  assert.deepEqual(incompatibility?.mismatch, {
    limit: "body.embodiment.commandKinds",
    substrateValue: "branch-world",
    bodyValue: "submit-order, cancel-order, replace-order, close-position, add-annotation",
  });
});

test("a substrate rate beyond the grant is incompatible with the exact compared values", () => {
  const outcome = checkPossessionCompatibility(
    possessionOne({
      substrate: momentumSubstrate({
        decisionRate: { maxDecisionsPerView: 3, minViewIntervalMs: 1000 },
      }),
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => [one.code, one.field]),
    [["rate-beyond-grant", "substrate.decisionRate.maxDecisionsPerView"]],
  );
  assert.deepEqual(outcome.incompatibilities[0]?.mismatch, {
    limit: "scope.decisionRate.maxDecisionsPerView",
    substrateValue: "3",
    bodyValue: "1",
  });
});

test("an exactly-equal rate boundary is compatible (≤ the grant, never clipped)", () => {
  const outcome = checkPossessionCompatibility(possessionOne());
  assert.equal(outcome.ok, true);
});

test("a substrate expecting tighter view spacing than the grant honors is incompatible", () => {
  const outcome = checkPossessionCompatibility(
    possessionOne({
      substrate: momentumSubstrate({
        decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 250 },
      }),
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => [one.code, one.field]),
    [["view-interval-below-grant", "substrate.decisionRate.minViewIntervalMs"]],
  );
  assert.deepEqual(outcome.incompatibilities[0]?.mismatch, {
    limit: "scope.decisionRate.minViewIntervalMs",
    substrateValue: "250",
    bodyValue: "1000",
  });
});

test("an unset substrate interval is never compared (the W003 unset law)", () => {
  const outcome = checkPossessionCompatibility(
    possessionOne({
      substrate: momentumSubstrate({
        decisionRate: { maxDecisionsPerView: 1 },
      }),
    }),
  );
  assert.equal(outcome.ok, true);
});

test("a body that cannot attach fails compatibility with the W032 errors verbatim", () => {
  const world = fixtureWorld({
    participants: [
      {
        participantId: "participant-someone-else" as never,
        worldId: fixtureWorld().scope.worldId,
        kind: "human",
        accountId: "account-trader" as never,
      },
    ],
  });
  const outcome = checkPossessionCompatibility(possessionOne(), world);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["body-attachment-failed"],
  );
  const direct = validateBodyAttachment(possessionOne().body, world);
  assert.equal(direct.ok, false);
  if (direct.ok) return;
  assert.deepEqual(outcome.incompatibilities[0]?.bodyErrors, direct.errors);
});

test("an invalid descriptor short-circuits with the errors verbatim (the W032 precedent)", () => {
  const outcome = checkPossessionCompatibility(
    possessionOne({ possessionId: "" as never }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["descriptor-invalid"],
  );
  assert.equal(outcome.incompatibilities[0]?.descriptorErrors?.length, 1);
});

test("the decision-level check proves a lawful stream and cites its digest", () => {
  const stream = lawfulStream();
  const outcome = checkDecisionStreamCompatibility(stream, possessionOne());
  assert.deepEqual(outcome, {
    ok: true,
    checked: ["descriptor-structure", "decision-stream"],
    streamDigest: decisionStreamDigestOf(stream),
  });
});

test("a stream violating the W033 law fails with its errors verbatim (the embodiment is the authority)", () => {
  const base = lawfulStream();
  const stream = lawfulStream({
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          commandId: "command-fixture-unknown" as never,
          worldId: WORLD,
          issuedBy: PARTICIPANT_TRADER,
          issuedAt: base.asOf,
          kind: "submit-order",
          accountId: ACCOUNT_TRADER,
          instrumentId: "instrument-unknown" as never,
          submission: {
            kind: "market",
            side: "buy",
            quantity: "1" as never,
            constraints: { timeInForce: "GTC" },
          },
        },
      },
    ],
  });
  const outcome = checkDecisionStreamCompatibility(stream, possessionOne());
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const streamInvalid = outcome.incompatibilities.filter(
    (one) => one.code === "stream-invalid",
  );
  assert.equal(streamInvalid.length, 1);
  assert.ok(
    (streamInvalid[0]?.streamErrors ?? []).some(
      (one) => one.code === "instrument-not-in-embodiment",
    ),
  );
});

test("a stream command kind beyond the possession scope is incompatible (declared and embodied, but outside the grant)", () => {
  const descriptor = possessionOne({
    substrate: momentumSubstrate({
      commandKinds: ["submit-order", "close-position", "add-annotation"],
    }),
  });
  const base = lawfulStream();
  const stream = lawfulStream({
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          commandId: "command-fixture-annotation" as never,
          worldId: WORLD,
          issuedBy: PARTICIPANT_TRADER,
          issuedAt: base.asOf,
          kind: "add-annotation",
          instrumentId: INSTRUMENT_ES,
          at: base.asOf,
          text: "fixture annotation",
        },
      },
    ],
  });
  const outcome = checkDecisionStreamCompatibility(stream, descriptor);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  // the W033 law passes (the kind is declared and embodied); ONLY the
  // possession-scope layer catches it — the grant is narrower than both.
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["command-kind-not-in-scope"],
  );
  assert.deepEqual(outcome.incompatibilities[0]?.mismatch, {
    limit: "scope.commandKinds",
    substrateValue: "add-annotation",
    bodyValue: "submit-order, close-position",
  });
});

test("a stream instrument beyond the possession scope is incompatible (inside the embodiment, outside the grant)", () => {
  // NQ is embodied by the fixture body but granted only for ES
  const base = lawfulStream();
  const stream = lawfulStream({
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          commandId: "command-fixture-nq" as never,
          worldId: WORLD,
          issuedBy: PARTICIPANT_TRADER,
          issuedAt: base.asOf,
          kind: "submit-order",
          accountId: ACCOUNT_TRADER,
          instrumentId: INSTRUMENT_NQ,
          submission: {
            kind: "market",
            side: "buy",
            quantity: "1" as never,
            constraints: { timeInForce: "GTC" },
          },
        },
      },
    ],
  });
  const outcome = checkDecisionStreamCompatibility(stream, possessionOne());
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  // the W033 law passes (NQ is inside the embodiment); ONLY the grant
  // layer catches it.
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["instrument-not-in-scope"],
  );
  assert.deepEqual(outcome.incompatibilities[0]?.mismatch, {
    limit: "scope.instruments",
    substrateValue: String(INSTRUMENT_NQ),
    bodyValue: String(INSTRUMENT_ES),
  });
});

test("a stream emitting beyond the scope's rate cap is incompatible with the exact count", () => {
  const base = lawfulStream();
  const second = {
    ...base.decisions[0]!,
    decisionId: "decision-fixture-2" as never,
    command: {
      commandId: "command-fixture-2" as never,
      worldId: WORLD,
      issuedBy: PARTICIPANT_TRADER,
      issuedAt: base.asOf,
      kind: "submit-order" as const,
      accountId: ACCOUNT_TRADER,
      instrumentId: INSTRUMENT_ES,
      submission: {
        kind: "market" as const,
        side: "buy" as const,
        quantity: "1" as never,
        constraints: { timeInForce: "GTC" as const },
      },
    },
  };
  const stream = lawfulStream({ decisions: [base.decisions[0]!, second] });
  const outcome = checkDecisionStreamCompatibility(stream, possessionOne());
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const rate = outcome.incompatibilities.find((one) => one.code === "rate-beyond-grant");
  assert.deepEqual(rate?.mismatch, {
    limit: "scope.decisionRate.maxDecisionsPerView",
    substrateValue: "2",
    bodyValue: "1",
  });
});

test("an invalid possession cannot prove any stream", () => {
  const outcome = checkDecisionStreamCompatibility(lawfulStream(), {
    ...possessionOne(),
    possessionId: "" as never,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["descriptor-invalid"],
  );
});
