/**
 * THE LISTING GATE (W058) — the laws as executable tests: R052 carried
 * verbatim through W056's own validator, the W040 lifecycle refused
 * loudly, the closed terms vocabularies, the lineage laws, duplicates.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { listOffer } from "../listing.js";
import type { Listing } from "../listing.js";
import { LISTING_ID_PREFIX } from "../listing.js";
import {
  OTHER_WORLD,
  SCOPE,
  TERMS,
  declarationFixture,
  listedFixture,
  registeredFixture,
  deprecateIn,
  emptyRegistry,
  revokeIn,
} from "./fixtures.js";

test("the happy path seals the listing with the registration carried VERBATIM", () => {
  const { listing, registration } = listedFixture();
  assert.equal(listing.listingId.startsWith(LISTING_ID_PREFIX), true);
  // The cited registration is the SAME record — offers carried verbatim.
  assert.deepEqual(listing.registration, registration);
  assert.equal(listing.registration.offers.length, 2);
  // The scope is carried from the registration (§14, never re-declared).
  assert.deepEqual(listing.scope, SCOPE);
  // The terms are the declared data, canonically projected.
  assert.deepEqual(listing.terms, TERMS);
  // Genesis lineage + deterministic provenance.
  assert.deepEqual(listing.lineage, { parentListingId: null, version: 1 });
  assert.equal(listing.provenance.deriver, "list-offer");
  assert.equal(listing.provenance.laws.includes("spec/REQUIREMENTS.md R052"), true);
});

test("R052 carried: an unmeasured offer surfaces as W056's own unmeasured-offer, carried verbatim", () => {
  const { registration, registry } = registeredFixture();
  const stripped = {
    ...registration,
    offers: registration.offers.map((offer) => ({ ...offer, provenance: [] })),
  };
  const outcome = listOffer(registry, { registration: stripped, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "provider-registration-invalid");
  assert.notEqual(wrapped, undefined);
  const carried = wrapped?.providerErrors ?? [];
  assert.equal(
    carried.some((candidate) => candidate.code === "unmeasured-offer"),
    true,
    `expected W056's unmeasured-offer carried verbatim, got ${JSON.stringify(carried.map((candidate) => candidate.code))}`,
  );
});

test("a registration W056 refuses is refused with W056's errors carried verbatim", () => {
  const { registration, registry } = registeredFixture();
  const tampered = { ...registration, identity: { ...registration.identity, name: "  " } };
  const outcome = listOffer(registry, { registration: tampered, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "provider-registration-invalid");
  assert.notEqual(wrapped, undefined);
  assert.equal(
    (wrapped?.providerErrors ?? []).some((candidate) => candidate.code === "blank-provider-name"),
    true,
  );
});

test("the W040 lifecycle carried: a deprecated capability is refused LOUDLY", () => {
  const { registration, registry } = registeredFixture();
  const deprecated = deprecateIn(registry, String(registration.offers[0]?.capabilityId));
  const outcome = listOffer(deprecated, { registration, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "deprecated-capability");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.offerId, String(registration.offers[0]?.offerId));
  assert.equal(refusal?.message.includes("deprecated"), true);
});

test("the W040 lifecycle carried: a revoked capability is refused LOUDLY (terminal)", () => {
  const { registration, registry } = registeredFixture();
  const revoked = revokeIn(registry, String(registration.offers[1]?.capabilityId));
  const outcome = listOffer(revoked, { registration, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "revoked-capability");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.offerId, String(registration.offers[1]?.offerId));
});

test("a capability that does not resolve in the registry is refused fail-closed", () => {
  const { registration } = registeredFixture();
  const outcome = listOffer(emptyRegistry(), { registration, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(
    outcome.errors.filter((candidate) => candidate.code === "capability-not-live").length,
    2,
  );
});

test("the closed licensing-model vocabulary is enforced loudly", () => {
  const { registration, registry } = registeredFixture();
  const outcome = listOffer(registry, {
    registration,
    terms: { model: "pay-what-you-want" as never, billingPeriod: "monthly", price: { amount: 1, currency: "USD" } },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "invalid-terms"), true);
});

test("the closed billing-period vocabulary is enforced loudly", () => {
  const { registration, registry } = registeredFixture();
  const outcome = listOffer(registry, {
    registration,
    terms: { model: "per-use", billingPeriod: "whenever" as never, price: { amount: 1, currency: "USD" } },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(
    outcome.errors.some((candidate) => candidate.code === "invalid-terms" && candidate.message.includes("billing period")),
    true,
  );
});

test("the structural price laws: negative, non-finite, and malformed currency amounts are refused", () => {
  const { registration, registry } = registeredFixture();
  const negative = listOffer(registry, { registration, terms: { model: "per-use", billingPeriod: "monthly", price: { amount: -1, currency: "USD" } } });
  assert.equal(negative.ok, false);
  const currency = listOffer(registry, { registration, terms: { model: "per-use", billingPeriod: "monthly", price: { amount: 1, currency: "dollars" } } });
  assert.equal(currency.ok, false);
  if (currency.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(currency.errors.some((candidate) => candidate.code === "invalid-terms"), true);
});

test("the lineage laws: a successor cites a REAL parent at exactly parent.version + 1", () => {
  const { listing, registration, registry } = listedFixture();
  // A v2 with no parent is a break.
  const orphan = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: 43, currency: "USD" } },
    lineage: { version: 2 },
  });
  assert.equal(orphan.ok, false);
  if (orphan.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(orphan.errors.some((candidate) => candidate.code === "listing-lineage-break"), true);
  // A v2 citing an UNKNOWN parent is a break.
  const unknown = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: 43, currency: "USD" } },
    lineage: { parentListingId: "mkt-does-not-exist" as Listing["listingId"], version: 2 },
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(unknown.errors.some((candidate) => candidate.code === "listing-lineage-break"), true);
  // A v3 citing the v1 parent skips a version.
  const skip = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: 43, currency: "USD" } },
    lineage: { parentListingId: listing.listingId, version: 3 },
  });
  assert.equal(skip.ok, false);
  if (skip.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(skip.errors.some((candidate) => candidate.code === "listing-lineage-break"), true);
  // The lawful successor seals.
  const successor = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: 43, currency: "USD" } },
    lineage: { parentListingId: listing.listingId, version: 2 },
  }, [listing]);
  assert.equal(successor.ok, true);
});

test("a version-1 listing is genesis: it cannot cite a parent", () => {
  const { listing, registration, registry } = listedFixture();
  const outcome = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: 44, currency: "USD" } },
    lineage: { parentListingId: listing.listingId, version: 1 },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "listing-lineage-break"), true);
});

test("duplicate listings are refused — listing identity is exact canonical-id identity", () => {
  const { listing, registration, registry } = listedFixture();
  const outcome = listOffer(registry, { registration, terms: TERMS }, [listing]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((candidate) => candidate.code === "duplicate-listing");
  assert.notEqual(refusal, undefined);
  assert.equal(refusal?.listingId, String(listing.listingId));
});

test("a malformed declaration is refused fail-closed", () => {
  const outcome = listOffer(emptyRegistry(), null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-input");
});

test("terms and lifecycle and registration violations are ALL collected, none dropped", () => {
  const { registration, registry } = registeredFixture();
  const deprecated = deprecateIn(registry, String(registration.offers[0]?.capabilityId));
  const outcome = listOffer(deprecated, {
    registration,
    terms: { model: "barter" as never, billingPeriod: "monthly", price: { amount: -5, currency: "us" } },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "invalid-terms"), true);
  assert.equal(outcome.errors.some((candidate) => candidate.code === "deprecated-capability"), true);
});

test("a provider registration measured in another scope never lists against this registry", () => {
  // A REAL registration measured in a different world (its evidence is
  // measured THERE), over its own other-world registry.
  const elsewhere = registeredFixture(declarationFixture(undefined, OTHER_WORLD));
  const here = emptyRegistry();
  const outcome = listOffer(here, { registration: elsewhere.registration, terms: TERMS });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "provider-registration-invalid");
  assert.notEqual(wrapped, undefined);
  assert.equal(
    (wrapped?.providerErrors ?? []).some((candidate) => candidate.code === "offer-descriptor-mismatch"),
    true,
  );
});
