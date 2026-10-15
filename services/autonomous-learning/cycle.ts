/**
 * The improvement cycle (W055) — the continuous autonomous improvement loop
 * AS TYPED DATA: the ImprovementCycle record and THE COMPOSITION GATE.
 *
 * `composeImprovementCycle(inputs)` is THE GATE, fail-closed at every seam:
 * (1) the step declarations through THIS package's per-step evidence laws
 * (A6 — errors carried verbatim); (2) EVERY cited record re-proven through
 * its SOURCE PACKAGE's own validators — the post-mortem through W053's
 * `validatePostMortem`, the brain generation through W054's
 * `validateFirmBrain`, the curriculum through W046's `validateCurriculum`,
 * each pairing plan through W046's own pairing validators, each skill
 * record through W041's `validateSkillRecord` (their errors carried
 * VERBATIM); (3) the cited brain generation's TENANT scope proven against
 * the cycle's scope — a cross-tenant citation is the loud `cross-tenant`
 * refusal naming R056 (§14 `scope-mismatch` for same-tenant/other-world);
 * (4) every step's citations proven COHERENT with the records they cite
 * (the observation records actually in the cited brain; the declared
 * adjustment coherent with the cited curriculum's own stages); then the
 * cycle sealed: the steps in CANONICAL loop order (A9 — input order never
 * leaks), the content-addressed `impcycle-<digest>` id, the immutable
 * lineage, the deterministic provenance.
 *
 * A13/A14 (BINDING): the cycle composes PROPOSAL records. It never
 * executes, never trains, never improves anything itself, never moves
 * authority (authority stays with possession grants). It records the
 * improvement plan; the runtime consumes it.
 *
 * Laws: spec/REQUIREMENTS.md R056; spec/ARCHITECTURE-LOCK.md §14, A6, A9,
 * A13, A14. W064's journey exercises this; nothing downstream may treat
 * the cycle as anything but recorded data.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import { validatePostMortem } from "outcome-learning";
import type { PostMortem, PostMortemValidationError } from "outcome-learning";
import { validateFirmBrain } from "firm-brain";
import type { BrainValidationError, FirmBrain } from "firm-brain";
import { validateCurriculum } from "learning-curriculum";
import type { Curriculum, CurriculumValidationError } from "learning-curriculum";
import { validateAdversarialPairing, validateSelfPlayPairing } from "learning-populations";
import type { AdversarialPairing, PairingValidationError, SelfPlayPairing } from "learning-populations";
import { validateSkillRecord } from "skills";
import type { SkillError, SkillRecord } from "skills";
import type { ForgedBodyPlan } from "body-forge";
import { blankKnowledgeScopeMembers, EXPLICIT_SCOPE_LAW, TENANT_ISOLATION_LAW } from "memory";
import type { KnowledgeScope } from "memory";
import { canonicalObservations, canonicalPairingCitations, canonicalPlanCitations, canonicalSkillCitations, canonicalSteps, EVIDENCE_LINKAGE_LAW, stepEvidenceErrors } from "./steps.js";
import type { BrainGenerationCitation, CurriculumAdjustmentStep, ForgedPlanCitation, ImprovementStep, ObserveStep, PairingCitation, SkillCitation, StepError } from "./steps.js";

/** The canonical law list carried on every cycle's provenance. */
export const IMPROVEMENT_CYCLE_PROVENANCE_LAWS: readonly string[] = [TENANT_ISOLATION_LAW, EXPLICIT_SCOPE_LAW, EVIDENCE_LINKAGE_LAW, "spec/ARCHITECTURE-LOCK.md A9", "spec/ARCHITECTURE-LOCK.md A13", "spec/ARCHITECTURE-LOCK.md A14"];

declare const improvementCycleIdBrand: unique symbol;
/** An OPAQUE improvement-cycle id (a canonical digest rendering) — produced
 * only by the composition gate / {@link improvementCycleDigestOf}; never parsed. */
export type ImprovementCycleId = string & { readonly [improvementCycleIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const IMPROVEMENT_CYCLE_ID_PREFIX = "impcycle-";

/** The immutable cycle lineage (the W053/W054 branch-lineage pattern): a
 * continuation declares its parent; the chain's root + ordinal are carried. */
export interface ImprovementCycleLineage {
  readonly parent: ImprovementCycleId | undefined;
  readonly root: ImprovementCycleId;
  readonly ordinal: number;
}
/** The declared lineage at composition time (a root cycle omits it). */
export interface ImprovementCycleLineageInput {
  readonly parent?: ImprovementCycleId;
  readonly root?: ImprovementCycleId;
  readonly ordinal?: number;
}
/** The deterministic provenance of one cycle (re-derivable from the cycle's
 * own carried citations — see ./validate.ts). */
export interface ImprovementCycleProvenance {
  readonly deriver: "compose-improvement-cycle";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/** ONE improvement cycle: the content-addressed id, the explicit §14 scope,
 * the six steps (canonical loop order — each citing its evidence records,
 * A6), the immutable lineage, the deterministic provenance. A PROPOSAL
 * record (A13/A14): typed data the runtime consumes; nothing here executes. */
export interface ImprovementCycle {
  readonly cycleId: ImprovementCycleId;
  readonly kind: "improvement-cycle";
  readonly scope: KnowledgeScope;
  readonly steps: readonly ImprovementStep[];
  readonly lineage: ImprovementCycleLineage;
  readonly provenance: ImprovementCycleProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ImprovementCycleErrorCode =
  | "malformed-input" // not lawful typed data
  | "invalid-scope" // a §14 scope member is blank
  | "invalid-step" // this package's own step laws (carried verbatim)
  | "invalid-post-mortem" // W053's own re-validation failed (carried verbatim)
  | "invalid-brain" // W054's own re-validation failed (carried verbatim)
  | "invalid-curriculum" // W046's own re-validation failed (carried verbatim)
  | "invalid-pairing" // W046's own pairing re-validation failed (carried verbatim)
  | "invalid-skill" // W041's own re-validation failed (carried verbatim)
  | "cross-tenant" // R056: a cited record's tenant ≠ the cycle's
  | "scope-mismatch" // §14: same tenant, another project/world
  | "unknown-citation" // a step cites a record not among the provided
  | "citation-mismatch" // a step's citation disagrees with the record it cites
  | "adjustment-incoherent" // the declared adjustment disagrees with the cited curriculum
  | "lineage-break"; // the immutable lineage is incoherent

/** One typed cycle error (fail-closed; the law named in the message). */
export interface ImprovementCycleError {
  readonly code: ImprovementCycleErrorCode;
  readonly message: string;
  readonly entryId?: string;
  /** `invalid-step` only: this package's own step errors, carried VERBATIM. */
  readonly stepErrors?: readonly StepError[];
  /** `invalid-post-mortem` only: W053's own errors, carried VERBATIM. */
  readonly postMortemErrors?: readonly PostMortemValidationError[];
  /** `invalid-brain` only: W054's own errors, carried VERBATIM. */
  readonly brainErrors?: readonly BrainValidationError[];
  /** `invalid-curriculum` only: W046's own errors, carried VERBATIM. */
  readonly curriculumErrors?: readonly CurriculumValidationError[];
  /** `invalid-pairing` only: W046's own errors, carried VERBATIM. */
  readonly pairingErrors?: readonly PairingValidationError[];
  /** `invalid-skill` only: W041's own errors, carried VERBATIM. */
  readonly skillErrors?: readonly SkillError[];
}

/** The composition outcome: the sealed cycle, or the refusal. */
export type ImprovementCycleOutcome =
  | { readonly ok: true; readonly cycle: ImprovementCycle }
  | { readonly ok: false; readonly errors: readonly ImprovementCycleError[] };

/** The composition input: the explicit scope, the step declarations (any
 * order — the seal canonicalizes), EVERY cited record (re-proven through
 * its own source package's validators), and the optional declared lineage. */
export interface ImprovementCycleInput {
  readonly scope: KnowledgeScope;
  readonly steps: readonly ImprovementStep[];
  readonly postMortem: PostMortem;
  readonly brain: FirmBrain;
  readonly curriculum: Curriculum;
  readonly pairings: readonly (SelfPlayPairing | AdversarialPairing)[];
  readonly skills: readonly SkillRecord[];
  readonly plans: readonly ForgedBodyPlan[];
  readonly lineage?: ImprovementCycleLineageInput;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
type ScopeLike = { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
function scopeOf(value: ScopeLike): KnowledgeScope {
  return { tenantId: value.tenantId, projectId: value.projectId, worldId: value.worldId };
}

/** THE SCOPE-AGREEMENT PROOFS: a cited record's §14 scope vs the cycle's —
 * a TENANT disagreement is the loud `cross-tenant` refusal naming R056. */
function scopeAgreementErrors(label: string, entryId: string, scope: KnowledgeScope, record: ScopeLike): ImprovementCycleError[] {
  if (String(record.tenantId) !== String(scope.tenantId)) {
    return [{ code: "cross-tenant", entryId, message: `the ${label} '${entryId}' belongs to tenant '${String(record.tenantId)}' but the improvement cycle is tenant '${scope.tenantId}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant citation is refused loudly, never adopted` }];
  }
  const errors: ImprovementCycleError[] = [];
  for (const member of ["projectId", "worldId"] as const) {
    if (String(record[member]) !== String(scope[member])) { errors.push({ code: "scope-mismatch", entryId, message: `the ${label} '${entryId}' carries '${member}' '${String(record[member])}' but the cycle's is '${scope[member]}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})` }); }
  }
  return errors;
}

/** The canonical citation tuple of one step (fixed member order — A9). */
function stepTupleOf(step: ImprovementStep): unknown {
  switch (step.kind) {
    case "observe": return [step.kind, step.observations.map((observation) => [String(observation.recordId), String(observation.kind)])];
    case "post-mortem": return [step.kind, String(step.citation.postMortemId), String(step.citation.evaluationId)];
    case "brain-update": return [step.kind, String(step.citation.brainId), step.citation.generation, step.citation.recordCount];
    case "curriculum-adjustment": return [step.kind, String(step.citation.curriculumId), step.citation.activeStage, step.citation.stageCount, step.declaration.action, step.declaration.toStage];
    case "re-selection": return [step.kind, step.citations.map((citation) => [String(citation.pairingId), String(citation.kind), String(citation.populationId)]), step.declaration.action];
    case "re-commissioning": return [step.kind, step.skillCitations.map((citation) => [String(citation.skillId), String(citation.capabilityId), citation.evidenceCount]), step.planCitations.map((citation) => [String(citation.planId), citation.endowmentCount]), step.declaration.action];
  }
}
function stepTuplesOf(steps: readonly ImprovementStep[]): readonly unknown[] {
  return steps.map((step) => stepTupleOf(step));
}

/** The cycle id: `impcycle-<digest>` over the canonical cycle bytes — the
 * scope (TENANT first — R056 carried) and the canonical step tuples. The
 * lineage rides BESIDE the id, never inside it (the W053/W054 precedent).
 * Pure and deterministic (A9). */
export function improvementCycleDigestOf(cycle: ImprovementCycle): ImprovementCycleId {
  const digest = canonicalDigestHex({ scope: [cycle.scope.tenantId, cycle.scope.projectId, cycle.scope.worldId], steps: stepTuplesOf(cycle.steps) });
  return `${IMPROVEMENT_CYCLE_ID_PREFIX}${digest}` as ImprovementCycleId;
}

/** The provenance input digest over the cycle's own carried citations —
 * re-derivable by ./validate.ts from the recorded cycle alone (A9). */
export function cycleCitationDigestOf(cycle: ImprovementCycle): string {
  const cited: readonly string[] = [
    ...citedPostMortemIdsOf(cycle),
    ...citedBrainIdsOf(cycle),
    ...citedCurriculumIdsOf(cycle),
    ...citedPairingIdsOf(cycle),
    ...citedSkillIdsOf(cycle),
    ...citedPlanIdsOf(cycle),
  ];
  return canonicalDigestHex({ cited, scope: [cycle.scope.tenantId, cycle.scope.projectId, cycle.scope.worldId] });
}
export function citedPostMortemIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.filter((step) => step.kind === "post-mortem").map((step) => String((step as { readonly citation: { readonly postMortemId: string } }).citation.postMortemId));
}
export function citedBrainIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.filter((step) => step.kind === "brain-update").map((step) => String((step as { readonly citation: { readonly brainId: string } }).citation.brainId));
}
export function citedCurriculumIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.filter((step) => step.kind === "curriculum-adjustment").map((step) => String((step as { readonly citation: { readonly curriculumId: string } }).citation.curriculumId));
}
export function citedPairingIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.flatMap((step) => (step.kind === "re-selection" ? (step as { readonly citations: readonly { readonly pairingId: string }[] }).citations.map((citation) => String(citation.pairingId)) : [])).sort();
}
export function citedSkillIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.flatMap((step) => (step.kind === "re-commissioning" ? (step as { readonly skillCitations: readonly { readonly skillId: string }[] }).skillCitations.map((citation) => String(citation.skillId)) : [])).sort();
}
export function citedPlanIdsOf(cycle: ImprovementCycle): readonly string[] {
  return cycle.steps.flatMap((step) => (step.kind === "re-commissioning" ? (step as { readonly planCitations: readonly { readonly planId: string }[] }).planCitations.map((citation) => String(citation.planId)) : [])).sort();
}

// ---------------------------------------------------------------------------
// THE CITATION-COHERENCE PROOFS (a step's citations vs the records provided)
// ---------------------------------------------------------------------------

function coherenceErrors(input: ImprovementCycleInput, steps: readonly ImprovementStep[]): ImprovementCycleError[] {
  const errors: ImprovementCycleError[] = [];
  const brainRecordIds = new Set(input.brain.records.map((record) => String(record.recordId)));
  const brainKinds = new Map(input.brain.records.map((record) => [String(record.recordId), String(record.citation.kind)]));
  const pairingById = new Map(input.pairings.map((pairing) => [String(pairing.pairingId), pairing]));
  const skillById = new Map(input.skills.map((skill) => [String(skill.skillId), skill]));
  const planById = new Map(input.plans.map((plan) => [String(plan.planId), plan]));
  for (const step of steps) {
    switch (step.kind) {
      case "observe": {
        for (const observation of (step as ObserveStep).observations) {
          const recordId = String(observation.recordId);
          if (!brainRecordIds.has(recordId)) {
            errors.push({ code: "unknown-citation", entryId: recordId, message: `the observe step cites the knowledge record '${recordId}' but the cited brain generation does not carry it — every step's citations are proven against the records they cite (${EVIDENCE_LINKAGE_LAW})` });
            continue;
          }
          if (brainKinds.get(recordId) !== String(observation.kind)) {
            errors.push({ code: "citation-mismatch", entryId: recordId, message: `the observe step cites the knowledge record '${recordId}' as kind '${String(observation.kind)}' but the record's own citation names kind '${String(brainKinds.get(recordId))}' — citations agree with the records they cite` });
          }
        }
        break;
      }
      case "post-mortem": {
        const citation = (step as { readonly citation: { readonly postMortemId: string; readonly evaluationId: string } }).citation;
        if (String(citation.postMortemId) !== String(input.postMortem.postMortemId) || String(citation.evaluationId) !== String(input.postMortem.evaluation.evaluationId)) {
          errors.push({ code: "citation-mismatch", entryId: String(citation.postMortemId), message: "the post-mortem step's citation disagrees with the cited post-mortem record's own ids — citations agree with the records they cite" });
        }
        break;
      }
      case "brain-update": {
        const citation = (step as { readonly citation: BrainGenerationCitation }).citation;
        if (String(citation.brainId) !== String(input.brain.brainId) || citation.generation !== input.brain.generation || citation.recordCount !== input.brain.records.length) {
          errors.push({ code: "citation-mismatch", entryId: String(citation.brainId), message: "the brain-update step's citation disagrees with the cited brain generation's own id/generation/record count — citations agree with the records they cite" });
        }
        break;
      }
      case "curriculum-adjustment": {
        const adjustment = step as CurriculumAdjustmentStep;
        const citation = adjustment.citation;
        if (String(citation.curriculumId) !== String(input.curriculum.curriculumId) || citation.activeStage !== input.curriculum.activeStage || citation.stageCount !== input.curriculum.stages.length) {
          errors.push({ code: "citation-mismatch", entryId: String(citation.curriculumId), message: "the curriculum-adjustment step's citation disagrees with the cited curriculum's own id/active stage/stage count — citations agree with the records they cite" });
          break;
        }
        const toStage = adjustment.declaration.toStage;
        if (toStage <= input.curriculum.activeStage || toStage > input.curriculum.stages.length - 1) {
          errors.push({ code: "adjustment-incoherent", entryId: String(citation.curriculumId), message: `the declared advance to stage '${String(toStage)}' is incoherent with the cited curriculum (active stage '${String(input.curriculum.activeStage)}', '${String(input.curriculum.stages.length)}' stages) — a proposal advances to a LATER stage the curriculum actually carries` });
        }
        break;
      }
      case "re-selection": {
        for (const citation of (step as { readonly citations: readonly PairingCitation[] }).citations) {
          const pairingId = String(citation.pairingId);
          const pairing = pairingById.get(pairingId);
          if (pairing === undefined) {
            errors.push({ code: "unknown-citation", entryId: pairingId, message: `the re-selection step cites the pairing plan '${pairingId}' but no such record was provided — every step's citations are proven against the records they cite (${EVIDENCE_LINKAGE_LAW})` });
            continue;
          }
          const populationId = pairing.kind === "self-play-pairing" ? String((pairing as SelfPlayPairing).populationId) : String((pairing as AdversarialPairing).challenger.populationId);
          if (String(citation.kind) !== String(pairing.kind) || String(citation.populationId) !== populationId) {
            errors.push({ code: "citation-mismatch", entryId: pairingId, message: "the re-selection step's citation disagrees with the cited pairing plan's own kind/population — citations agree with the records they cite" });
          }
        }
        break;
      }
      case "re-commissioning": {
        const commissioning = step as { readonly skillCitations: readonly SkillCitation[]; readonly planCitations: readonly ForgedPlanCitation[] };
        for (const citation of commissioning.skillCitations) {
          const skillId = String(citation.skillId);
          const skill = skillById.get(skillId);
          if (skill === undefined) {
            errors.push({ code: "unknown-citation", entryId: skillId, message: `the re-commissioning step cites the skill record '${skillId}' but no such record was provided — every step's citations are proven against the records they cite (${EVIDENCE_LINKAGE_LAW})` });
            continue;
          }
          if (String(citation.capabilityId) !== String(skill.competence.capabilityId) || citation.evidenceCount !== skill.evidence.trajectoryIds.length) {
            errors.push({ code: "citation-mismatch", entryId: skillId, message: "the re-commissioning step's skill citation disagrees with the cited skill record's own capability/evidence count — citations agree with the records they cite" });
          }
        }
        for (const citation of commissioning.planCitations) {
          const planId = String(citation.planId);
          const plan = planById.get(planId);
          if (plan === undefined) {
            errors.push({ code: "unknown-citation", entryId: planId, message: `the re-commissioning step cites the forged plan '${planId}' but no such record was provided — every step's citations are proven against the records they cite (${EVIDENCE_LINKAGE_LAW})` });
            continue;
          }
          if (citation.endowmentCount !== plan.endowment.entries.length) {
            errors.push({ code: "citation-mismatch", entryId: planId, message: "the re-commissioning step's plan citation disagrees with the cited forged plan's own endowment count — citations agree with the records they cite" });
          }
        }
        break;
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE LINEAGE RESOLUTION (the W053/W054 memory precedent)
// ---------------------------------------------------------------------------

function resolveLineage(input: ImprovementCycleLineageInput | undefined, cycleId: ImprovementCycleId): { readonly ok: true; readonly lineage: ImprovementCycleLineage } | { readonly ok: false; readonly errors: readonly ImprovementCycleError[] } {
  const parent = input?.parent;
  if (parent === undefined) {
    const declaredRoot = input?.root;
    if (declaredRoot !== undefined && declaredRoot !== cycleId) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root improvement cycle's lineage must cite its own id ('${cycleId}') — it declares '${declaredRoot}' (the immutable lineage law)` }] };
    }
    const ordinal = input?.ordinal ?? 0;
    if (ordinal !== 0) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root improvement cycle's lineage ordinal is 0 — it declares ${String(ordinal)} (the immutable lineage law)` }] };
    }
    return { ok: true, lineage: { parent: undefined, root: cycleId, ordinal: 0 } };
  }
  if (String(parent).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: "the improvement cycle declares a blank parent id — the lineage is explicit, never defaulted" }] };
  }
  const root = input?.root;
  if (root === undefined || String(root).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: `the continuation of '${String(parent)}' declares no chain root — a continuation carries the chain's root verbatim (the immutable lineage law)` }] };
  }
  const ordinal = input?.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
    return { ok: false, errors: [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it declares ${String(ordinal)} (the immutable lineage law)` }] };
  }
  return { ok: true, lineage: { parent, root, ordinal } };
}

// ---------------------------------------------------------------------------
// THE COMPOSITION GATE
// ---------------------------------------------------------------------------

/** Canonicalize the step declarations (A9 — input order never leaks): the
 * loop order over the steps, the canonical id orders within each step. */
function sealSteps(steps: readonly ImprovementStep[]): readonly ImprovementStep[] {
  return canonicalSteps(steps).map((step) => {
    switch (step.kind) {
      case "observe": return { ...step, observations: canonicalObservations((step as ObserveStep).observations) };
      case "re-selection": return { ...step, citations: canonicalPairingCitations((step as { readonly citations: readonly PairingCitation[] }).citations) };
      case "re-commissioning": return { ...step, skillCitations: canonicalSkillCitations((step as { readonly skillCitations: readonly SkillCitation[] }).skillCitations), planCitations: canonicalPlanCitations((step as { readonly planCitations: readonly ForgedPlanCitation[] }).planCitations) };
      default: return { ...step };
    }
  });
}

/** Compose ONE improvement cycle. THE GATE, fail-closed, every violation
 * collected, none silently repaired: the per-step evidence laws (A6), every
 * cited record re-proven through its own source package's validators
 * (errors carried VERBATIM), the cited brain generation's tenant scope
 * proven against the cycle's (R056 named loudly on violation), every
 * citation proven coherent with the record it cites, then the seal: the
 * canonical loop order, the `impcycle-<digest>` id, the immutable lineage,
 * the deterministic provenance. Pure (A9): the same records + the same
 * step declarations ⇒ the deep-equal cycle, whatever order they came in.
 * A13/A14: the sealed record is a PROPOSAL — nothing is executed here. */
export function composeImprovementCycle(input: ImprovementCycleInput): ImprovementCycleOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.scope)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the composition input is not typed data — a scope and the cited records are required" }] };
  }
  if (!Array.isArray(input.steps)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the steps are not a list — a cycle composes a list of improvement steps" }] };
  }
  const scope = scopeOf(input.scope);
  const errors: ImprovementCycleError[] = [];
  for (const member of blankKnowledgeScopeMembers(scope)) {
    errors.push({ code: "invalid-scope", message: `the improvement cycle's scope '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank` });
  }
  const postMortem = input.postMortem;
  if (!isRecordLike(postMortem)) { return { ok: false, errors: [...errors, { code: "malformed-input", message: "the cited post-mortem is not typed data — a sealed W053 record is required" }] }; }
  const brain = input.brain;
  if (!isRecordLike(brain)) { return { ok: false, errors: [...errors, { code: "malformed-input", message: "the cited firm brain is not typed data — a founded W054 brain generation is required" }] }; }
  const curriculum = input.curriculum;
  if (!isRecordLike(curriculum)) { return { ok: false, errors: [...errors, { code: "malformed-input", message: "the cited curriculum is not typed data — a founded W046 curriculum is required" }] }; }
  const pairings = Array.isArray(input.pairings) ? input.pairings : [];
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const plans = Array.isArray(input.plans) ? input.plans : [];
  // (1) THE PER-STEP EVIDENCE LAWS (A6) — over the CANONICALIZED steps
  // (A9: the declarer's order never leaks; the laws prove the sealed shape)
  // — errors carried verbatim.
  const sealedSteps = sealSteps(input.steps);
  const stepErrors = stepEvidenceErrors(sealedSteps);
  if (stepErrors.length > 0) { errors.push({ code: "invalid-step", message: `the step declarations violate ${String(stepErrors.length)} step law(s) — errors carried verbatim`, stepErrors }); }
  // (2) EVERY CITED RECORD RE-PROVEN THROUGH ITS OWN SOURCE VALIDATORS.
  const postMortemProof = validatePostMortem(postMortem);
  if (!postMortemProof.ok) { errors.push({ code: "invalid-post-mortem", message: `the cited post-mortem '${String(postMortem.postMortemId)}' failed W053's own whole-record re-validation — errors carried verbatim`, entryId: String(postMortem.postMortemId), postMortemErrors: postMortemProof.errors }); }
  const brainProof = validateFirmBrain(brain);
  if (!brainProof.ok) { errors.push({ code: "invalid-brain", message: `the cited brain generation '${String(brain.brainId)}' failed W054's own whole-brain re-validation — errors carried verbatim`, entryId: String(brain.brainId), brainErrors: brainProof.errors }); }
  const curriculumProof = validateCurriculum(curriculum);
  if (!curriculumProof.ok) { errors.push({ code: "invalid-curriculum", message: `the cited curriculum '${String(curriculum.curriculumId)}' failed W046's own whole-record re-validation — errors carried verbatim`, entryId: String(curriculum.curriculumId), curriculumErrors: curriculumProof.errors }); }
  for (const pairing of pairings) {
    const pairingId = String(isRecordLike(pairing) ? pairing.pairingId : "");
    const proof = pairing.kind === "adversarial-pairing" ? validateAdversarialPairing(pairing as AdversarialPairing) : validateSelfPlayPairing(pairing as SelfPlayPairing);
    if (!proof.ok) { errors.push({ code: "invalid-pairing", message: `the cited pairing plan '${pairingId}' failed W046's own whole-record re-validation — errors carried verbatim`, entryId: pairingId, pairingErrors: proof.errors }); }
  }
  for (const skill of skills) {
    const skillId = String(isRecordLike(skill) ? skill.skillId : "");
    const proof = validateSkillRecord(skill);
    if (!proof.ok) { errors.push({ code: "invalid-skill", message: `the cited skill record '${skillId}' failed W041's own whole-record re-validation — errors carried verbatim`, entryId: skillId, skillErrors: proof.errors }); }
  }
  // (3) THE SCOPE PROOFS — R056 named loudly on any tenant disagreement.
  errors.push(...scopeAgreementErrors("post-mortem", String(postMortem.postMortemId), scope, postMortem.scope as ScopeLike));
  errors.push(...scopeAgreementErrors("firm brain", String(brain.brainId), scope, (isRecordLike(brain.scope) ? brain.scope : {}) as ScopeLike));
  errors.push(...scopeAgreementErrors("curriculum", String(curriculum.curriculumId), scope, (isRecordLike(curriculum.scope) ? curriculum.scope : {}) as ScopeLike));
  for (const pairing of pairings) {
    errors.push(...scopeAgreementErrors("pairing plan", String(isRecordLike(pairing) ? pairing.pairingId : ""), scope, (isRecordLike(pairing) && isRecordLike(pairing.scope) ? pairing.scope : {}) as ScopeLike));
  }
  for (const skill of skills) {
    errors.push(...scopeAgreementErrors("skill record", String(isRecordLike(skill) ? skill.skillId : ""), scope, (isRecordLike(skill) && isRecordLike(skill.scope) ? skill.scope : {}) as ScopeLike));
  }
  for (const plan of plans) {
    const body = isRecordLike(plan) && isRecordLike(plan.body) ? plan.body : {};
    errors.push(...scopeAgreementErrors("forged plan", String(isRecordLike(plan) ? plan.planId : ""), scope, (isRecordLike(body.scope) ? body.scope : {}) as ScopeLike));
  }
  // (4) THE CITATION-COHERENCE PROOFS (against the canonicalized steps).
  errors.push(...coherenceErrors({ ...input, pairings, skills, plans }, sealedSteps));
  if (errors.length > 0) { return { ok: false, errors }; }
  // (5) THE SEAL.
  const cycleId = improvementCycleDigestOf({ cycleId: "" as ImprovementCycleId, kind: "improvement-cycle", scope, steps: sealedSteps, lineage: { parent: undefined, root: "" as ImprovementCycleId, ordinal: 0 }, provenance: { deriver: "compose-improvement-cycle", inputDigest: "", laws: [] } });
  const lineage = resolveLineage(input.lineage, cycleId);
  if (!lineage.ok) { return { ok: false, errors: lineage.errors }; }
  const cycle: ImprovementCycle = {
    cycleId,
    kind: "improvement-cycle",
    scope,
    steps: sealedSteps.map((step) => Object.freeze({ ...step })),
    lineage: lineage.lineage,
    provenance: { deriver: "compose-improvement-cycle", inputDigest: cycleCitationDigestOf({ cycleId, kind: "improvement-cycle", scope, steps: sealedSteps, lineage: lineage.lineage, provenance: { deriver: "compose-improvement-cycle", inputDigest: "", laws: [] } }), laws: IMPROVEMENT_CYCLE_PROVENANCE_LAWS },
  };
  return { ok: true, cycle: Object.freeze(cycle) };
}
