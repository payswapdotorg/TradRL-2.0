/**
 * The typed verdict records (W038, the W022 pattern) — findings + the
 * deterministic, content-addressed findings report.
 *
 * A **FAIL** is a valid outcome (the harness working, not failing); a
 * **PARTIAL** means the claim held within its declared scope and the
 * limitation is disclosed in the evidence. Findings are deterministic
 * (canonical order), evidence-linked (every line names its record/axis),
 * and undeclared failures surface as their OWN finding kind — a check may
 * not fail in a way its declaration does not anticipate.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { VerificationClaimDescriptor } from "./claims.js";
import type { EvaluationClaimKind } from "./claims.js";

// ---------------------------------------------------------------------------
// The verdict vocabulary
// ---------------------------------------------------------------------------

/** The verdict of one checked claim. A FAIL is a valid outcome. */
export type Verdict = "PASS" | "FAIL" | "PARTIAL";

/**
 * Which registry law a finding obeys: `declared` (it answers a registered
 * claim) or `undeclared-failure` (a failure its declaration does not
 * anticipate — e.g. a manifest split naming a holdout axis the policy never
 * declared: surfaced, never swallowed).
 */
export type FindingKind = "declared" | "undeclared-failure";

// ---------------------------------------------------------------------------
// The finding (the typed verdict record)
// ---------------------------------------------------------------------------

/** One checked claim's verdict: the claim it answers, the verdict, evidence. */
export interface Finding {
  readonly claimId: string;
  readonly claimKind: EvaluationClaimKind;
  readonly findingKind: FindingKind;
  readonly verdict: Verdict;
  /** Deterministic, ordered, evidence-linked lines (each names its subject). */
  readonly evidence: readonly string[];
}

/**
 * The evidence needles of one claim that a body of evidence fails to name —
 * the registry's own honesty check (a finding whose evidence misses a needle
 * is malformed; the tests pin the law).
 */
export function needlesMissing(
  claim: VerificationClaimDescriptor,
  evidence: readonly string[],
): readonly string[] {
  const joined = evidence.join("\n");
  return claim.evidenceNeedles.filter((needle) => !joined.includes(needle));
}

// ---------------------------------------------------------------------------
// The findings report (deterministic, content-addressed)
// ---------------------------------------------------------------------------

/** The assembled findings over one subject (an experiment evaluation). */
export interface FindingsReport {
  /** The subject's identity (the experiment evaluation id). */
  readonly subject: string;
  /** The registry the findings answer (declared before checking). */
  readonly claimCount: number;
  /** Declared findings in registry order, then undeclared failures (by id). */
  readonly findings: readonly Finding[];
  /** The canonical digest over the subject + the ordered findings (A9). */
  readonly digest: string;
  readonly passCount: number;
  readonly failCount: number;
  readonly partialCount: number;
  readonly undeclaredCount: number;
}

/** The canonical content-addressed digest of one subject's ordered findings. */
export function findingsDigestOf(subject: string, findings: readonly Finding[]): string {
  return canonicalDigestHex({
    subject,
    findings: findings.map((finding) => [
      finding.claimId,
      finding.claimKind,
      finding.findingKind,
      finding.verdict,
      finding.evidence,
    ]),
  });
}

/**
 * Assemble the findings report: declared findings in REGISTRY order (the
 * order the claims were declared in — canonical), undeclared failures after
 * them in claim-id order, the counts, and the content-addressed digest over
 * the subject + the ordered findings (A9: same subject + same findings ⇒
 * same digest; any byte of evidence flips it).
 */
export function assembleFindingsReport(
  subject: string,
  claims: readonly VerificationClaimDescriptor[],
  declaredFindings: readonly Finding[],
  undeclaredFindings: readonly Finding[],
): FindingsReport {
  const order = new Map(claims.map((claim, index) => [claim.claimId, index] as const));
  const declared = [...declaredFindings].sort((left, right) => {
    const delta =
      (order.get(left.claimId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.claimId) ?? Number.MAX_SAFE_INTEGER);
    return delta !== 0 ? delta : left.claimId.localeCompare(right.claimId);
  });
  const undeclared = [...undeclaredFindings].sort((left, right) =>
    left.claimId.localeCompare(right.claimId),
  );
  const findings = Object.freeze([...declared, ...undeclared]);
  const counts = (verdict: Verdict): number =>
    findings.filter((finding) => finding.verdict === verdict).length;
  const report: FindingsReport = {
    subject,
    claimCount: claims.length,
    findings,
    digest: findingsDigestOf(subject, findings),
    passCount: counts("PASS"),
    failCount: counts("FAIL"),
    partialCount: counts("PARTIAL"),
    undeclaredCount: findings.filter((finding) => finding.findingKind === "undeclared-failure")
      .length,
  };
  Object.freeze(report);
  return report;
}
