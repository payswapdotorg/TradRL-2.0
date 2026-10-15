/**
 * Whole-record re-validation (W061 `services/operations`) — the composed
 * records re-validated from their OWN content: the report id is RE-DERIVED
 * from the carried summaries, the carried counts must cohere (sums match
 * the carried totals), the window must be lawful, and the provenance
 * citation must be present (W059's vocabulary).
 *
 * Together with `verifyTrail` (the trail tamper gate) this closes the A9
 * re-derivation discipline: every shipped record proves itself again.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  AUDIT_ACTION_KINDS,
  canonicalScopeContent,
  OPS_EVENT_KINDS,
  validateOpsScope,
} from "observability";
import {
  operationsReportIdOf,
  OPERATIONS_REPORT_ID_PREFIX,
  type OperationsReport,
} from "./reports.js";

/** Every law a shipped report can violate (closed set). */
export type ReportRevalidationViolation =
  | { readonly kind: "report-id-mismatch"; readonly detail: string }
  | { readonly kind: "count-incoherent"; readonly detail: string }
  | { readonly kind: "window-inverted"; readonly detail: string }
  | { readonly kind: "provenance-missing"; readonly detail: string }
  | { readonly kind: "vocabulary-foreign-key"; readonly detail: string }
  | { readonly kind: "scope-unlawful"; readonly detail: string };

/**
 * Re-validate one operational report: the id must re-derive from the carried
 * content; the event counts must sum to the carried total and live inside
 * the closed kind vocabulary; the audit counts must sum to the carried trail
 * record count and live inside the closed action vocabulary; the window
 * must not be inverted; the §14 scope must be lawful; the provenance
 * citation must be present. Pure; never throws.
 */
export function validateOperationsReport(
  report: unknown,
): readonly ReportRevalidationViolation[] {
  if (typeof report !== "object" || report === null) {
    return [{ kind: "report-id-mismatch", detail: "report is not an object" }];
  }
  const candidate = report as Record<string, unknown>;
  const violations: ReportRevalidationViolation[] = [];
  const scopeViolations = validateOpsScope(candidate.scope);
  if (scopeViolations.length > 0) {
    violations.push({
      kind: "scope-unlawful",
      detail: scopeViolations.map((violation) => violation.kind).join(", "),
    });
  }
  const content = {
    auditCounts: candidate.auditCounts,
    eventCounts: candidate.eventCounts,
    eventTotal: candidate.eventTotal,
    eventWindow: candidate.eventWindow,
    provenance: candidate.provenance,
    scope:
      typeof candidate.scope === "object" && candidate.scope !== null
        ? canonicalScopeContent(candidate.scope as never)
        : candidate.scope,
    trailHead: candidate.trailHead,
    trailId: candidate.trailId,
    trailRecordCount: candidate.trailRecordCount,
  };
  const rederived = operationsReportIdOf(content as Omit<OperationsReport, "reportId">);
  if (candidate.reportId !== rederived) {
    violations.push({
      kind: "report-id-mismatch",
      detail: `report id ${String(candidate.reportId)} does not address its own content (re-derived ${rederived}) — the report was rewritten`,
    });
  }
  if (typeof candidate.reportId !== "string" || !candidate.reportId.startsWith(OPERATIONS_REPORT_ID_PREFIX)) {
    violations.push({
      kind: "report-id-mismatch",
      detail: `report id does not carry the ${OPERATIONS_REPORT_ID_PREFIX} prefix`,
    });
  }
  const eventCounts = candidate.eventCounts as Record<string, unknown> | undefined;
  if (eventCounts === undefined || typeof eventCounts !== "object") {
    violations.push({ kind: "count-incoherent", detail: "eventCounts is missing" });
  } else {
    let sum = 0;
    for (const [key, value] of Object.entries(eventCounts)) {
      if (!(OPS_EVENT_KINDS as readonly string[]).includes(key)) {
        violations.push({
          kind: "vocabulary-foreign-key",
          detail: `event count key ${key} is outside the closed kind vocabulary`,
        });
      }
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        violations.push({ kind: "count-incoherent", detail: `event count ${key} is not a non-negative integer` });
        continue;
      }
      sum += value;
    }
    if (candidate.eventTotal !== sum) {
      violations.push({
        kind: "count-incoherent",
        detail: `event counts sum to ${String(sum)} but eventTotal is ${String(candidate.eventTotal)}`,
      });
    }
  }
  const auditCounts = candidate.auditCounts as Record<string, unknown> | undefined;
  if (auditCounts === undefined || typeof auditCounts !== "object") {
    violations.push({ kind: "count-incoherent", detail: "auditCounts is missing" });
  } else {
    let sum = 0;
    for (const [key, value] of Object.entries(auditCounts)) {
      if (!(AUDIT_ACTION_KINDS as readonly string[]).includes(key)) {
        violations.push({
          kind: "vocabulary-foreign-key",
          detail: `audit count key ${key} is outside the closed action vocabulary`,
        });
      }
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        violations.push({ kind: "count-incoherent", detail: `audit count ${key} is not a non-negative integer` });
        continue;
      }
      sum += value;
    }
    if (candidate.trailRecordCount !== sum) {
      violations.push({
        kind: "count-incoherent",
        detail: `audit counts sum to ${String(sum)} but trailRecordCount is ${String(candidate.trailRecordCount)}`,
      });
    }
  }
  const window = candidate.eventWindow as { fromMs?: unknown; toMs?: unknown } | null | undefined;
  if (window !== null && window !== undefined) {
    if (
      typeof window.fromMs !== "number" ||
      typeof window.toMs !== "number" ||
      window.fromMs > window.toMs
    ) {
      violations.push({ kind: "window-inverted", detail: "event window is inverted or malformed" });
    }
  }
  const provenance = candidate.provenance as { kind?: unknown } | undefined;
  if (
    provenance === undefined ||
    provenance === null ||
    (provenance.kind !== "evidence-projection" && provenance.kind !== "no-declared-source")
  ) {
    violations.push({
      kind: "provenance-missing",
      detail: "the report does not carry a W059 provenance citation",
    });
  }
  return violations;
}
