/**
 * REAL record builders for the W057 arena adapter tests (the no-shim law,
 * the W056 capability-provider fixture precedent, adapted in-place for the
 * arena vocabulary — the W042 adaptation precedent): the W037 experiment
 * descriptor, the W038 evaluation + findings report, the W040 registry,
 * the W056 provider declaration, and the W057 arena declaration — every
 * builder constructs the REAL shapes through their real canonical seams
 * (`experimentIdOf`, `assembleFindingsReport`, `registerProvider`,
 * `registerArenaProvider`); nothing here stubs a package seam. Only
 * opaque-id leaf values are cast (the W037–W056 disclosed precedent).
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
import type { MeasuredEvidence } from "capability-registry";
import { skillIdOf } from "skills";
import type { SkillRecord } from "skills";
import { registerArenaProvider } from "../arena-registration.js";
import type { ArenaProviderDeclaration } from "../arena-registration.js";

export const TENANT = "tenant-arena-tests";
export const PROJECT = "project-arena";
export const WORLD = "world-arena-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

/** Opaque-id leaf literals (branded casts only — never parsed). */
export const SUBSTRATE_MOMENTUM = "substrate-momentum-mind" as SubstrateId;
export const SUBSTRATE_MEANREVERSION = "substrate-mean-reversion-mind" as SubstrateId;

export const ORG_CAP_EXECUTION = "capability-org-execution" as OrganizationCapabilityId;
export const ORG_CAP_RISK = "capability-org-risk-guard" as OrganizationCapabilityId;

/** Cast a plain string to the W039 organization capability id brand (test-side leaf cast). */
export const asOrgCap = (value: string): OrganizationCapabilityId => value as OrganizationCapabilityId;

/** The W037 experiment descriptor, built as REAL declarative data (the W040/W056 precedent). */
export function experimentFixture(tag = "a"): ExperimentDescriptor {
  return {
    name: `exp-arena-fixture-${tag}`,
    tenantId: TENANT,
    projectId: PROJECT,
    world: { worldId: WORLD, definitionDigest: `defdigest-arena-fixture-${tag}` },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: String(SUBSTRATE_MOMENTUM) },
    ],
    rewardModel: {
      modelId: "model-arena-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
      programId: "cp-arena-fixture",
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
      policyId: "pol-arena-fixture",
      rewardModelId: "model-arena-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-arena-fixture",
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
export function evaluationFixture(
  experiment: ExperimentDescriptor,
  tag = "a",
): ExperimentEvaluation {
  return {
    evaluationId: `expeval-arena-fixture-${tag}` as ExperimentEvaluationId,
    experimentId: experimentIdOf(experiment),
    policyId: "pol-arena-fixture",
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

/** The W038 claim registry, as REAL declarative data (the W040/W056 precedent). */
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

/** A full measured-evidence bundle: real experiment + bound evaluation + real findings, keyed by tag. */
export function evidenceBundle(tag = "a"): MeasuredEvidence {
  const experiment = experimentFixture(tag);
  const evaluation = evaluationFixture(experiment, tag);
  const findings = findingsFixture(String(evaluation.evaluationId));
  return { experiment, evaluation, findings };
}

/** A REAL W041 skill record hand-assembled as recorded DATA (the W056 precedent). */
export function skillRecordFixture(input: {
  capabilityId: string;
  capabilityName: string;
  kind: SkillRecord["competence"]["kind"];
  domain: SkillRecord["competence"]["domain"];
  bearer: SkillRecord["bearer"];
  provenance: SkillRecord["evidence"]["capabilityProvenance"];
  trajectoryId?: string;
}): SkillRecord {
  const trajectoryId = input.trajectoryId ?? "traj-arena-fixture-0001";
  const trajectoryIds = [trajectoryId] as unknown as SkillRecord["evidence"]["trajectoryIds"];
  const scope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
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
          policyId: "pol-arena-fixture",
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
    provenance: { extractionId: "extraction-arena-fixture-0001" as SkillRecord["provenance"]["extractionId"] },
  };
}

/** An empty W040 registry over the test scope. */
export function emptyRegistry() {
  return createCapabilityRegistry({ ...SCOPE });
}

/** The default fixture registered through the REAL arena gate (throws on refusal — a fixture invariant). */
export function registerArenaFixture() {
  const outcome = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  if (!outcome.ok) {
    throw new Error(`the arena fixture registration failed: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome;
}

/**
 * The default arena declaration: a staged-elimination venue of three
 * rounds under a top-k (k=2) leaderboard, and two measured offers — one
 * single-evaluation regime measured in the screening round, one
 * consensus-of-evaluations regime (two REAL, distinct evidence bundles)
 * measured in the trial round.
 */
export function arenaDeclarationFixture(
  overrides: Partial<ArenaProviderDeclaration> = {},
): ArenaProviderDeclaration {
  return {
    identity: {
      name: "the arena test venue",
      description: "an arena-adapter fixture declaration",
    },
    scope: { ...SCOPE },
    lineage: { parentProviderId: null, version: 1 },
    venue: {
      name: "the futures capability arena",
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
          evidence: [evidenceBundle("a")],
        },
        regime: { regimeKind: "single-evaluation" },
        measuredInRoundSequence: 1,
      },
      {
        offer: {
          name: "momentum risk control under drawdown",
          kind: "risk-control",
          domain: "futures",
          bearer: { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM },
          providesOrganizationCapabilityIds: [ORG_CAP_RISK],
          capabilityLineage: { parentCapabilityId: null, version: 1 },
          evidence: [evidenceBundle("b"), evidenceBundle("c")],
        },
        regime: { regimeKind: "consensus-of-evaluations" },
        measuredInRoundSequence: 2,
      },
    ],
    ...overrides,
  };
}
