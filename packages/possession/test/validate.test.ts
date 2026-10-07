/**
 * The PossessionDescriptor validators (W034): loud, complete, typed —
 * the W032 validateBodyAttachment style (every violation collected,
 * deterministic order, verbatim delegation to the consumed W032/W033
 * validators).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePossessionDescriptor } from "../index.js";
import { validateBodyDescriptor } from "agent-body/validate";
import { validateSubstrateDescriptor } from "cognitive-substrate/validate";
import {
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  possessionOne,
  traderBody,
  momentumSubstrate,
} from "./fixtures.js";

test("the default fixture possession is valid", () => {
  assert.deepEqual(validatePossessionDescriptor(possessionOne()), { ok: true });
});

test("blank possession and principal identities are rejected", () => {
  const blankPossession = validatePossessionDescriptor(
    possessionOne({ possessionId: "   " as never }),
  );
  assert.equal(blankPossession.ok, false);
  if (blankPossession.ok) return;
  assert.deepEqual(
    blankPossession.errors.map((one) => [one.code, one.field]),
    [["blank-identity", "possessionId"]],
  );

  const blankPrincipal = validatePossessionDescriptor(
    possessionOne({ grant: { ...possessionOne().grant, grantedBy: "" as never } }),
  );
  assert.equal(blankPrincipal.ok, false);
  if (blankPrincipal.ok) return;
  assert.deepEqual(
    blankPrincipal.errors.map((one) => [one.code, one.field]),
    [["blank-identity", "grant.grantedBy"]],
  );
});

test("unknown grant channels are rejected", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({
      grant: { ...possessionOne().grant, channel: "marketplace" as never },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.errors[0]?.code, "unknown-channel");
  assert.equal(outcome.errors[0]?.field, "grant.channel");
  assert.match(outcome.errors[0]?.message ?? "", /marketplace/u);
});

test("non-finite grant times are rejected (declared data, never a clock read)", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({ grant: { ...possessionOne().grant, grantedAt: Number.POSITIVE_INFINITY as never } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["non-finite-time", "grant.grantedAt"]],
  );
});

test("blank grant bases are rejected (rationale as data)", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({ grant: { ...possessionOne().grant, basis: "  " } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["blank-basis", "grant.basis"]],
  );
});

test("an invalid body is delegated to W032 and its errors carried verbatim", () => {
  const brokenBody = traderBody({
    embodiment: {
      ...traderBody().embodiment,
      instruments: [INSTRUMENT_ES, INSTRUMENT_ES],
    },
  });
  const outcome = validatePossessionDescriptor(possessionOne({ body: brokenBody }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["invalid-body", "body"]],
  );
  // the carried list is the W032 validator's own, verbatim — never re-derived
  const direct = validateBodyDescriptor(brokenBody);
  assert.equal(direct.ok, false);
  if (direct.ok) return;
  assert.deepEqual(outcome.errors[0]?.body, direct.errors);
});

test("an invalid substrate is delegated to W033 and its errors carried verbatim", () => {
  const brokenSubstrate = momentumSubstrate({ seed: "" });
  const outcome = validatePossessionDescriptor(
    possessionOne({ substrate: brokenSubstrate }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["invalid-substrate", "substrate"]],
  );
  const direct = validateSubstrateDescriptor(brokenSubstrate);
  assert.equal(direct.ok, false);
  if (direct.ok) return;
  assert.deepEqual(outcome.errors[0]?.substrate, direct.errors);
});

test("duplicate scope entries are each named", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({
      scope: {
        ...possessionOne().scope,
        instruments: [INSTRUMENT_ES, INSTRUMENT_ES],
        commandKinds: ["submit-order", "close-position", "submit-order"],
      },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [
      ["duplicate-scope-entry", "scope.instruments"],
      ["duplicate-scope-entry", "scope.commandKinds"],
    ],
  );
});

test("unknown observation kinds are rejected against the closed set", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({
      scope: {
        ...possessionOne().scope,
        observations: ["market-quote", "own-orders", "trade-ideas" as never],
      },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["unknown-observation-kind", "scope.observations"]],
  );
});

test("scope instruments beyond the embodiment are rejected by name", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({
      body: traderBody({
        embodiment: { ...traderBody().embodiment, instruments: [INSTRUMENT_ES] },
      }),
      scope: { ...possessionOne().scope, instruments: [INSTRUMENT_ES, INSTRUMENT_NQ] },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field, one.message.includes(String(INSTRUMENT_NQ))]),
    [["scope-beyond-embodiment", "scope.instruments", true]],
  );
});

test("scope command kinds beyond the embodiment are rejected by name", () => {
  const outcome = validatePossessionDescriptor(
    possessionOne({
      body: traderBody({
        embodiment: {
          ...traderBody().embodiment,
          commandKinds: ["submit-order", "close-position"],
        },
      }),
      scope: {
        ...possessionOne().scope,
        commandKinds: ["submit-order", "close-position", "branch-world"],
      },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((one) => [one.code, one.field]),
    [["scope-beyond-embodiment", "scope.commandKinds"]],
  );
  assert.match(outcome.errors[0]?.message ?? "", /branch-world/u);
});

test("malformed rate grants are rejected (the W033 rate law)", () => {
  const cases: readonly [number, string][] = [
    [0, "scope.decisionRate.maxDecisionsPerView"],
    [1.5, "scope.decisionRate.maxDecisionsPerView"],
  ];
  for (const [cap, field] of cases) {
    const outcome = validatePossessionDescriptor(
      possessionOne({
        scope: { ...possessionOne().scope, decisionRate: { maxDecisionsPerView: cap } },
      }),
    );
    assert.equal(outcome.ok, false, `cap ${String(cap)}`);
    if (outcome.ok) return;
    assert.deepEqual(
      outcome.errors.map((one) => [one.code, one.field]),
      [["invalid-rate-grant", field]],
    );
  }
  const negativeInterval = validatePossessionDescriptor(
    possessionOne({
      scope: {
        ...possessionOne().scope,
        decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: -1 },
      },
    }),
  );
  assert.equal(negativeInterval.ok, false);
  if (negativeInterval.ok) return;
  assert.deepEqual(
    negativeInterval.errors.map((one) => [one.code, one.field]),
    [["invalid-rate-grant", "scope.decisionRate.minViewIntervalMs"]],
  );
});

test("every violation is collected in deterministic order (complete outcomes)", () => {
  const outcome = validatePossessionDescriptor({
    possessionId: " " as never,
    body: traderBody({
      embodiment: { ...traderBody().embodiment, venues: [] },
    }),
    substrate: momentumSubstrate({ commandKinds: ["submit-order", "submit-order"] }),
    grant: {
      grantedBy: "principal-x" as never,
      channel: "spontaneous" as never,
      grantedAt: Number.NaN as never,
      basis: "no basis",
    },
    scope: {
      instruments: [INSTRUMENT_ES, INSTRUMENT_ES],
      observations: ["market-quote", "own-orders", "market-gossip" as never],
      commandKinds: ["submit-order", "close-position", "branch-world"],
    },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  // grant errors (identity, channel, time) → body (W032) → substrate
  // (W033) → scope duplicates → unknown kinds → embodiment breaches
  assert.deepEqual(
    outcome.errors.map((one) => one.code),
    [
      "blank-identity",
      "unknown-channel",
      "non-finite-time",
      "invalid-body",
      "invalid-substrate",
      "duplicate-scope-entry",
      "unknown-observation-kind",
      "scope-beyond-embodiment",
    ],
  );
});
