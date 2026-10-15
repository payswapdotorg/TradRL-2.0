/**
 * REAL record builders for the W058 entitlements tests (the no-shim
 * law): the W037 experiment descriptor, the W038 evaluation + findings
 * report, the W056 provider registration through the REAL
 * registerProvider gate, the marketplace listing through the REAL
 * listOffer gate, and the entitlement through the REAL grantEntitlement
 * gate. The W037/W038/W056 builders are ADAPTED from W056's own test
 * fixtures (the disclosed W057 precedent — no package seam is stubbed;
 * only opaque-id leaf values are cast).
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
import { createCapabilityRegistry } from "capability-registry";
import type { CapabilityRegistry, MeasuredEvidence } from "capability-registry";
import { registerProvider } from "capability-provider";
import type { ProviderDeclaration, ProviderRegistration } from "capability-provider";
import { listOffer } from "marketplace";
import type { Listing, LicensingTerms } from "marketplace";
import { grantEntitlement } from "../grant.js";
import type { Entitlement, EntitlementGrantInput } from "../grant.js";

export const TENANT = "tenant-entitlements-tests";
export const PROJECT = "project-entitlements";
export const WORLD = "world-entitlements-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

/** The grantee principal of the default fixtures (§14: tenant explicit). */
export const PRINCIPAL = { tenantId: TENANT, principalId: "principal-desk-ops" };

/** Opaque-id leaf literals (branded casts only — never parsed). */
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;

export const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;
export const ORG_CAP_RISK = "capability-org-risk-guard" as OrganizationCapabilityId;

/** The default licensing terms of the fixtures (declared data). */
export const TERMS: LicensingTerms = {
  model: "per-use",
  billingPeriod: "monthly",
  price: { amount: 42, currency: "USD" },
};

/** The default declared period of the fixtures (declared ticks). */
export const PERIOD = { kind: "fixed-window", startAt: 100, endAt: 200 } as const;

/** The W037 experiment descriptor, built as REAL declarative data. */
export function experimentFixture(): ExperimentDescriptor {
  return {
    name: "exp-entitlements-fixture",
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: "defdigest-entitlements-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-entitlements-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-entitlements-fixture",
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
      policyId: "pol-entitlements-fixture",
      rewardModelId: "model-entitlements-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-entitlements-fixture",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [{ axisId: "h-1", kind: "unseen-period" }],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
  };
}

/** The W038 experiment evaluation (opaque-id leaf cast; REAL experiment binding). */
export function evaluationFixture(experiment: ExperimentDescriptor): ExperimentEvaluation {
  return {
    evaluationId: "expeval-entitlements-fixture-00000001" as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-entitlements-fixture",
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

function findingOf(claimId: string, kind: Finding["claimKind"]): Finding {
  const evidence =
    kind === "evidence-chain"
      ? ["every record's evidence capsule validated", "all capsule citations resolved"]
      : ["determinism metadata present", "twin re-evaluation byte-equal"];
  return { claimId, claimKind: kind, findingKind: "declared", verdict: "PASS", evidence };
}

/** The W038 findings report, assembled through the REAL seam. */
export function findingsFixture(subject: string): ReturnType<typeof assembleFindingsReport> {
  const claims = claimsFixture();
  const findings = claims.map((claim) => findingOf(claim.claimId, claim.kind));
  return assembleFindingsReport(subject, claims, findings, []);
}

/** A full measured-evidence bundle: real experiment + bound evaluation + real findings. */
export function evidenceFixture(): MeasuredEvidence {
  const experiment = experimentFixture();
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
  return { experiment, evaluation, findings };
}

/** The default provider declaration: two measured offers, no endowments. */
export function declarationFixture(): ProviderDeclaration {
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
  };
}

/** A REAL listed fixture: registration → registry → listing, all through the REAL gates. */
export function listedFixture(input: {
  readonly terms?: LicensingTerms;
} = {}): {
  readonly listing: Listing;
  readonly registration: ProviderRegistration;
  readonly registry: CapabilityRegistry;
} {
  const declaration = declarationFixture();
  const registrationOutcome = registerProvider(
    createCapabilityRegistry({ ...declaration.scope }),
    declaration,
  );
  if (!registrationOutcome.ok) {
    throw new Error(`fixture registration failed: ${JSON.stringify(registrationOutcome.errors)}`);
  }
  const listingOutcome = listOffer(registrationOutcome.registry, {
    registration: registrationOutcome.registration,
    terms: input.terms ?? TERMS,
  });
  if (!listingOutcome.ok) {
    throw new Error(`fixture listing failed: ${JSON.stringify(listingOutcome.errors)}`);
  }
  return {
    listing: listingOutcome.listing,
    registration: registrationOutcome.registration,
    registry: registrationOutcome.registry,
  };
}

/** The default grant input over the listed fixture (the first offer). */
export function grantInputFixture(
  overrides: Partial<EntitlementGrantInput> = {},
): { readonly input: EntitlementGrantInput; readonly listing: Listing } {
  const { listing } = listedFixture();
  const offerId = listing.registration.offers[0]?.offerId;
  if (offerId === undefined) {
    throw new Error("fixture offer missing");
  }
  return {
    input: {
      listing,
      offerId,
      principal: { ...PRINCIPAL },
      terms: { ...TERMS, price: { ...TERMS.price } },
      period: { ...PERIOD },
      ...overrides,
    },
    listing,
  };
}

/** A REAL granted fixture (the default grant input through the REAL gate). */
export function grantedFixture(input: Partial<EntitlementGrantInput> = {}): {
  readonly entitlement: Entitlement;
  readonly listing: Listing;
} {
  const { input: grantInput, listing } = grantInputFixture(input);
  const outcome = grantEntitlement(grantInput);
  if (!outcome.ok) {
    throw new Error(`fixture grant failed: ${JSON.stringify(outcome.errors)}`);
  }
  return { entitlement: outcome.entitlement, listing };
}
