/**
 * The arena adjudication surface (W057) — W056's matchProviderOffers
 * delegated VERBATIM, and the ranking projection as carried data ordered
 * by canonical ids (never a re-scored statistic).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { matchProviderOffers } from "capability-provider";
import { deprecateCapability } from "capability-registry";
import type { CapabilityId } from "capability-registry";
import { adjudicateArenaOffers, projectArenaLeaderboard } from "../arena-adjudication.js";
import { registerArenaProvider } from "../arena-registration.js";
import type { ArenaProviderRegistration } from "../arena-registration.js";
import {
  ORG_CAP_EXECUTION,
  SCOPE,
  SUBSTRATE_MOMENTUM,
  arenaDeclarationFixture,
  asOrgCap,
  emptyRegistry,
  evidenceBundle,
} from "./fixtures.js";

const demandOf = (capabilityId: string) => ({
  scope: { ...SCOPE },
  capability: { capabilityId: asOrgCap(capabilityId), name: "the demanded capability" },
  demand: { capabilityId: asOrgCap(capabilityId), rationale: "the seat requires a measured capability" },
});

function registeredFixture() {
  const outcome = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  return outcome;
}

test("adjudicateArenaOffers delegates to W056's matchProviderOffers VERBATIM", () => {
  const { registration, registry } = registeredFixture();
  const demand = demandOf(String(ORG_CAP_EXECUTION));
  const delegated = adjudicateArenaOffers(demand, registration, registry);
  const direct = matchProviderOffers(demand, registration.provider, registry);
  assert.deepEqual(JSON.parse(JSON.stringify(delegated)), JSON.parse(JSON.stringify(direct)));
});

test("a matching offer wins: W040's evidence lines + the W056 tiebreak line carried verbatim", () => {
  const { registration, registry } = registeredFixture();
  const outcome = adjudicateArenaOffers(demandOf(String(ORG_CAP_EXECUTION)), registration, registry);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a match");
  }
  assert.match(outcome.evidence[0] ?? "", /canonical offer-id order/);
  assert.ok(outcome.evidence.some((line) => line.includes("measured provenance")));
  assert.equal(outcome.considered.length, 2);
  const executionEntry = registry.entries.find((entry) =>
    entry.descriptor.providesOrganizationCapabilityIds.some(
      (id) => String(id) === String(ORG_CAP_EXECUTION),
    ),
  );
  assert.equal(String(outcome.capabilityId), String(executionEntry?.descriptor.capabilityId));
});

test("an unprovided demand fails loudly per offer, W040's reasons carried verbatim", () => {
  const { registration, registry } = registeredFixture();
  const outcome = adjudicateArenaOffers(demandOf("capability-org-does-not-exist"), registration, registry);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.queryReasons.length, 0);
  assert.equal(outcome.offerRejections.length, 2);
  for (const rejection of outcome.offerRejections) {
    assert.ok(rejection.reasons.some((reason) => reason.code === "unprovided-demand"));
  }
});

test("a deprecated offer fails loudly with W040's own refusal reasons — carried, never re-scored", () => {
  const { registration, registry } = registeredFixture();
  const executionEntry = registry.entries.find((entry) =>
    entry.descriptor.providesOrganizationCapabilityIds.some(
      (id) => String(id) === String(ORG_CAP_EXECUTION),
    ),
  );
  assert.notEqual(executionEntry, undefined);
  const deprecated = deprecateCapability(
    registry,
    executionEntry?.descriptor.capabilityId as CapabilityId,
    "the fixture deprecation reason (rationale-as-data)",
  );
  assert.equal(deprecated.ok, true);
  if (!deprecated.ok) {
    assert.fail("expected the deprecation to succeed");
  }
  const outcome = adjudicateArenaOffers(
    demandOf(String(ORG_CAP_EXECUTION)),
    registration,
    deprecated.registry,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const executionRejection = outcome.offerRejections.find(
    (rejection) => String(rejection.capabilityId) === String(executionEntry?.descriptor.capabilityId),
  );
  assert.notEqual(executionRejection, undefined);
  assert.ok(
    (executionRejection?.reasons ?? []).some((reason) => reason.code === "capability-deprecated"),
    "expected W040's capability-deprecated carried verbatim",
  );
});

test("the leaderboard projects carried data in canonical offer-id order, never a re-scored statistic", () => {
  const { registration } = registeredFixture();
  const outcome = projectArenaLeaderboard(registration);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the projection to succeed");
  }
  const { projection } = outcome;
  assert.equal(projection.ordering, "canonical-offer-id");
  assert.equal(projection.style, "top-k");
  assert.equal(projection.topK, 2);
  const projectedIds = projection.entries.map((entry) => String(entry.offerId));
  assert.deepEqual([...projectedIds].sort(), projectedIds);
  assert.deepEqual(
    projectedIds,
    registration.offers.map((arenaOffer) => String(arenaOffer.offer.offerId)),
  );
  // Every entry member is CARRIED verbatim from the recorded offer.
  projection.entries.forEach((entry, index) => {
    const recorded = registration.offers[index]?.offer;
    assert.notEqual(recorded, undefined);
    assert.equal(entry.capabilityId, recorded?.capabilityId);
    assert.equal(entry.name, recorded?.name);
    assert.equal(entry.lifecycle, recorded?.lifecycle);
    assert.equal(entry.regime, registration.offers[index]?.regime);
    assert.equal(entry.measuredInRoundId, registration.offers[index]?.measuredInRoundId);
    assert.equal(entry.rank, index + 1);
  });
  assert.match(String(projection.leaderboardId), /^arena-leaderboard-/);
});

test("a top-k leaderboard keeps the first k entries of the canonical order", () => {
  const base = arenaDeclarationFixture();
  const third = {
    offer: {
      name: "momentum alpha in the final round",
      kind: "alpha-generation" as const,
      domain: "futures" as const,
      bearer: { kind: "substrate" as const, substrateId: SUBSTRATE_MOMENTUM },
      providesOrganizationCapabilityIds: [asOrgCap("capability-org-alpha")],
      capabilityLineage: { parentCapabilityId: null, version: 1 },
      evidence: [evidenceBundle("d")],
    },
    regime: { regimeKind: "single-evaluation" as const },
    measuredInRoundSequence: 3,
  };
  const outcome = registerArenaProvider(emptyRegistry(), { ...base, offers: [...base.offers, third] });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the registration to succeed");
  }
  const projected = projectArenaLeaderboard(outcome.registration);
  assert.equal(projected.ok, true);
  if (!projected.ok) {
    assert.fail("expected the projection to succeed");
  }
  assert.equal(projected.projection.entries.length, 2);
  const canonicalIds = [...outcome.registration.offers]
    .map((arenaOffer) => String(arenaOffer.offer.offerId))
    .sort();
  assert.deepEqual(
    projected.projection.entries.map((entry) => String(entry.offerId)),
    canonicalIds.slice(0, 2),
  );
});

test("a full-roster leaderboard carries every offer, no topK member", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, leaderboard: { style: "full-roster" } },
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the registration to succeed");
  }
  const projected = projectArenaLeaderboard(outcome.registration);
  assert.equal(projected.ok, true);
  if (!projected.ok) {
    assert.fail("expected the projection to succeed");
  }
  assert.equal(projected.projection.entries.length, 2);
  assert.equal("topK" in projected.projection, false);
});

test("the projection is fail-closed on an internally inconsistent record", () => {
  const { registration } = registeredFixture();
  const tampered: ArenaProviderRegistration = {
    ...registration,
    venue: { ...registration.venue, leaderboard: { style: "top-k" } },
  };
  const outcome = projectArenaLeaderboard(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(outcome.errors.some((item) => item.code === "leaderboard-top-k-invalid"));
  }
});
