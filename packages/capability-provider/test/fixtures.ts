/**
 * REAL record builders for the W056 capability-provider tests (the no-shim
 * law, the W040/W041 fixture precedent): the W037 experiment descriptor,
 * the W038 evaluation + findings report, the W040 registration, the W041
 * skill record, and the W056 provider declaration — every builder
 * constructs the REAL shapes through their real canonical seams
 * (`experimentIdOf`, `assembleFindingsReport`, `skillIdOf`,
 * `registerProvider`); nothing here stubs a package seam. Only opaque-id
 * leaf values are cast (the W037/W038/W039/W040 disclosed precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { assembleFindingsReport } from "verification";
import type { Finding, VerificationClaimDescriptor } from "verification";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "evaluation";
import type { SubstrateId } from "cognitive-substrate";
import type { OrganizationCapabilityId } from "organization";
import {
  createCapabilityRegistry,
  deprecateCapability,
} from "capability-registry";
import type { MeasuredEvidence } from "capability-registry";
import { skillIdOf } from "skills";
import type { SkillRecord } from "skills";
import type { ProviderDeclaration } from "../registration.js";

export const TENANT = "tenant-provider-tests";
export const PROJECT = "project-provider";
export const WORLD = "world-provider-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

export const OTHER_WORLD = "world-provider-other";

/** Opaque-id leaf literals (branded casts only — never parsed). */
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as SubstrateId;

export const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;
export const ORG_CAP_RISK = "capability-org-risk-guard" as OrganizationCapabilityId;

/**
 * The W037 experiment descriptor, built as REAL data (the W040 fixture
 * precedent: the specs are declarative data, so literals are the real
 * construction seam).
 */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-provider-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-provider-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-provider-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-provider-fixture",
      constraints: [
        {
          constraintId: "eb-1",
          kind: "exposure-budget",
          maxGrossExposureFraction: 0.001,
          penalty: { shape: "linear", coefficient: 10 },
        },
        {
          constraintId: "tb-1",
          kind: "turnover-budget",
          maxCommandsPerView: 0,
          penalty: { shape: "linear", coefficient: 2 },
        },
      ],
    },
    policy: {
      policyId: "pol-provider-fixture",
      rewardModelId: "model-provider-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-provider-fixture",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [{ axisId: "h-1", kind: "unseen-period" }],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
    ...overrides,
  };
}

/** The W038 experiment evaluation (opaque-id leaf cast; REAL experiment binding). */
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  evaluationId = "expeval-provider-fixture-00000001",
): ExperimentEvaluation {
  return {
    evaluationId: evaluationId as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-provider-fixture",
    trajectories: [],
    holdoutSplits: [],
    integrity: ["evidence-chain", "deterministic-replay"],
    reduction: {
      trajectoryCount: 0,
      combinedScoreTotal: 0,
      appliedSoftPenaltyTotal: 0,
      hardViolationCount: 0,
      compliance: "compliant",
      ranking: [],
    },
  };
}

/** The W038 claim registry, as REAL declarative data (the W040 precedent). */
function claimsFixture(): readonly VerificationClaimDescriptor[] {
  return [
    {
      claimId: "claim-evidence-chain",
      kind: "evidence-chain",
      declarationSource: "policy:integrity",
      evidenceNeedles: ["record", "capsule"],
    },
    {
      claimId: "claim-deterministic-replay",
      kind: "deterministic-replay",
      declarationSource: "policy:integrity",
      evidenceNeedles: ["determinism", "twin"],
    },
  ];
}

function findingOf(claimId: string, kind: Finding["claimKind"], verdict: Finding["verdict"]): Finding {
  const evidence =
    kind === "evidence-chain"
      ? ["every record's evidence capsule validated", "all capsule citations resolved"]
      : ["determinism metadata present", "twin re-evaluation byte-equal"];
  return {
    claimId,
    claimKind: kind,
    findingKind: "declared",
    verdict,
    evidence,
  };
}

/** The W038 findings report, assembled through the REAL seam. */
export function findingsFixture(
  subject: string,
  verdicts: readonly Finding["verdict"][] = ["PASS", "PASS"],
): ReturnType<typeof assembleFindingsReport> {
  const claims = claimsFixture();
  const findings = claims.map((claim, index) =>
    findingOf(claim.claimId, claim.kind, verdicts[index] ?? "PASS"),
  );
  return assembleFindingsReport(subject, claims, findings, []);
}

/** A full measured-evidence bundle: real experiment + bound evaluation + real findings. */
export function evidenceFixture(
  verdicts: readonly Finding["verdict"][] = ["PASS", "PASS"],
): MeasuredEvidence {
  const experiment = experimentFixture();
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId), verdicts);
  return { experiment, evaluation, findings };
}

/**
 * A REAL W041 skill record hand-assembled as recorded DATA (the record IS
 * data — W041's own validateSkillRecord re-proves it), measured AS the
 * given capability, demonstrated by the given bearer, in the provider's
 * scope, with its competence members carried from the W040 descriptor.
 */
export function skillRecordFixture(input: {
  capabilityId: string;
  capabilityName: string;
  kind: SkillRecord["competence"]["kind"];
  domain: SkillRecord["competence"]["domain"];
  bearer: SkillRecord["bearer"];
  provenance: SkillRecord["evidence"]["capabilityProvenance"];
  trajectoryId?: string;
  worldId?: string;
}): SkillRecord {
  const trajectoryId = input.trajectoryId ?? "traj-provider-fixture-0001";
  const trajectoryIds = [trajectoryId] as unknown as SkillRecord["evidence"]["trajectoryIds"];
  const scope = {
    tenantId: TENANT,
    projectId: PROJECT,
    worldId: input.worldId ?? WORLD,
  };
  return {
    skillId: skillIdOf({
      capabilityId: input.capabilityId,
      kind: input.kind,
      domain: input.domain,
      bearer:
        input.bearer.kind === "substrate"
          ? { kind: "substrate", id: String(input.bearer.substrateId) }
          : { kind: "body", id: String((input.bearer as { readonly bodyId?: string }).bodyId ?? "") },
      scope,
      trajectoryIds,
      lineage: { parentSkillId: null, version: 1 },
    }),
    competence: {
      capabilityId: input.capabilityId as SkillRecord["competence"]["capabilityId"],
      name: input.capabilityName,
      kind: input.kind,
      domain: input.domain,
    },
    bearer: input.bearer,
    scope,
    evidence: {
      trajectoryIds,
      experimentIds: input.provenance.map((citation) => String(citation.experimentId)).sort(),
      capabilityProvenance: input.provenance,
    },
    summary: {
      outcomeCarries: [
        {
          trajectoryId: trajectoryId as SkillRecord["summary"]["outcomeCarries"][number]["trajectoryId"],
          policyId: "pol-provider-fixture",
          combinedScore: 1,
          appliedSoftPenaltyTotal: 0,
          compliance: "compliant",
          status: "detached",
          passCount: 1,
          commandsIssued: 1,
          acked: 1,
          rejected: 0,
        },
      ],
      trajectoryCount: 1,
    },
    lineage: { parentSkillId: null, version: 1 },
    provenance: { extractionId: "extraction-provider-fixture-0001" as SkillRecord["provenance"]["extractionId"] },
  };
}

/** An empty registry over the test scope. */
export function emptyRegistry() {
  return createCapabilityRegistry({ ...SCOPE });
}

/** Deprecate a capability in the registry (typed helper for the drift tests). */
export function deprecateIn(registry: ReturnType<typeof emptyRegistry>, capabilityId: string) {
  return deprecateCapability(
    registry,
    capabilityId as Parameters<typeof deprecateCapability>[1],
    "the fixture deprecation reason (rationale-as-data)",
  );
}

/** The default provider declaration: two measured offers, no endowments. */
export function declarationFixture(overrides: Partial<ProviderDeclaration> = {}): ProviderDeclaration {
  return {
    identity: {
      name: "the neutral test provider",
      description: "a provider-neutral fixture declaration",
    },
    scope: { ...SCOPE },
    lineage: { parentProviderId: null, version: 1 },
    offers: [
      {
        name: "momentum execution under stress",
        description: "measured execution quality of the momentum substrate",
        kind: "execution-quality",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [evidenceFixture()],
      },
      {
        name: "momentum risk control under drawdown",
        kind: "risk-control",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [ORG_CAP_RISK],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [evidenceFixture()],
      },
    ],
    ...overrides,
  };
}

/** Cast a plain string to the W039 organization capability id brand (test-side leaf cast). */
export const asOrgCap = (value: string): OrganizationCapabilityId => value as OrganizationCapabilityId;
