/**
 * The §13 evaluation-policy descriptor (W036) — the evaluation AXES as typed
 * structures plus the deterministic reduction semantics.
 *
 * Spec: spec/ARCHITECTURE.md §13 — "Evaluation is constraint-aware and
 * includes unseen periods, walk-forward, regime/asset/venue holdouts,
 * execution stress, adversarial stress, organization ablations, model
 * substitution and search-history integrity. Raw P&L is never the sole
 * objective." Every axis family named there is a CLOSED, CANONICALLY-ORDERED
 * kind set here: a declarative shape W038 (evaluation/verification) can later
 * walk. W036 defines the types, the validation, and the reduction ONLY — no
 * experiment orchestration, no holdout splitting, no stress generation.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the reduction is pure and
 * canonical. Component results combine in the closed canonical kind order
 * (`REWARD_COMPONENT_KINDS` — never declaration order), the policy's
 * penalized soft constraints fold in canonical record order, and identical
 * inputs ⇒ identical results (no wall time, no randomness).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — constraint-aware evaluation: HARD
 * violations are compliance GATES, never priced trade-offs — naming a hard
 * constraint in `penalizedConstraintIds` is a typed construction error. Only
 * SOFT shaped penalties may enter the combined score, converted by the
 * declared `penaltyWeight`. EXPLICIT RULES, never silent: overflow (a
 * non-finite combined score) is the typed error `non-finite-combined`, and
 * the comparator's tie ladder is a total, deterministic order.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceStream } from "./evidence.js";
import { evaluateReward } from "./reward.js";
import type {
  RewardEvaluation,
  RewardEvaluationError,
  RewardModel,
} from "./reward.js";
import { evaluateConstraints } from "./constraintEvaluation.js";
import { renderNumber } from "./decimal.js";
import type {
  ConstraintCompliance,
  ConstraintEvaluation,
  ConstraintEvaluationError,
  ConstraintProgram,
} from "./constraints.js";
import { CONSTRAINT_KINDS, SOFT_CONSTRAINT_KINDS } from "./constraints.js";

// ---------------------------------------------------------------------------
// The §13 axis vocabulary (closed sets, canonical order)
// ---------------------------------------------------------------------------

/** Holdout kinds (§13: "unseen periods, walk-forward, regime/asset/venue holdouts"). */
export type HoldoutKind =
  | "unseen-period" // evaluation over a time range never seen in training
  | "walk-forward" // the rolling refit/re-evaluate discipline
  | "regime" // held-out market regimes
  | "asset" // held-out instruments/assets
  | "venue"; // held-out venues

/** The canonical holdout kind order (canonicalization + walking order). */
export const HOLDOUT_KINDS: readonly HoldoutKind[] = [
  "unseen-period",
  "walk-forward",
  "regime",
  "asset",
  "venue",
];

/** Stress kinds (§13: "execution stress, adversarial stress"). */
export type StressKind =
  | "execution" // degraded execution conditions (latency, fills, slippage)
  | "adversarial"; // adversarial market/counterparty pressure

/** The canonical stress kind order. */
export const STRESS_KINDS: readonly StressKind[] = ["execution", "adversarial"];

/** Ablation kinds (§13: "organization ablations, model substitution"). */
export type AblationKind =
  | "organization" // remove/substitute one organization component
  | "model-substitution"; // substitute the model under test

/** The canonical ablation kind order. */
export const ABLATION_KINDS: readonly AblationKind[] = ["organization", "model-substitution"];

/**
 * Integrity requirements. §13 names "search-history integrity"; the other two
 * are this package's own enforced integrity laws — the §10 evidence-chain
 * validation every evaluation seam runs, and the A9 deterministic-replay
 * discipline (twin evaluation identity).
 */
export type IntegrityRequirementKind =
  | "search-history" // §13: the model's search/optimization history is honest
  | "evidence-chain" // §10: capsules validate (the fail-closed seam law)
  | "deterministic-replay"; // A9: fixed inputs reproduce identical results

/** The canonical integrity requirement order. */
export const INTEGRITY_REQUIREMENT_KINDS: readonly IntegrityRequirementKind[] = [
  "search-history",
  "evidence-chain",
  "deterministic-replay",
];

// ---------------------------------------------------------------------------
// The axis descriptors + the policy spec
// ---------------------------------------------------------------------------

/** One declared holdout axis (an id + its kind; the split itself is W038's). */
export interface HoldoutDescriptor {
  readonly axisId: string;
  readonly kind: HoldoutKind;
}

/** One declared stress axis. */
export interface StressDescriptor {
  readonly axisId: string;
  readonly kind: StressKind;
}

/** One declared ablation axis. */
export interface AblationDescriptor {
  readonly axisId: string;
  readonly kind: AblationKind;
}

/** The declared evaluation axes (§13's families, as data). */
export interface EvaluationPolicyAxes {
  readonly holdouts: readonly HoldoutDescriptor[];
  readonly stresses: readonly StressDescriptor[];
  readonly ablations: readonly AblationDescriptor[];
  /** Non-empty (integrity is not optional — §13); unique; canonically ordered. */
  readonly integrity: readonly IntegrityRequirementKind[];
}

/**
 * The declared evaluation policy: WHICH reward model and constraint program
 * it evaluates, WHICH soft constraints' shaped penalties enter the combined
 * score (registry ids — an unregistered id is a typed error, never a silent
 * skip), the penalty conversion coefficient, and the §13 axes.
 */
export interface EvaluationPolicySpec {
  readonly policyId: string;
  readonly rewardModelId: string;
  readonly rewardModelVersion: string;
  readonly constraintProgramId: string;
  /** Soft constraint ids whose penalties enter the combined score (⊆ registry). */
  readonly penalizedConstraintIds: readonly string[];
  /** The soft-penalty → reward-unit conversion coefficient (positive, finite). */
  readonly penaltyWeight: number;
  readonly axes: EvaluationPolicyAxes;
}

/** One typed evaluation-policy construction error (closed set). */
export interface EvaluationPolicyError {
  readonly code: EvaluationPolicyErrorCode;
  readonly message: string;
  /** Present when the error belongs to one axis. */
  readonly axisId?: string;
  /** Present when the error belongs to one constraint reference. */
  readonly constraintId?: string;
}

export type EvaluationPolicyErrorCode =
  | "blank-policy-id"
  | "blank-reward-model-id"
  | "blank-reward-model-version"
  | "blank-constraint-program-id"
  | "reward-model-reference-mismatch"
  | "constraint-program-reference-mismatch"
  | "invalid-penalty-weight"
  | "duplicate-constraint-reference"
  | "unregistered-constraint" // the registry law: unknown ids never silently skip
  | "hard-constraint-penalty" // A13: hard breaches are gates, never priced
  | "blank-axis-id"
  | "duplicate-axis-id"
  | "unknown-holdout-kind"
  | "unknown-stress-kind"
  | "unknown-ablation-kind"
  | "unknown-integrity-requirement"
  | "duplicate-integrity-requirement"
  | "empty-integrity";

/** The construction outcome: the canonicalized policy, or typed errors. */
export type EvaluationPolicyOutcome =
  | { readonly ok: true; readonly policy: EvaluationPolicy }
  | { readonly ok: false; readonly errors: readonly EvaluationPolicyError[] };

/** A constructed evaluation policy: the canonicalized descriptor + the gate. */
export interface EvaluationPolicy {
  /**
   * The canonicalized descriptor: axes in canonical kind order (holdouts,
   * then stresses, then ablations; integrity in canonical order), the
   * penalized constraint ids in canonical constraint order. A permuted
   * declaration of the same policy yields the IDENTICAL descriptor (A9).
   */
  readonly descriptor: EvaluationPolicySpec;
  /** Evaluate the policy over one evidence stream (fail-closed). */
  evaluate(stream: EvidenceStream): PolicyEvaluationOutcome;
}

function error(
  code: EvaluationPolicyErrorCode,
  message: string,
  links?: { axisId?: string; constraintId?: string },
): EvaluationPolicyError {
  return { code, message, ...links };
}

/** Sort one axis family into canonical kind order, then axis id. */
function sortAxes<T extends { readonly kind: string; readonly axisId: string }>(
  descriptors: readonly T[],
  kinds: readonly string[],
): T[] {
  return [...descriptors].sort((left, right) => {
    const kindDelta = kinds.indexOf(left.kind) - kinds.indexOf(right.kind);
    return kindDelta !== 0 ? kindDelta : left.axisId.localeCompare(right.axisId);
  });
}

/** The canonical constraint order of one registry id (kind index, then id). */
function canonicalConstraintIndex(id: string, program: ConstraintProgram): number {
  const constraint = program.descriptor.constraints.find((entry) => entry.constraintId === id);
  const kind = constraint?.kind ?? "";
  const kindDelta = CONSTRAINT_KINDS.indexOf(kind as never);
  return kindDelta < 0 ? Number.MAX_SAFE_INTEGER : kindDelta;
}

/**
 * Construct the evaluation policy — THE CONSTRUCTION GATE. Every law is
 * checked here, loudly: identity blanks, the reference match against the
 * LIVE reward model and constraint program (a policy that cites another
 * model/program than the ones it will evaluate is a typed error), the
 * penalty weight, the registry law (penalized ids must be REGISTERED and
 * SOFT), the closed axis kind sets, axis id uniqueness across all families,
 * and the non-empty integrity requirement.
 */
export function createEvaluationPolicy(
  spec: EvaluationPolicySpec,
  model: Pick<RewardModel, "descriptor" | "componentKinds">,
  program: ConstraintProgram,
): EvaluationPolicyOutcome {
  const errors: EvaluationPolicyError[] = [];
  if (spec.policyId.trim().length === 0) {
    errors.push(error("blank-policy-id", "the evaluation policy id is blank"));
  }
  if (spec.rewardModelId.trim().length === 0) {
    errors.push(error("blank-reward-model-id", "the policy's reward model id is blank"));
  }
  if (spec.rewardModelVersion.trim().length === 0) {
    errors.push(error("blank-reward-model-version", "the policy's reward model version is blank"));
  }
  if (spec.constraintProgramId.trim().length === 0) {
    errors.push(error("blank-constraint-program-id", "the policy's constraint program id is blank"));
  }
  if (!Number.isFinite(spec.penaltyWeight) || spec.penaltyWeight <= 0) {
    errors.push(error("invalid-penalty-weight", `the penaltyWeight must be positive and finite (got ${String(spec.penaltyWeight)}) — the soft-penalty conversion coefficient is a declared law, never a default`));
  }
  if (model.descriptor.modelId !== spec.rewardModelId || model.descriptor.version !== spec.rewardModelVersion) {
    errors.push(error("reward-model-reference-mismatch", `the policy cites reward model '${spec.rewardModelId}' v${spec.rewardModelVersion} but the model under policy is '${model.descriptor.modelId}' v${model.descriptor.version} — a policy never evaluates a model it does not cite`));
  }
  if (program.descriptor.programId !== spec.constraintProgramId) {
    errors.push(error("constraint-program-reference-mismatch", `the policy cites constraint program '${spec.constraintProgramId}' but the program under policy is '${program.descriptor.programId}' — a policy never evaluates a program it does not cite`));
  }
  const axisIds = new Set<string>();
  const axisFamily = (
    descriptors: readonly { readonly axisId: string; readonly kind: string }[],
    kinds: readonly string[],
    unknownCode: EvaluationPolicyErrorCode,
    family: string,
  ): void => {
    for (const descriptor of descriptors) {
      if (descriptor.axisId.trim().length === 0) {
        errors.push(error("blank-axis-id", `a ${family} axis declares a blank id`));
        continue;
      }
      if (axisIds.has(descriptor.axisId)) {
        errors.push(
          error("duplicate-axis-id", `the axis id '${descriptor.axisId}' is declared twice`, {
            axisId: descriptor.axisId,
          }),
        );
      }
      axisIds.add(descriptor.axisId);
      if (!kinds.includes(descriptor.kind)) {
        errors.push(
          error(
            unknownCode,
            `unknown ${family} kind '${String(descriptor.kind)}' (the closed set: ${kinds.join(", ")})`,
            { axisId: descriptor.axisId },
          ),
        );
      }
    }
  };
  axisFamily(spec.axes.holdouts, HOLDOUT_KINDS, "unknown-holdout-kind", "holdout");
  axisFamily(spec.axes.stresses, STRESS_KINDS, "unknown-stress-kind", "stress");
  axisFamily(spec.axes.ablations, ABLATION_KINDS, "unknown-ablation-kind", "ablation");
  if (spec.axes.integrity.length === 0) {
    errors.push(error("empty-integrity", "the policy declares no integrity requirements — §13 evaluation integrity is not optional"));
  }
  const seenIntegrity = new Set<string>();
  for (const requirement of spec.axes.integrity) {
    if (!INTEGRITY_REQUIREMENT_KINDS.includes(requirement)) {
      errors.push(
        error(
          "unknown-integrity-requirement",
          `unknown integrity requirement '${String(requirement)}' (the closed set: ${INTEGRITY_REQUIREMENT_KINDS.join(", ")})`,
        ),
      );
      continue;
    }
    if (seenIntegrity.has(requirement)) {
      errors.push(
        error("duplicate-integrity-requirement", `the integrity requirement '${String(requirement)}' is declared twice`),
      );
    }
    seenIntegrity.add(requirement);
  }
  const seenConstraints = new Set<string>();
  for (const constraintId of spec.penalizedConstraintIds) {
    if (seenConstraints.has(constraintId)) {
      errors.push(
        error("duplicate-constraint-reference", `the penalized constraint id '${constraintId}' is declared twice`, {
          constraintId,
        }),
      );
      continue;
    }
    seenConstraints.add(constraintId);
    const constraint = program.descriptor.constraints.find(
      (entry) => entry.constraintId === constraintId,
    );
    if (constraint === undefined) {
      errors.push(
        error(
          "unregistered-constraint",
          `the penalized constraint id '${constraintId}' is not registered in program '${program.descriptor.programId}' — an unregistered constraint reference is a typed error, never a silent skip`,
          { constraintId },
        ),
      );
      continue;
    }
    if (!(SOFT_CONSTRAINT_KINDS as readonly string[]).includes(constraint.kind)) {
      errors.push(
        error(
          "hard-constraint-penalty",
          `the constraint '${constraintId}' is a HARD constraint ('${String(constraint.kind)}') — hard breaches are compliance gates (A13), never priced penalties`,
          { constraintId },
        ),
      );
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const descriptor: EvaluationPolicySpec = {
    ...spec,
    penalizedConstraintIds: [...spec.penalizedConstraintIds].sort(
      (left, right) =>
        canonicalConstraintIndex(left, program) - canonicalConstraintIndex(right, program) ||
        left.localeCompare(right),
    ),
    axes: {
      holdouts: sortAxes(spec.axes.holdouts, HOLDOUT_KINDS),
      stresses: sortAxes(spec.axes.stresses, STRESS_KINDS),
      ablations: sortAxes(spec.axes.ablations, ABLATION_KINDS),
      integrity: [...spec.axes.integrity].sort(
        (left, right) =>
          INTEGRITY_REQUIREMENT_KINDS.indexOf(left) - INTEGRITY_REQUIREMENT_KINDS.indexOf(right),
      ),
    },
  };
  return {
    ok: true,
    policy: {
      descriptor,
      evaluate: (stream: EvidenceStream): PolicyEvaluationOutcome =>
        evaluateUnderPolicy(descriptor, model, program, stream),
    },
  };
}

// ---------------------------------------------------------------------------
// The reduction semantics (deterministic, canonical, explicit rules)
// ---------------------------------------------------------------------------

/** The complete policy evaluation of one stream under one policy. */
export interface PolicyEvaluation {
  readonly policyId: string;
  /** The reward evaluation (components in canonical kind order). */
  readonly reward: RewardEvaluation;
  /** The constraint evaluation (records in canonical record order). */
  readonly constraints: ConstraintEvaluation;
  /** Σ the POLICY's penalized soft penalties, folded in canonical record order. */
  readonly appliedSoftPenaltyTotal: number;
  /** `reward.total − penaltyWeight × appliedSoftPenaltyTotal` (finite by law). */
  readonly combinedScore: number;
  /** The compliance verdict (`non-compliant` iff any hard violation exists). */
  readonly compliance: ConstraintCompliance;
}

/** One typed policy-evaluation error (fail-closed seam). */
export interface PolicyEvaluationError {
  readonly code: PolicyEvaluationErrorCode;
  readonly message: string;
  /** Present on `reward-error`: the reward seam's own typed errors, verbatim. */
  readonly rewardErrors?: readonly RewardEvaluationError[];
  /** Present on `constraint-error`: the constraint seam's own errors, verbatim. */
  readonly constraintErrors?: readonly ConstraintEvaluationError[];
}

export type PolicyEvaluationErrorCode =
  | "reward-error" // the reward seam failed closed (its errors carried)
  | "constraint-error" // the constraint seam failed closed (its errors carried)
  | "non-finite-combined"; // the EXPLICIT overflow rule (never a silent clamp)

export type PolicyEvaluationOutcome =
  | { readonly ok: true; readonly evaluation: PolicyEvaluation }
  | { readonly ok: false; readonly errors: readonly PolicyEvaluationError[] };

/**
 * THE REDUCTION (deterministic, canonical): evaluate the reward (components
 * combine in the closed canonical kind order — `reward.ts`'s law) and the
 * constraints (records in canonical record order — `constraintEvaluation.ts`'s
 * law), then fold the POLICY's penalized soft penalties in that same record
 * order and convert them once: `combinedScore = reward.total − penaltyWeight
 * × appliedSoftPenaltyTotal`. OVERFLOW RULE: a non-finite combined score is
 * the typed error `non-finite-combined` — never a silent clamp, never NaN.
 * Hard violations never enter the score: they gate the compliance verdict.
 */
export function evaluateUnderPolicy(
  spec: EvaluationPolicySpec,
  model: Pick<RewardModel, "descriptor" | "componentKinds">,
  program: ConstraintProgram,
  stream: EvidenceStream,
): PolicyEvaluationOutcome {
  const reward = evaluateReward(model, stream);
  if (!reward.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "reward-error",
          message: `[learning-objectives] the reward seam failed closed under policy '${spec.policyId}' (${String(reward.errors.length)} error(s)) — the policy never scores over a failed seam`,
          rewardErrors: reward.errors,
        },
      ],
    };
  }
  const constraints = evaluateConstraints(program, stream);
  if (!constraints.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "constraint-error",
          message: `[learning-objectives] the constraint seam failed closed under policy '${spec.policyId}' (${String(constraints.errors.length)} error(s)) — the policy never scores over a failed seam`,
          constraintErrors: constraints.errors,
        },
      ],
    };
  }
  const penalized = new Set(spec.penalizedConstraintIds);
  let appliedSoftPenaltyTotal = 0;
  for (const penalty of constraints.evaluation.penalties) {
    if (penalized.has(penalty.constraintId)) {
      appliedSoftPenaltyTotal += penalty.penalty;
    }
  }
  const combinedScore = reward.evaluation.total - spec.penaltyWeight * appliedSoftPenaltyTotal;
  if (!Number.isFinite(combinedScore)) {
    return {
      ok: false,
      errors: [
        {
          code: "non-finite-combined",
          message: `[learning-objectives] the policy reduction overflowed to a non-finite combined score (reward total ${renderNumber(reward.evaluation.total)} − penaltyWeight × applied penalties ${renderNumber(appliedSoftPenaltyTotal)}) — the declared penaltyWeight is out of evaluation range (fail-closed, never a silent clamp)`,
        },
      ],
    };
  }
  return {
    ok: true,
    evaluation: {
      policyId: spec.policyId,
      reward: reward.evaluation,
      constraints: constraints.evaluation,
      appliedSoftPenaltyTotal,
      combinedScore,
      compliance: constraints.evaluation.compliance,
    },
  };
}

/**
 * The deterministic comparator with the EXPLICIT TIE LADDER (a total order):
 * 1. compliance gates — a compliant evaluation outranks a non-compliant one
 *    at ANY combined score (§13 constraint-aware: hard breaches are gates);
 * 2. the combined score (higher);
 * 3. exact tie → the canonical-order component scores, lexicographically;
 * 4. exact tie → fewer hard violations;
 * 5. exact tie → the smaller applied soft penalty;
 * 6. all-equal → 0.
 * Misuse guard: throws loudly when the two evaluations do not share the same
 * policy id and canonical component sequence (comparing evaluations of
 * different policies is a protocol breach, never a number).
 */
export function comparePolicyEvaluations(a: PolicyEvaluation, b: PolicyEvaluation): -1 | 0 | 1 {
  const kindsOf = (evaluation: PolicyEvaluation): string =>
    evaluation.reward.components.map((component) => component.kind).join(",");
  if (a.policyId !== b.policyId || kindsOf(a) !== kindsOf(b)) {
    throw new Error(
      `[learning-objectives] comparePolicyEvaluations requires the same policy and canonical component sequence ('${a.policyId}'/'${kindsOf(a)}' vs '${b.policyId}'/'${kindsOf(b)}') — comparing evaluations of different policies is a protocol breach`,
    );
  }
  if (a.compliance !== b.compliance) {
    return a.compliance === "compliant" ? 1 : -1;
  }
  if (a.combinedScore !== b.combinedScore) {
    return a.combinedScore < b.combinedScore ? -1 : 1;
  }
  for (const [index, component] of a.reward.components.entries()) {
    const other = b.reward.components[index];
    if (other === undefined || component.score !== other.score) {
      return component.score < (other?.score ?? 0) ? -1 : 1;
    }
  }
  if (a.constraints.hardViolationCount !== b.constraints.hardViolationCount) {
    return a.constraints.hardViolationCount < b.constraints.hardViolationCount ? 1 : -1;
  }
  if (a.appliedSoftPenaltyTotal !== b.appliedSoftPenaltyTotal) {
    return a.appliedSoftPenaltyTotal < b.appliedSoftPenaltyTotal ? 1 : -1;
  }
  return 0;
}
