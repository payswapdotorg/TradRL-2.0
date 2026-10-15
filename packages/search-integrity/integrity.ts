/**
 * THE SEARCH-INTEGRITY GATES (W051) — `checkSearchIntegrity(history, claim)`.
 *
 * Spec: spec/ARCHITECTURE.md §13 — "Evaluation is constraint-aware and
 * includes … search-history integrity", enforced STRUCTURALLY:
 * - a backtest claim must cite its COMPLETE search history — every trial
 *   the record carries that the claim does NOT declare is a LOUD typed
 *   violation (`undeclared-trial`, naming §13), and each surfaces as its
 *   OWN `undeclared-failure` finding (the W038 registry law: a check may
 *   not fail in a way its declaration does not anticipate);
 * - every selection decision must cite only sealed pre-cutoff views — the
 *   R016 carry: evidence consulted beyond a decision's declared as-of
 *   point is refused loudly naming R016 (defensive depth over the
 *   construction/validation seams, the W050 engine precedent);
 * - the claim's cited evidence must be traceable to declared trials;
 * - the verdict is a PASS/FAIL/PARTIAL finding in the W038 shape, fed
 *   through verification's own `assembleFindingsReport` (this gate feeds
 *   W038's verification claims — it never replaces them).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the report is a pure function of
 * (history, claim): same inputs ⇒ the same violations, the same findings,
 * the same content-addressed digest. A FAIL is a valid outcome (the gate
 * working, not failing); a PARTIAL means the claim held within its
 * declared scope and the limitation is disclosed in the evidence.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — the gate composes typed records +
 * verdicts; it never executes a backtest, never scores (carry never
 * re-score).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ExperimentEvaluationId } from "evaluation";
import type {
  Finding,
  FindingsReport,
  Verdict,
  VerificationClaimDescriptor,
} from "verification";
import { assembleFindingsReport } from "verification";
import { KNOWLEDGE_FIREWALL_LAW } from "tradrl-time-machine";
import { canonicalDigestHex } from "trajectory";
import type {
  SearchHistory,
  SearchHistoryError,
  SearchHistoryId,
  SearchTrial,
} from "./history.js";
import { isRecordLike } from "./history.js";
import { validateSearchHistory } from "./validate.js";

/** The §13 law the declaration gates enforce (named in every violation). */
export const SEARCH_HISTORY_INTEGRITY_LAW = "spec/ARCHITECTURE.md §13" as const;

/**
 * The evidence needles of the search-history claim kind — W038's own
 * needles for `search-history` (["search-history", "declaration"]),
 * mirrored here so this package's findings always satisfy the registry's
 * honesty check.
 */
export const SEARCH_HISTORY_EVIDENCE_NEEDLES: readonly string[] = [
  "search-history",
  "declaration",
];

// ---------------------------------------------------------------------------
// The claim (the backtest result's own declaration)
// ---------------------------------------------------------------------------

/**
 * ONE backtest claim's declaration of the search behind it: the claim's
 * id, the claimed result (the W038 experiment evaluation id), the COMPLETE
 * search history it cites (by opaque id), every trial it declares, and
 * the sealed view ids the claimed result rests on.
 */
export interface SearchIntegrityClaim {
  readonly claimId: string;
  readonly subjectEvaluationId: ExperimentEvaluationId;
  readonly historyId: SearchHistoryId;
  readonly declaredTrials: readonly string[];
  readonly citedEvidence: readonly string[];
}

/**
 * The W038 registry descriptor of one lawful claim (the shape
 * `declareEvaluationClaims` would carry): kind `search-history`, the
 * claim's own declaration source, and the kind's evidence needles.
 */
export function searchIntegrityClaimDescriptor(
  claim: SearchIntegrityClaim,
): VerificationClaimDescriptor {
  return {
    claimId: String(claim.claimId),
    kind: "search-history",
    declarationSource: "the backtest claim's own search-history declaration (the W051 gate's subject)",
    evidenceNeedles: SEARCH_HISTORY_EVIDENCE_NEEDLES,
  };
}

// ---------------------------------------------------------------------------
// The typed violation family (closed set — every law named)
// ---------------------------------------------------------------------------

/** Everything the search-integrity gate can refuse. */
export type SearchIntegrityViolationCode =
  | "malformed-claim" // the claim is not lawful typed data
  | "history-mismatch" // the claim cites a different search record
  | "malformed-history" // whole-record re-proof failed (W050/W051 errors carried verbatim)
  | "undeclared-trial" // §13: a trial the claim does not declare
  | "unknown-declared-trial" // the claim declares a trial the record does not carry
  | "uncited-selection" // a selection decision citing no evidence
  | "uncited-claim" // a claim citing no evidence
  | "unresolved-evidence" // cited evidence not traceable to a declared trial's sealed view
  | "post-cutoff-consult"; // R016: evidence consulted beyond the decision's as-of

/** ONE loud typed violation, naming the law it violates. */
export interface SearchIntegrityViolation {
  readonly code: SearchIntegrityViolationCode;
  /** The law named: §13 (declaration laws) or R016 (the firewall carry). */
  readonly law: string;
  /** The violation's subject (a trial/decision/claim id, named loudly). */
  readonly subject: string;
  readonly message: string;
  /** `malformed-history` only: the re-proof errors, carried VERBATIM. */
  readonly historyErrors?: readonly SearchHistoryError[];
}

// ---------------------------------------------------------------------------
// The report (deterministic, content-addressed)
// ---------------------------------------------------------------------------

/**
 * The gate's verdict over one (history, claim) pair: the overall verdict,
 * every typed violation, and the W038-shaped findings report (assembled
 * through verification's own machinery — declared findings in registry
 * order, undeclared trials as their OWN undeclared-failure findings).
 */
export interface SearchIntegrityReport {
  readonly claimId: string;
  readonly historyId: string;
  readonly verdict: Verdict;
  readonly violations: readonly SearchIntegrityViolation[];
  readonly findings: FindingsReport;
  /** The canonical digest over the verdict + the violations (A9). */
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/**
 * Check one backtest claim's search-history integrity — THE GATE. Total
 * and pure: malformed inputs are refused with typed violations, never
 * thrown at. The record is re-proven whole (`./validate.js` — W050 view
 * errors carried verbatim), the claim's declaration is compared against
 * the record's OWN declaration of everything tried, the selection
 * decisions' evidence is re-traced to declared trials (the R016 carry
 * re-proven per cited view — defensive depth, the W050 engine precedent),
 * and the verdict + findings are assembled through W038's own report
 * machinery. Same (history, claim) ⇒ same report, deep-equal, same digest.
 */
export function checkSearchIntegrity(
  history: SearchHistory,
  claim: SearchIntegrityClaim,
): SearchIntegrityReport {
  const violations: SearchIntegrityViolation[] = [];
  const claimRecord = isRecordLike(claim) ? claim : undefined;
  const claimId = String(claimRecord?.claimId ?? "");
  const subject = String(claimRecord?.subjectEvaluationId ?? "");
  const claimedHistoryId = String(claimRecord?.historyId ?? "");
  const declaredTrials =
    claimRecord !== undefined && Array.isArray(claimRecord.declaredTrials)
      ? (claimRecord.declaredTrials as readonly unknown[]).map((id) => String(id))
      : undefined;
  const claimEvidence =
    claimRecord !== undefined && Array.isArray(claimRecord.citedEvidence)
      ? (claimRecord.citedEvidence as readonly unknown[]).map((id) => String(id))
      : undefined;
  if (
    claimRecord === undefined ||
    claimId.trim().length === 0 ||
    subject.trim().length === 0 ||
    claimedHistoryId.trim().length === 0 ||
    declaredTrials === undefined ||
    claimEvidence === undefined
  ) {
    violations.push({
      code: "malformed-claim",
      law: SEARCH_HISTORY_INTEGRITY_LAW,
      subject: claimId.trim().length > 0 ? claimId : "<blank-claim>",
      message:
        "the search-history claim is not lawful typed data — a claim's id, subject evaluation, history citation, trial declaration and cited evidence are explicit data, never defaulted",
    });
  }
  const historyRecord = isRecordLike(history) ? history : undefined;
  const historyId = String(historyRecord?.historyId ?? "");
  const trials: readonly SearchTrial[] =
    historyRecord !== undefined && Array.isArray(historyRecord.trials)
      ? historyRecord.trials
      : [];
  const selections =
    historyRecord !== undefined && Array.isArray(historyRecord.selections)
      ? historyRecord.selections
      : [];
  const validation = validateSearchHistory(history);
  if (!validation.ok) {
    violations.push({
      code: "malformed-history",
      law: SEARCH_HISTORY_INTEGRITY_LAW,
      subject: historyId.trim().length > 0 ? historyId : "<blank-history>",
      message:
        `the search history failed whole-record re-proof (${String(validation.errors.length)} error(s), first: ${String(validation.errors[0]?.code ?? "none")}) — the gate never audits an unlawful record`,
      historyErrors: validation.errors,
    });
  } else if (claimedHistoryId.trim().length > 0 && claimedHistoryId !== historyId) {
    violations.push({
      code: "history-mismatch",
      law: SEARCH_HISTORY_INTEGRITY_LAW,
      subject: claimId,
      message:
        `the claim cites history ${JSON.stringify(claimedHistoryId)} but the record carries ${JSON.stringify(historyId)} — a backtest claim must cite its COMPLETE search history (§13)`,
    });
  }
  const declaredSet = new Set(declaredTrials ?? []);
  const undeclared: SearchTrial[] = [];
  if (validation.ok) {
    for (const trial of trials) {
      const trialId = String(trial.trialId);
      if (!declaredSet.has(trialId)) {
        undeclared.push(trial);
        violations.push({
          code: "undeclared-trial",
          law: SEARCH_HISTORY_INTEGRITY_LAW,
          subject: trialId,
          message:
            `trial ${JSON.stringify(trialId)} is carried by the search record but NOT declared by the claim — a backtest claim must cite its COMPLETE search history (§13 search-history integrity; an undeclared trial is a loud typed violation)`,
        });
      }
    }
    for (const declared of declaredSet) {
      if (!trials.some((trial) => String(trial.trialId) === declared)) {
        violations.push({
          code: "unknown-declared-trial",
          law: SEARCH_HISTORY_INTEGRITY_LAW,
          subject: declared,
          message:
            `the claim declares trial ${JSON.stringify(declared)} which the record does not carry — a mis-cited search-history declaration`,
        });
      }
    }
  }
  const declaredTrialByViewId = new Map<string, string>();
  for (const trial of trials) {
    if (declaredSet.has(String(trial.trialId))) {
      declaredTrialByViewId.set(String(trial.view.viewId), String(trial.trialId));
    }
  }
  for (const selection of selections) {
    const decisionId = String(
      (selection as unknown as { decisionId?: unknown }).decisionId ?? "",
    );
    const cited = Array.isArray(selection.citedEvidence)
      ? (selection.citedEvidence as readonly unknown[]).map((id) => String(id))
      : [];
    if (cited.length === 0) {
      violations.push({
        code: "uncited-selection",
        law: SEARCH_HISTORY_INTEGRITY_LAW,
        subject: decisionId,
        message:
          `selection decision ${JSON.stringify(decisionId)} cites no evidence — WHICH sealed view the selection consulted is the record's whole point (§13 search-history integrity)`,
      });
      continue;
    }
    for (const evidence of cited) {
      const trialId = declaredTrialByViewId.get(evidence);
      if (trialId === undefined) {
        violations.push({
          code: "unresolved-evidence",
          law: SEARCH_HISTORY_INTEGRITY_LAW,
          subject: `${decisionId}:${evidence}`,
          message:
            `selection decision ${JSON.stringify(decisionId)} cites evidence ${JSON.stringify(evidence)} which resolves to no DECLARED trial's sealed view — selection evidence must trace to the trials it selected among (§13)`,
        });
        continue;
      }
      const trial = trials.find((candidate) => String(candidate.trialId) === trialId);
      const asOf = Number(
        (selection as unknown as { decidedAsOf?: unknown }).decidedAsOf,
      );
      if (trial !== undefined && Number(trial.view.query.cutoff) > asOf) {
        violations.push({
          code: "post-cutoff-consult",
          law: KNOWLEDGE_FIREWALL_LAW,
          subject: `${decisionId}:${evidence}`,
          message:
            `selection decision ${JSON.stringify(decisionId)} cites sealed view ${JSON.stringify(evidence)} (trial ${JSON.stringify(trialId)}) whose cutoff ${String(trial.view.query.cutoff)} is after the decision's declared as-of ${String(asOf)} — a result whose selection consulted anything the R016 firewall would withhold is refused`,
        });
      }
    }
  }
  if (claimEvidence !== undefined) {
    if (claimEvidence.length === 0) {
      violations.push({
        code: "uncited-claim",
        law: SEARCH_HISTORY_INTEGRITY_LAW,
        subject: claimId,
        message:
          "the claim cites no evidence — a backtest result rests on the sealed views it names, never on nothing (§13 search-history integrity)",
      });
    } else {
      for (const evidence of claimEvidence) {
        if (!declaredTrialByViewId.has(evidence)) {
          violations.push({
            code: "unresolved-evidence",
            law: SEARCH_HISTORY_INTEGRITY_LAW,
            subject: `${claimId}:${evidence}`,
            message:
              `the claim cites evidence ${JSON.stringify(evidence)} which resolves to no declared trial's sealed view — the claim's cited evidence must be traceable to declared trials (§13)`,
          });
        }
      }
    }
  }
  const verdict: Verdict =
    violations.length > 0 ? "FAIL" : selections.length === 0 ? "PARTIAL" : "PASS";
  const evidence: string[] = [
    `search-history declaration audit: claim ${JSON.stringify(claimId)} (subject evaluation ${JSON.stringify(subject)}) over history ${JSON.stringify(historyId)} — ${String(trials.length)} trial(s) carried, ${String(declaredSet.size)} declared, ${String(selections.length)} selection decision(s), ${String(violations.length)} violation(s)`,
  ];
  if (verdict === "PASS") {
    evidence.push(
      "search-history declaration COMPLETE — every carried trial is declared; every selection decision cites only sealed views at or before its declared as-of (R016 re-proven); the claim's cited evidence traces to declared trials",
    );
  } else if (verdict === "PARTIAL") {
    evidence.push(
      `search-history declaration complete over ${String(trials.length)} trial(s) but the record carries no selection decision — selection-integrity is unverifiable over a selection-free record (disclosed limitation)`,
    );
  } else {
    for (const violation of violations) {
      evidence.push(
        `[${violation.code}] ${violation.law} (${violation.subject}): ${violation.message}`,
      );
    }
  }
  const declaredFinding: Finding = {
    claimId: claimId.trim().length > 0 ? claimId : "search-history",
    claimKind: "search-history",
    findingKind: "declared",
    verdict,
    evidence,
  };
  const undeclaredFindings: readonly Finding[] = undeclared.map((trial) => ({
    claimId: `undeclared-trial:${String(trial.trialId)}`,
    claimKind: "search-history",
    findingKind: "undeclared-failure",
    verdict: "FAIL",
    evidence: [
      `trial ${JSON.stringify(String(trial.trialId))} is outside the claim's search-history declaration — an undeclared trial is a loud typed violation of §13 search-history integrity`,
      `the search-history declaration must cover every trial the record carries (${String(trials.length)} carried, ${String(declaredSet.size)} declared)`,
    ],
  }));
  const descriptor: VerificationClaimDescriptor = {
    claimId: declaredFinding.claimId,
    kind: "search-history",
    declarationSource:
      claimRecord !== undefined && claimId.trim().length > 0
        ? "the backtest claim's own search-history declaration (the W051 gate's subject)"
        : "the W051 search-integrity gate (the claim itself is malformed — disclosed)",
    evidenceNeedles: SEARCH_HISTORY_EVIDENCE_NEEDLES,
  };
  const findings = assembleFindingsReport(
    subject.trim().length > 0 ? subject : "unknown-subject",
    [descriptor],
    [declaredFinding],
    undeclaredFindings,
  );
  const report: SearchIntegrityReport = Object.freeze({
    claimId: declaredFinding.claimId,
    historyId,
    verdict,
    violations: Object.freeze(violations),
    findings,
    digest: canonicalDigestHex({
      claimId: declaredFinding.claimId,
      historyId,
      verdict,
      violations: violations.map((violation) => [
        violation.code,
        violation.law,
        violation.subject,
      ]),
      findingsDigest: findings.digest,
    }),
  });
  return report;
}
