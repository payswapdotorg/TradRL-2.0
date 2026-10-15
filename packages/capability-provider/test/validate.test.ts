/**
 * Whole-registration re-validation (W056) — every law re-proved from the
 * RECORDED data, plus the optional registry cross-check.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateProviderRegistration } from "../validate.js";
import { registerProvider } from "../register.js";
import { declarationFixture, emptyRegistry } from "./fixtures.js";

test("a real registration re-validates ok, from its recorded data alone", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const outcome = validateProviderRegistration(registered.registration);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected ok, got errors");
  } else {
    assert.ok(outcome.checked.includes("identity"));
    assert.ok(outcome.checked.includes("canonical-order"));
  }
  // With the registry supplied, the descriptor agreement holds too.
  const withRegistry = validateProviderRegistration(registered.registration, registered.registry);
  assert.equal(withRegistry.ok, true);
  if (withRegistry.ok) {
    assert.ok(withRegistry.checked.includes("registry-agreement"));
  }
});

test("a tampered offer id is refused: identity is a function of content", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const tampered = {
    ...registered.registration,
    offers: registered.registration.offers.map((offer, index) =>
      index === 0 ? { ...offer, offerId: "offer-tampered" as never } : offer,
    ),
  };
  const outcome = validateProviderRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.errors.some((candidate) => candidate.code === "offer-id-mismatch"));
  }
});

test("a tampered provider id is refused: identity is a function of content", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const tampered = { ...registered.registration, providerId: "provider-tampered" as never };
  const outcome = validateProviderRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.errors.some((candidate) => candidate.code === "provider-id-mismatch"));
  }
});

test("non-canonical offer order and duplicates are refused (A9)", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const [first, second] = registered.registration.offers;
  if (first === undefined || second === undefined) {
    assert.fail("expected two offers");
  }
  const reordered = {
    ...registered.registration,
    offers: [second, first],
  };
  const outcome = validateProviderRegistration(reordered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.errors.some((candidate) => candidate.code === "non-canonical-order"));
  }
  const duplicated = {
    ...registered.registration,
    offers: [first, { ...first }],
  };
  const duplicateOutcome = validateProviderRegistration(duplicated);
  assert.equal(duplicateOutcome.ok, false);
  if (!duplicateOutcome.ok) {
    assert.ok(duplicateOutcome.errors.some((candidate) => candidate.code === "duplicate-offer"));
  }
});

test("an unmeasured recorded offer (no provenance) is refused loudly — R052 carried into re-validation", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const stripped = {
    ...registered.registration,
    offers: registered.registration.offers.map((offer, index) =>
      index === 0 ? { ...offer, provenance: [] } : offer,
    ),
  };
  const outcome = validateProviderRegistration(stripped);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const unmeasured = outcome.errors.find((candidate) => candidate.code === "unmeasured-offer");
    assert.notEqual(unmeasured, undefined);
    assert.match(String(unmeasured?.message), /R052/);
    // The offer id ALSO no longer derives (identity caught the tamper).
    assert.ok(outcome.errors.some((candidate) => candidate.code === "offer-id-mismatch"));
  }
});

test("the registry cross-check refuses an offer whose capability is not registered", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const outcome = validateProviderRegistration(registered.registration, emptyRegistry());
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const mismatch = outcome.errors.find((candidate) => candidate.code === "offer-descriptor-mismatch");
    assert.notEqual(mismatch, undefined);
    assert.match(String(mismatch?.message), /does not resolve/);
  }
});
