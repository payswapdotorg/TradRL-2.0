/**
 * The A9 twin laws (W056) — same registration inputs + same registry ⇒
 * deep-equal adjudication and deep-equal recorded data, same canonical
 * ids; declaration order never leaks anywhere.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { matchProviderOffers } from "../match.js";
import { registerProvider } from "../register.js";
import { validateProviderRegistration } from "../validate.js";
import { ORG_CAP_EXECUTION, SCOPE, asOrgCap, declarationFixture, emptyRegistry } from "./fixtures.js";

const demand = {
  scope: { ...SCOPE },
  capability: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), name: "the demanded capability" },
  demand: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), rationale: "the seat requires a measured capability" },
};

test("twin registration: same declaration + same registry ⇒ deep-equal, same ids", () => {
  const left = registerProvider(emptyRegistry(), declarationFixture());
  const right = registerProvider(emptyRegistry(), declarationFixture());
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  assert.deepEqual(left.registration, right.registration);
  assert.deepEqual(left.registry, right.registry);
  assert.equal(String(left.registration.providerId), String(right.registration.providerId));
});

test("twin registration: offer declaration order never leaks (same provider id, deep-equal)", () => {
  const forward = registerProvider(emptyRegistry(), declarationFixture());
  const reversed = registerProvider(
    emptyRegistry(),
    declarationFixture({ offers: [...declarationFixture().offers].reverse() }),
  );
  assert.equal(forward.ok, true);
  assert.equal(reversed.ok, true);
  if (!forward.ok || !reversed.ok) {
    assert.fail("expected both orders to register");
  }
  // Same provider id (the canonical projection sorts the offers).
  assert.equal(String(forward.registration.providerId), String(reversed.registration.providerId));
  // Deep-equal recorded data (canonical offer-id order) AND deep-equal
  // chained registries (canonical capability-id order).
  assert.deepEqual(forward.registration, reversed.registration);
  assert.deepEqual(forward.registry, reversed.registry);
});

test("twin adjudication: same demand + registration + registry ⇒ deep-equal, same adjudication id", () => {
  const left = registerProvider(emptyRegistry(), declarationFixture());
  const right = registerProvider(emptyRegistry(), declarationFixture({ offers: [...declarationFixture().offers].reverse() }));
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  const leftMatch = matchProviderOffers(demand, left.registration, left.registry);
  const rightMatch = matchProviderOffers(demand, right.registration, right.registry);
  assert.deepEqual(leftMatch, rightMatch);
  assert.equal(String(leftMatch.adjudicationId), String(rightMatch.adjudicationId));
  assert.equal(leftMatch.ok, true);
});

test("twin re-validation: the same recorded data re-validates identically", () => {
  const left = registerProvider(emptyRegistry(), declarationFixture());
  const right = registerProvider(emptyRegistry(), declarationFixture());
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  assert.deepEqual(
    validateProviderRegistration(left.registration),
    validateProviderRegistration(right.registration),
  );
  assert.deepEqual(
    validateProviderRegistration(left.registration, left.registry),
    validateProviderRegistration(right.registration, right.registry),
  );
});
