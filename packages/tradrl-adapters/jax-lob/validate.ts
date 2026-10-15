/**
 * Whole-adapter-record re-validation (W049) — re-proving a sealed LOB
 * training projection or environment declaration set from its own
 * recorded data alone (the W044 `validateAgentBinding` / W047
 * `validateEpisode` / W048 `validateGenerationPlan` precedents): the
 * content-addressed identity re-derivations (mapping ids, environment
 * ids), the venue vocabulary laws re-proven on the recorded shape (its
 * errors carried verbatim), the canonical training-step sequence
 * re-derivation, the canonical episode-id order, the episode-projection
 * coverage laws, and the canonical shard order of the environment
 * declarations. Pure, deterministic, fail-closed — every violation
 * collected, every law named. Never a re-score, never a re-projection:
 * the RECORD is re-proven against its own content addresses (A9/A13).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalString } from "trajectory";
import { stepShapeViolations } from "./lob-vocabulary.js";
import type { LobVocabularyError } from "./lob-vocabulary.js";
import { canonicalTrainingSteps, lobBatchTrainingMappingIdOf, lobTrainingMappingIdOf } from "./lob-trainer.js";
import type { LobBatchTrainingProjection, LobEpisodeTrainingProjection } from "./lob-trainer.js";
import { lobEnvironmentIdOf, lobGenerationMappingIdOf } from "./lob-generation.js";
import type { LobEnvironmentDeclaration, LobEnvironmentDeclarations } from "./lob-generation.js";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type LobAdapterValidationErrorCode =
  | "identity-mismatch" // a mapping/environment id is not the content address of the recorded data
  | "invalid-step-shape" // the venue vocabulary refused the recorded shape (carried verbatim)
  | "invalid-step-count" // the recorded step count is not a positive integer
  | "step-sequence-mismatch" // the training steps are not the canonical re-derivation
  | "blank-citation" // an opaque citation is blank
  | "invalid-declaration" // a recorded declaration field drifted from its own laws
  | "non-canonical-episode-order" // the episode ids are not in canonical order
  | "duplicate-episode-id" // one episode id joins the record twice
  | "count-mismatch" // a recorded count disagrees with the record
  | "episode-projection-mismatch" // the episode projections do not cover the batch exactly
  | "shard-order" // the environments are not in canonical shard order
  | "unit-count-mismatch"; // the environments are not the declared unit count

/** One typed whole-record validation error (fail-closed). */
export interface LobAdapterValidationError {
  readonly code: LobAdapterValidationErrorCode;
  readonly message: string;
  /** Present on `invalid-step-shape`: the venue vocabulary's own errors, verbatim. */
  readonly vocabularyErrors?: readonly LobVocabularyError[];
}

export type LobValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly LobAdapterValidationError[] };

function violation(
  code: LobAdapterValidationErrorCode,
  message: string,
  vocabularyErrors?: readonly LobVocabularyError[],
): LobAdapterValidationError {
  return vocabularyErrors === undefined ? { code, message } : { code, message, vocabularyErrors };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// The episode-level training projection re-validation
// ---------------------------------------------------------------------------

/**
 * Re-prove one sealed episode-level projection from its own recorded
 * data: the kind law, the non-blank episode citation, the positive step
 * count, the recorded shape re-proven through the venue vocabulary (its
 * errors carried verbatim), the training steps as the CANONICAL
 * re-derivation of (stepCount, shape), and the mapping id as the content
 * address of (episode id, shape).
 */
export function validateLobEpisodeTrainingProjection(
  projection: LobEpisodeTrainingProjection,
): LobValidationOutcome {
  const errors: LobAdapterValidationError[] = [];

  if (projection.kind !== "lob-episode-training-projection") {
    errors.push(violation("invalid-declaration", "the record is not an episode-level training projection — kinds are closed-set data (fail-closed)"));
  }
  if (!nonBlank(String(projection.episodeId))) {
    errors.push(violation("blank-citation", "the projection cites a blank episode id — citations are opaque ids, never blank"));
  }
  if (!Number.isInteger(projection.stepCount) || projection.stepCount < 1) {
    errors.push(violation("invalid-step-count", `the projection records '${String(projection.stepCount)}' carried steps — a carried episode has at least one step`));
  }

  const vocabularyErrors = stepShapeViolations(projection.shape);
  if (vocabularyErrors.length > 0) {
    errors.push(violation("invalid-step-shape", `the recorded shape violates the venue vocabulary (${String(vocabularyErrors.length)} error(s), carried verbatim)`, vocabularyErrors));
  }

  const expectedSteps = canonicalTrainingSteps(
    Number.isInteger(projection.stepCount) && projection.stepCount > 0 ? projection.stepCount : 0,
    projection.shape,
  );
  if (canonicalString([...projection.trainingSteps]) !== canonicalString([...expectedSteps])) {
    errors.push(violation("step-sequence-mismatch", "the recorded training steps are not the canonical re-derivation of (step count, shape) — the step sequence is deterministic data (A9), never free drift"));
  }

  if (nonBlank(String(projection.episodeId))) {
    const expectedId = lobTrainingMappingIdOf({ episodeId: projection.episodeId, shape: projection.shape });
    if (String(expectedId) !== String(projection.mappingId)) {
      errors.push(violation("identity-mismatch", "the mapping id is not the canonical content address of (episode id, shape) — identity is a function of recorded bytes (A9)"));
    }
  }

  return errors.length === 0
    ? { ok: true, checked: ["kind", "citation", "step-count", "shape", "step-sequence", "identity"] }
    : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The batch-level training projection re-validation
// ---------------------------------------------------------------------------

/**
 * Re-prove one sealed batch-level projection from its own recorded data:
 * the kind law, the non-blank batch citation, the episode ids in
 * CANONICAL order with no duplicates, the count agreements (ids ⇔ count
 * ⇔ projections), every episode projection re-proven through its own
 * whole-record validator and covering exactly the batch's ids, the
 * recorded shape re-proven, and the mapping id as the content address of
 * (batch id, shape).
 */
export function validateLobBatchTrainingProjection(
  projection: LobBatchTrainingProjection,
): LobValidationOutcome {
  const errors: LobAdapterValidationError[] = [];

  if (projection.kind !== "lob-batch-training-projection") {
    errors.push(violation("invalid-declaration", "the record is not a batch-level training projection — kinds are closed-set data (fail-closed)"));
  }
  if (!nonBlank(String(projection.batchId))) {
    errors.push(violation("blank-citation", "the projection cites a blank batch id — citations are opaque ids, never blank"));
  }

  const ids = projection.episodeIds.map(String);
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      errors.push(violation("duplicate-episode-id", `the episode '${id}' joins the projection twice — one episode, one membership`));
    }
    seen.add(id);
    const previous = index > 0 ? ids[index - 1]! : undefined;
    if (previous !== undefined && id <= previous) {
      errors.push(violation("non-canonical-episode-order", `the projection's episode ids are not in canonical order ('${id}' at index ${String(index)} follows '${previous}') — input order never leaks (A9)`));
    }
  });

  if (projection.episodeCount !== ids.length) {
    errors.push(violation("count-mismatch", `the projection declares ${String(projection.episodeCount)} episode(s) but cites ${String(ids.length)} id(s) — the count summarizes the ids, never invents them`));
  }
  if (projection.episodeProjections.length !== ids.length) {
    errors.push(violation("count-mismatch", `the projection carries ${String(projection.episodeProjections.length)} episode projection(s) but cites ${String(ids.length)} episode id(s) — one projection per cited episode, exactly`));
  }

  const vocabularyErrors = stepShapeViolations(projection.shape);
  if (vocabularyErrors.length > 0) {
    errors.push(violation("invalid-step-shape", `the recorded shape violates the venue vocabulary (${String(vocabularyErrors.length)} error(s), carried verbatim)`, vocabularyErrors));
  }

  projection.episodeProjections.forEach((episodeProjection, index) => {
    const nested = validateLobEpisodeTrainingProjection(episodeProjection);
    if (!nested.ok) {
      errors.push(violation("episode-projection-mismatch", `the episode projection at position ${String(index)} failed its own whole-record re-validation (${nested.errors.map((entry) => entry.code).join(", ")}) — carried data re-proven, never trusted`));
    }
    const cited = index < ids.length ? ids[index]! : undefined;
    if (cited !== undefined && String(episodeProjection.episodeId) !== cited) {
      errors.push(violation("episode-projection-mismatch", `the episode projection at position ${String(index)} cites '${String(episodeProjection.episodeId)}' but the batch cites '${cited}' — the projections cover the batch's ids exactly, in order`));
    }
    if (canonicalString(episodeProjection.shape) !== canonicalString(projection.shape)) {
      errors.push(violation("episode-projection-mismatch", `the episode projection at position ${String(index)} carries a different shape than the batch projection — one batch projection, one declared step shape`));
    }
  });

  if (nonBlank(String(projection.batchId))) {
    const expectedId = lobBatchTrainingMappingIdOf({ batchId: projection.batchId, shape: projection.shape });
    if (String(expectedId) !== String(projection.mappingId)) {
      errors.push(violation("identity-mismatch", "the mapping id is not the canonical content address of (batch id, shape) — identity is a function of recorded bytes (A9)"));
    }
  }

  return errors.length === 0
    ? { ok: true, checked: ["kind", "citation", "episode-order", "counts", "shape", "episode-projections", "identity"] }
    : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The environment declarations re-validation
// ---------------------------------------------------------------------------

function environmentViolations(
  environment: LobEnvironmentDeclaration,
  declarations: LobEnvironmentDeclarations,
  index: number,
): LobAdapterValidationError[] {
  const errors: LobAdapterValidationError[] = [];
  if (environment.kind !== "lob-environment") {
    errors.push(violation("invalid-declaration", `the environment at position ${String(index)} is not a lob-environment — kinds are closed-set data (fail-closed)`));
  }
  if (!nonBlank(String(environment.unitId))) {
    errors.push(violation("blank-citation", `the environment at position ${String(index)} cites a blank unit id — citations are opaque ids, never blank`));
  }
  if (String(environment.planId) !== String(declarations.planId)) {
    errors.push(violation("invalid-declaration", `the environment at position ${String(index)} cites plan '${String(environment.planId)}' but the declarations cite '${String(declarations.planId)}' — one plan, one projection (fail-closed)`));
  }
  if (!Number.isInteger(environment.memberCount) || environment.memberCount < 1) {
    errors.push(violation("invalid-declaration", `the environment at position ${String(index)} records '${String(environment.memberCount)}' member(s) — a work unit's population slice is never empty (W048's no-empty-slice law)`));
  }
  if (!Number.isInteger(environment.declaredEpisodeCount) || environment.declaredEpisodeCount < 1) {
    errors.push(violation("invalid-declaration", `the environment at position ${String(index)} records '${String(environment.declaredEpisodeCount)}' declared episode(s) — the declared output volume is positive plan data (A9)`));
  }
  if (canonicalString(environment.shape) !== canonicalString(declarations.shape)) {
    errors.push(violation("invalid-declaration", `the environment at position ${String(index)} carries a different shape than the declarations — one projection, one declared step shape`));
  }
  if (nonBlank(String(environment.unitId))) {
    const expectedId = lobEnvironmentIdOf({ unitId: environment.unitId, shape: environment.shape });
    if (String(expectedId) !== String(environment.environmentId)) {
      errors.push(violation("identity-mismatch", `the environment id at position ${String(index)} is not the canonical content address of (unit id, shape) — identity is a function of recorded bytes (A9)`));
    }
  }
  return errors;
}

/**
 * Re-prove one sealed environment-declaration set from its own recorded
 * data: the kind law, the non-blank plan citation, the positive unit
 * count, the environments in CANONICAL SHARD ORDER (shard index i at
 * position i, exactly the declared count), every environment's own laws
 * (citations, carried counts, shape agreement, identity re-derivation),
 * the recorded shape re-proven through the venue vocabulary, and the
 * mapping id as the content address of (plan id, shape).
 */
export function validateLobEnvironmentDeclarations(
  declarations: LobEnvironmentDeclarations,
): LobValidationOutcome {
  const errors: LobAdapterValidationError[] = [];

  if (declarations.kind !== "lob-environment-declarations") {
    errors.push(violation("invalid-declaration", "the record is not an environment-declaration set — kinds are closed-set data (fail-closed)"));
  }
  if (!nonBlank(String(declarations.planId))) {
    errors.push(violation("blank-citation", "the declarations cite a blank plan id — citations are opaque ids, never blank"));
  }
  if (!Number.isInteger(declarations.unitCount) || declarations.unitCount < 1) {
    errors.push(violation("unit-count-mismatch", `the declarations record '${String(declarations.unitCount)}' unit(s) — a projection covers at least one work unit`));
  }

  const environments = Array.isArray(declarations.environments) ? declarations.environments : [];
  if (environments.length !== declarations.unitCount) {
    errors.push(violation("unit-count-mismatch", `the declarations record ${String(declarations.unitCount)} unit(s) but carry ${String(environments.length)} environment(s) — one environment per work unit, exactly`));
  }

  const vocabularyErrors = stepShapeViolations(declarations.shape);
  if (vocabularyErrors.length > 0) {
    errors.push(violation("invalid-step-shape", `the recorded shape violates the venue vocabulary (${String(vocabularyErrors.length)} error(s), carried verbatim)`, vocabularyErrors));
  }

  environments.forEach((environment, index) => {
    if (environment.shardIndex !== index) {
      errors.push(violation("shard-order", `the environment at position ${String(index)} carries shard index ${String(environment.shardIndex)} — the environments are sealed in canonical shard order (A9)`));
    }
    errors.push(...environmentViolations(environment, declarations, index));
  });

  if (nonBlank(String(declarations.planId))) {
    const expectedId = lobGenerationMappingIdOf({ planId: declarations.planId, shape: declarations.shape });
    if (String(expectedId) !== String(declarations.mappingId)) {
      errors.push(violation("identity-mismatch", "the mapping id is not the canonical content address of (plan id, shape) — identity is a function of recorded bytes (A9)"));
    }
  }

  return errors.length === 0
    ? { ok: true, checked: ["kind", "citation", "unit-count", "shard-order", "environments", "shape", "identity"] }
    : { ok: false, errors };
}
