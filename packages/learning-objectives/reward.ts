/**
 * The reward contract (W036) — reward as a FUNCTION OVER EVIDENCE, composed
 * of typed components, with the sole-P&L law enforced structurally.
 *
 * Spec: spec/ARCHITECTURE.md §12 Future learning — learning may use many
 * methods "depending on evidence"; §13 Evaluation — "Raw P&L is never the
 * sole objective." THIS PACKAGE MAKES THAT LAW A CONSTRUCTION-TIME TYPE
 * GATE: a reward model whose components are ALL from the financial-outcome
 * family (a single `realized-pnl` component being the literal case) is
 * REJECTED at construction with the loud typed error `pnl-sole-objective`
 * naming the law — the unlawful model never exists as an object, so no
 * evaluation can ever run it.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: a fixed reward model +
 * a fixed evidence stream produce the identical reward evaluation. The
 * reduction is CANONICAL, not positional: components reduce in the closed
 * canonical kind order (never declaration order — a permuted declaration
 * of the same components canonicalizes to the identical model), each
 * component's score is the clamped raw/scale, the total is the ordered
 * weighted sum, and non-finite values anywhere are typed errors (the
 * explicit overflow rule), never clamped silently.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — authority outside prompts: a reward
 * model is DATA (a declarable, auditable specification), and the component
 * semantics are the closed tables in `components.ts` — nothing here reads a
 * prompt, a model output, or a wall clock.
 *
 * This module is the CONTRACT: kinds, specs, construction validation, the
 * reduction semantics and the comparator. The per-kind evaluators (the pure
 * functions over evidence) live in `components.ts`.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceError, EvidenceStream } from "./evidence.js";
import { validateEvidenceStream } from "./evidence.js";
import { evaluateRewardComponent } from "./components.js";
import type { RewardComponentError } from "./components.js";

// ---------------------------------------------------------------------------
// The component vocabulary (closed set, canonical order)
// ---------------------------------------------------------------------------

/** The closed reward-component kind set, in CANONICAL reduction order. */
export type RewardComponentKind =
  | "realized-pnl" // the financial outcome (financial-outcome family)
  | "risk-adjusted-return" // outcome per unit of realized risk (financial-outcome family)
  | "drawdown-control" // worst peak-to-trough equity, penalty-shaped (risk-control family)
  | "exposure-discipline" // time-averaged gross exposure as a fraction of equity, penalty-shaped (risk-control family)
  | "execution-quality" // acks vs typed rejections of issued commands (process family)
  | "protocol-compliance"; // admission-gate refusals across passes (process family)

/** The canonical order — the reduction NEVER follows declaration order. */
export const REWARD_COMPONENT_KINDS: readonly RewardComponentKind[] = [
  "realized-pnl",
  "risk-adjusted-return",
  "drawdown-control",
  "exposure-discipline",
  "execution-quality",
  "protocol-compliance",
];

/** The component families (the §13 law's structural lever). */
export type RewardComponentFamily =
  | "financial-outcome" // P&L-derived readings
  | "risk-control" // risk-shaped readings
  | "process"; // behavior/discipline readings

/** The family table (closed; a contract change extends it deliberately). */
export const REWARD_COMPONENT_FAMILY: Readonly<
  Record<RewardComponentKind, RewardComponentFamily>
> = {
  "realized-pnl": "financial-outcome",
  "risk-adjusted-return": "financial-outcome",
  "drawdown-control": "risk-control",
  "exposure-discipline": "risk-control",
  "execution-quality": "process",
  "protocol-compliance": "process",
};

// ---------------------------------------------------------------------------
// The reward model (declaration + construction gate)
// ---------------------------------------------------------------------------

/** One declared reward component: kind + weight + normalization scale. */
export interface RewardComponentSpec {
  readonly kind: RewardComponentKind;
  /** Reduction weight: positive, finite. */
  readonly weight: number;
  /**
   * Normalization scale: positive, finite. The component's score is
   * `clamp(rawValue / scale, -1, +1)` — the declared "what counts as full
   * credit (or full blame)" magnitude in the component's own raw unit.
   */
  readonly scale: number;
}

/** The declared reward model (data, never prompt text). */
export interface RewardModelSpec {
  readonly modelId: string;
  readonly version: string;
  /** At least one component; kinds unique; NOT all financial-outcome. */
  readonly components: readonly RewardComponentSpec[];
}

/** One typed reward-model construction error (closed set). */
export interface RewardModelError {
  readonly code: RewardModelErrorCode;
  readonly message: string;
}

export type RewardModelErrorCode =
  | "blank-model-id"
  | "blank-version"
  | "empty-model"
  /**
   * THE §13 LAW, structural: "Raw P&L is never the sole objective" — every
   * declared component is from the financial-outcome family.
   */
  | "pnl-sole-objective"
  | "unknown-component-kind"
  | "duplicate-component-kind"
  | "invalid-weight"
  | "invalid-scale";

/** The construction outcome: the canonicalized model, or typed errors. */
export type RewardModelOutcome =
  | { readonly ok: true; readonly model: RewardModel }
  | { readonly ok: false; readonly errors: readonly RewardModelError[] };

/** A constructed reward model: the canonicalized declaration + the gate. */
export interface RewardModel {
  /**
   * The canonicalized descriptor: components re-ordered into the canonical
   * kind order (a permuted declaration of the same components yields the
   * IDENTICAL descriptor — A9).
   */
  readonly descriptor: RewardModelSpec;
  /** The canonical component kind sequence (the reduction order). */
  readonly componentKinds: readonly RewardComponentKind[];
  /** Evaluate the model over one evidence stream (fail-closed). */
  evaluate(stream: EvidenceStream): RewardEvaluationOutcome;
}

function canonicalKindIndex(kind: string): number {
  return REWARD_COMPONENT_KINDS.indexOf(kind as RewardComponentKind);
}

/**
 * Construct the reward model — THE CONSTRUCTION GATE. Every law is checked
 * here, loudly: structure, closed kinds, uniqueness, positive finite
 * weight/scale, and the §13 sole-P&L law (a model whose components are all
 * financial-outcome is refused; the message names the law).
 */
export function createRewardModel(spec: RewardModelSpec): RewardModelOutcome {
  const errors: RewardModelError[] = [];
  if (spec.modelId.trim().length === 0) {
    errors.push({ code: "blank-model-id", message: "the reward model id is blank" });
  }
  if (spec.version.trim().length === 0) {
    errors.push({ code: "blank-version", message: "the reward model version is blank" });
  }
  if (spec.components.length === 0) {
    errors.push({
      code: "empty-model",
      message: "the reward model declares no components — an objective with no axes is invalid",
    });
  }
  const seenKinds = new Set<RewardComponentKind>();
  let financialOutcomeCount = 0;
  for (const component of spec.components) {
    if (canonicalKindIndex(component.kind) < 0) {
      errors.push({
        code: "unknown-component-kind",
        message: `unknown reward component kind '${String(component.kind)}' (the closed set: ${REWARD_COMPONENT_KINDS.join(", ")})`,
      });
      continue;
    }
    if (seenKinds.has(component.kind)) {
      errors.push({
        code: "duplicate-component-kind",
        message: `the reward component kind '${component.kind}' is declared twice (compose by weight, never by repetition)`,
      });
    }
    seenKinds.add(component.kind);
    if (REWARD_COMPONENT_FAMILY[component.kind] === "financial-outcome") {
      financialOutcomeCount += 1;
    }
    if (!Number.isFinite(component.weight) || component.weight <= 0) {
      errors.push({
        code: "invalid-weight",
        message: `the '${component.kind}' component weight must be positive and finite (got ${String(component.weight)})`,
      });
    }
    if (!Number.isFinite(component.scale) || component.scale <= 0) {
      errors.push({
        code: "invalid-scale",
        message: `the '${component.kind}' component scale must be positive and finite (got ${String(component.scale)})`,
      });
    }
  }
  if (
    spec.components.length > 0 &&
    financialOutcomeCount === spec.components.length &&
    errors.every((error) => error.code !== "unknown-component-kind")
  ) {
    errors.push({
      code: "pnl-sole-objective",
      message:
        "Raw P&L is never the sole objective (spec/ARCHITECTURE.md §13): every declared component is from the financial-outcome family — the model must compose at least one risk-control or process component",
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonicalComponents = [...spec.components]
    .sort((left, right) => canonicalKindIndex(left.kind) - canonicalKindIndex(right.kind))
    .map((component) => ({ ...component }));
  const descriptor: RewardModelSpec = { ...spec, components: canonicalComponents };
  const componentKinds = canonicalComponents.map((component) => component.kind);
  return {
    ok: true,
    model: {
      descriptor,
      componentKinds,
      evaluate: (stream: EvidenceStream): RewardEvaluationOutcome =>
        evaluateReward({ descriptor, componentKinds }, stream),
    },
  };
}

// ---------------------------------------------------------------------------
// The evaluation result + the reduction semantics
// ---------------------------------------------------------------------------

/** Which evidence a component actually read (provenance, as data). */
export interface RewardComponentProvenance {
  /** The stream indices of the capsules that contributed the readings. */
  readonly capsuleIndices: readonly number[];
  /** Deterministic renderings of the specific readings used. */
  readonly readings: readonly string[];
}

/** One component's evaluated result (all numbers finite). */
export interface RewardComponentResult {
  readonly kind: RewardComponentKind;
  /** The component's raw value, in the component's own raw unit. */
  readonly rawValue: number;
  /** `clamp(rawValue / scale, -1, +1)` — the normalized score. */
  readonly score: number;
  readonly weight: number;
  /** `weight * score` — the reduction contribution. */
  readonly contribution: number;
  readonly provenance: RewardComponentProvenance;
}

/** The complete reward evaluation of one stream under one model. */
export interface RewardEvaluation {
  readonly modelId: string;
  readonly version: string;
  readonly capsuleCount: number;
  /** Canonical kind order (never declaration order). */
  readonly components: readonly RewardComponentResult[];
  /** The ordered weighted sum (canonical order; always finite). */
  readonly total: number;
}

/** One typed reward-evaluation error (fail-closed seam). */
export interface RewardEvaluationError {
  readonly code: RewardEvaluationErrorCode;
  readonly message: string;
  /** Present on `malformed-evidence`: the evidence errors, verbatim. */
  readonly evidenceErrors?: readonly EvidenceError[];
  /** Present on `component-error`: the component's own typed error. */
  readonly componentError?: RewardComponentError;
}

export type RewardEvaluationErrorCode =
  | "malformed-evidence"
  | "component-error"
  | "non-finite-total";

export type RewardEvaluationOutcome =
  | { readonly ok: true; readonly evaluation: RewardEvaluation }
  | { readonly ok: false; readonly errors: readonly RewardEvaluationError[] };

/**
 * THE REDUCTION (deterministic, canonical): validate the evidence (fail-
 * closed), evaluate each component in the canonical kind order, and fold the
 * contributions in that same order. Overflow rule: any non-finite raw value
 * or non-finite total is a typed error — never a silent clamp, never NaN.
 */
export function evaluateReward(
  model: Pick<RewardModel, "descriptor" | "componentKinds">,
  stream: EvidenceStream,
): RewardEvaluationOutcome {
  const evidence = validateEvidenceStream(stream);
  if (!evidence.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-evidence",
          message: `[learning-objectives] the evidence stream failed validation (${String(evidence.errors.length)} error(s)) — reward is never computed over malformed evidence`,
          evidenceErrors: evidence.errors,
        },
      ],
    };
  }
  const errors: RewardEvaluationError[] = [];
  const results: RewardComponentResult[] = [];
  const byKind = new Map(model.descriptor.components.map((c) => [c.kind, c]));
  for (const kind of model.componentKinds) {
    const spec = byKind.get(kind);
    if (spec === undefined) {
      errors.push({
        code: "component-error",
        message: `the canonical kind '${kind}' has no declared spec — a construction law was bypassed`,
      });
      continue;
    }
    const outcome = evaluateRewardComponent(spec, stream);
    if (!outcome.ok) {
      errors.push({
        code: "component-error",
        message: `the '${kind}' component failed closed (${outcome.error.code}: ${outcome.error.message})`,
        componentError: outcome.error,
      });
      continue;
    }
    results.push(outcome.result);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  let total = 0;
  for (const result of results) {
    total += result.contribution;
  }
  if (!Number.isFinite(total)) {
    return {
      ok: false,
      errors: [
        {
          code: "non-finite-total",
          message:
            "[learning-objectives] the canonical weighted sum overflowed to a non-finite total — the model's weights/scales are out of evaluation range (fail-closed)",
        },
      ],
    };
  }
  return {
    ok: true,
    evaluation: {
      modelId: model.descriptor.modelId,
      version: model.descriptor.version,
      capsuleCount: stream.capsules.length,
      components: results,
      total,
    },
  };
}

/**
 * The deterministic comparator with EXPLICIT TIE RULES: compare totals; on
 * an exact tie, compare the canonical-order component scores lexicographi-
 * cally; all-equal compares 0. Misuse guard: throws loudly when the two
 * evaluations do not share the same canonical component sequence (comparing
 * evaluations of different models is a protocol breach, never a number).
 */
export function compareRewardEvaluations(a: RewardEvaluation, b: RewardEvaluation): -1 | 0 | 1 {
  const kindsOf = (evaluation: RewardEvaluation): string =>
    evaluation.components.map((component) => component.kind).join(",");
  if (kindsOf(a) !== kindsOf(b)) {
    throw new Error(
      `[learning-objectives] compareRewardEvaluations requires the same canonical component sequence ('${kindsOf(a)}' vs '${kindsOf(b)}') — comparing evaluations of different models is a protocol breach`,
    );
  }
  if (a.total !== b.total) {
    return a.total < b.total ? -1 : 1;
  }
  for (const [index, component] of a.components.entries()) {
    const other = b.components[index];
    if (other === undefined || component.score !== other.score) {
      return component.score < (other?.score ?? 0) ? -1 : 1;
    }
  }
  return 0;
}
