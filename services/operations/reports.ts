/**
 * Deterministic operational report composition (W061 `services/operations`)
 * — carried counts and summaries AS DATA over the trail + event stream.
 *
 * Laws:
 * - FAIL-CLOSED on the trail: the report is composed only over a trail that
 *   re-verified END-TO-END (`verifyTrail` — a tampered trail is refused with
 *   the verification outcome carried verbatim, never reported around).
 * - Every event is whole-record re-validated first (ids re-derived —
 *   violations carried VERBATIM with the offending index).
 * - §14: every event must sit inside the trail's scope.
 * - A9: the composition is DETERMINISTIC — the events are canonically
 *   ordered by (declaredAt, eventId) so input order never leaks; the counts
 *   are carried in the closed vocabularies' canonical order (every member
 *   present, zero-filled); the report id is content-addressed over the
 *   report's canonical content (`opr-<digest>`) so the same inputs always
 *   produce the same bit-for-bit report.
 * - A14: pure records — no scraping, no serving, no alerting.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  AUDIT_ACTION_KINDS,
  canonicalScopeContent,
  OPS_EVENT_KINDS,
  validateOperationalEvent,
  type AuditTrail,
  type OpsEventViolation,
  type OpsScope,
  type OperationalEvent,
} from "observability";
import type { ResponseProvenanceCitation } from "api";
import { canonicalDigestHex } from "trajectory";
import { verifyTrail, type TrailVerification } from "./trail.js";

// ---------------------------------------------------------------------------
// The report (deterministic, content-addressed — A9)
// ---------------------------------------------------------------------------

/** The report id prefix (a rendering convention, never a parse target). */
export const OPERATIONS_REPORT_ID_PREFIX = "opr-";

/** The declared event window (min/max declared timestamps — data). */
export interface ReportWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * ONE deterministic operational report: the trail it was composed over
 * (content-addressed id + head + counts by action) and the event stream
 * (counts by kind, total, declared window), all CARRIED DATA.
 */
export interface OperationsReport {
  readonly reportId: string;
  readonly scope: OpsScope;
  readonly trailId: string;
  readonly trailHead: string;
  readonly trailRecordCount: number;
  readonly auditCounts: Readonly<Record<string, number>>;
  readonly eventCounts: Readonly<Record<string, number>>;
  readonly eventTotal: number;
  readonly eventWindow: ReportWindow | null;
  readonly provenance: ResponseProvenanceCitation;
}

// ---------------------------------------------------------------------------
// The composition gate (fail-closed)
// ---------------------------------------------------------------------------

/** Every law a composition can violate (closed set — failures name indexes). */
export type ReportCompositionViolation =
  | { readonly kind: "trail-unverified"; readonly verification: TrailVerification }
  | {
      readonly kind: "event-unlawful";
      readonly index: number;
      readonly detail: string;
      readonly violations: readonly OpsEventViolation[];
    }
  | {
      readonly kind: "event-scope-mismatch";
      readonly index: number;
      readonly detail: string;
    }
  | {
      readonly kind: "duplicate-event-id";
      readonly index: number;
      readonly detail: string;
    };

/** The outcome of a report composition. */
export type ReportCompositionOutcome =
  | { readonly ok: true; readonly report: OperationsReport }
  | { readonly ok: false; readonly violations: readonly ReportCompositionViolation[] };

const scopeKey = (scope: OpsScope): string => JSON.stringify(canonicalScopeContent(scope));

/** Canonical event order: declared timestamp, then event id (code-unit). */
export function compareOperationalEvents(
  left: OperationalEvent,
  right: OperationalEvent,
): number {
  if (left.declaredAt !== right.declaredAt) {
    return left.declaredAt < right.declaredAt ? -1 : 1;
  }
  return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
}

/** The canonical content a report id addresses (every carried summary). */
export function canonicalReportContent(
  report: Omit<OperationsReport, "reportId">,
): Record<string, unknown> {
  return {
    auditCounts: report.auditCounts,
    eventCounts: report.eventCounts,
    eventTotal: report.eventTotal,
    eventWindow: report.eventWindow,
    provenance: report.provenance,
    scope: canonicalScopeContent(report.scope),
    trailHead: report.trailHead,
    trailId: report.trailId,
    trailRecordCount: report.trailRecordCount,
  };
}

/** The content-addressed report id: `opr-<digest>` (A9). */
export function operationsReportIdOf(
  report: Omit<OperationsReport, "reportId">,
): string {
  return `${OPERATIONS_REPORT_ID_PREFIX}${canonicalDigestHex(canonicalReportContent(report))}`;
}

/**
 * Compose the deterministic operational report over one trail + its event
 * stream. The trail MUST verify end-to-end first (fail-closed); the events
 * are re-validated, scope-checked, de-duplicated and canonically ordered;
 * the counts are carried in the closed vocabularies' canonical order.
 */
export function composeOperationsReport(
  trail: AuditTrail,
  events: readonly OperationalEvent[],
): ReportCompositionOutcome {
  const verification = verifyTrail(trail);
  if (!verification.ok) {
    return {
      ok: false,
      violations: [{ kind: "trail-unverified", verification }],
    };
  }
  const violations: ReportCompositionViolation[] = [];
  const seenIds = new Set<string>();
  const ordered = [...events].sort(compareOperationalEvents);
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    const eventViolations = validateOperationalEvent(event);
    if (eventViolations.length > 0) {
      violations.push({
        kind: "event-unlawful",
        index,
        detail: `event at position ${String(index)} fails whole-record re-validation`,
        violations: eventViolations,
      });
      continue;
    }
    if (scopeKey(event.scope) !== scopeKey(trail.scope)) {
      violations.push({
        kind: "event-scope-mismatch",
        index,
        detail: `event at position ${String(index)} is outside the trail's scope (§14)`,
      });
    }
    if (seenIds.has(event.eventId)) {
      violations.push({
        kind: "duplicate-event-id",
        index,
        detail: `event ${event.eventId} appears twice — the stream is immutable (§14)`,
      });
    }
    seenIds.add(event.eventId);
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const eventCounts: Record<string, number> = {};
  for (const kind of OPS_EVENT_KINDS) {
    eventCounts[kind] = 0;
  }
  const auditCounts: Record<string, number> = {};
  for (const action of AUDIT_ACTION_KINDS) {
    auditCounts[action] = 0;
  }
  for (const event of ordered) {
    eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
  }
  for (const record of trail.records) {
    auditCounts[record.action] = (auditCounts[record.action] ?? 0) + 1;
  }
  const content: Omit<OperationsReport, "reportId"> = {
    scope: trail.scope,
    trailId: trail.trailId,
    trailHead: trail.head,
    trailRecordCount: trail.records.length,
    auditCounts,
    eventCounts,
    eventTotal: ordered.length,
    eventWindow:
      ordered.length === 0
        ? null
        : {
            fromMs: ordered[0]!.declaredAt,
            toMs: ordered[ordered.length - 1]!.declaredAt,
          },
    provenance: { kind: "no-declared-source" },
  };
  return { ok: true, report: { ...content, reportId: operationsReportIdOf(content) } };
}
