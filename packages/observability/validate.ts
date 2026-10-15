/**
 * Whole-record re-validation (W061 `observability`) — every shipped record
 * is re-validated from its OWN content: ids are RE-DERIVED and compared, the
 * closed vocabularies are re-checked, the §14 scope laws are re-proven and
 * the W028 provenance citation is re-guarded.
 *
 * A record that was edited after the fact (a rewrite — §14's loud typed
 * violation) is caught here by id re-derivation: the carried id no longer
 * addresses the carried content. The per-record construction violations are
 * carried VERBATIM from the mint gates — one vocabulary, never a second.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md §14 (immutable, explicit scope), A9
 * (deterministic re-derivation), A14 (pure contracts, no I/O).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  eventIdOf,
  mintOperationalEvent,
  OPS_EVENT_ID_PREFIX,
  validateOpsScope,
  type OpsEventViolation,
  type OperationalEvent,
} from "./events.js";
import { OPS_HEALTH_STATUSES } from "./events.js";
import {
  auditRecordIdOf,
  mintAuditRecord,
  AUDIT_RECORD_ID_PREFIX,
  isSourceCitation,
  type AuditRecord,
  type AuditRecordViolation,
} from "./audit.js";
import { descriptorIdOf } from "./events.js";
import type { HealthDescriptor, OpsScope, TrafficDescriptor } from "./events.js";

// ---------------------------------------------------------------------------
// The operational event (whole-record re-validation)
// ---------------------------------------------------------------------------

/** A deep-cast view of an unknown event value — for re-derivation only. */
function asEventDeclaration(
  candidate: Record<string, unknown>,
): Omit<OperationalEvent, "eventId"> {
  return candidate as unknown as Omit<OperationalEvent, "eventId">;
}

/**
 * Re-validate one operational event: the id must re-derive from the carried
 * content, and every construction law must hold again. Pure; never throws.
 */
export function validateOperationalEvent(
  event: unknown,
): readonly OpsEventViolation[] {
  if (typeof event !== "object" || event === null) {
    return [{ kind: "unknown-event-kind", detail: "event is not an object" }];
  }
  const candidate = event as Record<string, unknown>;
  const rederived = eventIdOf(asEventDeclaration(candidate));
  if (candidate.eventId !== rederived) {
    return [
      {
        kind: "id-mismatch",
        detail: `event id ${String(candidate.eventId)} does not address its own content (re-derived ${rederived}) — the record was rewritten`,
      },
    ];
  }
  if (typeof candidate.eventId !== "string" || !candidate.eventId.startsWith(OPS_EVENT_ID_PREFIX)) {
    return [
      {
        kind: "id-mismatch",
        detail: `event id does not carry the ${OPS_EVENT_ID_PREFIX} prefix`,
      },
    ];
  }
  const outcome = mintOperationalEvent(asEventDeclaration(candidate));
  if (outcome.ok) {
    return [];
  }
  return outcome.violations;
}

// ---------------------------------------------------------------------------
// The audit record (whole-record re-validation — the tamper gate)
// ---------------------------------------------------------------------------

/** A deep-cast view of an unknown record value — for re-derivation only. */
function asAuditDeclaration(
  candidate: Record<string, unknown>,
): Omit<AuditRecord, "recordId"> {
  return candidate as unknown as Omit<AuditRecord, "recordId">;
}

/**
 * Re-validate one audit record: the id must re-derive from the carried
 * content (any post-hoc edit — detail, provenance, scope, subject — mints a
 * different id and is REFUSED loudly), and every construction law must hold
 * again, the W028 provenance citation included. Pure; never throws.
 */
export function validateAuditRecord(
  record: unknown,
): readonly AuditRecordViolation[] {
  if (typeof record !== "object" || record === null) {
    return [{ kind: "unknown-audit-action", detail: "record is not an object" }];
  }
  const candidate = record as Record<string, unknown>;
  const rederived = auditRecordIdOf(asAuditDeclaration(candidate));
  if (candidate.recordId !== rederived) {
    return [
      {
        kind: "record-id-mismatch",
        detail: `record id ${String(candidate.recordId)} does not address its own content (re-derived ${rederived}) — the record was rewritten`,
      },
    ];
  }
  if (typeof candidate.recordId !== "string" || !candidate.recordId.startsWith(AUDIT_RECORD_ID_PREFIX)) {
    return [
      {
        kind: "record-id-mismatch",
        detail: `record id does not carry the ${AUDIT_RECORD_ID_PREFIX} prefix`,
      },
    ];
  }
  if (!isSourceCitation(candidate.provenance)) {
    return [
      {
        kind: "provenance-malformed",
        detail: "provenance is not a W028 SourceCitation (closed union: information-artifact | dataset | none)",
      },
    ];
  }
  const outcome = mintAuditRecord(asAuditDeclaration(candidate));
  if (outcome.ok) {
    return [];
  }
  return outcome.violations;
}

// ---------------------------------------------------------------------------
// The health + traffic descriptors (data re-validation)
// ---------------------------------------------------------------------------

/** Re-validate one health descriptor (statuses and times as declared data). */
export function validateHealthDescriptor(
  descriptor: unknown,
): readonly OpsEventViolation[] {
  if (typeof descriptor !== "object" || descriptor === null) {
    return [{ kind: "unknown-event-kind", detail: "descriptor is not an object" }];
  }
  const candidate = descriptor as Record<string, unknown>;
  const violations: OpsEventViolation[] = [...validateOpsScope(candidate.scope as OpsScope)];
  if (
    typeof candidate.status !== "string" ||
    !(OPS_HEALTH_STATUSES as readonly string[]).includes(candidate.status)
  ) {
    violations.push({
      kind: "payload-field-invalid",
      detail: `status ${JSON.stringify(candidate.status)} is outside the closed health vocabulary`,
    });
  }
  if (typeof candidate.checkedAt !== "number" || !Number.isSafeInteger(candidate.checkedAt) || candidate.checkedAt < 0) {
    violations.push({ kind: "non-integer-timestamp", detail: "checkedAt is not a non-negative safe integer" });
  }
  if (!Array.isArray(candidate.notes) || candidate.notes.some((note) => typeof note !== "string")) {
    violations.push({ kind: "payload-field-invalid", detail: "notes must be an array of strings" });
  }
  const rederived = descriptorIdOf({
    scope: candidate.scope as OpsScope,
    kind: "health",
    content: { checkedAt: candidate.checkedAt, notes: candidate.notes, status: candidate.status },
  });
  if (candidate.descriptorId !== rederived) {
    violations.push({
      kind: "id-mismatch",
      detail: "health descriptor id does not address its own content",
    });
  }
  return violations;
}

/** Re-validate one traffic descriptor (counts and window as declared data). */
export function validateTrafficDescriptor(
  descriptor: unknown,
): readonly OpsEventViolation[] {
  if (typeof descriptor !== "object" || descriptor === null) {
    return [{ kind: "unknown-event-kind", detail: "descriptor is not an object" }];
  }
  const candidate = descriptor as Record<string, unknown>;
  const violations: OpsEventViolation[] = [...validateOpsScope(candidate.scope as OpsScope)];
  for (const field of ["windowFromMs", "windowToMs", "eventCount", "auditRecordCount"]) {
    const value = candidate[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      violations.push({
        kind: "payload-field-invalid",
        detail: `traffic field ${field} is not a non-negative safe integer`,
      });
    }
  }
  if (
    typeof candidate.windowFromMs === "number" &&
    typeof candidate.windowToMs === "number" &&
    candidate.windowFromMs > candidate.windowToMs
  ) {
    violations.push({
      kind: "payload-field-invalid",
      detail: "traffic window is inverted (windowFromMs > windowToMs)",
    });
  }
  const rederived = descriptorIdOf({
    scope: candidate.scope as OpsScope,
    kind: "traffic",
    content: {
      auditRecordCount: candidate.auditRecordCount,
      eventCount: candidate.eventCount,
      windowFromMs: candidate.windowFromMs,
      windowToMs: candidate.windowToMs,
    },
  });
  if (candidate.descriptorId !== rederived) {
    violations.push({
      kind: "id-mismatch",
      detail: "traffic descriptor id does not address its own content",
    });
  }
  return violations;
}

/** Type-only re-export so the surface stays one vocabulary. */
export type { OperationalEvent, AuditRecord, HealthDescriptor, TrafficDescriptor };
