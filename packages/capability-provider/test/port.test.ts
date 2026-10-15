/**
 * The neutral port + reference adapter (W056) — the ONLY implementation
 * this package ships, deterministic and in-memory.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { referenceProviderAdapter } from "../port.js";
import { registerProvider } from "../register.js";
import { declarationFixture, emptyRegistry } from "./fixtures.js";

test("the reference adapter serves a recorded registration deterministically", () => {
  const outcome = registerProvider(emptyRegistry(), declarationFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const port = referenceProviderAdapter(outcome.registration);
  assert.equal(String(port.providerId), String(outcome.registration.providerId));

  const offers = port.listOffers();
  assert.equal(offers.length, 2);
  assert.deepEqual(
    offers.map((offer) => String(offer.offerId)),
    offers.map((offer) => String(offer.offerId)).sort(),
  );
  // Same registration ⇒ deep-equal answers, every call (A9).
  assert.deepEqual(port.listOffers(), referenceProviderAdapter(outcome.registration).listOffers());
});

test("describeOffer resolves by EXACT id and refuses unknown ids loudly", () => {
  const outcome = registerProvider(emptyRegistry(), declarationFixture());
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const port = referenceProviderAdapter(outcome.registration);
  const offerId = outcome.registration.offers[0]?.offerId;
  assert.notEqual(offerId, undefined);
  const lookup = port.describeOffer(offerId as never);
  assert.equal(lookup.ok, true);
  if (lookup.ok) {
    assert.equal(String(lookup.offer.offerId), String(offerId));
  }
  const unknown = port.describeOffer("offer-does-not-exist" as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.errors[0]?.code, "unknown-offer");
    assert.match(String(unknown.errors[0]?.message), /exact ids only/);
  }
});

test("provenanceOf exposes the measured citations, fail-closed", () => {
  const outcome = registerProvider(emptyRegistry(), declarationFixture());
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const port = referenceProviderAdapter(outcome.registration);
  for (const offer of outcome.registration.offers) {
    const provenance = port.provenanceOf(offer.offerId);
    assert.equal(provenance.ok, true);
    if (provenance.ok) {
      assert.equal(provenance.provenance.length, offer.provenance.length);
      assert.deepEqual(provenance.provenance, offer.provenance);
    }
  }
  const unknown = port.provenanceOf("offer-does-not-exist" as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.errors[0]?.code, "unknown-offer");
  }
});
