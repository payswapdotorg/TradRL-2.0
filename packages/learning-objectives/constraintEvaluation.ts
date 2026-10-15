/**
 * The composed constraint evaluation (W036) — one program over one evidence
 * stream, reduced deterministically.
 *
 * The composition: validate the evidence (fail-closed — constraints are
 * never evaluated over malformed evidence), dispatch every REGISTERED
 * constraint in the program's canonical order to its checker, sort all
 * records by the canonical total order, fold the soft penalty total in that
 * same order, and derive the compliance verdict (`non-compliant` iff any
 * hard violation exists — soft penalties shape, never breach).
 *
 * Determinism (A9): fixed program + fixed evidence stream ⇒ identical
 * evaluation — pure functions, canonical orders, no wall time, no
 * randomness, no invented identity.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceStream } from "./evidence.js";
import { validateEvidenceStream } from "./evidence.js";
import { DecimalContractError } from "./decimal.js";
import {
  canonicalRecordOrder,
  CheckerReadError,
  checkAuthorizationGate,
  checkDrawdownEnvelope,
  checkExposureBudget,
  checkRiskLimit,
  checkTurnoverBudget,
  checkVenuePolicy,
} from "./constraintCheckers.js";
import type {
  ConstraintCheckError,
  ConstraintEvaluation,
  ConstraintEvaluationOutcome,
  ConstraintProgram,
  ConstraintSpec,
  HardConstraintViolation,
  SoftConstraintPenalty,
} from "./constraints.js";

/**
 * Evaluate the whole constraint program over one evidence stream. Unknown
 * constraint kinds reaching evaluation (a construction law bypassed) and
 * checker read failures are typed errors — never silent skips.
 */
export function evaluateConstraints(
  program: ConstraintProgram,
  stream: EvidenceStream,
): ConstraintEvaluationOutcome {
  const evidence = validateEvidenceStream(stream);
  if (!evidence.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-evidence",
          message: `[learning-objectives] the evidence stream failed validation (${String(evidence.errors.length)} error(s)) — constraints are never evaluated over malformed evidence`,
          evidenceErrors: evidence.errors,
        },
      ],
    };
  }
  const violations: HardConstraintViolation[] = [];
  const penalties: SoftConstraintPenalty[] = [];
  for (const constraint of program.descriptor.constraints) {
    try {
      switch (constraint.kind) {
        case "risk-limit":
          checkRiskLimit(constraint, stream, violations);
          break;
        case "venue-policy":
          checkVenuePolicy(constraint, stream, violations);
          break;
        case "authorization-gate":
          checkAuthorizationGate(constraint, stream, violations);
          break;
        case "exposure-budget":
          checkExposureBudget(constraint, stream, penalties);
          break;
        case "turnover-budget":
          checkTurnoverBudget(constraint, stream, penalties);
          break;
        case "drawdown-envelope":
          checkDrawdownEnvelope(constraint, stream, penalties);
          break;
        default: {
          // The switch is exhaustive over the closed kind set: reaching here
          // means a program construction law was bypassed. The narrowed
          // `never` is read back through the declared union so the typed
          // record still names the offender.
          const bypassed = constraint as ConstraintSpec;
          return {
            ok: false,
            errors: [
              {
                code: "check-error",
                message: `unknown constraint kind '${String(bypassed.kind)}' reached evaluation — a program construction law was bypassed (fail-closed)`,
                checkError: {
                  constraintId: String(bypassed.constraintId),
                  code: "unknown-constraint-kind",
                  message: `unknown kind '${String(bypassed.kind)}'`,
                },
              },
            ],
          };
        }
      }
    } catch (error) {
      const checkError = constraintCheckErrorOf(constraint.constraintId, error);
      if (checkError !== undefined) {
        return {
          ok: false,
          errors: [
            {
              code: "check-error",
              message: `the '${String(constraint.kind)}' constraint '${String(constraint.constraintId)}' failed closed (${checkError.code}: ${checkError.message})`,
              checkError,
            },
          ],
        };
      }
      throw error;
    }
  }
  violations.sort(canonicalRecordOrder);
  penalties.sort(canonicalRecordOrder);
  let softPenaltyTotal = 0;
  for (const penalty of penalties) {
    if (!Number.isFinite(penalty.penalty) || !Number.isFinite(penalty.magnitude)) {
      return {
        ok: false,
        errors: [
          {
            code: "check-error",
            message: `the soft constraint '${penalty.constraintId}' produced a non-finite penalty at capsule ${String(penalty.capsuleIndex)} — shaped penalties must stay finite (fail-closed)`,
            checkError: {
              constraintId: penalty.constraintId,
              code: "non-finite-reading",
              message: "non-finite shaped penalty",
            },
          },
        ],
      };
    }
    softPenaltyTotal += penalty.penalty;
  }
  const evaluation: ConstraintEvaluation = {
    programId: program.descriptor.programId,
    violations,
    penalties,
    hardViolationCount: violations.length,
    softPenaltyTotal,
    compliance: violations.length === 0 ? "compliant" : "non-compliant",
  };
  return { ok: true, evaluation };
}

/** Convert a checker's throw into its typed check error, if it is one. */
function constraintCheckErrorOf(
  constraintId: string,
  error: unknown,
): ConstraintCheckError | undefined {
  if (error instanceof CheckerReadError) {
    return { constraintId: error.constraintId, code: error.code, message: error.message };
  }
  if (error instanceof DecimalContractError) {
    return { constraintId, code: "malformed-decimal", message: error.message };
  }
  return undefined;
}
