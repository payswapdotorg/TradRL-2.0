/**
 * The registration gate (W056) — the laws as executable tests: R052
 * refused loudly HERE, W040's gate errors carried verbatim, scope
 * agreement, duplicates, lineage, and the endowment laws.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { registerProvider } from "../register.js";
import type { ProviderOfferDeclaration } from "../registration.js";
import type { RegistryEntry } from "capability-registry";
import {
  OTHER_WORLD,
  SCOPE,
  SUBSTRATE_MEANREVERSION,
  SUBSTRATE_MOMENTUM,
  declarationFixture,
  emptyRegistry,
  evidenceFixture,
  experimentFixture,
  evaluationFixture,
  findingsFixture,
} from "./fixtures.js";

test("the happy path registers every offer through W040 and records the canonical data", () => {
  const registry = emptyRegistry();
  const outcome = registerProvider(registry, declarationFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected ok, got errors");
  }
  // Both offers registered as W040 capabilities, in canonical id order.
  assert.equal(outcome.registry.entries.length, 2);
  assert.deepEqual(
    outcome.registry.entries.map((entry) => String(entry.descriptor.capabilityId)),
    outcome.registry.entries.map((entry) => String(entry.descriptor.capabilityId)).sort(),
  );
  // The recorded offers: canonical offer-id order, lifecycle carried
  // from W040 (freshly registered), provenance carried from the
  // descriptor, no endowments.
  assert.equal(outcome.registration.offers.length, 2);
  assert.deepEqual(
    outcome.registration.offers.map((offer) => String(offer.offerId)),
    outcome.registration.offers.map((offer) => String(offer.offerId)).sort(),
  );
  for (const offer of outcome.registration.offers) {
    assert.equal(offer.lifecycle.state, "registered");
    assert.equal(offer.lifecycle.transitions.length, 0);
    assert.equal(offer.provenance.length, 1);
    assert.equal(offer.endowments.length, 0);
    assert.equal(offer.scope.tenantId, SCOPE.tenantId);
    // The recorded capability id IS the W040 canonical derivation.
    const entry: RegistryEntry | undefined = outcome.registry.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === String(offer.capabilityId),
    );
    assert.notEqual(entry, undefined);
    assert.equal(entry?.descriptor.provenance.length, offer.provenance.length);
  }
  // The input registry is never mutated (immutable value law).
  assert.equal(registry.entries.length, 0);
});

test("R052: an offer without measured evidence is refused LOUDLY, naming the law", () => {
  const declaration = declarationFixture({
    offers: [
      {
        name: "a label-only offer",
        kind: "alpha-generation",
        domain: "fx",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
        providesOrganizationCapabilityIds: [],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [],
      },
    ],
  });
  const outcome = registerProvider(emptyRegistry(), declaration);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected the unmeasured offer to be refused");
  }
  const unmeasured = outcome.errors.find((candidate) => candidate.code === "unmeasured-offer");
  assert.notEqual(unmeasured, undefined);
  assert.match(String(unmeasured?.message), /R052/);
  assert.match(String(unmeasured?.message), /EMPIRICAL/);
  // W040's own unmeasured law is ALSO carried verbatim (doubly loud).
  const refused = outcome.errors.find((candidate) => candidate.code === "offer-refused");
  assert.notEqual(refused, undefined);
  assert.ok(refused?.capabilityErrors?.some((candidate) => candidate.code === "unmeasured-capability"));
});

test("W040's citation laws are carried verbatim: a FAILED measurement establishes nothing", () => {
  const experiment = experimentFixture();
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId), ["PASS", "FAIL"]);
  const declaration = declarationFixture({
    offers: [
      {
        name: "a failed measurement is not evidence",
        kind: "execution-quality",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [{ experiment, evaluation, findings }],
      },
    ],
  });
  const outcome = registerProvider(emptyRegistry(), declaration);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected the failed evidence to be refused");
  }
  const refused = outcome.errors.find((candidate) => candidate.code === "offer-refused");
  assert.notEqual(refused, undefined);
  assert.ok(refused?.capabilityErrors?.some((candidate) => candidate.code === "failed-evidence"));
});

test("scope agreement: an offer whose evidence measured in another world is refused (carried)", () => {
  const foreignEvidence = evidenceFixture();
  const foreignExperiment = experimentFixture({
    world: { worldId: OTHER_WORLD, definitionDigest: "defdigest-provider-fixture-2" },
  });
  const foreignEvaluation = evaluationFixture(foreignExperiment, "expeval-provider-fixture-00000002");
  const foreignFindings = findingsFixture(String(foreignEvaluation.evaluationId));
  const declaration = declarationFixture({
    offers: [
      {
        name: "measured somewhere else",
        kind: "execution-quality",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [{ experiment: foreignExperiment, evaluation: foreignEvaluation, findings: foreignFindings }, foreignEvidence],
      },
    ],
  });
  const outcome = registerProvider(emptyRegistry(), declaration);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected the scope mismatch to be refused");
  }
  const refused = outcome.errors.find((candidate) => candidate.code === "offer-refused");
  assert.ok(refused?.capabilityErrors?.some((candidate) => candidate.code === "scope-mismatch"));
});

test("structure laws: blank names, blank scope, and no offers are refused loudly", () => {
  const blankName = registerProvider(emptyRegistry(), declarationFixture({ identity: { name: "   " } }));
  assert.equal(blankName.ok, false);
  if (!blankName.ok) {
    assert.ok(blankName.errors.some((candidate) => candidate.code === "blank-provider-name"));
  }
  const blankScope = registerProvider(
    emptyRegistry(),
    declarationFixture({ scope: { tenantId: "", projectId: "p", worldId: "w" } }),
  );
  assert.equal(blankScope.ok, false);
  if (!blankScope.ok) {
    assert.ok(blankScope.errors.some((candidate) => candidate.code === "blank-scope-member"));
  }
  const noOffers = registerProvider(emptyRegistry(), declarationFixture({ offers: [] }));
  assert.equal(noOffers.ok, false);
  if (!noOffers.ok) {
    assert.ok(noOffers.errors.some((candidate) => candidate.code === "no-offers"));
  }
  const blankOfferName = declarationFixture({
    offers: [
      {
        name: "",
        kind: "risk-control",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [evidenceFixture()],
      },
    ],
  });
  const blankOffer = registerProvider(emptyRegistry(), blankOfferName);
  assert.equal(blankOffer.ok, false);
  if (!blankOffer.ok) {
    assert.ok(blankOffer.errors.some((candidate) => candidate.code === "blank-offer-name"));
  }
});

test("duplicate offers and duplicate providers are refused by exact canonical id", () => {
  const offer: ProviderOfferDeclaration = {
    name: "the same measured offer",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    providesOrganizationCapabilityIds: [],
    capabilityLineage: { parentCapabilityId: null, version: 1 },
    evidence: [evidenceFixture()],
  };
  const duplicateOffers = registerProvider(
    emptyRegistry(),
    declarationFixture({ offers: [offer, { ...offer }] }),
  );
  assert.equal(duplicateOffers.ok, false);
  if (!duplicateOffers.ok) {
    assert.ok(duplicateOffers.errors.some((candidate) => candidate.code === "duplicate-offer"));
  }

  // A provider already in `known` is refused (duplicate-provider).
  const first = registerProvider(emptyRegistry(), declarationFixture());
  assert.equal(first.ok, true);
  const again = registerProvider(
    emptyRegistry(),
    declarationFixture(),
    first.ok ? [first.registration] : [],
  );
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.ok(again.errors.some((candidate) => candidate.code === "duplicate-provider"));
  }
});

test("provider lineage: a successor cites a REAL parent at exactly parent.version + 1", () => {
  const genesis = registerProvider(emptyRegistry(), declarationFixture());
  assert.equal(genesis.ok, true);
  const known = genesis.ok ? [genesis.registration] : [];
  const successor = registerProvider(
    emptyRegistry(),
    declarationFixture({
      identity: { name: "the successor provider" },
      lineage: { parentProviderId: known[0]?.providerId ?? null, version: 2 },
    }),
    known,
  );
  assert.equal(successor.ok, true);

  const orphan = registerProvider(
    emptyRegistry(),
    declarationFixture({
      identity: { name: "an orphan successor" },
      lineage: { parentProviderId: "provider-does-not-exist" as never, version: 2 },
    }),
    known,
  );
  assert.equal(orphan.ok, false);
  if (!orphan.ok) {
    assert.ok(orphan.errors.some((candidate) => candidate.code === "provider-lineage-break"));
  }
  const skipped = registerProvider(
    emptyRegistry(),
    declarationFixture({
      identity: { name: "a version-skipping successor" },
      lineage: { parentProviderId: known[0]?.providerId ?? null, version: 3 },
    }),
    known,
  );
  assert.equal(skipped.ok, false);
  if (!skipped.ok) {
    assert.ok(skipped.errors.some((candidate) => candidate.code === "provider-lineage-break"));
  }
});
