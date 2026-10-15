/**
 * The A9 twins (W058) — determinism as executable tests: same inputs ⇒
 * deep-equal listing with the same canonical id; any differing byte ⇒ a
 * different id; input order never leaks.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { listOffer } from "../listing.js";
import { TERMS, declarationFixture, listedFixture, registeredFixture } from "./fixtures.js";

test("the A9 twin: the same registration + terms seal the SAME listing, deep-equal", () => {
  const first = registeredFixture();
  const second = registeredFixture();
  const left = listOffer(first.registry, { registration: first.registration, terms: TERMS });
  const right = listOffer(second.registry, { registration: second.registration, terms: TERMS });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean listings");
  }
  assert.deepEqual(left.listing, right.listing);
  assert.equal(String(left.listing.listingId), String(right.listing.listingId));
});

test("any differing byte of the terms yields a DIFFERENT listing id", () => {
  const { registration, registry } = registeredFixture();
  const left = listOffer(registry, { registration, terms: TERMS });
  const right = listOffer(registry, {
    registration,
    terms: { ...TERMS, price: { amount: TERMS.price.amount + 1, currency: TERMS.price.currency } },
  });
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected two clean listings");
  }
  assert.notEqual(String(left.listing.listingId), String(right.listing.listingId));
});

test("a differing registration yields a DIFFERENT listing id (content-addressed)", () => {
  const left = listedFixture();
  const registered = registeredFixture(
    declarationFixture({ identity: { name: "a second neutral provider" } }),
  );
  const right = listedFixture({
    registration: registered.registration,
    registry: registered.registry,
  });
  assert.notEqual(String(left.listing.listingId), String(right.listing.listingId));
});

test("a differing lineage yields a DIFFERENT listing id (lineage is weighed)", () => {
  const { listing, registration, registry } = listedFixture();
  const successor = listOffer(
    registry,
    {
      registration,
      terms: { ...TERMS, price: { amount: TERMS.price.amount + 2, currency: TERMS.price.currency } },
      lineage: { parentListingId: listing.listingId, version: 2 },
    },
    [listing],
  );
  const twin = listOffer(
    registry,
    {
      registration,
      terms: { ...TERMS, price: { amount: TERMS.price.amount + 2, currency: TERMS.price.currency } },
    },
  );
  assert.equal(successor.ok, true);
  assert.equal(twin.ok, true);
  if (!successor.ok || !twin.ok) {
    assert.fail("expected two clean listings");
  }
  assert.notEqual(String(successor.listing.listingId), String(twin.listing.listingId));
});

test("the known-listings order never leaks into the sealed value", () => {
  const { listing, registration, registry } = listedFixture();
  const otherRegistered = registeredFixture(
    declarationFixture({ identity: { name: "a second neutral provider" } }),
  );
  const other = listedFixture({
    registration: otherRegistered.registration,
    registry: otherRegistered.registry,
  }).listing;
  const successorLeft = listOffer(
    registry,
    {
      registration,
      terms: { ...TERMS, price: { amount: 50, currency: "USD" } },
      lineage: { parentListingId: listing.listingId, version: 2 },
    },
    [listing, other],
  );
  const successorRight = listOffer(
    registry,
    {
      registration,
      terms: { ...TERMS, price: { amount: 50, currency: "USD" } },
      lineage: { parentListingId: listing.listingId, version: 2 },
    },
    [other, listing],
  );
  assert.equal(successorLeft.ok, true);
  assert.equal(successorRight.ok, true);
  if (!successorLeft.ok || !successorRight.ok) {
    assert.fail("expected two clean listings");
  }
  assert.deepEqual(successorLeft.listing, successorRight.listing);
});
