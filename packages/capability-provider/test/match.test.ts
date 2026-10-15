/**
 * Demand adjudication (W056) — W040's matchCapabilityDemand carried
 * VERBATIM against each offer, canonical tiebreaks, content-addressed
 * adjudication id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { matchProviderOffers } from "../match.js";
import { registerProvider } from "../register.js";
import {
  ORG_CAP_EXECUTION,
  ORG_CAP_RISK,
  asOrgCap,
  SCOPE,
  deprecateIn,
  declarationFixture,
  emptyRegistry,
} from "./fixtures.js";

const demandOf = (capabilityId: string) => ({
  scope: { ...SCOPE },
  capability: { capabilityId: asOrgCap(capabilityId), name: "the demanded capability" },
  demand: { capabilityId: asOrgCap(capabilityId), rationale: "the seat requires a measured capability" },
});

test("a matching offer wins: W040's evidence lines carried verbatim + the tiebreak line", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const outcome = matchProviderOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registered.registration,
    registered.registry,
  );
  assert.equal(outcome.ok, true);
  const executionEntry = registered.registry.entries.find((entry) =>
    entry.descriptor.providesOrganizationCapabilityIds.some(
      (id) => String(id) === String(ORG_CAP_EXECUTION),
    ),
  );
  assert.equal(String(outcome.capabilityId), String(executionEntry?.descriptor.capabilityId));
  // The W040 evidence lines ride verbatim (scope agreement, first-eligible
  // law, lifecycle, measured provenance) + the W056 tiebreak line first.
  assert.match(outcome.evidence[0] ?? "", /canonical offer-id order/);
  assert.ok(outcome.evidence.some((line) => line.includes("first registered provider in canonical id order")));
  assert.ok(outcome.evidence.some((line) => line.includes("measured provenance")));
  // Every offer was considered.
  assert.equal(outcome.considered.length, 2);
});

test("an unprovided demand fails loudly per offer, W040's reasons carried verbatim", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const outcome = matchProviderOffers(
    demandOf("capability-org-does-not-exist"),
    registered.registration,
    registered.registry,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.queryReasons.length, 0);
  assert.equal(outcome.offerRejections.length, 2);
  for (const rejection of outcome.offerRejections) {
    assert.equal(rejection.reasons.length, 1);
    assert.equal(rejection.reasons[0]?.code, "unprovided-demand");
  }
});

test("a deprecated offer fails demand-matching LOUDLY, W040's reason carried verbatim", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const executionOffer = registered.registration.offers.find((offer) =>
    offer.providesOrganizationCapabilityIds.some((id) => String(id) === String(ORG_CAP_EXECUTION)),
  );
  assert.notEqual(executionOffer, undefined);
  const deprecated = deprecateIn(registered.registry, String(executionOffer?.capabilityId));
  assert.equal(deprecated.ok, true);
  if (!deprecated.ok) {
    assert.fail("expected the deprecation to succeed");
  }
  const outcome = matchProviderOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registered.registration,
    deprecated.registry,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected the deprecated offer to fail loudly");
  }
  const rejection = outcome.offerRejections.find(
    (candidate) => String(candidate.offerId) === String(executionOffer?.offerId),
  );
  assert.notEqual(rejection, undefined);
  assert.equal(rejection?.reasons[0]?.code, "capability-deprecated");
  assert.match(String(rejection?.reasons[0]?.message), /DEPRECATED/);
  // The risk offer still matches its own demand.
  const still = matchProviderOffers(demandOf(String(ORG_CAP_RISK)), registered.registration, deprecated.registry);
  assert.equal(still.ok, true);
});

test("a malformed query is refused by W040's own query-level laws, carried verbatim", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const inconsistent = matchProviderOffers(
    {
      scope: { ...SCOPE },
      capability: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), name: "one capability" },
      demand: { capabilityId: asOrgCap(String(ORG_CAP_RISK)), rationale: "names another capability" },
    },
    registered.registration,
    registered.registry,
  );
  assert.equal(inconsistent.ok, false);
  if (inconsistent.ok) {
    assert.fail("expected the inconsistent query to be refused");
  }
  assert.equal(inconsistent.queryReasons[0]?.code, "inconsistent-demand");
  assert.equal(inconsistent.offerRejections.length, 0);

  const outOfScope = matchProviderOffers(
    {
      scope: { ...SCOPE, worldId: "world-provider-elsewhere" },
      capability: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), name: "the demanded capability" },
      demand: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), rationale: "out of this registry's scope" },
    },
    registered.registration,
    registered.registry,
  );
  assert.equal(outOfScope.ok, false);
  if (outOfScope.ok) {
    assert.fail("expected the scope mismatch to be refused");
  }
  assert.equal(outOfScope.queryReasons[0]?.code, "registry-scope-mismatch");
});

test("a drifted registry (offer's capability gone) is carried loudly, and the id is content-addressed", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  // Adjudicate against an EMPTY registry: the offers' capabilities do
  // not resolve — W040's unknown-capability carried verbatim.
  const drifted = matchProviderOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registered.registration,
    emptyRegistry(),
  );
  assert.equal(drifted.ok, false);
  if (drifted.ok) {
    assert.fail("expected the drifted adjudication to fail");
  }
  for (const rejection of drifted.offerRejections) {
    assert.equal(rejection.reasons.length, 0);
    assert.equal(rejection.resolutionErrors[0]?.code, "unknown-capability");
  }

  // The adjudication id is a function of provider + demand + registry
  // value (A9): the same inputs ⇒ the same id; a transition ⇒ a new id.
  const first = matchProviderOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registered.registration,
    registered.registry,
  );
  const again = matchProviderOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registered.registration,
    registered.registry,
  );
  assert.equal(String(first.adjudicationId), String(again.adjudicationId));
  assert.notEqual(String(drifted.adjudicationId), String(first.adjudicationId));
});
