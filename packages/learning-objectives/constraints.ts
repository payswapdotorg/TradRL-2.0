/**
 * The constraint contract (W036) — hard/soft constraints as DATA, with
 * typed, ordered, evidence-linked violation records.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — "Risk, authorization, venue policy
 * and execution gates are runtime controls, not model prompt instructions."
 * This module is the DECLARATION side of that law for evaluation: a
 * constraint spec is a typed record (limits, policies, permission
 * boundaries, budgets, penalty shapes) — data an evaluator walks and an
 * auditor reads. It is never prompt text, and this package never ENFORCES
 * anything (the world runtime's own gates stay the sole authority); it
 * EVALUATES evidence against the declared boundaries and records what the
 * evidence shows.
 *
 * Spec: spec/ARCHITECTURE.md §13 — "Evaluation is constraint-aware": hard
 * violations (risk limits, venue policy, authorization gates) and soft
 * penalties (shaped budgets) are first-class records, each linked to the
 * capsule/decision/command it arose from. Violations are TYPED, ORDERED,
 * EVIDENCE-LINKED records — never strings — and the canonical record order
 * (capsule index, canonical constraint kind, constraint id, code) is a
 * total order: identical evidence + identical program ⇒ identical records
 * (A9).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CommandId, OrderKind, RiskLimits, TimestampMs } from "tradrl-world-contracts";
// DecisionId is NOT re-exported by the contracts root index (it lives in the
// registered `cognitiveSubstrate` subpath, exactly as agent-world-protocol
// imports it) — the deviation W030 hit with QueryPort, avoided here upfront.
import type { DecisionId } from "tradrl-world-contracts/cognitiveSubstrate";
import type { EvidenceError } from "./evidence.js";
import { isCanonicalDecimal } from "./decimal.js";

// --- the constraint vocabulary (closed sets, canonical order) ------------------

/** Hard constraint kinds: boundaries whose breach is a compliance fact. */
export type HardConstraintKind =
  | "risk-limit" // the A13 risk-limit family, declared in the RiskLimits shape
  | "venue-policy" // a venue's declared order-kind policy
  | "authorization-gate"; // the account permission boundary (incl. no live execution)

/** Soft constraint kinds: shaped budgets whose breach is a penalty, not a breach. */
export type SoftConstraintKind =
  | "exposure-budget" // soft gross-exposure budget (fraction of equity)
  | "turnover-budget" // soft per-view command budget
  | "drawdown-envelope"; // soft drawdown envelope (fraction of peak equity)

export type ConstraintKind = HardConstraintKind | SoftConstraintKind;

/** The canonical constraint kind order (hard families first). */
export const HARD_CONSTRAINT_KINDS: readonly HardConstraintKind[] = [
  "risk-limit",
  "venue-policy",
  "authorization-gate",
];
export const SOFT_CONSTRAINT_KINDS: readonly SoftConstraintKind[] = [
  "exposure-budget",
  "turnover-budget",
  "drawdown-envelope",
];
/** The canonical order — record ordering and program canonicalization. */
export const CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  ...HARD_CONSTRAINT_KINDS,
  ...SOFT_CONSTRAINT_KINDS,
];

/** The shaped penalty of one soft constraint (data, never prose). */
export interface PenaltyShape {
  readonly shape: "linear" | "quadratic";
  /** Positive finite coefficient. */
  readonly coefficient: number;
}

// --- the hard constraint specs (declaration only; enforcement is runtime's) ----

export interface RiskLimitConstraintSpec {
  readonly constraintId: string;
  readonly kind: "risk-limit";
  /** The declared boundary, in the A13 `RiskLimits` shape (unset = unchecked). */
  readonly limits: RiskLimits;
}

export interface VenuePolicyConstraintSpec {
  readonly constraintId: string;
  readonly kind: "venue-policy";
  /** The order kinds this policy admits (non-empty; the venue's allow-list). */
  readonly allowedOrderKinds: readonly OrderKind[];
}

export interface AuthorizationGateConstraintSpec {
  readonly constraintId: string;
  readonly kind: "authorization-gate";
  /**
   * The declared permission boundary. `liveExecutionAllowed: false` is the
   * World Alpha law (A14) — the contract shape records it as data.
   */
  readonly requiredPermissions: {
    readonly canTrade: boolean;
    readonly canShort: boolean;
    readonly liveExecutionAllowed: boolean;
  };
}

export type HardConstraintSpec =
  | RiskLimitConstraintSpec
  | VenuePolicyConstraintSpec
  | AuthorizationGateConstraintSpec;

// --- the soft constraint specs (shaped budgets) --------------------------------

export interface ExposureBudgetConstraintSpec {
  readonly constraintId: string;
  readonly kind: "exposure-budget";
  /** Max gross exposure as a fraction of equity, ∈ (0, 1]. */
  readonly maxGrossExposureFraction: number;
  readonly penalty: PenaltyShape;
}

export interface TurnoverBudgetConstraintSpec {
  readonly constraintId: string;
  readonly kind: "turnover-budget";
  /** Max issued commands per view (pass), ≥ 0. */
  readonly maxCommandsPerView: number;
  readonly penalty: PenaltyShape;
}

export interface DrawdownEnvelopeConstraintSpec {
  readonly constraintId: string;
  readonly kind: "drawdown-envelope";
  /** Max drawdown as a fraction of peak equity, ∈ (0, 1]. */
  readonly maxDrawdownFraction: number;
  readonly penalty: PenaltyShape;
}

export type SoftConstraintSpec =
  | ExposureBudgetConstraintSpec
  | TurnoverBudgetConstraintSpec
  | DrawdownEnvelopeConstraintSpec;

export type ConstraintSpec = HardConstraintSpec | SoftConstraintSpec;

// --- the violation/penalty records (typed, ordered, evidence-linked) -----------

/** The closed hard-violation code set (grouped by kind). */
export type HardViolationCode =
  // risk-limit: proposed order quantity / observed position / observed gross
  // exposure / observed drawdown beyond the declared caps, buying power under
  // the declared floor, or a breach the runtime's own gates recorded.
  | "order-quantity"
  | "position-quantity"
  | "gross-exposure"
  | "drawdown"
  | "buying-power"
  | "runtime-breach"
  | "order-kind-not-allowed" // venue-policy: a proposed kind outside the policy
  | "authorization-denied"; // authorization-gate: an observed authorize-stage denial

/** One hard-constraint violation: a typed, evidence-linked record. */
export interface HardConstraintViolation {
  readonly severity: "hard";
  readonly constraintId: string;
  readonly kind: HardConstraintKind;
  readonly code: HardViolationCode;
  /** The declared boundary / the observed value (deterministic renderings). */
  readonly limit: string;
  readonly observed: string;
  /** The stream index of the capsule the violation arose from. */
  readonly capsuleIndex: number;
  readonly occurredAt: TimestampMs;
  /** Present when the violation arises from one proposed command. */
  readonly decisionId?: DecisionId;
  readonly commandId?: CommandId;
}

/** The closed soft-violation code set (grouped by kind). */
export type SoftViolationCode =
  | "exposure-over-budget"
  | "commands-over-budget"
  | "drawdown-over-envelope";

/** One soft-constraint penalty: a typed, evidence-linked shaped record. */
export interface SoftConstraintPenalty {
  readonly severity: "soft";
  readonly constraintId: string;
  readonly kind: SoftConstraintKind;
  readonly code: SoftViolationCode;
  /** The declared budget (deterministic rendering). */
  readonly budget: string;
  /** The exceedance magnitude (deterministic; the budget's own unit). */
  readonly magnitude: number;
  /** coefficient × magnitude (linear) / × magnitude² (quadratic). */
  readonly penalty: number;
  readonly capsuleIndex: number;
  readonly occurredAt: TimestampMs;
}

// --- the constraint program (the registry) -------------------------------------

/** The declared program: an id + the ordered constraint specs. */
export interface ConstraintProgramSpec {
  readonly programId: string;
  readonly constraints: readonly ConstraintSpec[];
}

export type ConstraintProgramErrorCode =
  | "blank-program-id"
  | "blank-constraint-id"
  | "empty-program" // no constraints: no boundary at all
  | "duplicate-constraint-id" // the registry key is the constraint id
  | "unknown-constraint-kind"
  | "empty-allowed-order-kinds"
  | "invalid-budget-fraction" // not a number in (0, 1]
  | "invalid-command-budget" // negative or non-finite
  | "invalid-penalty-shape" // bad shape or non-positive/non-finite coefficient
  | "malformed-decimal"; // a declared limit is not canonical decimal text

/** One typed constraint-program construction error. */
export interface ConstraintProgramError {
  readonly code: ConstraintProgramErrorCode;
  readonly message: string;
  readonly constraintId?: string;
}

export type ConstraintProgramOutcome =
  | { readonly ok: true; readonly program: ConstraintProgram }
  | { readonly ok: false; readonly errors: readonly ConstraintProgramError[] };

/**
 * A constructed constraint program — THE REGISTRY: constraints are
 * registered by id at construction (duplicates refused, kinds closed,
 * budgets validated), and every evaluation reference resolves against this
 * registry. An UNREGISTERED constraint id referenced anywhere (e.g. by an
 * evaluation policy) is a typed error, never a silent skip.
 */
export interface ConstraintProgram {
  /** The canonicalized descriptor (constraints in canonical kind order). */
  readonly descriptor: ConstraintProgramSpec;
  /** The registered constraint ids, canonical order then id. */
  readonly constraintIds: readonly string[];
  /** Registry lookup. */
  has(constraintId: string): boolean;
}

function constraintKindIndex(kind: string): number {
  return CONSTRAINT_KINDS.indexOf(kind as ConstraintKind);
}

/** Construct the constraint program (the registry gate; fail-closed). */
export function createConstraintProgram(spec: ConstraintProgramSpec): ConstraintProgramOutcome {
  const errors: ConstraintProgramError[] = [];
  if (spec.programId.trim().length === 0) {
    errors.push({ code: "blank-program-id", message: "the constraint program id is blank" });
  }
  if (spec.constraints.length === 0) {
    errors.push({
      code: "empty-program",
      message: "the constraint program declares no constraints — constraint-aware evaluation requires at least one boundary",
    });
  }
  const seenIds = new Set<string>();
  for (const constraint of spec.constraints) {
    const id = String(constraint.constraintId);
    if (id.trim().length === 0) {
      errors.push({
        code: "blank-constraint-id",
        message: "a constraint declares a blank id — every registry entry is named",
      });
      continue;
    }
    if (seenIds.has(id)) {
      errors.push({
        code: "duplicate-constraint-id",
        message: `the constraint id '${id}' is registered twice — the registry key is unique`,
        constraintId: id,
      });
    }
    seenIds.add(id);
    if (constraintKindIndex(constraint.kind) < 0) {
      errors.push({
        code: "unknown-constraint-kind",
        message: `unknown constraint kind '${String(constraint.kind)}' (the closed set: ${CONSTRAINT_KINDS.join(", ")})`,
        constraintId: id,
      });
      continue;
    }
    if (constraint.kind === "risk-limit") {
      const declared = [
        constraint.limits.maxOrderQuantity,
        constraint.limits.maxPositionQuantity,
        constraint.limits.maxGrossExposure?.amount,
        constraint.limits.maxDrawdown?.amount,
        constraint.limits.minBuyingPowerAfterOrder?.amount,
      ];
      if (declared.some((value) => value !== undefined && !isCanonicalDecimal(value))) {
        errors.push({
          code: "malformed-decimal",
          message: `the risk-limit constraint '${id}' declares a limit that is not canonical decimal text — boundaries are data, and malformed data fails closed`,
          constraintId: id,
        });
      }
    }
    if (constraint.kind === "venue-policy" && constraint.allowedOrderKinds.length === 0) {
      errors.push({
        code: "empty-allowed-order-kinds",
        message: `the venue-policy constraint '${id}' allows no order kinds — an empty policy is not a boundary`,
        constraintId: id,
      });
    }
    if (constraint.kind === "exposure-budget" || constraint.kind === "drawdown-envelope") {
      const fraction =
        constraint.kind === "exposure-budget"
          ? constraint.maxGrossExposureFraction
          : constraint.maxDrawdownFraction;
      if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
        errors.push({
          code: "invalid-budget-fraction",
          message: `the '${constraint.kind}' constraint '${id}' declares a budget fraction of ${String(fraction)} — it must be in (0, 1]`,
          constraintId: id,
        });
      }
    }
    if (constraint.kind === "turnover-budget") {
      const budget = constraint.maxCommandsPerView;
      if (!Number.isFinite(budget) || budget < 0) {
        errors.push({
          code: "invalid-command-budget",
          message: `the turnover-budget constraint '${id}' declares a per-view command budget of ${String(budget)} — it must be ≥ 0 and finite`,
          constraintId: id,
        });
      }
    }
    if ("penalty" in constraint) {
      const { penalty } = constraint;
      if (
        (penalty.shape !== "linear" && penalty.shape !== "quadratic") ||
        !Number.isFinite(penalty.coefficient) ||
        penalty.coefficient <= 0
      ) {
        errors.push({
          code: "invalid-penalty-shape",
          message: `the soft constraint '${id}' declares an invalid penalty shape (${String(penalty.shape)} × ${String(penalty.coefficient)}) — 'linear'/'quadratic' with a positive finite coefficient`,
          constraintId: id,
        });
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonicalConstraints = [...spec.constraints]
    .sort((left, right) => constraintKindIndex(left.kind) - constraintKindIndex(right.kind))
    .map((constraint) => ({ ...constraint }));
  const descriptor: ConstraintProgramSpec = { ...spec, constraints: canonicalConstraints };
  const constraintIds = canonicalConstraints
    .map((constraint) => String(constraint.constraintId))
    .sort((left, right) => left.localeCompare(right));
  return {
    ok: true,
    program: {
      descriptor,
      constraintIds,
      has: (constraintId: string): boolean => constraintIds.includes(constraintId),
    },
  };
}

// --- the evaluation result (the `constraintEvaluation.ts` surface) -------------

/** The compliance verdict of one evaluated stream. */
export type ConstraintCompliance = "compliant" | "non-compliant";

/** The complete constraint evaluation of one stream under one program. */
export interface ConstraintEvaluation {
  readonly programId: string;
  /** Hard violations, canonical order (never strings). */
  readonly violations: readonly HardConstraintViolation[];
  /** Soft penalties, canonical order. */
  readonly penalties: readonly SoftConstraintPenalty[];
  readonly hardViolationCount: number;
  /** Σ penalty, folded in canonical order (finite by construction). */
  readonly softPenaltyTotal: number;
  readonly compliance: ConstraintCompliance;
}

export type ConstraintEvaluationErrorCode =
  | "malformed-evidence" // the stream failed validation (errors carried)
  | "check-error"; // a checker failed closed (its own typed error carried)

export interface ConstraintEvaluationError {
  readonly code: ConstraintEvaluationErrorCode;
  readonly message: string;
  /** Present on `malformed-evidence`: the evidence errors, verbatim. */
  readonly evidenceErrors?: readonly EvidenceError[];
  /** Present on `check-error`: the failing checker's own typed error. */
  readonly checkError?: ConstraintCheckError;
}

export type ConstraintEvaluationOutcome =
  | { readonly ok: true; readonly evaluation: ConstraintEvaluation }
  | { readonly ok: false; readonly errors: readonly ConstraintEvaluationError[] };

/** One typed checker failure (the money-reading discipline's family). */
export type ConstraintCheckErrorCode =
  | "missing-portfolio-read"
  | "mixed-currency"
  | "malformed-decimal"
  | "non-finite-reading"
  | "non-positive-equity"
  | "non-finite-penalty"
  | "unknown-constraint-kind";

export interface ConstraintCheckError {
  readonly constraintId: string;
  readonly code: ConstraintCheckErrorCode;
  readonly message: string;
}
