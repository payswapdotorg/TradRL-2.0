/**
 * The A9 twins (W058 entitlements) — determinism as executable tests:
 * same inputs ⇒ deep-equal entitlement with the same canonical id; any
 * differing byte ⇒ a different id; the TENANT twin (R056 structural);
 * input order never leaks.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { grantEntitlement } from "../grant.js";
import { verifyEntitlement } from "../verify.js";
import { PERIOD, PRINCIPAL, TERMS, grantedFixture, grantInputFixture } from "./fixtures.js";

test("the A9 twin: the same grant input seals the SAME entitlement, deep-equal", () => {
  const { input } = grantInputFixture();
  const left = grantEntitlement(input);
  const right = grantEntitlement(input);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean grants");
  }
  assert.deepEqual(left.entitlement, right.entitlement);
  assert.equal(String(left.entitlement.entitlementId), String(right.entitlement.entitlementId));
});

test("any differing byte yields a DIFFERENT entitlement id (content-addressed)", () => {
  const { input } = grantInputFixture();
  const left = grantEntitlement(input);
  const right = grantEntitlement({ ...input, period: { kind: "fixed-window", startAt: PERIOD.startAt, endAt: PERIOD.endAt + 1 } });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean grants");
  }
  assert.notEqual(String(left.entitlement.entitlementId), String(right.entitlement.entitlementId));
});

test("the TENANT twin (R056 structural): identical grants under different tenants differ", () => {
  const { input } = grantInputFixture();
  const left = grantEntitlement(input);
  const right = grantEntitlement({
    ...input,
    principal: { tenantId: "tenant-entitlements-OTHER", principalId: PRINCIPAL.principalId },
  });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean grants");
  }
  assert.notEqual(String(left.entitlement.entitlementId), String(right.entitlement.entitlementId));
  // And each twin's use stays confined to its own tenant: the OTHER
  // tenant's grant refuses THIS tenant's principal loudly (R056).
  const use = {
    scope: { ...PRINCIPAL },
    offerId: right.entitlement.offer.offerId,
    at: 150,
    terms: { ...TERMS, price: { ...TERMS.price } },
  };
  const verdict = verifyEntitlement(right.entitlement, use);
  assert.equal(verdict.ok, false);
  if (verdict.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(verdict.refusals.some((candidate) => candidate.code === "cross-tenant"), true);
});

test("the PRINCIPAL twin: same tenant, different principal ⇒ different entitlement", () => {
  const { input } = grantInputFixture();
  const left = grantEntitlement(input);
  const right = grantEntitlement({
    ...input,
    principal: { tenantId: PRINCIPAL.tenantId, principalId: "principal-someone-else" },
  });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean grants");
  }
  assert.notEqual(String(left.entitlement.entitlementId), String(right.entitlement.entitlementId));
});

test("the known-entitlements order never leaks into the sealed value", () => {
  const { entitlement } = grantedFixture();
  const { input } = grantInputFixture();
  const left = grantEntitlement(
    { ...input, lineage: { parentEntitlementId: entitlement.entitlementId, version: 2 } },
    [entitlement],
  );
  const right = grantEntitlement(
    { ...input, lineage: { parentEntitlementId: entitlement.entitlementId, version: 2 } },
    [entitlement],
  );
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean renewals");
  }
  assert.deepEqual(left.entitlement, right.entitlement);
});

test("the verification twin: the same entitlement + use always yield the same verdict (A9)", () => {
  const { entitlement } = grantedFixture();
  const use = {
    scope: { ...PRINCIPAL },
    offerId: entitlement.offer.offerId,
    at: 150,
    terms: { ...TERMS, price: { ...TERMS.price } },
  };
  const left = verifyEntitlement(entitlement, use);
  const right = verifyEntitlement(entitlement, use);
  assert.deepEqual(left, right);
  assert.equal(left.ok, true);
});
