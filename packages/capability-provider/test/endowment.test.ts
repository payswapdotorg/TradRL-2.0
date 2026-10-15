/**
 * The endowment laws (W056) — a REAL W041 skill endowment: carried
 * through W041's own gate, measured AS the offered capability,
 * demonstrated by the offered bearer, in the provider's scope.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { canonicalRegistration, capabilityIdOf } from "capability-registry";
import { registerProvider } from "../register.js";
import type { ProviderDeclaration } from "../registration.js";
import {
  OTHER_WORLD,
  emptyRegistry,
  SCOPE,
  SUBSTRATE_MEANREVERSION,
  SUBSTRATE_MOMENTUM,
  declarationFixture,
  evidenceFixture,
  skillRecordFixture,
} from "./fixtures.js";

test("the endowment laws: a REAL W041 skill, measured AS the offered capability, by the offered bearer", () => {
  // Derive the offer's capability id through the W040 canonical seams
  // (pure derivation — the same id the gate returns on success).
  const evidence = evidenceFixture();
  const capabilityInput = canonicalRegistration({
    name: "momentum execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    scope: SCOPE,
    providesOrganizationCapabilityIds: [],
    lineage: { parentCapabilityId: null, version: 1 },
    evidence: [evidence],
  });
  const capabilityId = capabilityIdOf(capabilityInput);
  const skill = skillRecordFixture({
    capabilityId: String(capabilityId),
    capabilityName: "momentum execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    provenance: capabilityInput.provenance.map((citation) => ({
      experimentId: citation.experimentId as never,
      evaluationId: citation.evaluationId as never,
      findingsDigest: citation.findingsDigest,
    })),
  });
  const declaration: ProviderDeclaration = declarationFixture({
    offers: [
      {
        name: "momentum execution under stress",
        kind: "execution-quality",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [evidence],
        skillEndowments: [skill],
      },
    ],
  });
  const outcome = registerProvider(emptyRegistry(), declaration);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected ok, got errors");
  }
  const offer = outcome.registration.offers[0];
  assert.notEqual(offer, undefined);
  assert.equal(offer?.endowments.length, 1);
  assert.equal(String(offer?.endowments[0]?.skillId), String(skill.skillId));
  assert.equal(String(offer?.endowments[0]?.capabilityId), String(capabilityId));

  // A skill measured as a DIFFERENT capability is refused loudly.
  const foreign = skillRecordFixture({
    capabilityId: "cap-a-different-capability",
    capabilityName: "a different capability",
    kind: "risk-control",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    provenance: capabilityInput.provenance.map((citation) => ({
      experimentId: citation.experimentId as never,
      evaluationId: citation.evaluationId as never,
      findingsDigest: citation.findingsDigest,
    })),
  });
  const mismatched = registerProvider(
    emptyRegistry(),
    declarationFixture({
      offers: [
        {
          name: "momentum execution under stress",
          kind: "execution-quality",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [evidence],
          skillEndowments: [foreign],
        },
      ],
    }),
  );
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.ok(mismatched.errors.some((candidate) => candidate.code === "endowment-capability-mismatch"));
  }

  // A skill demonstrated by a DIFFERENT bearer is refused loudly.
  const otherBearer = skillRecordFixture({
    capabilityId: String(capabilityId),
    capabilityName: "momentum execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
    provenance: capabilityInput.provenance.map((citation) => ({
      experimentId: citation.experimentId as never,
      evaluationId: citation.evaluationId as never,
      findingsDigest: citation.findingsDigest,
    })),
  });
  const bearerMismatch = registerProvider(
    emptyRegistry(),
    declarationFixture({
      offers: [
        {
          name: "momentum execution under stress",
          kind: "execution-quality",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [evidence],
          skillEndowments: [otherBearer],
        },
      ],
    }),
  );
  assert.equal(bearerMismatch.ok, false);
  if (!bearerMismatch.ok) {
    assert.ok(bearerMismatch.errors.some((candidate) => candidate.code === "endowment-bearer-mismatch"));
  }

  // A skill whose scope disagrees with the provider's is refused loudly.
  const outOfScope = skillRecordFixture({
    capabilityId: String(capabilityId),
    capabilityName: "momentum execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    provenance: capabilityInput.provenance.map((citation) => ({
      experimentId: citation.experimentId as never,
      evaluationId: citation.evaluationId as never,
      findingsDigest: citation.findingsDigest,
    })),
    worldId: OTHER_WORLD,
  });
  const scopeMismatch = registerProvider(
    emptyRegistry(),
    declarationFixture({
      offers: [
        {
          name: "momentum execution under stress",
          kind: "execution-quality",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [evidence],
          skillEndowments: [outOfScope],
        },
      ],
    }),
  );
  assert.equal(scopeMismatch.ok, false);
  if (!scopeMismatch.ok) {
    assert.ok(scopeMismatch.errors.some((candidate) => candidate.code === "skill-scope-mismatch"));
  }

  // A tampered skill id fails W041's own record laws (errors carried).
  const tampered = { ...skill, skillId: "skill-tampered" as never };
  const invalid = registerProvider(
    emptyRegistry(),
    declarationFixture({
      offers: [
        {
          name: "momentum execution under stress",
          kind: "execution-quality",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [evidence],
          skillEndowments: [tampered],
        },
      ],
    }),
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    const endowment = invalid.errors.find((candidate) => candidate.code === "invalid-skill-endowment");
    assert.notEqual(endowment, undefined);
    assert.ok(endowment?.skillErrors?.some((candidate) => candidate.code === "skill-id-mismatch"));
  }
});
