/**
 * The curriculum record + founding gate (W046) — THE CURRICULUM: the staged
 * population schedule as typed DATA. A curriculum composes ONE proven W045
 * population with declared stages — each stage pairing the population
 * generation it runs against with declared difficulty atoms (DATA derived
 * from measured evidence, every atom citing the W038 experiment evaluation
 * it was measured from — never hand-tuned numbers) and an evidence
 * threshold CARRIED from W038 evaluations + findings (carry never
 * re-scores). Founding re-proves the population through W045's own
 * whole-record validator (errors carried verbatim), proves the schedule's
 * generation laws (the first stage runs against the population's OWN
 * generation; every stage advance is exactly one new generation), proves
 * every stage's difficulty/threshold laws (R052 evidence-less refusals; the
 * §13 sole-P&L refusal), canonicalizes everything (A9: input order never
 * leaks), and seals the content-addressed curr-<digest> record: the staged
 * schedule, the explicit scope, the immutable lineage (genesis here;
 * ./progression.ts extends it, never rewriting it), and deterministic
 * provenance (A9: no clocks — the founding time is the population's own
 * sealedAt, carried DATA).
 *
 * A14: a curriculum COMPOSES typed plans — it never executes, never trains,
 * never steps a world. R054: method-neutral — no RL specifics (W047/W048
 * own the methods), no episode generation (W048).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { OpaqueId } from "skills";
import { validatePopulation } from "populations";
import type { Population, PopulationId, PopulationValidationError } from "populations";
import type { Verdict } from "verification";
import { compareDifficultyAtoms, compareRequirements, compareStages } from "./validate.js";
import { difficultyLawErrors, scheduleLawErrors, thresholdLawErrors } from "./validate.js";

/** The identity of one curriculum (opaque; digest-derived). */
export type CurriculumId = OpaqueId<"CurriculumId">;

/** The curriculum id prefix (the W016 family convention). */
export const CURRICULUM_ID_PREFIX = "curr-";

/** The explicit single-world scope a curriculum lives in (the population's own). */
export interface CurriculumScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * The evidence citation: the W038 experiment evaluation a measurement or
 * threshold is carried from (R052 — no evidence-free measurement; the id is
 * the walker's own opaque content address, never parsed here).
 */
export interface EvidenceCitation {
  readonly evaluationId: string;
}

/**
 * One declared difficulty atom: a named difficulty dimension, its MEASURED
 * value, and the W038 evaluation the value was measured from. Difficulty is
 * DATA derived from measured evidence — never a hand-tuned number.
 */
export interface DifficultyAtom {
  readonly dimension: string;
  readonly value: number;
  readonly measuredFrom: EvidenceCitation;
}

/**
 * One declared gate requirement over the CARRIED W038 evaluation data — the
 * closed vocabulary: the constraint-aware compliance dimension (§13 — the
 * carried reduction must be compliant), the hard-violation ceiling (hard
 * violations are counted, never priced), the trajectory-count floor, the
 * combined-score floor (the P&L-ish dimension — NEVER sole: a threshold
 * that gates on it alone is the loud §13 refusal), a carried W038 integrity
 * requirement, and a carried W038 verification finding verdict.
 */
export type StageGateRequirement =
  | { readonly kind: "compliance" }
  | { readonly kind: "hard-violations"; readonly max: number }
  | { readonly kind: "trajectory-count"; readonly min: number }
  | { readonly kind: "combined-score"; readonly min: number }
  | { readonly kind: "integrity"; readonly requirement: string }
  | { readonly kind: "finding"; readonly claimId: string; readonly verdict: Verdict };

/**
 * The stage's evidence threshold — CARRIED from W038: the citation naming
 * the experiment evaluation the threshold is grounded in (R052), plus the
 * declared requirements proven against that evaluation's CARRIED summaries
 * at the progression gate (./progression.ts — never re-scored here).
 */
export interface EvidenceThreshold {
  readonly citation: EvidenceCitation;
  readonly requirements: readonly StageGateRequirement[];
}

/** One staged schedule entry (as declared; founding canonicalizes it). */
export interface StageDeclaration {
  readonly populationGeneration: number;
  readonly difficulty: readonly DifficultyAtom[];
  readonly threshold: EvidenceThreshold;
}

/** One sealed stage of the schedule: the canonical declaration, frozen. */
export interface CurriculumStage {
  readonly populationGeneration: number;
  readonly difficulty: readonly DifficultyAtom[];
  readonly threshold: EvidenceThreshold;
}

/** How one curriculum generation came to be: founding, or one stage advance. */
export type CurriculumOrigin =
  | { readonly kind: "founding" }
  | { readonly kind: "stage-advance"; readonly fromStage: number; readonly toStage: number };

/**
 * The immutable generational lineage: the parent curriculum (null iff
 * founding), the generation number (0 for founding, +1 per unsealed stage),
 * and the origin of THIS generation. Immutable means progression never
 * edits a lineage — every advance seals a NEW record citing its parent.
 */
export interface CurriculumLineage {
  readonly parentCurriculumId: CurriculumId | null;
  readonly generation: number;
  readonly origin: CurriculumOrigin;
}

/**
 * The curriculum provenance — deterministic DATA, never a clock read (A9):
 * the founding time (the founding population's own sealedAt, carried), and
 * the digest over the gate-passing evidence (null iff the founding
 * generation — founding gates nothing).
 */
export interface CurriculumProvenance {
  readonly foundedAt: number;
  readonly gateEvidenceDigest: string | null;
}

/** The Curriculum record: typed DATA (A14). */
export interface Curriculum {
  readonly curriculumId: CurriculumId;
  readonly kind: "curriculum";
  readonly scope: CurriculumScope;
  /** The founding population this curriculum stages (carried reference). */
  readonly populationId: PopulationId;
  /** The founding population's own lineage.generation (stage 0 runs against it). */
  readonly foundingGeneration: number;
  /** The staged schedule, canonical population-generation order. */
  readonly stages: readonly CurriculumStage[];
  /** The index of the ACTIVE stage (0 at founding; progression unseals +1). */
  readonly activeStage: number;
  readonly lineage: CurriculumLineage;
  readonly provenance: CurriculumProvenance;
}

// ---------------------------------------------------------------------------
// The typed founding error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type CurriculumErrorCode =
  | "invalid-population" // W045's own validator refused the population (carried verbatim)
  | "empty-stages" // no stages declared
  | "stage-generation" // the staged schedule's generation laws
  | "difficulty-invalid" // a declared difficulty atom's own laws
  | "threshold-evidence-less" // R052: an evidence-less stage threshold
  | "requirement-invalid" // one gate requirement's own laws
  | "bare-pnl-gate"; // §13: raw P&L alone as the gate

export interface CurriculumError {
  readonly code: CurriculumErrorCode;
  readonly message: string;
  readonly stageIndex?: number;
  /** Present on `invalid-population`: W045's own validation errors, verbatim. */
  readonly populationErrors?: readonly PopulationValidationError[];
}

export type CurriculumOutcome =
  | { readonly ok: true; readonly curriculum: Curriculum }
  | { readonly ok: false; readonly errors: readonly CurriculumError[] };

function error(code: CurriculumErrorCode, message: string, extras: Omit<CurriculumError, "code" | "message"> = {}): CurriculumError {
  return { code, message, ...extras };
}

// ---------------------------------------------------------------------------
// The content-addressed identity + the seal
// ---------------------------------------------------------------------------

/** The content address of one curriculum generation (A9). */
export function curriculumIdOf(
  scope: CurriculumScope,
  populationId: PopulationId,
  foundingGeneration: number,
  stages: readonly CurriculumStage[],
  activeStage: number,
  lineage: CurriculumLineage,
): CurriculumId {
  return `${CURRICULUM_ID_PREFIX}${stableDigest({
    kind: "curriculum",
    scope: { tenantId: scope.tenantId, projectId: scope.projectId, worldId: scope.worldId },
    populationId: String(populationId),
    foundingGeneration,
    stages,
    activeStage,
    lineage,
  })}` as CurriculumId;
}

/** Deep-freeze the sealed record (the W043/W044/W045 precedent). */
export function freezeCurriculum(value: unknown): void {
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeCurriculum(child);
    }
  }
}

/**
 * Canonicalize one declared stage (A9: input order never leaks): difficulty
 * atoms into canonical dimension order, threshold requirements into the
 * canonical requirement order.
 */
export function canonicalStage(stage: StageDeclaration): CurriculumStage {
  return {
    populationGeneration: stage.populationGeneration,
    difficulty: [...stage.difficulty].sort(compareDifficultyAtoms),
    threshold: {
      citation: { evaluationId: stage.threshold.citation.evaluationId },
      requirements: [...stage.threshold.requirements].sort(compareRequirements),
    },
  };
}

/**
 * Seal one curriculum generation (the shared seam founding and progression
 * compose): canonical stages + lineage + provenance ⇒ the frozen record.
 */
export function sealCurriculum(input: {
  readonly scope: CurriculumScope;
  readonly populationId: PopulationId;
  readonly foundingGeneration: number;
  readonly stages: readonly CurriculumStage[];
  readonly activeStage: number;
  readonly lineage: CurriculumLineage;
  readonly foundedAt: number;
  readonly gateEvidenceDigest: string | null;
}): Curriculum {
  const curriculum: Curriculum = {
    curriculumId: curriculumIdOf(input.scope, input.populationId, input.foundingGeneration, input.stages, input.activeStage, input.lineage),
    kind: "curriculum",
    scope: input.scope,
    populationId: input.populationId,
    foundingGeneration: input.foundingGeneration,
    stages: [...input.stages].sort(compareStages),
    activeStage: input.activeStage,
    lineage: input.lineage,
    provenance: {
      foundedAt: input.foundedAt,
      gateEvidenceDigest: input.gateEvidenceDigest,
    },
  };
  freezeCurriculum(curriculum);
  return curriculum;
}

// ---------------------------------------------------------------------------
// THE FOUNDING GATE
// ---------------------------------------------------------------------------

/**
 * THE FOUNDING GATE: `foundCurriculum(population, stages)` — compose one
 * proven W045 population with the declared staged schedule and seal the
 * founding curriculum generation. Deterministic (A9): same population +
 * same stages ⇒ deep-equal curriculum, same canonical id — input order
 * never matters.
 */
export function foundCurriculum(
  population: Population,
  stages: readonly StageDeclaration[],
): CurriculumOutcome {
  const errors: CurriculumError[] = [];
  const populationProof = validatePopulation(population);
  if (!populationProof.ok) {
    errors.push(error(
      "invalid-population",
      `population '${String(population.populationId)}' failed W045's own whole-record re-validation (${String(populationProof.errors.length)} error(s), carried verbatim) — a curriculum is staged only over a proven population`,
      { populationErrors: populationProof.errors },
    ));
  }
  if (stages.length === 0) {
    errors.push(error("empty-stages", "a curriculum of zero stages is refused — a curriculum composes at least one staged schedule"));
    return { ok: false, errors };
  }
  const canonical = stages.map(canonicalStage);
  const ordered = [...canonical].sort(compareStages);
  const scheduleErrors = scheduleLawErrors(ordered, population.lineage.generation);
  for (const violation of scheduleErrors) {
    errors.push(error(violation.code as CurriculumErrorCode, violation.message));
  }
  ordered.forEach((stage, index) => {
    for (const violation of [...difficultyLawErrors(stage), ...thresholdLawErrors(stage)]) {
      errors.push(error(violation.code as CurriculumErrorCode, violation.message, { stageIndex: index }));
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const scope: CurriculumScope = {
    tenantId: String(population.scope.tenantId),
    projectId: String(population.scope.projectId),
    worldId: String(population.scope.worldId),
  };
  const curriculum = sealCurriculum({
    scope,
    populationId: population.populationId,
    foundingGeneration: population.lineage.generation,
    stages: ordered,
    activeStage: 0,
    lineage: { parentCurriculumId: null, generation: 0, origin: { kind: "founding" } },
    foundedAt: population.provenance.sealedAt,
    gateEvidenceDigest: null,
  });
  return { ok: true, curriculum };
}
