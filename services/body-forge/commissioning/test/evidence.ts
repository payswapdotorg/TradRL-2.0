/**
 * REAL capability-registry-side builders for the W043 commissioning
 * tests — ADAPTED from the W042 model-selection test fixtures (which
 * themselves follow the W040/W041 fixture precedent: every builder
 * constructs the REAL W037/W038 shapes through their real canonical
 * seams — `experimentIdOf` re-identifies the descriptor,
 * `assembleFindingsReport` assembles the findings report — nothing here
 * stubs a package seam; only opaque-id leaf values are cast, the repo's
 * disclosed test precedent).
 *
 * The scope is the REAL benchmarks/model-capability catalogue's own
 * single scope, so the REAL catalogue is consumable by the REAL W042
 * selection walk; the evaluations carry the W038 holdout-split
 * aggregations whose atoms the catalogue's execution benchmark demands
 * (compared AS DATA by the walk's coverage proof).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { assembleFindingsReport } from "verification";
import type { EvaluationClaimKind, Finding, VerificationClaimDescriptor } from "verification";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "evaluation";
import type { TimestampMs } from "tradrl-world-contracts";
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

export const TENANT = "tenant-model-selection";
export const PROJECT = "project-selection";
export const WORLD = "world-selection-fixture";
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
 * real construction seam). Distinct names ⇒ distinct canonical ids.
 */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-commissioning-fixture-1",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-commissioning-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-execution-class", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-commissioning-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-commissioning-fixture",
      constraints: [
        { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
        { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
        { constraintId: "de-1", kind: "drawdown-envelope", maxDrawdownFraction: 0.001, penalty: { shape: "linear", coefficient: 1 } },
      ],
    },
    policy: {
      policyId: "pol-commissioning-fixture",
      rewardModelId: "model-commissioning-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-commissioning-fixture",
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

/** The second experiment (a distinct canonical id, the same scope). */
export function experimentVariant(name: string): ExperimentDescriptor {
  return experimentFixture({ name });
}

/**
 * The W038 experiment evaluation, carrying the holdout-split aggregations
 * whose atoms the catalogue's execution benchmark demands (the evaluation
 * side of h-1 is the catalogue's held-out period; h-2's evaluation side
 * its held-out venue).
 */
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  evaluationId: string,
): ExperimentEvaluation {
  return {
    evaluationId: evaluationId as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-commissioning-fixture",
    trajectories: [],
    holdoutSplits: [
      {
        axisId: "h-1",
        kind: "unseen-period",
        derivation: "period-instants",
        split: {
          axisId: "h-1",
          kind: "unseen-period",
          train: [{ kind: "period", from: 1_700_000_000_000 as TimestampMs, to: 1_700_500_000_000 as TimestampMs }],
          evaluation: [{ kind: "period", from: 1_700_500_000_001 as TimestampMs, to: 1_701_000_000_000 as TimestampMs }],
        },
        train: [],
        evaluation: [],
        unassigned: [],
      },
      {
        axisId: "h-2",
        kind: "venue",
        derivation: "not-derivable",
        split: {
          axisId: "h-2",
          kind: "venue",
          train: [{ kind: "venue", venueId: "venue-forge-secondary" }],
          evaluation: [{ kind: "venue", venueId: "venue-forge-main" }],
        },
        train: [],
        evaluation: [],
        unassigned: [],
      },
    ],
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
export function evidenceFixture(
  experiment: ExperimentDescriptor,
  evaluation: ExperimentEvaluation,
): MeasuredEvidence {
  const findings = findingsFixture(String(evaluation.evaluationId));
  return { experiment, evaluation, findings };
}

/** The two fixture evidence bundles (exp-1/eval-1, exp-2/eval-2). */
export function evidenceBundles(): readonly MeasuredEvidence[] {
  const experiment1 = experimentFixture();
  const experiment2 = experimentVariant("exp-commissioning-fixture-2");
  return [
    evidenceFixture(experiment1, evaluationFixture(experiment1, "expeval-commissioning-00000001")),
    evidenceFixture(experiment2, evaluationFixture(experiment2, "expeval-commissioning-00000002")),
  ];
}

/** The evaluations the benchmark surface carries (all cited evidence resolves). */
export function surfaceEvaluations(): readonly ExperimentEvaluation[] {
  return evidenceBundles().map((bundle) => bundle.evaluation);
}

/** The default registration: the momentum substrate's measured execution quality (TWO citations). */
export function registrationFixture(
  overrides: Partial<CapabilityRegistration> = {},
): CapabilityRegistration {
  const bundles = evidenceBundles();
  return {
    name: "momentum execution under stress",
    description: "measured execution quality of the momentum substrate",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
    scope: SCOPE,
    providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
    lineage: { parentCapabilityId: null, version: 1 },
    evidence: [bundles[0]!, bundles[1]!],
    ...overrides,
  };
}

function mustRegister(registry: CapabilityRegistry, registration: CapabilityRegistration): CapabilityRegistry {
  const outcome = registerCapability(registry, registration);
  if (!outcome.ok) {
    throw new Error(`commissioning fixture: registration failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.registry;
}

function momentumCapabilityId(
  registry: CapabilityRegistry,
): CapabilityRegistry["entries"][number]["descriptor"]["capabilityId"] {
  const entry = registry.entries.find((candidate) => candidate.descriptor.name === "momentum execution under stress");
  if (entry === undefined) {
    throw new Error("commissioning fixture: the momentum capability is missing");
  }
  return entry.descriptor.capabilityId;
}

/**
 * The fixture registry: the demonstrated momentum capability (registered,
 * the endowment's + the selection's covering capability) plus the
 * registered mean-reversion candidacy — the minimal walk surface both the
 * W041 forge and the W042 selection accept.
 */
export function registryFixture(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture());
  registry = mustRegister(registry, registrationFixture({
    name: "mean-reversion execution under stress",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
  }));
  return registry;
}

/** A registry whose momentum capability is DEPRECATED (the stale-selection refusal fixture). */
export function deprecatedMomentumRegistry(): CapabilityRegistry {
  const registry = registryFixture();
  const deprecated = deprecateCapability(registry, momentumCapabilityId(registry), "a newer measurement supersedes it");
  if (!deprecated.ok) {
    throw new Error("commissioning fixture: momentum deprecation failed");
  }
  return deprecated.registry;
}

/** A registry whose momentum capability is REVOKED (the terminal refusal fixture). */
export function revokedMomentumRegistry(): CapabilityRegistry {
  const registry = registryFixture();
  const revoked = revokeCapability(registry, momentumCapabilityId(registry), "the measurement regime no longer applies");
  if (!revoked.ok) {
    throw new Error("commissioning fixture: momentum revocation failed");
  }
  return revoked.registry;
}

/** A registry WITHOUT the momentum capability (the unregistered-capability fixture). */
export function sparseRegistry(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  registry = mustRegister(registry, registrationFixture({
    name: "mean-reversion execution under stress",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
  }));
  return registry;
}
