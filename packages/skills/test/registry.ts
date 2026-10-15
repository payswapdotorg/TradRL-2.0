/**
 * REAL record builders for the W041 skills tests — the capability-registry
 * side (the W040 fixture precedent: every builder constructs the REAL
 * W037/W038 shapes through their real canonical seams — `experimentIdOf`
 * re-identifies the descriptor, `assembleFindingsReport` assembles the
 * findings report and its digest — nothing here stubs a package seam; only
 * opaque-id leaf values are cast, the W037/W038/W039/W040 disclosed
 * precedent). The bearer and organization-capability leaves are typed
 * through the registration's own indexed types (the W039 precedent — no
 * extra dependency for a branded leaf).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { assembleFindingsReport } from "verification";
import type { EvaluationClaimKind, Finding, VerificationClaimDescriptor } from "verification";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "evaluation";
import {
  canonicalRegistration,
  capabilityIdOf,
  createCapabilityRegistry,
  deprecateCapability,
  registerCapability,
  revokeCapability,
} from "capability-registry";
import type { CapabilityRegistration, MeasuredEvidence } from "capability-registry";

export const TENANT = "tenant-skill-tests";
export const PROJECT = "project-skill";
export const WORLD = "world-skill-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD } as const;

export const OTHER_WORLD = "world-skill-other";

/** The bearer leaves (opaque-id casts only — never parsed). */
type BearerSubstrateId = Extract<CapabilityRegistration["bearer"], { kind: "substrate" }>["substrateId"];
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as BearerSubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as BearerSubstrateId;

/** The W039 organization-capability leaf, through the registration's own type. */
type OrgCapabilityId = CapabilityRegistration["providesOrganizationCapabilityIds"][number];
export const ORG_CAP_EXECUTION = "capability-org-execution" as OrgCapabilityId;

/**
 * The W037 experiment descriptor, built as REAL declarative data (the W040
 * fixture precedent: the specs are declarative data, so literals are the
 * real construction seam).
 */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-skill-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-skill-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-execution-class", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-skill-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-skill-fixture",
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
      policyId: "pol-skill-fixture",
      rewardModelId: "model-skill-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-skill-fixture",
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
 * The W038 experiment evaluation (the opaque-id leaf cast precedent: the
 * walker is the evaluation id's only producer; the binding to the
 * experiment is REAL — re-derived through `experimentIdOf`).
 */
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  overrides: Partial<ExperimentEvaluation> = {},
): ExperimentEvaluation {
  return {
    evaluationId: "expeval-skill-fixture-00000001" as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-skill-fixture",
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

/** The W038 findings report, assembled through the REAL seam (PASS/PASS). */
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
export function evidenceFixture(): MeasuredEvidence {
  const experiment = experimentFixture();
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
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

/** The momentum capability's canonical id (re-derived through W040's own seam). */
export const MOMENTUM_CAPABILITY_ID = capabilityIdOf(canonicalRegistration(registrationFixture()));

/**
 * The fixture registry: the demonstrated momentum capability (registered),
 * a registered-but-not-demonstrated mean-reversion capability, a
 * deprecated legacy capability, and a revoked retired capability — the
 * full walk surface (skills + every refusal kind).
 */
export function registryFixture(): ReturnType<typeof createCapabilityRegistry> {
  let registry = createCapabilityRegistry(SCOPE);
  const momentum = registerCapability(registry, registrationFixture());
  if (!momentum.ok) {
    throw new Error(`fixture: momentum registration failed (${momentum.errors.map((e) => e.code).join(", ")})`);
  }
  registry = momentum.registry;
  const meanReversion = registerCapability(registry, registrationFixture({
    name: "mean-reversion execution under stress",
    description: "measured execution quality of the mean-reversion substrate",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
  }));
  if (!meanReversion.ok) {
    throw new Error(`fixture: mean-reversion registration failed (${meanReversion.errors.map((e) => e.code).join(", ")})`);
  }
  registry = meanReversion.registry;
  const legacy = registerCapability(registry, registrationFixture({ name: "momentum execution (legacy)" }));
  if (!legacy.ok) {
    throw new Error(`fixture: legacy registration failed (${legacy.errors.map((e) => e.code).join(", ")})`);
  }
  registry = legacy.registry;
  const retired = registerCapability(registry, registrationFixture({ name: "momentum execution (retired)" }));
  if (!retired.ok) {
    throw new Error(`fixture: retired registration failed (${retired.errors.map((e) => e.code).join(", ")})`);
  }
  registry = retired.registry;
  const deprecated = deprecateCapability(registry, legacy.capabilityId, "superseded by the re-measured variant");
  if (!deprecated.ok) {
    throw new Error("fixture: deprecation failed");
  }
  registry = deprecated.registry;
  const revoked = revokeCapability(registry, retired.capabilityId, "the measurement regime no longer applies");
  if (!revoked.ok) {
    throw new Error("fixture: revocation failed");
  }
  return revoked.registry;
}
