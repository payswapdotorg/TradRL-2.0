/**
 * The venue's GenerationWorkerPort-facing contract (W049) — how a W048
 * generation plan / work unit projects to LOB-style environment
 * declarations.
 *
 * W048 shipped the GenerationPlan + the GenerationWorkerPort
 * (`learning-compute`); THIS module is the LOB venue's projection over
 * them: the mapping as PURE typed DATA. ONE work unit (its shard, its
 * population slice, its declared batch descriptor, its declared scope)
 * projects to ONE declared LOB-style environment: the environment cites
 * the plan and the unit by their OPAQUE ids, carries the unit's declared
 * output volume and member-slice size verbatim, and declares the venue's
 * episode-step shape — the shape the environment's episodes' steps are
 * expected to carry. The content-addressed environment id
 * (`lobenv-<digest>`) and mapping id (`lobgen-<digest>`) make the
 * projection deterministic (A9).
 *
 * Fail-closed at every seam: a plan that fails W048's own whole-plan
 * re-validation is refused with ITS errors carried VERBATIM (the W048
 * populationErrors precedent); a malformed shape is refused with the
 * venue vocabulary's errors carried verbatim; a declared expected scope
 * that disagrees with the plan's scope is refused by name.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — this module COMPOSES typed data;
 * it never executes generation, never steps a book environment, never
 * invokes a worker (the GenerationWorkerPort handshake itself is typed
 * by W048; a future distributed runtime satisfies it).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateGenerationPlan } from "learning-compute";
import type {
  GenerationPlan,
  GenerationPlanId,
  GenerationPlanValidationError,
  GenerationUnitId,
} from "learning-compute";
import { canonicalDigestHex } from "trajectory";
import { lobEpisodeStepShapeOf, stepShapeViolations } from "./lob-vocabulary.js";
import type { LobEpisodeStepShape, LobVocabularyError } from "./lob-vocabulary.js";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type LobGenerationErrorCode =
  | "invalid-plan" // W048's own whole-plan re-validation refused (carried verbatim)
  | "invalid-step-shape" // the venue vocabulary refused the declared shape (carried verbatim)
  | "scope-mismatch"; // a declared expected scope disagrees with the plan's

/** One typed generation-projection error (fail-closed). */
export interface LobGenerationError {
  readonly code: LobGenerationErrorCode;
  readonly message: string;
  /** Present on `invalid-plan`: W048's own whole-plan validation errors, verbatim. */
  readonly planErrors?: readonly GenerationPlanValidationError[];
  /** Present on `invalid-step-shape`: the venue vocabulary's own errors, verbatim. */
  readonly vocabularyErrors?: readonly LobVocabularyError[];
}

export type LobEnvironmentDeclarationsOutcome =
  | { readonly ok: true; readonly declarations: LobEnvironmentDeclarations }
  | { readonly ok: false; readonly errors: readonly LobGenerationError[] };

// ---------------------------------------------------------------------------
// The projection records (typed DATA — canonical shard order)
// ---------------------------------------------------------------------------

declare const lobEnvironmentIdBrand: unique symbol;

/** The declared expected scope handed to the generation gate: the plan-scope members (tenant/project/world), structural DATA — compared member-wise, never parsed. */
export interface LobExpectedScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/** An OPAQUE environment id (a canonical digest rendering, produced only by {@link lobEnvironmentIdOf}; never parsed). */
export type LobEnvironmentId = string & { readonly [lobEnvironmentIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const LOB_ENVIRONMENT_ID_PREFIX = "lobenv-";

declare const lobGenerationMappingIdBrand: unique symbol;

/** An OPAQUE generation-mapping id (a canonical digest rendering, produced only by {@link lobGenerationMappingIdOf}; never parsed). */
export type LobGenerationMappingId = string & { readonly [lobGenerationMappingIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const LOB_GENERATION_MAPPING_ID_PREFIX = "lobgen-";

/**
 * ONE declared LOB-style environment — DATA: its content-addressed id,
 * the plan and work unit it descends from (opaque citations), the unit's
 * shard index, its population-slice size and declared episode quota
 * (carried VERBATIM from the unit — carry, never re-derive), and the
 * venue's sealed episode-step shape (the step protocol the environment's
 * episodes carry). ALL a venue worker needs besides the unit itself.
 */
export interface LobEnvironmentDeclaration {
  readonly environmentId: LobEnvironmentId;
  readonly kind: "lob-environment";
  readonly planId: GenerationPlanId;
  readonly unitId: GenerationUnitId;
  readonly shardIndex: number;
  readonly memberCount: number;
  readonly declaredEpisodeCount: number;
  readonly shape: LobEpisodeStepShape;
}

/**
 * The plan-level projection: the content-addressed mapping id, the cited
 * plan id, the declared unit count, the sealed venue shape, and one
 * environment declaration per work unit — CANONICAL SHARD ORDER (the
 * plan's own unit order, A9).
 */
export interface LobEnvironmentDeclarations {
  readonly mappingId: LobGenerationMappingId;
  readonly kind: "lob-environment-declarations";
  readonly planId: GenerationPlanId;
  readonly unitCount: number;
  readonly shape: LobEpisodeStepShape;
  readonly environments: readonly LobEnvironmentDeclaration[];
}

// ---------------------------------------------------------------------------
// The id derivations (pure, deterministic — shared with ./validate.ts)
// ---------------------------------------------------------------------------

/** The environment id: the canonical content digest over the cited unit id + the sealed shape (A9). */
export function lobEnvironmentIdOf(input: {
  readonly unitId: GenerationUnitId;
  readonly shape: LobEpisodeStepShape;
}): LobEnvironmentId {
  return `${LOB_ENVIRONMENT_ID_PREFIX}${canonicalDigestHex({
    kind: "lob-environment",
    unitId: String(input.unitId),
    stepKinds: input.shape.stepKinds,
  })}` as LobEnvironmentId;
}

/** The generation-mapping id: the canonical content digest over the cited plan id + the sealed shape (A9). */
export function lobGenerationMappingIdOf(input: {
  readonly planId: GenerationPlanId;
  readonly shape: LobEpisodeStepShape;
}): LobGenerationMappingId {
  return `${LOB_GENERATION_MAPPING_ID_PREFIX}${canonicalDigestHex({
    kind: "lob-environment-declarations",
    planId: String(input.planId),
    stepKinds: input.shape.stepKinds,
  })}` as LobGenerationMappingId;
}

// ---------------------------------------------------------------------------
// THE GATE
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
 * Project ONE W048 generation plan to LOB-style environment declarations
 * — THE GENERATION GATE. Laws: the plan re-proves through W048's own
 * whole-plan re-validation (its errors carried VERBATIM — the plan's
 * scope/world agreement, canonical shard partition, and identity laws are
 * W048's, re-proven never re-derived here); the declared shape re-proves
 * through the venue vocabulary gate (its errors carried verbatim); a
 * declared expected scope, when handed, must agree with the plan's own
 * scope (one venue, one scope). Then the mapping is sealed: one
 * `lobenv-<digest>` environment declaration per unit in canonical shard
 * order, the `lobgen-<digest>` mapping id over (plan id, shape). Pure,
 * deterministic (A9); A14: composes typed data — never executes
 * generation, never invokes a worker.
 */
export function lobEnvironmentDeclarationsOf(
  plan: GenerationPlan,
  shape: LobEpisodeStepShape,
  expectedScope?: LobExpectedScope,
): LobEnvironmentDeclarationsOutcome {
  const errors: LobGenerationError[] = [];

  const planProof = validateGenerationPlan(plan);
  if (!planProof.ok) {
    errors.push({
      code: "invalid-plan",
      message: `[jax-lob] the generation plan failed W048's own whole-plan re-validation (${String(planProof.errors.length)} error(s), carried verbatim) — the venue projects only proven plans (fail-closed at every seam)`,
      planErrors: planProof.errors,
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

  if (expectedScope !== undefined && !sameScope(expectedScope, plan.scope)) {
    errors.push({
      code: "scope-mismatch",
      message: `the declared expected scope (${String(expectedScope.tenantId)}, ${String(expectedScope.projectId)}, ${String(expectedScope.worldId)}) disagrees with the plan's (${String(plan.scope.tenantId)}, ${String(plan.scope.projectId)}, ${String(plan.scope.worldId)}) — one venue projection, one scope (fail-closed)`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const sealedShape = lobEpisodeStepShapeOf(shape);
  if (!sealedShape.ok) {
    return { ok: false, errors: [{ code: "invalid-step-shape", message: "the declared shape could not be sealed", vocabularyErrors: sealedShape.errors }] };
  }

  const environments = plan.units.map((unit) => ({
    environmentId: lobEnvironmentIdOf({ unitId: unit.unitId, shape: sealedShape.shape }),
    kind: "lob-environment" as const,
    planId: plan.planId,
    unitId: unit.unitId,
    shardIndex: unit.shard.shardIndex,
    memberCount: unit.populationSlice.length,
    declaredEpisodeCount: unit.batch.declaredEpisodeCount,
    shape: sealedShape.shape,
  }));

  const declarations: LobEnvironmentDeclarations = {
    mappingId: lobGenerationMappingIdOf({ planId: plan.planId, shape: sealedShape.shape }),
    kind: "lob-environment-declarations",
    planId: plan.planId,
    unitCount: environments.length,
    shape: sealedShape.shape,
    environments,
  };
  Object.freeze(declarations);
  return { ok: true, declarations };
}
