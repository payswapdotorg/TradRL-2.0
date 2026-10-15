/**
 * Whole-record re-validation (W058) — the laws as executable tests: the
 * clean re-proof, the id/provenance re-derivations, the scope/lineage
 * laws, W056 carried verbatim, and the registry-supplied liveness law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateListing } from "../validate.js";
import { OTHER_WORLD, SCOPE, TERMS, declarationFixture, deprecateIn, listedFixture, registeredFixture } from "./fixtures.js";

test("a clean listing re-validates whole-record, naming every checked law", () => {
  const { listing } = listedFixture();
  const outcome = validateListing(listing);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a clean re-validation");
  }
  assert.deepEqual(outcome.checked, [
    "structure",
    "terms-laws",
    "scope-laws",
    "lineage-shape",
    "provider-registration",
    "identity",
    "provenance",
  ]);
  const withRegistry = validateListing(listing, listedFixture().registry);
  assert.equal(withRegistry.ok, true);
  if (!withRegistry.ok) {
    assert.fail("expected a clean re-validation");
  }
  assert.equal(withRegistry.checked.includes("lifecycle"), true);
});

test("an edited listing body is caught by the id re-derivation (A9, loudly)", () => {
  const { listing } = listedFixture();
  const tampered = { ...listing, terms: { ...TERMS, price: { amount: 1, currency: "USD" } } };
  const outcome = validateListing(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "listing-id-mismatch"), true);
});

test("an edited scope member is caught loudly", () => {
  const { listing } = listedFixture();
  const tampered = { ...listing, scope: { ...SCOPE, worldId: OTHER_WORLD } };
  const outcome = validateListing(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "scope-mismatch"), true);
  assert.equal(outcome.errors.some((candidate) => candidate.code === "listing-id-mismatch"), true);
});

test("a tampered provenance is caught by the input-digest re-derivation", () => {
  const { listing } = listedFixture();
  const tampered = {
    ...listing,
    provenance: { ...listing.provenance, inputDigest: "00000000" },
  };
  const outcome = validateListing(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "provenance-mismatch"), true);
  // The provenance rides BESIDE the id (the W053/memory precedent), so a
  // tampered provenance is caught by its OWN re-derivation law — the
  // listing id itself still re-derives.
});

test("a tampered registration is refused with W056's errors carried verbatim", () => {
  const { listing } = listedFixture();
  const tampered = {
    ...listing,
    registration: { ...listing.registration, identity: { ...listing.registration.identity, name: "" } },
  };
  const outcome = validateListing(tampered);
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

test("R052 rides the re-validation: a stripped provenance carries W056's unmeasured-offer", () => {
  const { listing } = listedFixture();
  const stripped = {
    ...listing,
    registration: {
      ...listing.registration,
      offers: listing.registration.offers.map((offer) => ({ ...offer, provenance: [] })),
    },
  };
  const outcome = validateListing(stripped);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "provider-registration-invalid");
  assert.notEqual(wrapped, undefined);
  assert.equal(
    (wrapped?.providerErrors ?? []).some((candidate) => candidate.code === "unmeasured-offer"),
    true,
  );
});

test("a non-canonical offer order is caught through W056's own law, carried verbatim", () => {
  const { listing } = listedFixture();
  const shuffled = {
    ...listing,
    registration: {
      ...listing.registration,
      offers: [...listing.registration.offers].reverse(),
    },
  };
  const outcome = validateListing(shuffled);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const wrapped = outcome.errors.find((candidate) => candidate.code === "provider-registration-invalid");
  assert.notEqual(wrapped, undefined);
  assert.equal(
    (wrapped?.providerErrors ?? []).some((candidate) => candidate.code === "non-canonical-order"),
    true,
  );
});

test("with a registry supplied, a LATER deprecated capability is refused loudly", () => {
  const { listing, registration, registry } = listedFixture();
  const deprecated = deprecateIn(registry, String(registration.offers[0]?.capabilityId));
  const outcome = validateListing(listing, deprecated);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "deprecated-capability"), true);
  // Without the registry, the same listing stays lawful (the W056
  // disclosure pattern: later states are legitimate LATER registry data).
  const bare = validateListing(listing);
  assert.equal(bare.ok, true);
});

test("a lineage shape break is re-proved from the record", () => {
  const { listing } = listedFixture();
  const tampered = {
    ...listing,
    lineage: { parentListingId: listing.listingId, version: 1 },
  };
  const outcome = validateListing(tampered);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "listing-lineage-break"), true);
});

test("malformed records are refused fail-closed", () => {
  const outcome = validateListing(null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-record");
});

test("a listing cited against a registry that does not hold its capabilities is refused with W056's errors carried", () => {
  // A registration measured in another world, over its OWN registry.
  const elsewhere = registeredFixture(declarationFixture(undefined, OTHER_WORLD));
  const { listing } = listedFixture();
  // The same listing, re-validated against the other registry: the
  // offers do not resolve there, so W056's offer-descriptor-mismatch
  // carries verbatim.
  const outcome = validateListing(listing, elsewhere.registry);
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
