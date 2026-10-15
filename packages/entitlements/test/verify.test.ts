/**
 * The PURE grant-check (W058) — the laws as executable tests: scope
 * match (the R056 cross-tenant violation LOUD), capability match, period
 * coverage, terms agreement, the invalid-record refusal, and the
 * never-silent-denial law (all refusals collected).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { verifyEntitlement } from "../verify.js";
import type { EntitlementUse } from "../verify.js";
import { grantEntitlement } from "../grant.js";
import { PERIOD, PRINCIPAL, TERMS, grantedFixture, grantInputFixture } from "./fixtures.js";

function useFixture(overrides: Partial<EntitlementUse> = {}): EntitlementUse {
  const { entitlement } = grantedFixture();
  return {
    scope: { ...PRINCIPAL },
    offerId: entitlement.offer.offerId,
    at: 150,
    terms: { ...TERMS, price: { ...TERMS.price } },
    ...overrides,
  };
}

test("the happy path: the grantee's own use, inside the window, under the listing's terms", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(entitlement, useFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a grant");
  }
  assert.deepEqual(outcome.entitlement, entitlement);
});

test("R056: a CROSS-TENANT use is the loud typed refusal naming the law", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(
    entitlement,
    useFixture({ scope: { tenantId: "tenant-entitlements-OTHER", principalId: PRINCIPAL.principalId } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.refusals.find((candidate) => candidate.code === "cross-tenant");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes("R056"), true);
  assert.equal(refusal?.message.includes("tenant isolated"), true);
});

test("a same-tenant different-principal use is refused as principal-mismatch", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(
    entitlement,
    useFixture({ scope: { tenantId: PRINCIPAL.tenantId, principalId: "principal-someone-else" } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.refusals.some((candidate) => candidate.code === "principal-mismatch"), true);
  assert.equal(outcome.refusals.some((candidate) => candidate.code === "cross-tenant"), false);
});

test("a use naming an offer the grant does not cover is capability-mismatch", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(entitlement, useFixture({ offerId: "offer-00000000" as never }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.refusals.find((candidate) => candidate.code === "capability-mismatch");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes(String(entitlement.offer.offerId)), true);
});

test("period coverage: ticks outside the declared window are refused (inclusive bounds)", () => {
  const { entitlement } = grantedFixture();
  const before = verifyEntitlement(entitlement, useFixture({ at: PERIOD.startAt - 1 }));
  assert.equal(before.ok, false);
  if (before.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(before.refusals.some((candidate) => candidate.code === "period-not-covered"), true);
  const after = verifyEntitlement(entitlement, useFixture({ at: PERIOD.endAt + 1 }));
  assert.equal(after.ok, false);
  if (after.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(after.refusals.some((candidate) => candidate.code === "period-not-covered"), true);
  // The bounds themselves are covered (inclusive).
  const atStart = verifyEntitlement(entitlement, useFixture({ at: PERIOD.startAt }));
  assert.equal(atStart.ok, true);
  const atEnd = verifyEntitlement(entitlement, useFixture({ at: PERIOD.endAt }));
  assert.equal(atEnd.ok, true);
});

test("a perpetual grant is covered at every declared tick", () => {
  const { input } = grantInputFixture();
  const granted = grantEntitlement({ ...input, period: { kind: "perpetual" } });
  assert.equal(granted.ok, true);
  if (!granted.ok) {
    assert.fail("expected a clean grant");
  }
  const far = verifyEntitlement(granted.entitlement, useFixture({ at: 1_000_000 }));
  assert.equal(far.ok, true);
});

test("terms that disagree with the grant's are refused as terms-mismatch", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(
    entitlement,
    useFixture({ terms: { ...TERMS, price: { amount: 43, currency: "USD" } } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.refusals.some((candidate) => candidate.code === "terms-mismatch"), true);
});

test("a tampered entitlement record is refused loudly before any grant-check", () => {
  const { entitlement } = grantedFixture();
  const tampered = {
    ...entitlement,
    scope: { ...entitlement.scope, principalId: "principal-someone-else" },
  };
  const outcome = verifyEntitlement(tampered, useFixture());
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.refusals.some((candidate) => candidate.code === "invalid-entitlement"), true);
});

test("never a silent denial: EVERY mismatch rides as its own typed reason", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(
    entitlement,
    useFixture({
      scope: { tenantId: "tenant-entitlements-OTHER", principalId: "principal-someone-else" },
      offerId: "offer-00000000" as never,
      at: 999_999,
      terms: { ...TERMS, price: { amount: 1, currency: "EUR" } },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const codes = outcome.refusals.map((refusal) => refusal.code);
  assert.deepEqual(codes.includes("cross-tenant"), true);
  assert.deepEqual(codes.includes("capability-mismatch"), true);
  assert.deepEqual(codes.includes("period-not-covered"), true);
  assert.deepEqual(codes.includes("terms-mismatch"), true);
});

test("a malformed use is refused fail-closed (malformed-use)", () => {
  const { entitlement } = grantedFixture();
  const outcome = verifyEntitlement(entitlement, null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.refusals[0]?.code, "malformed-use");
  const negativeTick = verifyEntitlement(entitlement, useFixture({ at: -1 }));
  assert.equal(negativeTick.ok, false);
  if (negativeTick.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(negativeTick.refusals[0]?.code, "malformed-use");
});

test("a malformed entitlement record is refused fail-closed (invalid-entitlement)", () => {
  const outcome = verifyEntitlement(null as never, useFixture());
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.refusals[0]?.code, "invalid-entitlement");
});
