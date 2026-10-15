/**
 * The improvement step vocabulary (W055) — the closed set of step kinds the
 * improvement cycle composes, and the per-step EVIDENCE LAWS (A6: a step
 * without its required citations is refused loudly, naming A6 — never
 * silently dropped).
 *
 * The loop order (the canonical step order of every sealed cycle — the
 * order the digest's chain names): observe → post-mortem → brain-update →
 * curriculum-adjustment → re-selection → re-commissioning. Each kind
 * appears EXACTLY ONCE per cycle; the composition gate canonicalizes
 * whatever order the declarer brought (A9 — input order never leaks), and
 * the whole-cycle re-validator re-proves the sealed order.
 *
 * A13/A14 (BINDING): every step is a PROPOSAL record — typed data citing
 * its evidence records. The adjustment/selection/commissioning steps
 * DECLARE what the runtime should do next; nothing here executes, trains,
 * or moves authority (authority stays with possession grants, A13).
 *
 * Laws: spec/ARCHITECTURE-LOCK.md A6 (evidence-linked steps), A9
 * (determinism — canonical orders, no clocks/randomness/env reads), A13
 * (proposals, never authority), A14 (never executes); §14 (explicit
 * tenant/project/world identity); R056 (the brain's tenant isolation is
 * proven at the composition gate, ./cycle.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { KNOWLEDGE_KINDS } from "memory";
import type { KnowledgeKind } from "memory";

/** A6 — THE evidence-linkage law every step's citations answer. */
export const EVIDENCE_LINKAGE_LAW = "spec/ARCHITECTURE-LOCK.md A6" as const;
/** A13 — the proposal law: authority never moves into the loop. */
export const PROPOSAL_LAW = "spec/ARCHITECTURE-LOCK.md A13" as const;
/** A14 — the never-executes law: the cycle records the plan, nothing more. */
export const NEVER_EXECUTES_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;

// ---------------------------------------------------------------------------
// The closed step vocabulary
// ---------------------------------------------------------------------------

/** The closed step-kind vocabulary, in CANONICAL loop order. */
export const IMPROVEMENT_STEP_KINDS = ["observe", "post-mortem", "brain-update", "curriculum-adjustment", "re-selection", "re-commissioning"] as const;
/** One step kind (the loop's own order is the array order). */
export type ImprovementStepKind = (typeof IMPROVEMENT_STEP_KINDS)[number];

// ---------------------------------------------------------------------------
// The typed citations (A6 — each step cites its evidence records)
// ---------------------------------------------------------------------------

/** One observation: a knowledge record the cited brain generation carries. */
export interface ObservationCitation {
  /** The W054 memory record id (`mem-<digest>`) observed this cycle. */
  readonly recordId: string;
  /** The record's knowledge kind (must agree with the record's citation). */
  readonly kind: KnowledgeKind;
}

/** The post-mortem citation: the W053 record the cycle answers. */
export interface PostMortemStepCitation {
  readonly postMortemId: string;
  readonly evaluationId: string;
}

/** The brain-generation citation: the W054 firm brain the cycle updates. */
export interface BrainGenerationCitation {
  readonly brainId: string;
  readonly generation: number;
  readonly recordCount: number;
}

/** The curriculum citation: the W046 record the adjustment targets. */
export interface CurriculumStepCitation {
  readonly curriculumId: string;
  readonly activeStage: number;
  readonly stageCount: number;
}

/** One pairing citation: the W046 pairing plan the re-selection proposes over.
 * `populationId` names the population the pairing composes over — the split
 * population for a self-play pairing, the CHALLENGER side for an
 * adversarial pairing (the generation the re-selection would re-run). */
export interface PairingCitation {
  readonly pairingId: string;
  readonly kind: "self-play-pairing" | "adversarial-pairing";
  readonly populationId: string;
}

/** One skill citation: the W041 skill record the re-commissioning endows. */
export interface SkillCitation {
  readonly skillId: string;
  readonly capabilityId: string;
  readonly evidenceCount: number;
}

/** One forged-plan citation: the W041 plan the re-commissioning proposes. */
export interface ForgedPlanCitation {
  readonly planId: string;
  readonly endowmentCount: number;
}

// ---------------------------------------------------------------------------
// The typed declarations (A13 — PROPOSALS, never executed here)
// ---------------------------------------------------------------------------

/** The declared curriculum adjustment: advance to a LATER stage of the
 * cited curriculum. A PROPOSAL — the progression gate (W046) decides. */
export interface CurriculumAdjustmentDeclaration {
  readonly action: "advance-stage";
  /** The stage index the proposal advances to (proven coherent at the gate). */
  readonly toStage: number;
}

/** The declared re-selection: re-run selection over the cited pairings. */
export interface ReSelectionDeclaration {
  readonly action: "re-run-selection";
}

/** The declared re-commissioning: commission the cited forged plans. The
 * authority stays with the W034 possession grants the plans carry — A13. */
export interface ReCommissioningDeclaration {
  readonly action: "commission-plans";
}

// ---------------------------------------------------------------------------
// The step union
// ---------------------------------------------------------------------------

/** The observe step: the knowledge records observed this cycle. */
export interface ObserveStep {
  readonly kind: "observe";
  readonly observations: readonly ObservationCitation[];
}

/** The post-mortem step: the outcome record the cycle answers. */
export interface PostMortemStep {
  readonly kind: "post-mortem";
  readonly citation: PostMortemStepCitation;
}

/** The brain-update step: the brain generation the cycle proposes updating. */
export interface BrainUpdateStep {
  readonly kind: "brain-update";
  readonly citation: BrainGenerationCitation;
}

/** The curriculum-adjustment step: the declared adjustment proposal. */
export interface CurriculumAdjustmentStep {
  readonly kind: "curriculum-adjustment";
  readonly citation: CurriculumStepCitation;
  readonly declaration: CurriculumAdjustmentDeclaration;
}

/** The re-selection step: the declared re-selection proposal. */
export interface ReSelectionStep {
  readonly kind: "re-selection";
  readonly citations: readonly PairingCitation[];
  readonly declaration: ReSelectionDeclaration;
}

/** The re-commissioning step: the declared commissioning proposal. */
export interface ReCommissioningStep {
  readonly kind: "re-commissioning";
  readonly skillCitations: readonly SkillCitation[];
  readonly planCitations: readonly ForgedPlanCitation[];
  readonly declaration: ReCommissioningDeclaration;
}

/** One improvement step — typed DATA (A14). */
export type ImprovementStep =
  | ObserveStep
  | PostMortemStep
  | BrainUpdateStep
  | CurriculumAdjustmentStep
  | ReSelectionStep
  | ReCommissioningStep;

// ---------------------------------------------------------------------------
// The typed step-law error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type StepErrorCode =
  | "malformed-step" // not lawful typed data
  | "unknown-step-kind" // outside the closed vocabulary, loudly enforced
  | "missing-step" // A6: a loop step is absent — every step cites evidence
  | "duplicate-step-kind" // the loop carries each kind exactly once
  | "uncited-step" // A6: a step without its required citations
  | "blank-citation-member" // a citation carries a blank identity member
  | "duplicate-citation" // the same cited record twice
  | "non-canonical-order"; // a citation list is not in canonical order (A9)

/** One typed step error (fail-closed; the law named in the message). */
export interface StepError {
  readonly code: StepErrorCode;
  readonly message: string;
  readonly stepKind?: string;
  readonly entryId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function isCount(value: unknown, minimum: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

/** The canonical citation order of the observe step's observations. */
export function canonicalObservations(observations: readonly ObservationCitation[]): readonly ObservationCitation[] {
  return [...observations].sort((left, right) => compareCodeUnits(String(left.recordId), String(right.recordId)));
}
/** The canonical citation order of the re-selection step's pairings. */
export function canonicalPairingCitations(citations: readonly PairingCitation[]): readonly PairingCitation[] {
  return [...citations].sort((left, right) => compareCodeUnits(String(left.pairingId), String(right.pairingId)));
}
/** The canonical citation order of the re-commissioning step's skills. */
export function canonicalSkillCitations(citations: readonly SkillCitation[]): readonly SkillCitation[] {
  return [...citations].sort((left, right) => compareCodeUnits(String(left.skillId), String(right.skillId)));
}
/** The canonical citation order of the re-commissioning step's plans. */
export function canonicalPlanCitations(citations: readonly ForgedPlanCitation[]): readonly ForgedPlanCitation[] {
  return [...citations].sort((left, right) => compareCodeUnits(String(left.planId), String(right.planId)));
}
/** The canonical step order of a step list: the loop order (A9). */
export function canonicalSteps(steps: readonly ImprovementStep[]): readonly ImprovementStep[] {
  const rank = new Map<string, number>(IMPROVEMENT_STEP_KINDS.map((kind, index) => [kind, index]));
  return [...steps].sort((left, right) => (rank.get(String(left.kind)) ?? IMPROVEMENT_STEP_KINDS.length) - (rank.get(String(right.kind)) ?? IMPROVEMENT_STEP_KINDS.length));
}

// ---------------------------------------------------------------------------
// THE PER-STEP EVIDENCE LAWS (A6 — fail-closed, every violation collected)
// ---------------------------------------------------------------------------

function observationErrors(step: ObserveStep): StepError[] {
  const errors: StepError[] = [];
  const observations = step.observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    return [{ code: "uncited-step", stepKind: "observe", message: `the observe step carries no observations — every step cites its evidence records (${EVIDENCE_LINKAGE_LAW}); a step without carried evidence is refused loudly` }];
  }
  const seen = new Set<string>();
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (observation === undefined || !isRecordLike(observation)) {
      errors.push({ code: "malformed-step", stepKind: "observe", message: `the observation at index ${String(index)} is not typed data — an observation citation is a record id plus a knowledge kind` });
      continue;
    }
    const recordId = String(observation.recordId);
    if (blank(recordId)) {
      errors.push({ code: "blank-citation-member", stepKind: "observe", entryId: recordId, message: "the observation carries a blank record id — citations are explicit, never blank" });
      continue;
    }
    if (!KNOWLEDGE_KINDS.includes(observation.kind as KnowledgeKind)) {
      errors.push({ code: "malformed-step", stepKind: "observe", entryId: recordId, message: `the observation's kind '${String(observation.kind)}' is outside the memory contract's closed knowledge vocabulary — observations cite ${KNOWLEDGE_KINDS.join(", ")} only` });
      continue;
    }
    if (seen.has(recordId)) {
      errors.push({ code: "duplicate-citation", stepKind: "observe", entryId: recordId, message: `the knowledge record '${recordId}' is observed twice — citation identity is exact` });
    }
    seen.add(recordId);
    const previous = observations[index - 1];
    if (previous !== undefined && compareCodeUnits(String(previous.recordId), recordId) > 0) {
      errors.push({ code: "non-canonical-order", stepKind: "observe", entryId: recordId, message: `the observe step's observations are not in canonical record-id order at index ${String(index)} — the sealed cycle's orders are canonical (A9)` });
    }
  }
  return errors;
}

function postMortemErrors(step: PostMortemStep): StepError[] {
  const citation = step.citation;
  if (!isRecordLike(citation)) {
    return [{ code: "malformed-step", stepKind: "post-mortem", message: "the post-mortem step carries no citation — a post-mortem id and the evaluation id it answers are required" }];
  }
  const errors: StepError[] = [];
  for (const member of ["postMortemId", "evaluationId"] as const) {
    if (blank(citation[member])) {
      errors.push({ code: "blank-citation-member", stepKind: "post-mortem", message: `the post-mortem citation's '${member}' is blank — citations are explicit, never blank` });
    }
  }
  return errors;
}

function brainUpdateErrors(step: BrainUpdateStep): StepError[] {
  const citation = step.citation;
  if (!isRecordLike(citation)) {
    return [{ code: "malformed-step", stepKind: "brain-update", message: "the brain-update step carries no citation — the cited brain generation's id is required" }];
  }
  const errors: StepError[] = [];
  if (blank(citation.brainId)) {
    errors.push({ code: "blank-citation-member", stepKind: "brain-update", message: "the brain-generation citation's 'brainId' is blank — citations are explicit, never blank" });
  }
  if (!isCount(citation.generation, 0)) {
    errors.push({ code: "malformed-step", stepKind: "brain-update", message: `the brain-generation citation's 'generation' '${String(citation.generation)}' is not a non-negative integer — generations are explicit` });
  }
  if (!isCount(citation.recordCount, 0)) {
    errors.push({ code: "malformed-step", stepKind: "brain-update", message: `the brain-generation citation's 'recordCount' '${String(citation.recordCount)}' is not a non-negative integer — counts are honest carries` });
  }
  return errors;
}

function curriculumAdjustmentErrors(step: CurriculumAdjustmentStep): StepError[] {
  const errors: StepError[] = [];
  const citation = step.citation;
  if (!isRecordLike(citation)) {
    return [{ code: "malformed-step", stepKind: "curriculum-adjustment", message: "the curriculum-adjustment step carries no citation — the targeted curriculum's id is required" }];
  }
  if (blank(citation.curriculumId)) {
    errors.push({ code: "blank-citation-member", stepKind: "curriculum-adjustment", message: "the curriculum citation's 'curriculumId' is blank — citations are explicit, never blank" });
  }
  if (!isCount(citation.activeStage, 0) || !isCount(citation.stageCount, 1)) {
    errors.push({ code: "malformed-step", stepKind: "curriculum-adjustment", message: "the curriculum citation's 'activeStage'/'stageCount' are non-negative integers (a stage count of at least one) — counts are honest carries" });
  }
  const declaration = step.declaration;
  if (!isRecordLike(declaration) || declaration.action !== "advance-stage") {
    return [...errors, { code: "malformed-step", stepKind: "curriculum-adjustment", message: `the declared adjustment action '${String(isRecordLike(declaration) ? declaration.action : declaration)}' is outside the closed vocabulary — the loop declares 'advance-stage' proposals only (${PROPOSAL_LAW})` }];
  }
  if (!isCount(declaration.toStage, 1)) {
    errors.push({ code: "malformed-step", stepKind: "curriculum-adjustment", message: `the declared 'toStage' '${String(declaration.toStage)}' is not a positive integer — the proposed stage is explicit` });
  }
  return errors;
}

function reSelectionErrors(step: ReSelectionStep): StepError[] {
  const citations = step.citations;
  if (!Array.isArray(citations) || citations.length === 0) {
    return [{ code: "uncited-step", stepKind: "re-selection", message: `the re-selection step cites no pairing plans — every step cites its evidence records (${EVIDENCE_LINKAGE_LAW}); a step without carried evidence is refused loudly` }];
  }
  if (!isRecordLike(step.declaration) || step.declaration.action !== "re-run-selection") {
    return [{ code: "malformed-step", stepKind: "re-selection", message: `the declared re-selection action '${String(isRecordLike(step.declaration) ? step.declaration.action : step.declaration)}' is outside the closed vocabulary — the loop declares 're-run-selection' proposals only (${PROPOSAL_LAW})` }];
  }
  const errors: StepError[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < citations.length; index += 1) {
    const citation = citations[index];
    if (citation === undefined || !isRecordLike(citation)) {
      errors.push({ code: "malformed-step", stepKind: "re-selection", message: `the pairing citation at index ${String(index)} is not typed data — a pairing id, kind and population id are required` });
      continue;
    }
    const pairingId = String(citation.pairingId);
    if (blank(pairingId) || blank(citation.populationId)) {
      errors.push({ code: "blank-citation-member", stepKind: "re-selection", entryId: pairingId, message: "the pairing citation carries a blank 'pairingId'/'populationId' — citations are explicit, never blank" });
      continue;
    }
    if (citation.kind !== "self-play-pairing" && citation.kind !== "adversarial-pairing") {
      errors.push({ code: "malformed-step", stepKind: "re-selection", entryId: pairingId, message: `the pairing citation's kind '${String(citation.kind)}' is outside W046's closed pairing vocabulary — 'self-play-pairing', 'adversarial-pairing' only` });
      continue;
    }
    if (seen.has(pairingId)) {
      errors.push({ code: "duplicate-citation", stepKind: "re-selection", entryId: pairingId, message: `the pairing plan '${pairingId}' is cited twice — citation identity is exact` });
    }
    seen.add(pairingId);
    const previous = citations[index - 1];
    if (previous !== undefined && compareCodeUnits(String(previous.pairingId), pairingId) > 0) {
      errors.push({ code: "non-canonical-order", stepKind: "re-selection", entryId: pairingId, message: `the re-selection step's citations are not in canonical pairing-id order at index ${String(index)} — the sealed cycle's orders are canonical (A9)` });
    }
  }
  return errors;
}

function reCommissioningErrors(step: ReCommissioningStep): StepError[] {
  const skills = step.skillCitations;
  const plans = step.planCitations;
  if ((!Array.isArray(skills) || skills.length === 0) && (!Array.isArray(plans) || plans.length === 0)) {
    return [{ code: "uncited-step", stepKind: "re-commissioning", message: `the re-commissioning step cites neither skill records nor forged plans — every step cites its evidence records (${EVIDENCE_LINKAGE_LAW}); a step without carried evidence is refused loudly` }];
  }
  if (!isRecordLike(step.declaration) || step.declaration.action !== "commission-plans") {
    return [{ code: "malformed-step", stepKind: "re-commissioning", message: `the declared re-commissioning action '${String(isRecordLike(step.declaration) ? step.declaration.action : step.declaration)}' is outside the closed vocabulary — the loop declares 'commission-plans' proposals only (${PROPOSAL_LAW}, ${NEVER_EXECUTES_LAW})` }];
  }
  const errors: StepError[] = [];
  const seenSkills = new Set<string>();
  for (let index = 0; index < (Array.isArray(skills) ? skills.length : 0); index += 1) {
    const citation = skills[index];
    if (citation === undefined || !isRecordLike(citation)) {
      errors.push({ code: "malformed-step", stepKind: "re-commissioning", message: `the skill citation at index ${String(index)} is not typed data — a skill id, capability id and evidence count are required` });
      continue;
    }
    const skillId = String(citation.skillId);
    if (blank(skillId) || blank(citation.capabilityId)) {
      errors.push({ code: "blank-citation-member", stepKind: "re-commissioning", entryId: skillId, message: "the skill citation carries a blank 'skillId'/'capabilityId' — citations are explicit, never blank" });
      continue;
    }
    if (!isCount(citation.evidenceCount, 0)) {
      errors.push({ code: "malformed-step", stepKind: "re-commissioning", entryId: skillId, message: `the skill citation's 'evidenceCount' '${String(citation.evidenceCount)}' is not a non-negative integer — counts are honest carries` });
      continue;
    }
    if (seenSkills.has(skillId)) {
      errors.push({ code: "duplicate-citation", stepKind: "re-commissioning", entryId: skillId, message: `the skill record '${skillId}' is cited twice — citation identity is exact` });
    }
    seenSkills.add(skillId);
    const previous = skills[index - 1];
    if (previous !== undefined && compareCodeUnits(String(previous.skillId), skillId) > 0) {
      errors.push({ code: "non-canonical-order", stepKind: "re-commissioning", entryId: skillId, message: `the re-commissioning step's skill citations are not in canonical skill-id order at index ${String(index)} — the sealed cycle's orders are canonical (A9)` });
    }
  }
  const seenPlans = new Set<string>();
  for (let index = 0; index < (Array.isArray(plans) ? plans.length : 0); index += 1) {
    const citation = plans[index];
    if (citation === undefined || !isRecordLike(citation)) {
      errors.push({ code: "malformed-step", stepKind: "re-commissioning", message: `the forged-plan citation at index ${String(index)} is not typed data — a plan id and an endowment count are required` });
      continue;
    }
    const planId = String(citation.planId);
    if (blank(planId)) {
      errors.push({ code: "blank-citation-member", stepKind: "re-commissioning", entryId: planId, message: "the forged-plan citation carries a blank 'planId' — citations are explicit, never blank" });
      continue;
    }
    if (!isCount(citation.endowmentCount, 0)) {
      errors.push({ code: "malformed-step", stepKind: "re-commissioning", entryId: planId, message: `the forged-plan citation's 'endowmentCount' '${String(citation.endowmentCount)}' is not a non-negative integer — counts are honest carries` });
      continue;
    }
    if (seenPlans.has(planId)) {
      errors.push({ code: "duplicate-citation", stepKind: "re-commissioning", entryId: planId, message: `the forged plan '${planId}' is cited twice — citation identity is exact` });
    }
    seenPlans.add(planId);
    const previous = plans[index - 1];
    if (previous !== undefined && compareCodeUnits(String(previous.planId), planId) > 0) {
      errors.push({ code: "non-canonical-order", stepKind: "re-commissioning", entryId: planId, message: `the re-commissioning step's plan citations are not in canonical plan-id order at index ${String(index)} — the sealed cycle's orders are canonical (A9)` });
    }
  }
  return errors;
}

/** THE PER-STEP EVIDENCE LAWS: every step of the closed vocabulary exactly
 * once (a missing loop step is the loud `missing-step` refusal naming A6),
 * each step's citations present, explicit, unique and canonically ordered.
 * Fail-closed — every violation collected, none silently repaired. */
export function stepEvidenceErrors(steps: readonly ImprovementStep[]): readonly StepError[] {
  if (!Array.isArray(steps)) {
    return [{ code: "malformed-step", message: "the steps are not a list — a cycle composes a list of improvement steps" }];
  }
  const errors: StepError[] = [];
  const byKind = new Map<string, ImprovementStep[]>();
  for (const step of steps) {
    if (!isRecordLike(step) || !IMPROVEMENT_STEP_KINDS.includes(step.kind as ImprovementStepKind)) {
      errors.push({ code: "unknown-step-kind", message: `the step kind '${String(isRecordLike(step) ? step.kind : step)}' is outside the closed vocabulary — the loop composes ${IMPROVEMENT_STEP_KINDS.join(", ")} only` });
      continue;
    }
    const bucket = byKind.get(String(step.kind));
    if (bucket === undefined) {
      byKind.set(String(step.kind), [step as unknown as ImprovementStep]);
    } else {
      bucket.push(step as unknown as ImprovementStep);
    }
  }
  for (const kind of IMPROVEMENT_STEP_KINDS) {
    const bucket = byKind.get(kind);
    if (bucket === undefined) {
      errors.push({ code: "missing-step", stepKind: kind, message: `the '${kind}' step is missing — the improvement loop composes every step of the chain, each citing its evidence (${EVIDENCE_LINKAGE_LAW})` });
      continue;
    }
    if (bucket.length > 1) {
      errors.push({ code: "duplicate-step-kind", stepKind: kind, message: `the '${kind}' step is declared ${String(bucket.length)} times — the loop carries each step kind exactly once` });
      continue;
    }
    const step = bucket[0];
    if (step === undefined) {
      continue;
    }
    switch (kind) {
      case "observe": errors.push(...observationErrors(step as ObserveStep)); break;
      case "post-mortem": errors.push(...postMortemErrors(step as PostMortemStep)); break;
      case "brain-update": errors.push(...brainUpdateErrors(step as BrainUpdateStep)); break;
      case "curriculum-adjustment": errors.push(...curriculumAdjustmentErrors(step as CurriculumAdjustmentStep)); break;
      case "re-selection": errors.push(...reSelectionErrors(step as ReSelectionStep)); break;
      case "re-commissioning": errors.push(...reCommissioningErrors(step as ReCommissioningStep)); break;
    }
  }
  return errors;
}
