/**
 * THE GRANT GATE (W058) — the laws as executable tests: the listing
 * re-proven through the marketplace's own validator (errors carried
 * verbatim), the fail-closed offer resolution, the terms-agreement law,
 * the §14 principal scope, the closed period vocabulary, the lineage
 * laws, duplicates, and the R056 structural tenant law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { grantEntitlement } from "../grant.js";
import type { Entitlement } from "../grant.js";
import { ENTITLEMENT_ID_PREFIX } from "../grant.js";
import {
  PERIOD,
  PRINCIPAL,
  TERMS,
  grantedFixture,
  grantInputFixture,
  listedFixture,
} from "./fixtures.js";

test("the happy path seals the entitlement citing the listing and carrying the offer VERBATIM", () => {
  const { entitlement, listing } = grantedFixture();
  assert.equal(entitlement.entitlementId.startsWith(ENTITLEMENT_ID_PREFIX), true);
  assert.equal(String(entitlement.listingId), String(listing.listingId));
  // The granted offer is one of the listing's own, carried verbatim.
  assert.deepEqual(entitlement.offer, listing.registration.offers[0]);
  // The grantee scope + terms + period are the declared data.
  assert.deepEqual(entitlement.scope, PRINCIPAL);
  assert.deepEqual(entitlement.terms, TERMS);
  assert.deepEqual(entitlement.period, PERIOD);
  assert.deepEqual(entitlement.lineage, { parentEntitlementId: null, version: 1 });
  assert.equal(entitlement.provenance.deriver, "grant-entitlement");
  assert.equal(entitlement.provenance.laws.includes("spec/REQUIREMENTS.md R056"), true);
});

test("R056 structural: the TENANT is part of the entitlement's canonical identity", () => {
  const { input, listing } = grantInputFixture();
  const sameTenant = grantEntitlement({
    ...input,
    principal: { tenantId: PRINCIPAL.tenantId, principalId: "principal-desk-ops" },
  });
  const otherTenant = grantEntitlement({
    ...input,
    principal: { tenantId: "tenant-entitlements-OTHER", principalId: PRINCIPAL.principalId },
  });
  assert.equal(sameTenant.ok, true);
  assert.equal(otherTenant.ok, true);
  if (!sameTenant.ok || !otherTenant.ok) {
    assert.fail("expected two clean grants");
  }
  // Identical grants under different tenants are DIFFERENT entitlements.
  assert.notEqual(
    String(sameTenant.entitlement.entitlementId),
    String(otherTenant.entitlement.entitlementId),
  );
  assert.equal(listing.listingId.length > 0, true);
});

test("a tampered listing is refused with the marketplace's errors carried VERBATIM", () => {
  const { input } = grantInputFixture();
  const tamperedListing = {
    ...input.listing,
    terms: { ...TERMS, price: { amount: 1, currency: "USD" } },
  };
  const outcome = grantEntitlement({ ...input, listing: tamperedListing });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "listing-invalid");
  assert.notEqual(wrapped, undefined);
  assert.equal(
    (wrapped?.marketplaceErrors ?? []).some((candidate) => candidate.code === "listing-id-mismatch"),
    true,
  );
});

test("R052 rides the marketplace re-proof: an unmeasured offer carries through verbatim", () => {
  const { input } = grantInputFixture();
  const stripped = {
    ...input.listing,
    registration: {
      ...input.listing.registration,
      offers: input.listing.registration.offers.map((offer) => ({ ...offer, provenance: [] })),
    },
  };
  const outcome = grantEntitlement({ ...input, listing: stripped });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "listing-invalid");
  assert.notEqual(wrapped, undefined);
  const marketplaceErrors = wrapped?.marketplaceErrors ?? [];
  const providerWrapped = marketplaceErrors.find(
    (candidate) => candidate.code === "provider-registration-invalid",
  );
  assert.notEqual(providerWrapped, undefined);
  assert.equal(
    (providerWrapped?.providerErrors ?? []).some((candidate) => candidate.code === "unmeasured-offer"),
    true,
  );
});

test("an offer the listing does not surface is refused fail-closed (exact id)", () => {
  const { input } = grantInputFixture();
  const outcome = grantEntitlement({ ...input, offerId: "offer-00000000" as never });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "unknown-offer"), true);
});

test("terms that disagree with the listing's own are refused LOUDLY (never silent)", () => {
  const { input } = grantInputFixture();
  const outcome = grantEntitlement({
    ...input,
    terms: { ...TERMS, price: { amount: TERMS.price.amount + 1, currency: TERMS.price.currency } },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "terms-mismatch");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes("UNDER the listing's terms"), true);
});

test("terms outside the closed vocabulary are refused loudly", () => {
  const { input } = grantInputFixture();
  const outcome = grantEntitlement({
    ...input,
    terms: { model: "barter" as never, billingPeriod: "monthly", price: { amount: 1, currency: "USD" } },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "invalid-terms"), true);
});

test("a blank grantee scope member is refused (§14 — tenant explicit, never blank)", () => {
  const { input } = grantInputFixture();
  const outcome = grantEntitlement({
    ...input,
    principal: { tenantId: "  ", principalId: PRINCIPAL.principalId },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "blank-scope-member");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.message.includes("tenantId"), true);
});

test("the closed period vocabulary is enforced loudly", () => {
  const { input } = grantInputFixture();
  const unknown = grantEntitlement({ ...input, period: { kind: "forever" } as never });
  assert.equal(unknown.ok, false);
  if (unknown.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(unknown.errors.some((candidate) => candidate.code === "invalid-period"), true);
});

test("the fixed-window laws: empty, negative, and non-integer windows are refused", () => {
  const { input } = grantInputFixture();
  const empty = grantEntitlement({ ...input, period: { kind: "fixed-window", startAt: 200, endAt: 100 } });
  assert.equal(empty.ok, false);
  if (empty.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(empty.errors.some((candidate) => candidate.code === "invalid-period"), true);
  const negative = grantEntitlement({ ...input, period: { kind: "fixed-window", startAt: -1, endAt: 100 } });
  assert.equal(negative.ok, false);
  const fractional = grantEntitlement({ ...input, period: { kind: "fixed-window", startAt: 0.5, endAt: 100 } });
  assert.equal(fractional.ok, false);
  if (!fractional.ok) {
    assert.equal(fractional.errors.some((candidate) => candidate.code === "invalid-period"), true);
  }
});

test("a perpetual period is a lawful closed-vocabulary member", () => {
  const { input } = grantInputFixture();
  const outcome = grantEntitlement({ ...input, period: { kind: "perpetual" } });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a clean grant");
  }
  assert.deepEqual(outcome.entitlement.period, { kind: "perpetual" });
});

test("the lineage laws: a renewal cites a REAL parent at exactly parent.version + 1", () => {
  const { entitlement, listing } = grantedFixture();
  const { input } = grantInputFixture();
  // v2 without a parent is a break.
  const orphan = grantEntitlement({ ...input, lineage: { version: 2 } });
  assert.equal(orphan.ok, false);
  if (orphan.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(orphan.errors.some((candidate) => candidate.code === "entitlement-lineage-break"), true);
  // An unknown parent is a break.
  const unknown = grantEntitlement({
    ...input,
    lineage: { parentEntitlementId: "ent-00000000" as Entitlement["entitlementId"], version: 2 },
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(unknown.errors.some((candidate) => candidate.code === "entitlement-lineage-break"), true);
  // A skipped version is a break.
  const skip = grantEntitlement(
    { ...input, lineage: { parentEntitlementId: entitlement.entitlementId, version: 3 } },
    [entitlement],
  );
  assert.equal(skip.ok, false);
  if (skip.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(skip.errors.some((candidate) => candidate.code === "entitlement-lineage-break"), true);
  // The lawful renewal (a widened window) seals as a NEW record.
  const renewal = grantEntitlement(
    {
      ...input,
      period: { kind: "fixed-window", startAt: 100, endAt: 400 },
      lineage: { parentEntitlementId: entitlement.entitlementId, version: 2 },
    },
    [entitlement],
  );
  assert.equal(renewal.ok, true);
  if (!renewal.ok) {
    assert.fail("expected a clean renewal");
  }
  assert.equal(String(renewal.entitlement.listingId), String(listing.listingId));
});

test("duplicate entitlements are refused — identity is exact canonical-id identity", () => {
  const { entitlement } = grantedFixture();
  const { input } = grantInputFixture();
  const outcome = grantEntitlement(input, [entitlement]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "duplicate-entitlement");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.entitlementId, String(entitlement.entitlementId));
});

test("a grant for the listing's SECOND offer is a different entitlement over the same listing", () => {
  const { listing } = listedFixture();
  const first = listing.registration.offers[0]?.offerId;
  const second = listing.registration.offers[1]?.offerId;
  assert.notEqual(first, undefined);
  assert.notEqual(second, undefined);
  if (first === undefined || second === undefined) {
    assert.fail("fixture offers missing");
  }
  const left = grantEntitlement({
    listing,
    offerId: first,
    principal: { ...PRINCIPAL },
    terms: { ...TERMS },
    period: { ...PERIOD },
  });
  const right = grantEntitlement({
    listing,
    offerId: second,
    principal: { ...PRINCIPAL },
    terms: { ...TERMS },
    period: { ...PERIOD },
  });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean grants");
  }
  assert.notEqual(
    String(left.entitlement.entitlementId),
    String(right.entitlement.entitlementId),
  );
});

test("a malformed grant declaration is refused fail-closed", () => {
  const outcome = grantEntitlement(null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-input");
});
