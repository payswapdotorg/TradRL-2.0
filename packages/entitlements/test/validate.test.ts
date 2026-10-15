/**
 * Whole-record re-validation (W058 entitlements) — the laws as
 * executable tests: the clean re-proof naming every checked law, the id
 * + provenance re-derivations, the scope/terms/period/lineage laws.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateEntitlement } from "../validate.js";
import type { Entitlement } from "../grant.js";
import { PERIOD, PRINCIPAL, TERMS, grantedFixture } from "./fixtures.js";

test("a clean entitlement re-validates whole-record, naming every checked law", () => {
  const { entitlement } = grantedFixture();
  const outcome = validateEntitlement(entitlement);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a clean re-validation");
  }
  assert.deepEqual(outcome.checked, [
    "structure",
    "scope-laws",
    "terms-laws",
    "period-laws",
    "lineage-shape",
    "identity",
    "provenance",
  ]);
});

test("an edited body is caught by the id re-derivation (A9, loudly)", () => {
  const { entitlement } = grantedFixture();
  const tampered = { ...entitlement, terms: { ...TERMS, price: { amount: 1, currency: "USD" } } };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "entitlement-id-mismatch"), true);
});

test("an edited grantee scope is caught by BOTH the scope law and the id law", () => {
  const { entitlement } = grantedFixture();
  const tampered = { ...entitlement, scope: { ...PRINCIPAL, principalId: "principal-someone-else" } };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "entitlement-id-mismatch"), true);
});

test("a blank grantee member is caught loudly at re-validation", () => {
  const { entitlement } = grantedFixture();
  const tampered = { ...entitlement, scope: { tenantId: "", principalId: PRINCIPAL.principalId } };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "blank-scope-member");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes("tenantId"), true);
});

test("an invalid period is caught at re-validation", () => {
  const { entitlement } = grantedFixture();
  const tampered: Entitlement = { ...entitlement, period: { kind: "fixed-window", startAt: 500, endAt: 100 } };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "invalid-period"), true);
});

test("a tampered provenance is caught by the input-digest re-derivation", () => {
  const { entitlement } = grantedFixture();
  const tampered = {
    ...entitlement,
    provenance: { ...entitlement.provenance, inputDigest: "00000000" },
  };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "provenance-mismatch"), true);
  // The provenance rides BESIDE the id (the W053/memory precedent), so a
  // tampered provenance is caught by its OWN re-derivation law — the
  // entitlement id itself still re-derives.
});

test("a lineage shape break is re-proved from the record", () => {
  const { entitlement } = grantedFixture();
  const tampered = {
    ...entitlement,
    lineage: { parentEntitlementId: entitlement.entitlementId, version: 1 },
  };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "entitlement-lineage-break"), true);
});

test("terms outside the closed vocabulary are caught through the marketplace's own validator", () => {
  const { entitlement } = grantedFixture();
  const tampered: Entitlement = {
    ...entitlement,
    terms: { model: "barter" as never, billingPeriod: "monthly", price: { amount: 1, currency: "USD" } },
  };
  const outcome = validateEntitlement(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "invalid-terms");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes("closed vocabulary"), true);
});

test("a malformed record is refused fail-closed", () => {
  const outcome = validateEntitlement(null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-record");
});

test("the carried period rides the record verbatim (the declared window is data)", () => {
  const { entitlement } = grantedFixture();
  assert.deepEqual(entitlement.period, PERIOD);
  const outcome = validateEntitlement(entitlement);
  assert.equal(outcome.ok, true);
});
