/**
 * The catalogue surface (W058) — the laws as executable tests: canonical
 * order regardless of input order, duplicate refusal, whole-record
 * re-validation carried verbatim, deterministic queries, fail-closed
 * by-id resolution.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleCatalogue,
  listingsByOffer,
  listingsByProvider,
  listingsByScope,
  resolveListing,
} from "../catalogue.js";
import { SCOPE, TERMS, declarationFixture, listedFixture, registeredFixture } from "./fixtures.js";
import type { Listing } from "../listing.js";

/** A second, DIFFERENT provider's listing (its own registration + own registry). */
function secondListing(): Listing {
  const registered = registeredFixture(
    declarationFixture({ identity: { name: "another neutral provider" } }),
  );
  return listedFixture({
    registration: registered.registration,
    registry: registered.registry,
  }).listing;
}

test("the catalogue assembles carried listings in canonical listing-id order (A9)", () => {
  const first = listedFixture();
  const second = secondListing();
  const outcome = assembleCatalogue([second, first.listing]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a catalogue");
  }
  const ids = outcome.catalogue.listings.map((listing) => String(listing.listingId));
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(ids.length, 2);
  // Input order never leaks: the reversed input yields the SAME value.
  const twin = assembleCatalogue([first.listing, second]);
  assert.equal(twin.ok, true);
  if (!twin.ok) {
    assert.fail("expected a catalogue");
  }
  assert.deepEqual(twin.catalogue, outcome.catalogue);
});

test("duplicate listing ids are refused at assembly (exact canonical-id identity)", () => {
  const { listing } = listedFixture();
  const outcome = assembleCatalogue([listing, listing]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "duplicate-listing"), true);
});

test("a tampered listing is refused at assembly, loudly", () => {
  const { listing } = listedFixture();
  const tampered = { ...listing, terms: { ...TERMS, price: { amount: 1, currency: "USD" } } };
  const outcome = assembleCatalogue([tampered]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((candidate) => candidate.code === "listing-id-mismatch"), true);
});

test("listingsByProvider answers in canonical order with carried data", () => {
  const { listing, registration } = listedFixture();
  const other = secondListing();
  const outcome = assembleCatalogue([listing, other]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a catalogue");
  }
  const mine = listingsByProvider(outcome.catalogue, registration.providerId);
  assert.deepEqual(mine.map((candidate) => candidate.listingId), [listing.listingId]);
  assert.deepEqual(mine[0]?.registration, registration);
});

test("listingsByOffer answers every listing surfacing the given offer", () => {
  const { listing, registration } = listedFixture();
  const outcome = assembleCatalogue([listing]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a catalogue");
  }
  const offerId = registration.offers[0]?.offerId;
  assert.notEqual(offerId, undefined);
  if (offerId === undefined) {
    assert.fail("fixture offer missing");
  }
  const surfacing = listingsByOffer(outcome.catalogue, offerId);
  assert.deepEqual(surfacing.map((candidate) => candidate.listingId), [listing.listingId]);
  assert.deepEqual(listingsByOffer(outcome.catalogue, "offer-00000000" as never), []);
});

test("listingsByScope answers by field equality (never parsed)", () => {
  const { listing } = listedFixture();
  const outcome = assembleCatalogue([listing]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a catalogue");
  }
  assert.deepEqual(
    listingsByScope(outcome.catalogue, { ...SCOPE }).map((candidate) => candidate.listingId),
    [listing.listingId],
  );
  assert.deepEqual(listingsByScope(outcome.catalogue, { ...SCOPE, worldId: "world-marketplace-other" }), []);
});

test("resolveListing is fail-closed on unknown ids", () => {
  const { listing } = listedFixture();
  const outcome = assembleCatalogue([listing]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a catalogue");
  }
  const hit = resolveListing(outcome.catalogue, listing.listingId);
  assert.equal(hit.ok, true);
  if (!hit.ok) {
    assert.fail("expected a resolution");
  }
  assert.deepEqual(hit.listing, listing);
  const miss = resolveListing(outcome.catalogue, "mkt-00000000" as never);
  assert.equal(miss.ok, false);
  if (!miss.ok) {
    assert.equal(miss.errors[0]?.code, "unknown-listing");
    return;
  }
  assert.fail("expected a refusal");
});

test("a non-array catalogue input is refused fail-closed", () => {
  const outcome = assembleCatalogue(null as never);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-input");
});
