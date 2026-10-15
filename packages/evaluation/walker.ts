/**
 * The experiment walker (W038) — THE EVALUATION ENGINE over W037 experiments.
 *
 * Given an `ExperimentManifest`, its member `TrajectoryRecord`s, and the
 * experiment's `EvaluationPolicy` (W036), produce the typed, deterministic
 * `ExperimentEvaluation`: per-trajectory results CARRIED from the records'
 * own outcome summaries, per-holdout-split aggregations (the manifest's
 * declarative splits compared as DATA — never computed statistics), the
 * policy reduction folded across trajectories in canonical order, and the
 * compliance dimension (hard violations gate, soft penalties fold — never a
 * bare P&L).
 *
 * Spec: spec/ARCHITECTURE.md §13 — evaluation is constraint-aware; raw P&L is
 * never the sole objective. Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism:
 * the walk is pure (no wall clocks, no randomness, no env reads) and carries
 * a canonical content-addressed evaluation id (same manifest + same records +
 * same policy ⇒ identical evaluation AND identical id). A13 — the walker
 * MEASURES and aggregates; it never enforces and never re-scores (the
 * records' own outcome summaries are carried, not re-derived).
 *
 * FAIL-CLOSED: a record whose trajectory is not a manifest member, a member
 * without a record, a scope/world/digest/policy disagreement, a malformed
 * record (the W037 capture laws re-proven, errors carried verbatim), an
 * unknown or re-kinded holdout split, a broken integrity carry-forward, or a
 * non-finite reduction — every one is a loud typed error naming the law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { HOLDOUT_KINDS } from "learning-objectives";
import { comparePolicyEvaluations } from "learning-objectives";
import type {
  ConstraintCompliance,
  EvaluationPolicy,
  HoldoutKind,
  IntegrityRequirementKind,
} from "learning-objectives";
import { canonicalDigestHex } from "trajectory";
import { validateTrajectoryRecord } from "trajectory";
import type { TrajectoryError, TrajectoryId, TrajectoryRecord } from "trajectory";
import type { ExperimentId, ExperimentManifest, HoldoutSplitDescriptor } from "experiments";
import {
  canonicalSummaryOrder,
  holdoutSplitAggregationOf,
  trajectoryOutcomeSummaryOf,
} from "./summary.js";
import type { HoldoutSplitAggregation, TrajectoryOutcomeSummary } from "./summary.js";

// ---------------------------------------------------------------------------
// The evaluation result (typed, deterministic, compliance-carrying)
// ---------------------------------------------------------------------------

declare const experimentEvaluationIdBrand: unique symbol;

/**
 * An OPAQUE experiment-evaluation id — the canonical content-addressed digest
 * over the evaluation's canonical bytes (A9), produced only by the walker and
 * never parsed.
 */
export type ExperimentEvaluationId = string & {
  readonly [experimentEvaluationIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const EXPERIMENT_EVALUATION_ID_PREFIX = "expeval-";

/**
 * The deterministic cross-trajectory reduction: the policy's own dimensions
 * folded across ALL walked trajectories in canonical trajectory-id order —
 * combined scores sum, applied soft penalties sum (the fold), hard
 * violations sum, and the compliance GATE (one non-compliant trajectory
 * makes the whole experiment non-compliant; hard violations are never
 * priced). Plus the deterministic ranking (W036's total comparator over the
 * records' own evaluations, canonical id tiebreak).
 */
export interface ExperimentReduction {
  readonly trajectoryCount: number;
  readonly combinedScoreTotal: number;
  readonly appliedSoftPenaltyTotal: number;
  readonly hardViolationCount: number;
  readonly compliance: ConstraintCompliance;
  /** Best-first, by W036's total order; canonical trajectory-id tiebreak. */
  readonly ranking: readonly TrajectoryId[];
}

/**
 * The complete evaluation of one experiment: the walked trajectories' carried
 * outcome summaries (canonical id order), the per-split aggregations
 * (canonical kind-then-axis order), the integrity requirements carried
 * verbatim, and the reduction. The compliance dimension is ALWAYS present —
 * never a bare P&L number (§13).
 */
export interface ExperimentEvaluation {
  readonly evaluationId: ExperimentEvaluationId;
  readonly experimentId: ExperimentId;
  readonly policyId: string;
  readonly trajectories: readonly TrajectoryOutcomeSummary[];
  readonly holdoutSplits: readonly HoldoutSplitAggregation[];
  readonly integrity: readonly IntegrityRequirementKind[];
  readonly reduction: ExperimentReduction;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set)
// ---------------------------------------------------------------------------

export type ExperimentEvaluationErrorCode =
  | "empty-records" // no member records: nothing to walk
  | "duplicate-record" // one trajectory id walks once
  | "unknown-record" // a record that is not a manifest member
  | "missing-record" // a manifest member with no record
  | "record-scope-mismatch" // the record's scope disagrees with its membership
  | "world-mismatch" // the record's stream world ≠ the manifest's world
  | "world-digest-mismatch" // the record's world digest ≠ the manifest's
  | "policy-id-mismatch" // the record was evaluated under another policy
  | "malformed-record" // the W037 capture laws failed re-validation (carried)
  | "integrity-carry-mismatch" // the manifest's integrity ≠ the policy's axes
  | "unknown-holdout-kind" // a split kind outside the closed set (runtime)
  | "unknown-holdout-axis" // a split naming an axis the policy never declared
  | "split-kind-mismatch" // a split whose kind disagrees with its declared axis
  | "reduction-overflow"; // a non-finite fold total (explicit rule, never NaN)

/** One typed walker error (fail-closed; the law named in the message). */
export interface ExperimentEvaluationError {
  readonly code: ExperimentEvaluationErrorCode;
  readonly message: string;
  /** The offending trajectory/axis id, when the error belongs to one entry. */
  readonly entryId?: string;
  /** Present on `malformed-record`: the W037 capture-law errors, verbatim. */
  readonly recordErrors?: readonly TrajectoryError[];
}

export type ExperimentEvaluationOutcome =
  | { readonly ok: true; readonly evaluation: ExperimentEvaluation }
  | { readonly ok: false; readonly errors: readonly ExperimentEvaluationError[] };

/** The walker input: the manifest, its member records, the policy. */
export interface ExperimentEvaluationInput {
  readonly manifest: ExperimentManifest;
  readonly records: readonly TrajectoryRecord[];
  readonly policy: EvaluationPolicy;
}

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

const SCOPE_MEMBERS = ["tenantId", "projectId", "worldId", "experimentId", "sessionId"] as const;

/** Re-prove one split against the policy's declared axes (from data). */
function splitGateErrors(
  split: HoldoutSplitDescriptor,
  declaredAxes: ReadonlyMap<string, HoldoutKind>,
): ExperimentEvaluationError[] {
  if (!HOLDOUT_KINDS.includes(split.kind as never)) {
    return [
      {
        code: "unknown-holdout-kind",
        message: `the split for axis '${split.axisId}' declares unknown holdout kind '${String(split.kind)}' (the closed set: ${HOLDOUT_KINDS.join(", ")}) — fail-closed, never a silent skip`,
        entryId: split.axisId,
      },
    ];
  }
  const declaredKind = declaredAxes.get(split.axisId);
  if (declaredKind === undefined) {
    return [
      {
        code: "unknown-holdout-axis",
        message: `the split names axis '${split.axisId}' but the evaluation policy declares no such holdout axis — splits never invent axes`,
        entryId: split.axisId,
      },
    ];
  }
  if (declaredKind !== split.kind) {
    return [
      {
        code: "split-kind-mismatch",
        message: `the split for axis '${split.axisId}' declares kind '${String(split.kind)}' but the policy declared that axis as '${String(declaredKind)}' — a split never re-kinds its axis`,
        entryId: split.axisId,
      },
    ];
  }
  return [];
}

/**
 * Walk one experiment — THE EVALUATION GATE. Every law is re-proven here,
 * loudly, from data: membership (every record is a manifest member; every
 * member has a record), scope agreement (record scope ≡ membership scope),
 * world agreement (stream world and determinism digest ≡ the manifest's
 * world), the W037 capture laws (`validateTrajectoryRecord`, errors carried
 * verbatim), the policy agreement (every record was evaluated under THIS
 * policy), the integrity carry-forward (manifest ≡ policy axes), and the
 * holdout split laws. The assembled evaluation carries the summaries in
 * canonical trajectory-id order, the aggregations in canonical
 * kind-then-axis order, and the content-addressed id (A9).
 */
export function evaluateExperiment(input: ExperimentEvaluationInput): ExperimentEvaluationOutcome {
  const errors: ExperimentEvaluationError[] = [];
  const manifest = input.manifest;
  const policy = input.policy;

  if (input.records.length === 0) {
    errors.push({
      code: "empty-records",
      message: "the walker received no trajectory records — an experiment evaluation walks at least one trajectory (fail-closed)",
    });
  }
  const seen = new Set<string>();
  for (const record of input.records) {
    const id = String(record.trajectoryId);
    if (seen.has(id)) {
      errors.push({
        code: "duplicate-record",
        message: `the trajectory '${id}' walks the experiment twice — one trajectory, one evaluation`,
        entryId: id,
      });
      continue;
    }
    seen.add(id);
    const memberScope = manifest.trajectories.find(
      (ref) => String(ref.trajectoryId) === id,
    )?.scope;
    if (memberScope === undefined) {
      errors.push({
        code: "unknown-record",
        message: `the record '${id}' is not a member of experiment '${String(manifest.experimentId)}' — the walker walks manifest members only`,
        entryId: id,
      });
      continue;
    }
    for (const member of SCOPE_MEMBERS) {
      if (String(record.scope[member]) !== String(memberScope[member])) {
        errors.push({
          code: "record-scope-mismatch",
          message: `the record '${id}' declares scope.${member} '${String(record.scope[member])}' but its manifest membership declares '${String(memberScope[member])}' — trajectory/experiment scope mismatch`,
          entryId: id,
        });
      }
    }
    if (String(manifest.experimentId) !== String(record.scope.experimentId)) {
      errors.push({
        code: "record-scope-mismatch",
        message: `the record '${id}' belongs to experiment '${String(record.scope.experimentId)}' but the manifest is '${String(manifest.experimentId)}' — trajectory/experiment scope mismatch`,
        entryId: id,
      });
    }
    if (String(record.stream.worldId) !== String(manifest.world.worldId)) {
      errors.push({
        code: "world-mismatch",
        message: `the record '${id}' ran in world '${String(record.stream.worldId)}' but the manifest's world is '${String(manifest.world.worldId)}' — mixed worlds are refused`,
        entryId: id,
      });
    }
    if (String(record.determinism.worldDefinitionDigest) !== String(manifest.world.definitionDigest)) {
      errors.push({
        code: "world-digest-mismatch",
        message: `the record '${id}' ran against world digest '${String(record.determinism.worldDefinitionDigest)}' but the manifest's world is digest '${String(manifest.world.definitionDigest)}' — an experiment evaluates one content-addressed world (A9)`,
        entryId: id,
      });
    }
    if (record.evaluation.policyId !== policy.descriptor.policyId) {
      errors.push({
        code: "policy-id-mismatch",
        message: `the record '${id}' was evaluated under policy '${record.evaluation.policyId}' but the experiment's policy is '${policy.descriptor.policyId}' — a walker never mixes policies`,
        entryId: id,
      });
    }
    const revalidated = validateTrajectoryRecord(record);
    if (!revalidated.ok) {
      errors.push({
        code: "malformed-record",
        message: `[evaluation] the record '${id}' failed the W037 capture-law re-validation (${String(revalidated.errors.length)} error(s)) — malformed records are never walked`,
        entryId: id,
        recordErrors: revalidated.errors,
      });
    }
  }
  for (const ref of manifest.trajectories) {
    if (!seen.has(String(ref.trajectoryId))) {
      errors.push({
        code: "missing-record",
        message: `the manifest member '${String(ref.trajectoryId)}' has no record — the walker never silently skips a member`,
        entryId: String(ref.trajectoryId),
      });
    }
  }
  if (manifest.integrity.join(",") !== policy.descriptor.axes.integrity.join(",")) {
    errors.push({
      code: "integrity-carry-mismatch",
      message: `the manifest carries integrity [${manifest.integrity.join(", ")}] but the policy declares [${policy.descriptor.axes.integrity.join(", ")}] — the W037 carry-forward law is broken (the manifest carries the policy's integrity verbatim)`,
    });
  }

  const declaredAxes = new Map<string, HoldoutKind>();
  for (const axis of policy.descriptor.axes.holdouts) {
    declaredAxes.set(axis.axisId, axis.kind);
  }
  for (const split of manifest.holdoutSplits) {
    errors.push(...splitGateErrors(split, declaredAxes));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // --- the walk (canonical order, deterministic fold, content-addressed id) ---

  const ordered = [...input.records].sort((left, right) =>
    String(left.trajectoryId).localeCompare(String(right.trajectoryId)),
  );
  const summaries = canonicalSummaryOrder(ordered.map((record) => trajectoryOutcomeSummaryOf(record)));

  const splits = [...manifest.holdoutSplits].sort((left, right) => {
    const kindDelta = HOLDOUT_KINDS.indexOf(left.kind as never) - HOLDOUT_KINDS.indexOf(right.kind as never);
    return kindDelta !== 0 ? kindDelta : left.axisId.localeCompare(right.axisId);
  });
  const aggregations = splits.map((split) => holdoutSplitAggregationOf(split, ordered));
  let combinedScoreTotal = 0;
  let appliedSoftPenaltyTotal = 0;
  let hardViolationCount = 0;
  let compliant = true;
  for (const record of ordered) {
    combinedScoreTotal += record.evaluation.combinedScore;
    appliedSoftPenaltyTotal += record.evaluation.appliedSoftPenaltyTotal;
    hardViolationCount += record.evaluation.constraints.hardViolationCount;
    if (record.evaluation.compliance !== "compliant") {
      compliant = false;
    }
  }
  if (
    !Number.isFinite(combinedScoreTotal) ||
    !Number.isFinite(appliedSoftPenaltyTotal) ||
    !Number.isInteger(hardViolationCount) ||
    hardViolationCount < 0
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "reduction-overflow",
          message: `[evaluation] the cross-trajectory reduction overflowed (combined ${String(combinedScoreTotal)}, penalties ${String(appliedSoftPenaltyTotal)}, hard violations ${String(hardViolationCount)}) — non-finite fold totals are typed errors, never silent clamps`,
        },
      ],
    };
  }

  const ranking = [...ordered]
    .sort((left, right) => {
      const delta = comparePolicyEvaluations(right.evaluation, left.evaluation);
      return delta !== 0 ? delta : String(left.trajectoryId).localeCompare(String(right.trajectoryId));
    })
    .map((record) => record.trajectoryId);

  const reduction: ExperimentReduction = {
    trajectoryCount: ordered.length,
    combinedScoreTotal,
    appliedSoftPenaltyTotal,
    hardViolationCount,
    compliance: compliant ? "compliant" : "non-compliant",
    ranking,
  };
  Object.freeze(reduction);

  const integrity: IntegrityRequirementKind[] = [...manifest.integrity];
  const canonicalContent = {
    experimentId: String(manifest.experimentId),
    policyId: policy.descriptor.policyId,
    trajectories: summaries.map((summary) => [
      String(summary.trajectoryId),
      summary.policyId,
      summary.combinedScore,
      summary.appliedSoftPenaltyTotal,
      summary.hardViolationCount,
      summary.compliance,
    ]),
    holdoutSplits: aggregations.map((aggregation) => [
      aggregation.axisId,
      String(aggregation.kind),
      aggregation.derivation,
      aggregation.train.map((summary) => String(summary.trajectoryId)),
      aggregation.evaluation.map((summary) => String(summary.trajectoryId)),
      aggregation.unassigned.map((summary) => String(summary.trajectoryId)),
    ]),
    integrity,
    reduction,
  };
  const evaluationId = `${EXPERIMENT_EVALUATION_ID_PREFIX}${canonicalDigestHex(canonicalContent)}` as ExperimentEvaluationId;

  const evaluation: ExperimentEvaluation = {
    evaluationId,
    experimentId: manifest.experimentId,
    policyId: policy.descriptor.policyId,
    trajectories: summaries,
    holdoutSplits: aggregations,
    integrity,
    reduction,
  };
  Object.freeze(evaluation);
  return { ok: true, evaluation };
}
