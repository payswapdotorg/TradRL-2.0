/**
 * REAL record builders for the W058 marketplace tests (the no-shim law):
 * the W037 experiment descriptor, the W038 evaluation + findings report,
 * the W056 provider registration through the REAL registerProvider gate,
 * and the marketplace listing through the REAL listOffer gate. The W037/
 * W038/W056 builders are ADAPTED from W056's own test fixtures (the
 * disclosed W057 precedent — no package seam is stubbed; only opaque-id
 * leaf values are cast).
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
import { createCapabilityRegistry, deprecateCapability, revokeCapability } from "capability-registry";
import type { CapabilityRegistry, MeasuredEvidence } from "capability-registry";
import { registerProvider } from "capability-provider";
import type { ProviderDeclaration, ProviderRegistration } from "capability-provider";
import { listOffer } from "../listing.js";
import type { Listing, LicensingTerms } from "../listing.js";

export const TENANT = "tenant-marketplace-tests";
export const PROJECT = "project-marketplace";
export const WORLD = "world-marketplace-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

/** Opaque-id leaf literals (branded casts only — never parsed). */
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as SubstrateId;

export const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;
export const ORG_CAP_RISK = "capability-org-risk-guard" as OrganizationCapabilityId;

/** The default licensing terms of the fixtures (declared data). */
export const TERMS: LicensingTerms = {
  model: "per-use",
  billingPeriod: "monthly",
  price: { amount: 42, currency: "USD" },
};

/** The W037 experiment descriptor, built as REAL declarative data. */
export function experimentFixture(overrides: Partial<ExperimentDescriptor> = {}): ExperimentDescriptor {
  return {
    name: "exp-marketplace-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-marketplace-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-marketplace-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-marketplace-fixture",
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
      policyId: "pol-marketplace-fixture",
      rewardModelId: "model-marketplace-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-marketplace-fixture",
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
  evaluationId = "expeval-marketplace-fixture-00000001",
): ExperimentEvaluation {
  return {
    evaluationId: evaluationId as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-marketplace-fixture",
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
  worldId: string = WORLD,
): MeasuredEvidence {
  const experiment = experimentFixture(
    worldId === WORLD ? {} : { world: { worldId, definitionDigest: `defdigest-marketplace-${worldId}` } },
  );
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId), verdicts);
  return { experiment, evaluation, findings };
}

/** The default provider declaration: two measured offers, no endowments. */
export function declarationFixture(
  overrides: Partial<ProviderDeclaration> = {},
  worldId: string = WORLD,
): ProviderDeclaration {
  return {
    identity: {
      name: "the neutral test provider",
      description: "a provider-neutral fixture declaration",
    },
    scope: { tenantId: TENANT, projectId: PROJECT, worldId },
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
        evidence: [evidenceFixture(["PASS", "PASS"], worldId)],
      },
      {
        name: "momentum risk control under drawdown",
        kind: "risk-control",
        domain: "futures",
        bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
        providesOrganizationCapabilityIds: [ORG_CAP_RISK],
        capabilityLineage: { parentCapabilityId: null, version: 1 },
        evidence: [evidenceFixture(["PASS", "PASS"], worldId)],
      },
    ],
    ...overrides,
  };
}

export const OTHER_WORLD = "world-marketplace-other";

/** An empty registry over the test scope. */
export function emptyRegistry(): CapabilityRegistry {
  return createCapabilityRegistry({ ...SCOPE });
}

/**
 * A REAL registered provider: the declaration through W056's own gate
 * (over a registry scoped to the declaration's own scope), returning the
 * recorded registration and the chained registry.
 */
export function registeredFixture(
  declaration: ProviderDeclaration = declarationFixture(),
): { readonly registration: ProviderRegistration; readonly registry: CapabilityRegistry } {
  const outcome = registerProvider(createCapabilityRegistry({ ...declaration.scope }), declaration);
  if (!outcome.ok) {
    throw new Error(`fixture registration failed: ${JSON.stringify(outcome.errors)}`);
  }
  return { registration: outcome.registration, registry: outcome.registry };
}

/** A REAL listed fixture: the registered provider listed under the default terms. */
export function listedFixture(input: {
  readonly terms?: LicensingTerms;
  readonly registry?: CapabilityRegistry;
  readonly registration?: ProviderRegistration;
} = {}): { readonly listing: Listing; readonly registration: ProviderRegistration; readonly registry: CapabilityRegistry } {
  const base = input.registration === undefined
    ? registeredFixture()
    : { registration: input.registration, registry: input.registry ?? createCapabilityRegistry({ ...input.registration.scope }) };
  const outcome = listOffer(base.registry, {
    registration: base.registration,
    terms: input.terms ?? TERMS,
  });
  if (!outcome.ok) {
    throw new Error(`fixture listing failed: ${JSON.stringify(outcome.errors)}`);
  }
  return { listing: outcome.listing, registration: base.registration, registry: base.registry };
}

/** Deprecate a capability in the registry (typed helper for the lifecycle tests). */
export function deprecateIn(registry: CapabilityRegistry, capabilityId: string): CapabilityRegistry {
  const outcome = deprecateCapability(registry, capabilityId as Parameters<typeof deprecateCapability>[1], "the fixture deprecation reason (rationale-as-data)");
  if (!outcome.ok) {
    throw new Error(`fixture deprecation failed: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.registry;
}

/** Revoke a capability in the registry (typed helper for the lifecycle tests). */
export function revokeIn(registry: CapabilityRegistry, capabilityId: string): CapabilityRegistry {
  const outcome = revokeCapability(registry, capabilityId as Parameters<typeof revokeCapability>[1], "the fixture revocation reason (rationale-as-data)");
  if (!outcome.ok) {
    throw new Error(`fixture revocation failed: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.registry;
}
