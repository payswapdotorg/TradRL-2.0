/**
 * The claim registry (W038, the W022 pattern) — every claim is DECLARED
 * before it is checked.
 *
 * The registry is the checklist; the checks (checks.ts) are the trial; the
 * findings (findings.ts) are the typed verdict record. A claim that cannot
 * fail is worthless: each descriptor carries the declaration source (where
 * the claim was declared — the policy's own integrity axes, a declared
 * holdout axis, or §13 itself) and the EVIDENCE NEEDLES its findings must
 * name (checkable strings — a finding whose evidence misses a needle is
 * malformed, and the tests pin that law).
 *
 * The harness never invents claims: integrity claims come from the policy's
 * declared integrity requirements (carried on the manifest), holdout
 * coverage claims from the policy's DECLARED holdout axes — with exactly two
 * §13-named exceptions that are always declared: the search-history
 * integrity requirement (§13 names it; a policy that does not declare it
 * gets the claim with the limitation disclosed — the check's PARTIAL) and
 * the sole-P&L law (raw P&L is never the sole objective — not optional).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvaluationPolicy } from "learning-objectives";
import type { ExperimentManifest } from "experiments";

// ---------------------------------------------------------------------------
// The claim vocabulary (closed set, canonical order)
// ---------------------------------------------------------------------------

/** The kinds of evaluation claims the harness declares and checks. */
export type EvaluationClaimKind =
  | "evidence-chain" // §10: every capsule validates, citations resolve
  | "deterministic-replay" // A9: metadata present + twin re-evaluation equality
  | "search-history" // §13: the search-history integrity requirement
  | "holdout-coverage" // §13 axes: every declared holdout axis is split
  | "constraint-dimension"; // §13: raw P&L is never the sole objective

/** The canonical claim-kind order (registry + findings ordering). */
export const CLAIM_KINDS: readonly EvaluationClaimKind[] = [
  "evidence-chain",
  "deterministic-replay",
  "search-history",
  "holdout-coverage",
  "constraint-dimension",
];

/**
 * One DECLARED claim: its id, its kind, where it was declared, and the
 * evidence needles its findings' evidence must name.
 */
export interface VerificationClaimDescriptor {
  readonly claimId: string;
  readonly kind: EvaluationClaimKind;
  readonly declarationSource: string;
  readonly evidenceNeedles: readonly string[];
  /** Present on holdout-coverage claims: the declared axis this claim covers. */
  readonly axisId?: string;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const NEEDLES: Readonly<Record<EvaluationClaimKind, readonly string[]>> = {
  "evidence-chain": ["record", "capsule"],
  "deterministic-replay": ["determinism", "twin"],
  "search-history": ["search-history", "declaration"],
  "holdout-coverage": ["split"],
  "constraint-dimension": ["compliance", "components"],
};

/**
 * Declare the evaluation claims — THE REGISTRY, always built before any
 * check runs:
 * - one claim per integrity requirement the policy declares (carried on the
 *   manifest — the W037 carry-forward), needles per kind;
 * - the §13 search-history claim ALWAYS (§13 names it): declared by the
 *   policy when it is, otherwise declared by §13 itself with the limitation
 *   disclosed (the check runs PARTIAL over undeclared data);
 * - one holdout-coverage claim per DECLARED policy holdout axis (needles
 *   name the axis id and the split);
 * - the constraint-dimension claim ALWAYS (§13: raw P&L is never the sole
 *   objective — not optional).
 */
export function declareEvaluationClaims(
  manifest: ExperimentManifest,
  policy: EvaluationPolicy,
): readonly VerificationClaimDescriptor[] {
  const claims: VerificationClaimDescriptor[] = [];
  for (const requirement of manifest.integrity) {
    if (requirement === "search-history") {
      claims.push({
        claimId: "search-history",
        kind: "search-history",
        declarationSource: "the policy's integrity axes, carried on the manifest",
        evidenceNeedles: NEEDLES["search-history"],
      });
      continue;
    }
    claims.push({
      claimId: requirement,
      kind: requirement,
      declarationSource: "the policy's integrity axes, carried on the manifest",
      evidenceNeedles: NEEDLES[requirement],
    });
  }
  if (!claims.some((claim) => claim.claimId === "search-history")) {
    claims.push({
      claimId: "search-history",
      kind: "search-history",
      declarationSource:
        "spec/ARCHITECTURE.md §13 (NOT declared by this policy — the disclosed limitation)",
      evidenceNeedles: NEEDLES["search-history"],
    });
  }
  for (const axis of policy.descriptor.axes.holdouts) {
    claims.push({
      claimId: `holdout-coverage:${axis.axisId}`,
      kind: "holdout-coverage",
      declarationSource: `the policy's declared holdout axis '${axis.axisId}' (${axis.kind})`,
      evidenceNeedles: [axis.axisId, ...NEEDLES["holdout-coverage"]],
      axisId: axis.axisId,
    });
  }
  claims.push({
    claimId: "constraint-dimension",
    kind: "constraint-dimension",
    declarationSource: "spec/ARCHITECTURE.md §13 — raw P&L is never the sole objective",
    evidenceNeedles: NEEDLES["constraint-dimension"],
  });
  return Object.freeze(claims);
}
