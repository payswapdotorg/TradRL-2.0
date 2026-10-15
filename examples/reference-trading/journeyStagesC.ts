/**
 * The W064 reference journey — STAGE SET C, THE IMPROVEMENT LOOP + THE
 * COMMERCE FAMILY (W055/W056/W057/W058): the improvement cycle composed
 * over the whole journey (W055's composeImprovementCycle gate — every
 * cited record re-proven through its own source validator), the arena
 * provider registration (W057's registerArenaProvider gate over W056's
 * provider gate, evidence measured in the journey's own world), the
 * marketplace listing (W058's listOffer gate), and the entitlement grant +
 * its verified use (W058's grantEntitlement + verifyEntitlement gates).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { composeImprovementCycle } from "../../services/autonomous-learning/index.js";
import type { ImprovementCycle } from "../../services/autonomous-learning/index.js";
import { aCycleInput } from "../../services/autonomous-learning/test/fixtures.js";
import { experimentIdOf } from "../../packages/experiments/index.js";
import type { ExperimentDescriptor } from "../../packages/experiments/index.js";
import { assembleFindingsReport } from "../../packages/verification/index.js";
import type { Finding, VerificationClaimDescriptor } from "../../packages/verification/index.js";
import type { ExperimentEvaluation, ExperimentEvaluationId } from "../../packages/evaluation/index.js";
import type { SubstrateId } from "../../packages/cognitive-substrate/index.js";
import type { OrganizationCapabilityId } from "../../packages/organization/index.js";
import { createCapabilityRegistry } from "../../packages/capability-registry/index.js";
import type { MeasuredEvidence } from "../../packages/capability-registry/index.js";
import { registerProvider } from "../../packages/capability-provider/index.js";
import type { ProviderDeclaration, ProviderRegistration } from "../../packages/capability-provider/index.js";
import {
  projectArenaLeaderboard,
  registerArenaProvider,
} from "../../packages/tradrl-adapters/arena/index.js";
import type { ArenaProviderDeclaration, ArenaProviderRegistration } from "../../packages/tradrl-adapters/arena/index.js";
import { listOffer } from "../../packages/marketplace/index.js";
import type { Listing } from "../../packages/marketplace/index.js";
import { grantEntitlement, verifyEntitlement } from "../../packages/entitlements/index.js";
import type { Entitlement } from "../../packages/entitlements/index.js";
import {
  ENTITLEMENT_PERIOD,
  ENTITLEMENT_USE_AT,
  LISTING_TERMS,
  PRINCIPAL,
  SCOPE,
} from "./journeyFacts.js";
import { mustOk, type StageLine } from "./journeyHelpers.js";
import type { DeclarationOrder, LearningRecords } from "./journeyStagesB.js";
import type { FoundingRecords } from "./journeyStagesA.js";

/** The loop + commerce family's composed records. */
export interface CommerceRecords {
  readonly cycle: ImprovementCycle;
  readonly arena: ArenaProviderRegistration;
  readonly arenaLeaderboardSize: number;
  readonly provider: ProviderRegistration;
  readonly listing: Listing;
  readonly entitlement: Entitlement;
}

const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;
const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;

// --- The measured evidence at THIS scope (W037/W038 shapes, real seams) ----

function journeyExperiment(): ExperimentDescriptor {
  return {
    name: "exp-w064-reference-journey",
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    world: { worldId: SCOPE.worldId, definitionDigest: "defdigest-w064-reference-journey-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-w064-reference-journey",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
      ],
    },
    constraints: {
      programId: "cp-w064-reference-journey",
      constraints: [
        { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
      ],
    },
    policy: {
      policyId: "pol-w064-reference-journey",
      rewardModelId: "model-w064-reference-journey",
      rewardModelVersion: "1",
      constraintProgramId: "cp-w064-reference-journey",
      penalizedConstraintIds: ["eb-1"],
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

function journeyClaims(): readonly VerificationClaimDescriptor[] {
  return [
    { claimId: "claim-evidence-chain", kind: "evidence-chain", declarationSource: "policy:integrity", evidenceNeedles: ["record", "capsule"] },
    { claimId: "claim-deterministic-replay", kind: "deterministic-replay", declarationSource: "policy:integrity", evidenceNeedles: ["determinism", "twin"] },
  ];
}

function journeyFindings(subject: string): ReturnType<typeof assembleFindingsReport> {
  const claims = journeyClaims();
  const findings = claims.map((claim): Finding => ({
    claimId: claim.claimId,
    claimKind: claim.kind,
    findingKind: "declared",
    verdict: "PASS",
    evidence:
      claim.kind === "evidence-chain"
        ? ["every record's evidence capsule validated", "all capsule citations resolved"]
        : ["determinism metadata present", "twin re-evaluation byte-equal"],
  }));
  return assembleFindingsReport(subject, claims, findings, []);
}

function journeyEvidence(): MeasuredEvidence {
  const experiment = journeyExperiment();
  const evaluation: ExperimentEvaluation = {
    evaluationId: "expeval-w064-reference-journey-00000001" as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-w064-reference-journey",
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
  return { experiment, evaluation, findings: journeyFindings(String(evaluation.evaluationId)) };
}

// --- The arena + marketplace declarations (declared data, one scope) -------

function arenaDeclaration(): ArenaProviderDeclaration {
  return {
    identity: {
      name: "the reference journey arena",
      description: "the W064 reference journey's measured capability venue",
    },
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
    lineage: { parentProviderId: null, version: 1 },
    venue: {
      name: "the reference journey futures arena",
      venueKind: "staged-elimination",
      rounds: [
        { roundKind: "screening", sequence: 1 },
        { roundKind: "trial", sequence: 2 },
        { roundKind: "final", sequence: 3 },
      ],
      leaderboard: { style: "top-k", topK: 2 },
    },
    offers: [
      {
        offer: {
          name: "momentum execution under stress",
          description: "measured execution quality of the momentum substrate",
          kind: "execution-quality",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [journeyEvidence()],
        },
        regime: { regimeKind: "single-evaluation" },
        measuredInRoundSequence: 1,
      },
    ],
  };
}

function providerDeclaration(): ProviderDeclaration {
  return {
    identity: {
      name: "the reference journey provider",
      description: "the W064 reference journey's measured capability provider",
    },
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
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
        evidence: [journeyEvidence()],
      },
    ],
  };
}

/** Compose the improvement loop + the commerce family through every gate. */
export function stagesCommerce(
  founding: FoundingRecords,
  learning: LearningRecords,
  order: DeclarationOrder = "canonical",
): { readonly lines: readonly StageLine[]; readonly records: CommerceRecords } {
  const base = aCycleInput();
  const steps = order === "canonical" ? base.steps : [...base.steps].reverse();
  const cycle = mustOk(
    composeImprovementCycle({
      ...base,
      steps,
      brain: learning.brain,
      pairings: [learning.selfPlay, learning.adversarial],
      plans: [founding.plan],
    }),
    "compose-improvement-cycle",
  ).cycle;
  const cycleLine: StageLine = {
    stage: "S21 compose the improvement cycle",
    gate: "W055 composeImprovementCycle",
    recordId: String(cycle.cycleId),
    carriedCount: cycle.steps.length,
  };

  const arenaOutcome = registerArenaProvider(
    createCapabilityRegistry({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId }),
    arenaDeclaration(),
  );
  const arenaRegistered = mustOk(arenaOutcome, "register-arena-provider");
  const arena = arenaRegistered.registration;
  const leaderboard = mustOk(projectArenaLeaderboard(arena), "project-arena-leaderboard").projection;
  const arenaLine: StageLine = {
    stage: "S22 register the arena provider",
    gate: "W057 registerArenaProvider",
    recordId: String(arena.arenaId),
    carriedCount: arena.offers.length,
  };
  const leaderboardLine: StageLine = {
    stage: "S23 project the arena leaderboard",
    gate: "W057 projectArenaLeaderboard",
    recordId: String(arena.arenaId),
    carriedCount: leaderboard.entries.length,
  };

  const providerOutcome = registerProvider(
    createCapabilityRegistry({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId }),
    providerDeclaration(),
  );
  const registered = mustOk(providerOutcome, "register-provider");
  const provider = registered.registration;
  const listing = mustOk(
    listOffer(registered.registry, {
      registration: provider,
      terms: LISTING_TERMS,
    }),
    "list-offer",
  ).listing;
  const providerLine: StageLine = {
    stage: "S24 register the capability provider",
    gate: "W056 registerProvider",
    recordId: String(provider.providerId),
    carriedCount: provider.offers.length,
  };
  const listingLine: StageLine = {
    stage: "S25 list the marketplace offer",
    gate: "W058 listOffer",
    recordId: String(listing.listingId),
    carriedCount: listing.registration.offers.length,
  };

  const offerId = listing.registration.offers[0]?.offerId;
  if (offerId === undefined) {
    throw new Error("journey stage 'grant-entitlement' — the listing surfaces no offer");
  }
  const entitlement = mustOk(
    grantEntitlement({
      listing,
      offerId,
      principal: { ...PRINCIPAL },
      terms: LISTING_TERMS,
      period: ENTITLEMENT_PERIOD,
    }),
    "grant-entitlement",
  ).entitlement;
  mustOk(verifyEntitlement(entitlement, {
    scope: { ...PRINCIPAL },
    offerId,
    at: ENTITLEMENT_USE_AT,
    terms: LISTING_TERMS,
  }), "verify-entitlement");
  const entitlementLine: StageLine = {
    stage: "S26 grant + verify the entitlement",
    gate: "W058 grantEntitlement+verifyEntitlement",
    recordId: String(entitlement.entitlementId),
    carriedCount: null,
  };

  return {
    lines: [
      cycleLine,
      arenaLine,
      leaderboardLine,
      providerLine,
      listingLine,
      entitlementLine,
    ],
    records: {
      cycle,
      arena,
      arenaLeaderboardSize: leaderboard.entries.length,
      provider,
      listing,
      entitlement,
    },
  };
}
