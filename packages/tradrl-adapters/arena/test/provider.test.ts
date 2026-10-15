/**
 * The concrete port implementation (W057) — the Arena capability provider
 * satisfies W056's neutral port AND the canonical contracts/capability
 * contract shape at COMPILE time (this file is type-checked by `tsc -p .`,
 * pulling the contract sources in through the relative import — the
 * contracts/ui pattern) and the behavioral laws at RUNTIME.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  CapabilityProviderAdjudication,
  CapabilityProviderOfferDescriptor,
  CapabilityProviderPort,
} from "../../../../contracts/capability/src/capability-provider-contract.js";
import type { ProviderMatchOutcome, ProviderOffer } from "capability-provider";
import { registerArenaProvider } from "../arena-registration.js";
import { arenaCapabilityProvider } from "../arena-provider.js";
import { arenaDeclarationFixture, emptyRegistry } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Compile-time drift guards (the contracts/ui pattern): the arena adapter's
// real types satisfy the canonical neutral contract types.
// ---------------------------------------------------------------------------

const _offerDriftGuard: CapabilityProviderOfferDescriptor = {} as ProviderOffer;
const _portDriftGuard: CapabilityProviderPort = {} as ReturnType<typeof arenaCapabilityProvider>;
const _adjudicationDriftGuard: CapabilityProviderAdjudication = {} as ProviderMatchOutcome;
void _offerDriftGuard;
void _portDriftGuard;
void _adjudicationDriftGuard;

// ---------------------------------------------------------------------------
// Runtime behavioral laws
// ---------------------------------------------------------------------------

function registeredFixture() {
  const outcome = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  return outcome;
}

test("the arena provider satisfies the contract's port shape at runtime", () => {
  const { registration } = registeredFixture();
  const port: CapabilityProviderPort = arenaCapabilityProvider(registration);
  assert.equal(typeof port.providerId, "string");
  const offers = port.listOffers();
  assert.equal(offers.length, 2);
  for (const offer of offers) {
    const descriptor: CapabilityProviderOfferDescriptor = offer;
    assert.equal(typeof descriptor.offerId, "string");
    assert.equal(typeof descriptor.capabilityId, "string");
    assert.ok(["execution-quality", "alpha-generation", "risk-control", "market-making", "information-synthesis"].includes(descriptor.kind));
    assert.ok(["equities", "futures", "fx", "crypto-spot"].includes(descriptor.domain));
    assert.ok(["registered", "deprecated", "revoked"].includes(descriptor.lifecycle.state));
    assert.ok(Array.isArray(descriptor.provenance));
    assert.ok(descriptor.provenance.length > 0);
  }
});

test("listOffers serves the recorded offers in canonical offer-id order", () => {
  const { registration } = registeredFixture();
  const port = arenaCapabilityProvider(registration);
  const offerIds = port.listOffers().map((offer) => String(offer.offerId));
  assert.deepEqual([...offerIds].sort(), offerIds);
  assert.deepEqual(
    offerIds,
    registration.provider.offers.map((offer) => String(offer.offerId)),
  );
});

test("describeOffer resolves exact ids and refuses unknown ids fail-closed", () => {
  const { registration } = registeredFixture();
  const port = arenaCapabilityProvider(registration);
  const first = port.listOffers()[0];
  if (first === undefined) {
    assert.fail("expected a first offer");
  }
  const lookup = port.describeOffer(first.offerId);
  assert.equal(lookup.ok, true);
  if (lookup.ok) {
    assert.deepEqual(lookup.offer, first);
  }
  const unknown = port.describeOffer("offer-does-not-exist" as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.errors[0]?.code, "unknown-offer");
    assert.match(unknown.errors[0]?.message ?? "", /exact ids only/);
  }
});

test("provenanceOf exposes the measured citations, fail-closed on unknown ids", () => {
  const { registration } = registeredFixture();
  const port = arenaCapabilityProvider(registration);
  const offer = port.listOffers()[0];
  if (offer === undefined) {
    assert.fail("expected a first offer");
  }
  const provenance = port.provenanceOf(offer.offerId);
  assert.equal(provenance.ok, true);
  if (provenance.ok) {
    assert.ok(provenance.provenance.length >= 1);
    assert.match(String(provenance.provenance[0]?.experimentId), /^exp-/);
    assert.match(String(provenance.provenance[0]?.findingsDigest), /^[0-9a-f]+$/);
  }
  const unknown = port.provenanceOf("offer-does-not-exist" as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.errors[0]?.code, "unknown-offer");
  }
});

test("the arena provider is deterministic: twin registrations, deep-equal ports (A9)", () => {
  const left = registeredFixture();
  const right = registeredFixture();
  assert.deepEqual(
    left.registration.provider.offers,
    right.registration.provider.offers,
  );
  const leftPort = arenaCapabilityProvider(left.registration);
  const rightPort = arenaCapabilityProvider(right.registration);
  assert.equal(String(leftPort.providerId), String(rightPort.providerId));
  assert.deepEqual(leftPort.listOffers(), rightPort.listOffers());
  const first = leftPort.listOffers()[0];
  if (first === undefined) {
    assert.fail("expected a first offer");
  }
  assert.deepEqual(leftPort.describeOffer(first.offerId), rightPort.describeOffer(first.offerId));
});
