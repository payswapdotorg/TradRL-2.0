/**
 * The curriculum law surface (W046) — the shared stage/threshold laws the
 * founding gate composes AND the whole-record re-validation re-proves (the
 * W045 validate.ts precedent): the staged schedule's generation laws (the
 * first stage runs against the founding population's OWN generation, every
 * later stage exactly one generation on — a stage advance is a new
 * generation), the declared difficulty atoms' own laws (non-blank distinct
 * dimensions, finite measured values, every atom citing the W038 evaluation
 * it was measured from — R052: evidence-less atoms refused loudly), the
 * evidence threshold's own laws (the citation non-blank — R052 again — the
 * requirements non-empty, each well-formed over the closed gate vocabulary,
 * the W038 findings verdicts carried), and THE §13 LAW: a threshold that
 * gates on raw P&L alone (a combined-score requirement with no compliance
 * requirement) is a loud typed refusal naming the sole-P&L law. Pure,
 * deterministic, fail-closed — every violation collected.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type {
  Curriculum,
  CurriculumStage,
  DifficultyAtom,
  StageGateRequirement,
} from "./curriculum.js";
import { CURRICULUM_ID_PREFIX } from "./curriculum.js";

// ---------------------------------------------------------------------------
// The typed validation error family (closed set — every law named)
// ---------------------------------------------------------------------------

export interface CurriculumValidationError {
  readonly code: CurriculumValidationErrorCode;
  readonly message: string;
}

export type CurriculumValidationErrorCode =
  | "invalid-kind" // the record is not a curriculum
  | "invalid-scope" // the scope carries a blank member
  | "empty-stages" // no stages at all
  | "canonical-order" // stages or requirements not in canonical order (A9)
  | "stage-generation" // the staged schedule's generation laws
  | "difficulty-invalid" // a declared difficulty atom's own laws
  | "threshold-evidence-less" // R052: an evidence-less stage threshold
  | "requirement-invalid" // one gate requirement's own laws
  | "bare-pnl-gate" // §13: raw P&L alone as the gate
  | "active-stage-invalid" // the active stage index is out of range
  | "lineage-invalid" // the generational lineage's own laws
  | "invalid-provenance" // the deterministic provenance's own laws
  | "identity-mismatch"; // the id is not the content address of the record

export type CurriculumValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly CurriculumValidationError[] };

function violation(code: CurriculumValidationErrorCode, message: string): CurriculumValidationError {
  return { code, message };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The shared canonical orders (A9: input order never leaks)
// ---------------------------------------------------------------------------

/** The canonical stage order: population-generation ascending. */
export function compareStages(left: CurriculumStage, right: CurriculumStage): number {
  return left.populationGeneration - right.populationGeneration;
}

/** The canonical difficulty order: dimension lexicographic. */
export function compareDifficultyAtoms(left: DifficultyAtom, right: DifficultyAtom): number {
  return compareStrings(left.dimension, right.dimension);
}

/** One requirement's canonical sort key: kind, then its payload. */
function requirementKey(requirement: StageGateRequirement): string {
  switch (requirement.kind) {
    case "compliance":
      return "compliance";
    case "hard-violations":
      return `hard-violations:${String(requirement.max)}`;
    case "trajectory-count":
      return `trajectory-count:${String(requirement.min)}`;
    case "combined-score":
      return `combined-score:${String(requirement.min)}`;
    case "integrity":
      return `integrity:${requirement.requirement}`;
    case "finding":
      return `finding:${requirement.claimId}:${requirement.verdict}`;
  }
}

/** The canonical requirement order (deterministic total order over the closed vocabulary). */
export function compareRequirements(left: StageGateRequirement, right: StageGateRequirement): number {
  return compareStrings(requirementKey(left), requirementKey(right));
}

// ---------------------------------------------------------------------------
// The shared stage laws (founding composes them; validation re-proves them)
// ---------------------------------------------------------------------------

/** The declared difficulty atoms' own laws (R052 named on every citation law). */
export function difficultyLawErrors(stage: CurriculumStage): CurriculumValidationError[] {
  const errors: CurriculumValidationError[] = [];
  if (stage.difficulty.length === 0) {
    errors.push(violation("difficulty-invalid", "a stage declares no difficulty atom — difficulty is DATA derived from measured evidence, never blank"));
  }
  const dimensions = new Set<string>();
  for (const atom of stage.difficulty) {
    if (!nonBlank(atom.dimension)) {
      errors.push(violation("difficulty-invalid", "a difficulty atom carries a blank dimension — difficulty dimensions are explicit"));
    }
    if (dimensions.has(atom.dimension)) {
      errors.push(violation("difficulty-invalid", `difficulty dimension '${atom.dimension}' is declared twice in one stage — one dimension, one atom`));
    }
    dimensions.add(atom.dimension);
    if (!isFiniteNumber(atom.value)) {
      errors.push(violation("difficulty-invalid", `difficulty atom '${atom.dimension}' carries a non-finite measured value — measured DATA, never NaN`));
    }
    if (!nonBlank(atom.measuredFrom.evaluationId)) {
      errors.push(violation("threshold-evidence-less", `difficulty atom '${atom.dimension}' cites no W038 experiment evaluation — difficulty is derived from MEASURED evidence (R052: no evidence-free measurement), never hand-tuned numbers`));
    }
  }
  return errors;
}

/** One gate requirement's own shape laws. */
export function requirementLawErrors(requirement: StageGateRequirement): CurriculumValidationError[] {
  const errors: CurriculumValidationError[] = [];
  switch (requirement.kind) {
    case "compliance":
      return errors;
    case "hard-violations":
      if (!isFiniteNumber(requirement.max) || requirement.max < 0) {
        errors.push(violation("requirement-invalid", "a hard-violations requirement carries a negative or non-finite max — hard violations are counted, never priced (§13)"));
      }
      return errors;
    case "trajectory-count":
      if (!isFiniteNumber(requirement.min) || requirement.min < 1) {
        errors.push(violation("requirement-invalid", "a trajectory-count requirement carries a min below one — a gate over zero evidence gates nothing"));
      }
      return errors;
    case "combined-score":
      if (!isFiniteNumber(requirement.min)) {
        errors.push(violation("requirement-invalid", "a combined-score requirement carries a non-finite min — carried DATA, never NaN"));
      }
      return errors;
    case "integrity":
      if (!nonBlank(requirement.requirement)) {
        errors.push(violation("requirement-invalid", "an integrity requirement carries a blank kind — the W038 integrity vocabulary is explicit"));
      }
      return errors;
    case "finding":
      if (!nonBlank(requirement.claimId)) {
        errors.push(violation("requirement-invalid", "a finding requirement carries a blank claim id — W038 claims are declared, never blank"));
      }
      if (requirement.verdict !== "PASS" && requirement.verdict !== "FAIL" && requirement.verdict !== "PARTIAL") {
        errors.push(violation("requirement-invalid", `a finding requirement carries verdict '${String(requirement.verdict)}' outside the W038 closed verdict set (PASS, FAIL, PARTIAL)`));
      }
      return errors;
  }
}

/** THE §13 LAW: a threshold that gates on raw P&L alone is refused loudly. */
export function barePnlGateError(requirements: readonly StageGateRequirement[]): CurriculumValidationError | null {
  const hasScore = requirements.some((requirement) => requirement.kind === "combined-score");
  const hasCompliance = requirements.some((requirement) => requirement.kind === "compliance");
  if (!hasScore || hasCompliance) {
    return null;
  }
  return violation(
    "bare-pnl-gate",
    "the stage threshold gates on the combined-score dimension alone (no compliance requirement) — 'Raw P&L is never the sole objective' (§13: constraint-aware progression; R054: a curriculum is never a P&L chaser): the constraint dimension is carried from the W038 evaluation or nothing gates",
  );
}

/** The evidence threshold's own laws (R052 + §13 + the requirement shapes). */
export function thresholdLawErrors(stage: CurriculumStage): CurriculumValidationError[] {
  const errors: CurriculumValidationError[] = [];
  if (!nonBlank(stage.threshold.citation.evaluationId)) {
    errors.push(violation("threshold-evidence-less", "the stage threshold cites no W038 experiment evaluation — an evidence-less threshold is refused loudly (R052: no evidence-free measurement; the threshold is CARRIED from W038 evaluations, never invented)"));
  }
  if (stage.threshold.requirements.length === 0) {
    errors.push(violation("requirement-invalid", "the stage threshold declares no requirements — a gate over nothing gates nothing"));
  }
  for (const requirement of stage.threshold.requirements) {
    errors.push(...requirementLawErrors(requirement));
  }
  const duplicateKeys = stage.threshold.requirements.filter((requirement, index) =>
    stage.threshold.requirements.findIndex((other) => requirementKey(other) === requirementKey(requirement)) !== index);
  if (duplicateKeys.length > 0) {
    errors.push(violation("requirement-invalid", "the stage threshold declares the same requirement twice — one dimension, one requirement (the canonical set never repeats)"));
  }
  const barePnl = barePnlGateError(stage.threshold.requirements);
  if (barePnl !== null) {
    errors.push(barePnl);
  }
  return errors;
}

/** The staged schedule's generation laws (a stage advance is a new generation). */
export function scheduleLawErrors(stages: readonly CurriculumStage[], foundingGeneration: number): CurriculumValidationError[] {
  const errors: CurriculumValidationError[] = [];
  if (stages.length === 0) {
    return [violation("empty-stages", "a curriculum of zero stages is refused — a curriculum composes at least one staged schedule")];
  }
  if (stages[0]!.populationGeneration !== foundingGeneration) {
    errors.push(violation("stage-generation", `the first stage runs against population generation ${String(stages[0]!.populationGeneration)} but the founding population is generation ${String(foundingGeneration)} — the curriculum begins at the population's OWN generation`));
  }
  for (let index = 1; index < stages.length; index += 1) {
    const previous = stages[index - 1]!.populationGeneration;
    const current = stages[index]!.populationGeneration;
    if (current === previous) {
      errors.push(violation("stage-generation", `two stages run against population generation ${String(current)} — one generation, one stage`));
    } else if (current !== previous + 1) {
      errors.push(violation("stage-generation", `stage ${String(index)} runs against population generation ${String(current)} but the previous stage runs against ${String(previous)} — every stage advance is EXACTLY one new population generation`));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The whole-record re-validation
// ---------------------------------------------------------------------------

/**
 * Re-prove a sealed curriculum from its own recorded data (the W045
 * `validatePopulation` precedent). The population's own re-proof needs the
 * population record, so it runs at FOUNDING (where the population is given);
 * everything else is re-provable from the record alone and is re-proved
 * here. The lineage cross-laws tie the advance origin to the active stage
 * (a rewritten lineage that disagrees with the schedule is refused).
 */
export function validateCurriculum(curriculum: Curriculum): CurriculumValidationOutcome {
  const errors: CurriculumValidationError[] = [];
  if (curriculum.kind !== "curriculum") {
    return { ok: false, errors: [violation("invalid-kind", "the record is not a curriculum — kind is explicit, never inferred")] };
  }
  if (!nonBlank(curriculum.scope.tenantId) || !nonBlank(curriculum.scope.projectId) || !nonBlank(curriculum.scope.worldId)) {
    errors.push(violation("invalid-scope", "the curriculum scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  if (!nonBlank(String(curriculum.populationId))) {
    errors.push(violation("invalid-scope", "the curriculum cites a blank founding population id — the population reference is content-addressed, never blank"));
  }
  const stages = [...curriculum.stages];
  if (stages.length === 0) {
    return { ok: false, errors: [violation("empty-stages", "the curriculum carries no stages — a curriculum composes at least one staged schedule")] };
  }
  if (stages.some((stage, index) => stages.findIndex((other) => other.populationGeneration === stage.populationGeneration) !== index)) {
    errors.push(violation("canonical-order", "two stages share a population generation — the canonical schedule never repeats"));
  }
  const sorted = [...stages].sort(compareStages);
  if (stages.map((stage) => stage.populationGeneration).join(",") !== sorted.map((stage) => stage.populationGeneration).join(",")) {
    errors.push(violation("canonical-order", "the stages are not in canonical population-generation order (A9: input order never leaks)"));
  }
  errors.push(...scheduleLawErrors(stages, curriculum.foundingGeneration));
  for (const stage of stages) {
    errors.push(...difficultyLawErrors(stage));
    errors.push(...thresholdLawErrors(stage));
    const requirements = [...stage.threshold.requirements];
    const requirementSorted = [...requirements].sort(compareRequirements);
    if (requirements.map(requirementKey).join("|") !== requirementSorted.map(requirementKey).join("|")) {
      errors.push(violation("canonical-order", `the stage ${String(stage.populationGeneration)} threshold requirements are not in canonical order (A9: input order never leaks)`));
    }
    const atoms = [...stage.difficulty];
    const atomSorted = [...atoms].sort(compareDifficultyAtoms);
    if (atoms.map((atom) => atom.dimension).join(",") !== atomSorted.map((atom) => atom.dimension).join(",")) {
      errors.push(violation("canonical-order", `the stage ${String(stage.populationGeneration)} difficulty atoms are not in canonical dimension order (A9)`));
    }
  }
  if (!Number.isInteger(curriculum.activeStage) || curriculum.activeStage < 0 || curriculum.activeStage >= stages.length) {
    errors.push(violation("active-stage-invalid", `the active stage index ${String(curriculum.activeStage)} is outside the schedule (0..${String(stages.length - 1)}) — the active stage is explicit and always a REAL stage`));
  }
  const lineage = curriculum.lineage;
  const isFounding = lineage.origin.kind === "founding";
  if (isFounding && (lineage.parentCurriculumId !== null || lineage.generation !== 0)) {
    errors.push(violation("lineage-invalid", "a founding curriculum carries a parent or a non-zero generation — founding is generation 0 with no parent"));
  }
  if (!isFounding && (lineage.parentCurriculumId === null || lineage.generation < 1)) {
    errors.push(violation("lineage-invalid", "an advanced curriculum cites no parent or carries a non-positive generation — every stage advance extends a parent generation"));
  }
  if (!isFounding && !nonBlank(String(lineage.parentCurriculumId ?? ""))) {
    errors.push(violation("lineage-invalid", "an advanced curriculum cites a blank parent id — the lineage is content-addressed, never blank"));
  }
  if (lineage.origin.kind === "stage-advance") {
    const origin = lineage.origin;
    if (origin.toStage !== origin.fromStage + 1) {
      errors.push(violation("lineage-invalid", `a stage-advance origin unseals stage ${String(origin.toStage)} from stage ${String(origin.fromStage)} — an advance unseals exactly the NEXT stage`));
    }
    if (origin.fromStage < 0) {
      errors.push(violation("lineage-invalid", "a stage-advance origin names a negative stage — stages are indexed from zero"));
    }
    if (curriculum.activeStage !== origin.toStage) {
      errors.push(violation("lineage-invalid", `the lineage unsealed stage ${String(origin.toStage)} but the active stage is ${String(curriculum.activeStage)} — the lineage and the schedule cannot disagree (immutability is the whole point)`));
    }
  }
  if (!isFiniteNumber(curriculum.provenance.foundedAt)) {
    errors.push(violation("invalid-provenance", "the founding time is not a finite declared number — deterministic DATA, never a clock read (A9)"));
  }
  const digest = curriculum.provenance.gateEvidenceDigest;
  if (isFounding && digest !== null) {
    errors.push(violation("invalid-provenance", "a founding curriculum records gate evidence — founding gates nothing"));
  }
  if (!isFounding && !nonBlank(String(digest ?? ""))) {
    errors.push(violation("invalid-provenance", "an advanced curriculum records no gate-evidence digest — every unsealing gate ran against carried evidence"));
  }
  const expected = `${CURRICULUM_ID_PREFIX}${stableDigest({
    kind: "curriculum",
    scope: { tenantId: curriculum.scope.tenantId, projectId: curriculum.scope.projectId, worldId: curriculum.scope.worldId },
    populationId: String(curriculum.populationId),
    foundingGeneration: curriculum.foundingGeneration,
    stages: curriculum.stages,
    activeStage: curriculum.activeStage,
    lineage: curriculum.lineage,
  })}`;
  if (expected !== String(curriculum.curriculumId)) {
    errors.push(violation("identity-mismatch", `the curriculum id is not the content address of the recorded schedule (expected ${expected.slice(0, 20)}…, recorded ${String(curriculum.curriculumId).slice(0, 20)}…)`));
  }
  return errors.length === 0
    ? { ok: true, checked: ["identity", "scope", "stages", "difficulty", "threshold", "active-stage", "lineage", "provenance"] }
    : { ok: false, errors };
}
