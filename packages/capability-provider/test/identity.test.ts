/**
 * Identity laws (W056) — content-addressed provider/offer/adjudication
 * ids over REAL canonical seams.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCapabilityRegistration } from "capability-registry";
import {
  ADJUDICATION_ID_PREFIX,
  OFFER_ID_PREFIX,
  PROVIDER_ID_PREFIX,
  adjudicationIdOf,
  canonicalOffer,
  canonicalProviderRegistration,
  offerIdOf,
  providerIdOf,
} from "../identity.js";
import type { OfferCanonicalInput } from "../identity.js";
import { evidenceFixture } from "./fixtures.js";
import { canonicalRegistration } from "capability-registry";
import type { CapabilityRegistration } from "capability-registry";
import { ORG_CAP_EXECUTION, SUBSTRATE_MOMENTUM, asOrgCap } from "./fixtures.js";

const SCOPE = { tenantId: "tenant-provider-tests", projectId: "project-provider", worldId: "world-provider-tests" };

function offerInput(name: string, endowmentSkillIds: readonly string[] = []): OfferCanonicalInput {
  const registration: CapabilityRegistration = {
    name,
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    scope: SCOPE,
    providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
    lineage: { parentCapabilityId: null, version: 1 },
    evidence: [evidenceFixture()],
  };
  return { ...canonicalRegistration(registration), endowmentSkillIds };
}

test("offer ids are opaque, prefixed, content-addressed", () => {
  const input = offerInput("momentum execution under stress");
  const id = offerIdOf(input);
  assert.ok(String(id).startsWith(OFFER_ID_PREFIX));
  // A differing byte ⇒ a different id.
  const other = offerIdOf(offerInput("a different name"));
  assert.notEqual(String(id), String(other));
  // The same bytes ⇒ the same id (A9).
  assert.equal(String(offerIdOf(offerInput("momentum execution under stress"))), String(id));
});

test("offer ids weigh the endowment skill ids — endowing is a different offer", () => {
  const bare = offerIdOf(offerInput("momentum execution under stress"));
  const endowed = offerIdOf(offerInput("momentum execution under stress", ["skill-00000001"]));
  assert.notEqual(String(bare), String(endowed));
  // Endowment declaration order never matters (canonical sort).
  const reversed = offerIdOf(
    offerInput("momentum execution under stress", ["skill-00000002", "skill-00000001"]),
  );
  const sorted = offerIdOf(
    offerInput("momentum execution under stress", ["skill-00000001", "skill-00000002"]),
  );
  assert.equal(String(reversed), String(sorted));
});

test("the canonical offer projection sorts provides + provenance + endowments", () => {
  const input = offerInput("momentum execution under stress", ["skill-b", "skill-a"]);
  const canonical = canonicalOffer(input);
  assert.deepEqual(
    canonical.endowmentSkillIds,
    [...canonical.endowmentSkillIds].sort(),
  );
  assert.deepEqual(
    canonical.providesOrganizationCapabilityIds,
    [...canonical.providesOrganizationCapabilityIds].sort(),
  );
  // The capability-shaped members ride the W040 canonical projection.
  assert.equal(
    JSON.stringify(canonical),
    JSON.stringify({
      ...canonicalCapabilityRegistration(input),
      endowmentSkillIds: ["skill-a", "skill-b"],
    }),
  );
});

test("provider ids are opaque, prefixed, and offer-order independent (A9)", () => {
  const offers = [offerInput("offer one"), offerInput("offer two")];
  const id = providerIdOf({
    identity: { name: "the neutral test provider" },
    scope: SCOPE,
    lineage: { parentProviderId: null, version: 1 },
    offers,
  });
  assert.ok(String(id).startsWith(PROVIDER_ID_PREFIX));
  const reversed = providerIdOf({
    identity: { name: "the neutral test provider" },
    scope: SCOPE,
    lineage: { parentProviderId: null, version: 1 },
    offers: [...offers].reverse(),
  });
  assert.equal(String(id), String(reversed));
  // A differing display identity ⇒ a different provider id.
  const other = providerIdOf({
    identity: { name: "another provider" },
    scope: SCOPE,
    lineage: { parentProviderId: null, version: 1 },
    offers,
  });
  assert.notEqual(String(id), String(other));
  // The canonical projection itself is sorted.
  const canonical = canonicalProviderRegistration({
    identity: { name: "the neutral test provider" },
    scope: SCOPE,
    lineage: { parentProviderId: null, version: 1 },
    offers,
  });
  assert.equal(canonical.offers.length, 2);
});

test("adjudication ids are content-addressed over provider + demand + registry fingerprint", () => {
  const demand = {
    scope: { tenantId: "tenant-provider-tests", projectId: "project-provider", worldId: "world-provider-tests" },
    capability: { capabilityId: asOrgCap("capability-org-execution"), name: "execution" },
    demand: { capabilityId: asOrgCap("capability-org-execution"), rationale: "the seat requires measured execution" },
  };
  const id = adjudicationIdOf({ providerId: "provider-00000001", demand, registryFingerprint: "fingerprint-1" });
  assert.ok(String(id).startsWith(ADJUDICATION_ID_PREFIX));
  // Same inputs ⇒ the same id.
  assert.equal(
    String(adjudicationIdOf({ providerId: "provider-00000001", demand, registryFingerprint: "fingerprint-1" })),
    String(id),
  );
  // A different registry fingerprint (a lifecycle transition) ⇒ a NEW id.
  assert.notEqual(
    String(adjudicationIdOf({ providerId: "provider-00000001", demand, registryFingerprint: "fingerprint-2" })),
    String(id),
  );
  // A different provider ⇒ a different id.
  assert.notEqual(
    String(adjudicationIdOf({ providerId: "provider-00000002", demand, registryFingerprint: "fingerprint-1" })),
    String(id),
  );
});
