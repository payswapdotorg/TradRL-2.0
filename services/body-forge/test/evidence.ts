/**
 * REAL capability-registry-side builders for the W041 body-forge tests
 * (the W040 fixture precedent: every builder constructs the REAL
 * W037/W038 shapes through their real canonical seams — `experimentIdOf`
 * re-identifies the descriptor, `assembleFindingsReport` assembles the
 * findings report — nothing here stubs a package seam; only opaque-id
 * leaf values are cast, the repo's disclosed test precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { assembleFindingsReport } from "verification";
import type { EvaluationClaimKind, Finding, VerificationClaimDescriptor } from "verification";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "evaluation";
import {
  createCapabilityRegistry,
  deprecateCapability,
  registerCapability,
  revokeCapability,
} from "capability-registry";
import type {
  CapabilityRegistration,
  CapabilityRegistry,
  MeasuredEvidence,
} from "capability-registry";

export const TENANT = "tenant-forge-tests";
export const PROJECT = "project-forge";
export const WORLD = "world-forge-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD } as const;

/** The bearer leaves (opaque-id casts only — never parsed). */
type BearerSubstrateId = Extract<CapabilityRegistration["bearer"], { kind: "substrate" }>["substrateId"];
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as BearerSubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as BearerSubstrateId;

/** The W039 organization-capability leaf, through the registration's own type. */
type OrgCapabilityId = CapabilityRegistration["providesOrganizationCapabilityIds"][number];
export const ORG_CAP_EXECUTION = "capability-org-execution" as OrgCapabilityId;

/**
 * The W037 experiment descriptor, as REAL declarative data (the W040
 * fixture precedent: the specs are declarative data, so literals are the
 * real construction seam).
 */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-forge-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-forge-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-execution-class", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-forge-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-forge-fixture",
      constraints: [
        { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
        { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
        { constraintId: "de-1", kind: "drawdown-envelope", maxDrawdownFraction: 0.001, penalty: { shape: "linear", coefficient: 1 } },
      ],
    },
    policy: {
      policyId: "pol-forge-fixture",
      rewardModelId: "model-forge-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-forge-fixture",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [{ axisId: "h-1", kind: "unseen-period" }, { axisId: "h-2", kind: "venue" }],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
    ...overrides,
  };
}

/** The W038 experiment evaluation (the opaque-id leaf cast precedent). */
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  overrides: Partial<ExperimentEvaluation> = {},
): ExperimentEvaluation {
  return {
    evaluationId: "expeval-forge-fixture-00000001" as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-forge-fixture",
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
    { claimId: "claim-evidence-chain", kind: "evidence-chain", declarationSource: "policy:integrity", evidenceNeedles: ["record", "capsule"] },
    { claimId: "claim-deterministic-replay", kind: "deterministic-replay", declarationSource: "policy:integrity", evidenceNeedles: ["determinism", "twin"] },
  ];
}

function findingOf(claimId: string, kind: EvaluationClaimKind, verdict: Finding["verdict"]): Finding {
  const evidence =
    kind === "evidence-chain"
      ? ["every record's evidence capsule validated", "all capsule citations resolved"]
      : ["determinism metadata present", "twin re-evaluation byte-equal"];
  return { claimId, claimKind: kind, findingKind: "declared", verdict, evidence };
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

function mustRegister(registry: CapabilityRegistry, registration: CapabilityRegistration): CapabilityRegistry {
  const outcome = registerCapability(registry, registration);
  if (!outcome.ok) {
    throw new Error(`forge fixture: registration failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.registry;
}

/**
 * The fixture registry: the demonstrated momentum capability (registered),
 * a registered-but-not-demonstrated mean-reversion capability, a deprecated
 * legacy capability, and a revoked retired capability — the same walk
 * surface the skills fixtures exercise.
 */
export function registryFixture(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture());
  registry = mustRegister(registry, registrationFixture({
    name: "mean-reversion execution under stress",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
  }));
  registry = mustRegister(registry, registrationFixture({ name: "momentum execution (legacy)" }));
  const retired = mustRegister(registry, registrationFixture({ name: "momentum execution (retired)" }));
  registry = retired;
  const retiredEntry = retired.entries.find((entry) => entry.descriptor.name === "momentum execution (retired)");
  const legacyEntry = registry.entries.find((entry) => entry.descriptor.name === "momentum execution (legacy)");
  const revoked = revokeCapability(registry, retiredEntry!.descriptor.capabilityId, "the measurement regime no longer applies");
  if (!revoked.ok) {
    throw new Error("forge fixture: revocation failed");
  }
  const deprecated = deprecateCapability(revoked.registry, legacyEntry!.descriptor.capabilityId, "superseded by the re-measured variant");
  if (!deprecated.ok) {
    throw new Error("forge fixture: deprecation failed");
  }
  return deprecated.registry;
}

/** A registry whose momentum capability is DEPRECATED (the lifecycle refusal fixture). */
export function deprecatedMomentumRegistry(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture());
  const momentum = registry.entries.find((entry) => entry.descriptor.name === "momentum execution under stress");
  const deprecated = deprecateCapability(registry, momentum!.descriptor.capabilityId, "a newer measurement supersedes it");
  if (!deprecated.ok) {
    throw new Error("forge fixture: momentum deprecation failed");
  }
  return deprecated.registry;
}

/** A registry whose momentum capability is REVOKED (the terminal refusal fixture). */
export function revokedMomentumRegistry(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture());
  const momentum = registry.entries.find((entry) => entry.descriptor.name === "momentum execution under stress");
  const revoked = revokeCapability(registry, momentum!.descriptor.capabilityId, "the measurement regime no longer applies");
  if (!revoked.ok) {
    throw new Error("forge fixture: momentum revocation failed");
  }
  return revoked.registry;
}

/** A registry WITHOUT the momentum capability (the unregistered-skill fixture). */
export function sparseRegistry(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture({
    name: "mean-reversion execution under stress",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
  }));
  return registry;
}
