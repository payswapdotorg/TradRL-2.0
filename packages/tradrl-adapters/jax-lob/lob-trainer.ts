/**
 * The venue's TrainerPort-facing contract (W049) — how a W047 episode or
 * batch maps to LOB-style training steps.
 *
 * W047 shipped the TrainerPort + the episode/batch contracts
 * (`rl-protocol`); THIS module is the LOB venue's projection over them:
 * the mapping as PURE typed DATA. One carried episode step (the W036
 * evidence capsule, carried VERBATIM — never re-structured, never
 * re-scored) maps to the declared sequence of LOB step records of the
 * venue's declared episode-step shape; the mapping cites the episode by
 * its OPAQUE id and the step by its INDEX — it never copies capsule
 * content (carry, never re-score). The content-addressed mapping id
 * (`lobtrain-<digest>`) makes the projection deterministic (A9).
 *
 * Fail-closed at every seam: a malformed episode is refused with W047's
 * OWN validation errors carried VERBATIM (the W048 populationErrors
 * precedent); a malformed batch descriptor is refused with W047's own
 * batch errors carried verbatim; a malformed shape is refused with the
 * venue vocabulary's errors carried verbatim; episodes that do not
 * realize the batch exactly, or that disagree on scope, are refused by
 * name.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — this module COMPOSES typed data;
 * it never trains, never invokes a trainer, never steps an environment.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateEpisode, validateEpisodeBatchDescriptor } from "rl-protocol";
import type {
  Episode,
  EpisodeBatchDescriptor,
  EpisodeBatchId,
  EpisodeBatchValidationError,
  EpisodeId,
  EpisodeValidationError,
} from "rl-protocol";
import { canonicalDigestHex } from "trajectory";
import { lobEpisodeStepShapeOf, stepShapeViolations } from "./lob-vocabulary.js";
import type { LobEpisodeStepShape, LobStepKind, LobVocabularyError } from "./lob-vocabulary.js";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type LobTrainerErrorCode =
  | "invalid-episode" // W047's own episode re-validation refused (carried verbatim)
  | "invalid-batch" // W047's own batch re-validation refused (carried verbatim)
  | "invalid-step-shape" // the venue vocabulary refused the declared shape (carried verbatim)
  | "batch-realization-mismatch" // the episodes do not realize the batch exactly
  | "scope-mismatch"; // the episodes disagree on their identity scope

/** One typed trainer-projection error (fail-closed). */
export interface LobTrainerError {
  readonly code: LobTrainerErrorCode;
  readonly message: string;
  /** Present on `invalid-episode`: W047's own episode validation errors, verbatim. */
  readonly episodeErrors?: readonly EpisodeValidationError[];
  /** Present on `invalid-batch`: W047's own batch validation errors, verbatim. */
  readonly batchErrors?: readonly EpisodeBatchValidationError[];
  /** Present on `invalid-step-shape`: the venue vocabulary's own errors, verbatim. */
  readonly vocabularyErrors?: readonly LobVocabularyError[];
}

export type LobEpisodeTrainingOutcome =
  | { readonly ok: true; readonly projection: LobEpisodeTrainingProjection }
  | { readonly ok: false; readonly errors: readonly LobTrainerError[] };

export type LobBatchTrainingOutcome =
  | { readonly ok: true; readonly projection: LobBatchTrainingProjection }
  | { readonly ok: false; readonly errors: readonly LobTrainerError[] };

// ---------------------------------------------------------------------------
// The projection records (typed DATA — canonical order, content-addressed)
// ---------------------------------------------------------------------------

declare const lobTrainingMappingIdBrand: unique symbol;

/** An OPAQUE training-mapping id (a canonical digest rendering, produced only by {@link lobTrainingMappingIdOf}; never parsed). */
export type LobTrainingMappingId = string & { readonly [lobTrainingMappingIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const LOB_TRAINING_MAPPING_ID_PREFIX = "lobtrain-";

/**
 * ONE declared LOB training step — DATA: the carried episode step INDEX
 * it maps (the capsule itself is carried by the episode, never copied),
 * the venue's step KIND for that record, and the step's dense canonical
 * ORDINAL (0-based, in canonical order).
 */
export interface LobTrainingStepDeclaration {
  readonly episodeStepIndex: number;
  readonly stepKind: LobStepKind;
  readonly stepOrdinal: number;
}

/**
 * The episode-level projection: the content-addressed mapping id, the
 * cited opaque episode id, the carried step count, the sealed venue
 * shape, and the declared training steps in canonical order — for every
 * carried step index, the shape's step kinds in canonical protocol
 * order. ALL a venue trainer is handed besides the episode itself.
 */
export interface LobEpisodeTrainingProjection {
  readonly mappingId: LobTrainingMappingId;
  readonly kind: "lob-episode-training-projection";
  readonly episodeId: EpisodeId;
  readonly stepCount: number;
  readonly shape: LobEpisodeStepShape;
  readonly trainingSteps: readonly LobTrainingStepDeclaration[];
}

/**
 * The batch-level projection: the content-addressed mapping id, the
 * cited W047 batch id, the episode ids in CANONICAL order, and one
 * episode-level projection per episode — canonical episode-id order,
 * never the input order (A9: input order never leaks).
 */
export interface LobBatchTrainingProjection {
  readonly mappingId: LobTrainingMappingId;
  readonly kind: "lob-batch-training-projection";
  readonly batchId: EpisodeBatchId;
  readonly episodeIds: readonly EpisodeId[];
  readonly episodeCount: number;
  readonly shape: LobEpisodeStepShape;
  readonly episodeProjections: readonly LobEpisodeTrainingProjection[];
}

// ---------------------------------------------------------------------------
// The id derivations (pure, deterministic — shared with ./validate.ts)
// ---------------------------------------------------------------------------

/** The episode-level mapping id: the canonical content digest over the cited episode id + the sealed shape (A9). */
export function lobTrainingMappingIdOf(input: {
  readonly episodeId: EpisodeId;
  readonly shape: LobEpisodeStepShape;
}): LobTrainingMappingId {
  return `${LOB_TRAINING_MAPPING_ID_PREFIX}${canonicalDigestHex({
    kind: "lob-episode-training-projection",
    episodeId: String(input.episodeId),
    stepKinds: input.shape.stepKinds,
  })}` as LobTrainingMappingId;
}

/** The batch-level mapping id: the canonical content digest over the cited batch id + the sealed shape (A9). */
export function lobBatchTrainingMappingIdOf(input: {
  readonly batchId: EpisodeBatchId;
  readonly shape: LobEpisodeStepShape;
}): LobTrainingMappingId {
  return `${LOB_TRAINING_MAPPING_ID_PREFIX}${canonicalDigestHex({
    kind: "lob-batch-training-projection",
    batchId: String(input.batchId),
    stepKinds: input.shape.stepKinds,
  })}` as LobTrainingMappingId;
}

/**
 * The canonical training-step sequence: for every carried episode step
 * index (0..stepCount-1), the shape's step kinds in canonical protocol
 * order, with dense ordinals. Pure, deterministic (A9) — the shared
 * derivation of the gate and the whole-record re-validation.
 */
export function canonicalTrainingSteps(
  stepCount: number,
  shape: LobEpisodeStepShape,
): readonly LobTrainingStepDeclaration[] {
  const steps: LobTrainingStepDeclaration[] = [];
  let ordinal = 0;
  for (let episodeStepIndex = 0; episodeStepIndex < stepCount; episodeStepIndex += 1) {
    for (const stepKind of shape.stepKinds) {
      steps.push({ episodeStepIndex, stepKind, stepOrdinal: ordinal });
      ordinal += 1;
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// THE EPISODE GATE
// ---------------------------------------------------------------------------

/**
 * Project ONE carried episode to LOB-style training steps — THE EPISODE
 * GATE. Laws: the episode re-proves through W047's own whole-record
 * validation (its errors carried VERBATIM); the declared shape re-proves
 * through the venue vocabulary gate (its errors carried verbatim); the
 * carried steps are non-empty. Then the mapping is sealed: the
 * `lobtrain-<digest>` id over (episode id, shape), the training steps in
 * canonical order. Pure, deterministic (A9); A14: composes typed data —
 * the capsule content is NEVER copied, never re-structured, never
 * re-scored.
 */
export function lobTrainingStepsOf(
  episode: Episode,
  shape: LobEpisodeStepShape,
): LobEpisodeTrainingOutcome {
  const errors: LobTrainerError[] = [];

  const episodeProof = validateEpisode(episode);
  if (!episodeProof.ok) {
    errors.push({
      code: "invalid-episode",
      message: `[jax-lob] the episode failed W047's own whole-record re-validation (${String(episodeProof.errors.length)} error(s), carried verbatim) — the venue maps only proven episodes (fail-closed at every seam)`,
      episodeErrors: episodeProof.errors,
    });
  }

  const vocabularyErrors = stepShapeViolations(shape);
  if (vocabularyErrors.length > 0) {
    errors.push({
      code: "invalid-step-shape",
      message: `[jax-lob] the declared episode-step shape violates the venue vocabulary (${String(vocabularyErrors.length)} error(s), carried verbatim) — the venue's step protocol is declared closed-set data`,
      vocabularyErrors,
    });
  }

  if (episode.steps.length === 0) {
    errors.push({
      code: "invalid-episode",
      message: "the episode carries no observation→action→outcome steps — an empty evidence carry is malformed (W047's empty-steps law; re-proven here)",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const sealedShape = lobEpisodeStepShapeOf(shape);
  if (!sealedShape.ok) {
    return { ok: false, errors: [{ code: "invalid-step-shape", message: "the declared shape could not be sealed", vocabularyErrors: sealedShape.errors }] };
  }

  const projection: LobEpisodeTrainingProjection = {
    mappingId: lobTrainingMappingIdOf({ episodeId: episode.episodeId, shape: sealedShape.shape }),
    kind: "lob-episode-training-projection",
    episodeId: episode.episodeId,
    stepCount: episode.steps.length,
    shape: sealedShape.shape,
    trainingSteps: canonicalTrainingSteps(episode.steps.length, sealedShape.shape),
  };
  Object.freeze(projection);
  return { ok: true, projection };
}

// ---------------------------------------------------------------------------
// THE BATCH GATE
// ---------------------------------------------------------------------------

function sameScope(
  left: { readonly tenantId: unknown; readonly projectId: unknown; readonly worldId: unknown },
  right: { readonly tenantId: unknown; readonly projectId: unknown; readonly worldId: unknown },
): boolean {
  return (
    String(left.tenantId) === String(right.tenantId) &&
    String(left.projectId) === String(right.projectId) &&
    String(left.worldId) === String(right.worldId)
  );
}

/**
 * Project ONE W047 batch (with the episodes that realize it) to LOB-style
 * training steps — THE BATCH GATE. Laws: the batch descriptor re-proves
 * through W047's own whole-record validation (its errors carried
 * VERBATIM); every episode re-proves through W047's own whole-record
 * validation (errors carried verbatim per episode); the handed episodes
 * realize the batch EXACTLY (every batch id present once, no foreign
 * episode); the episodes agree on their identity scope (one venue
 * projection, one scope). Then the mapping is sealed: the
 * `lobtrain-<digest>` id over (batch id, shape), the episode projections
 * in CANONICAL episode-id order — input order never leaks (A9).
 */
export function lobBatchTrainingStepsOf(
  batch: EpisodeBatchDescriptor,
  episodes: readonly Episode[],
  shape: LobEpisodeStepShape,
): LobBatchTrainingOutcome {
  const errors: LobTrainerError[] = [];

  const batchProof = validateEpisodeBatchDescriptor(batch);
  if (!batchProof.ok) {
    errors.push({
      code: "invalid-batch",
      message: `[jax-lob] the batch descriptor failed W047's own whole-record re-validation (${String(batchProof.errors.length)} error(s), carried verbatim) — the venue maps only proven batches (fail-closed at every seam)`,
      batchErrors: batchProof.errors,
    });
  }

  const vocabularyErrors = stepShapeViolations(shape);
  if (vocabularyErrors.length > 0) {
    errors.push({
      code: "invalid-step-shape",
      message: `[jax-lob] the declared episode-step shape violates the venue vocabulary (${String(vocabularyErrors.length)} error(s), carried verbatim) — the venue's step protocol is declared closed-set data`,
      vocabularyErrors,
    });
  }

  const byId = new Map<string, Episode>();
  const handedIds = new Set<string>();
  for (const episode of episodes) {
    const id = String(episode.episodeId);
    if (handedIds.has(id)) {
      errors.push({
        code: "batch-realization-mismatch",
        message: `the episode '${id}' is handed to the batch realization twice — one episode, one realization (deterministic projections, A9)`,
      });
    }
    handedIds.add(id);
    byId.set(id, episode);
    const episodeProof = validateEpisode(episode);
    if (!episodeProof.ok) {
      errors.push({
        code: "invalid-episode",
        message: `[jax-lob] the episode '${id}' failed W047's own whole-record re-validation (${String(episodeProof.errors.length)} error(s), carried verbatim) — the venue maps only proven episodes`,
        episodeErrors: episodeProof.errors,
      });
    }
  }

  const batchIds = batch.episodeIds.map(String);
  const expected = new Set(batchIds);
  if (expected.size !== batchIds.length) {
    errors.push({
      code: "batch-realization-mismatch",
      message: "the batch descriptor cites one episode twice — one episode joins one realization once",
    });
  }
  for (const id of batchIds) {
    if (!byId.has(id)) {
      errors.push({
        code: "batch-realization-mismatch",
        message: `the batch cites the episode '${id}' but the handed realization does not carry it — a venue batch projection maps exactly the batch's episodes (fail-closed)`,
      });
    }
  }
  for (const id of byId.keys()) {
    if (!expected.has(id)) {
      errors.push({
        code: "batch-realization-mismatch",
        message: `the handed episode '${id}' is not cited by the batch — a foreign episode never joins a venue batch projection (fail-closed)`,
      });
    }
  }

  const reference = episodes[0];
  for (const episode of episodes.slice(1)) {
    if (reference !== undefined && !sameScope(reference.scope, episode.scope)) {
      errors.push({
        code: "scope-mismatch",
        message: `the episode '${String(episode.episodeId)}' carries scope (${String(episode.scope.tenantId)}, ${String(episode.scope.projectId)}, ${String(episode.scope.worldId)}) but '${String(reference.episodeId)}' carries (${String(reference.scope.tenantId)}, ${String(reference.scope.projectId)}, ${String(reference.scope.worldId)}) — one venue batch projection, one scope (fail-closed)`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const sealedShape = lobEpisodeStepShapeOf(shape);
  if (!sealedShape.ok) {
    return { ok: false, errors: [{ code: "invalid-step-shape", message: "the declared shape could not be sealed", vocabularyErrors: sealedShape.errors }] };
  }

  const canonicalIds = [...byId.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const episodeProjections = canonicalIds.map((id) => {
    const outcome = lobTrainingStepsOf(byId.get(id)!, sealedShape.shape);
    if (!outcome.ok) {
      throw new Error("unreachable: the episode re-proved above (defensive depth)");
    }
    return outcome.projection;
  });

  const projection: LobBatchTrainingProjection = {
    mappingId: lobBatchTrainingMappingIdOf({ batchId: batch.batchId, shape: sealedShape.shape }),
    kind: "lob-batch-training-projection",
    batchId: batch.batchId,
    episodeIds: canonicalIds.map((id) => id as EpisodeId),
    episodeCount: canonicalIds.length,
    shape: sealedShape.shape,
    episodeProjections,
  };
  Object.freeze(projection);
  return { ok: true, projection };
}
