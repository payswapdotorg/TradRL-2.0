/**
 * REAL record builders for the W040 capability registry tests (the no-shim
 * law: every builder constructs the REAL W037/W038 shapes through their
 * real canonical seams — `experimentIdOf` re-identifies the descriptor,
 * `assembleFindingsReport` assembles the findings report and its digest —
 * nothing here stubs a package seam; only opaque-id leaf values are cast,
 * the W037/W038/W039 disclosed precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { assembleFindingsReport } from "verification";
import type { EvaluationClaimKind, Finding, VerificationClaimDescriptor } from "verification";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "evaluation";
import type { SubstrateId } from "cognitive-substrate";
import type { OrganizationCapabilityId } from "organization";
import type { MeasuredEvidence } from "../register.js";
import type { CapabilityRegistration } from "../register.js";
import type { CapabilityScope } from "../identity.js";

export const TENANT = "tenant-capability-tests";
export const PROJECT = "project-capability";
export const WORLD = "world-capability-tests";
export const SCOPE: CapabilityScope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

export const OTHER_WORLD = "world-capability-other";

/** Opaque-id leaf literals (branded casts only — never parsed). */
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as SubstrateId;
export const BODY_EXECUTION = "body-execution-class";

export const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;
export const ORG_CAP_RISK = "capability-org-risk-guard" as OrganizationCapabilityId;

/**
 * The W037 experiment descriptor, built as REAL data (the W036 reward /
 * constraint / policy spec literals — the experiments-package fixture
 * precedent: the specs are declarative data, so literals are the real
 * construction seam).
 */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-capability-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-capability-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-capability-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-capability-fixture",
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
        {
          constraintId: "de-1",
          kind: "drawdown-envelope",
          maxDrawdownFraction: 0.001,
          penalty: { shape: "linear", coefficient: 1 },
        },
      ],
    },
    policy: {
      policyId: "pol-capability-fixture",
      rewardModelId: "model-capability-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-capability-fixture",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [
          { axisId: "h-1", kind: "unseen-period" },
          { axisId: "h-2", kind: "venue" },
        ],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
    ...overrides,
  };
}

/**
 * The W038 experiment evaluation. The evaluationId is an OPAQUE-ID LEAF
 * CAST (the walker is the only producer; the registry never re-runs it —
 * the cast is the disclosed test-side convention, confined to opaque-id
 * leaf literals); the experimentId binding is REAL (re-derived through
 * `experimentIdOf` and re-proved by the gate).
 */
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  overrides: Partial<ExperimentEvaluation> = {},
): ExperimentEvaluation {
  return {
    evaluationId: "expeval-capability-fixture-00000001" as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-capability-fixture",
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
    ...overrides,
  };
}

/** The W038 claim registry, as REAL declarative data. */
export function claimsFixture(): readonly VerificationClaimDescriptor[] {
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

function findingOf(claimId: string, kind: EvaluationClaimKind, verdict: Finding["verdict"]): Finding {
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

/**
 * The W038 findings report, assembled through the REAL
 * `assembleFindingsReport` (canonical digest, canonical order, counts) —
 * the verdict of every claim configurable.
 */
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

/** The default registration: the momentum substrate's measured execution quality. */
export function registrationFixture(
  overrides: Partial<CapabilityRegistration> = {},
): CapabilityRegistration {
  return {
    name: "momentum execution under stress",
    description: "measured execution quality of the momentum substrate",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    scope: SCOPE,
    providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
    lineage: { parentCapabilityId: null, version: 1 },
    evidence: [evidenceFixture()],
    ...overrides,
  };
}
