/**
 * The audit-trail machinery (W061 `services/operations`) — pure record
 * assembly + end-to-end verification over the W061 `observability`
 * contracts.
 *
 * `assembleTrail(records)` — DETERMINISTIC assembly: the records are
 * canonically ordered by their own sequence axis (input order never leaks —
 * A9), every record is whole-record re-validated first (ids re-derived, W028
 * provenance re-guarded — violations carried VERBATIM with the offending
 * index), all records must share ONE §14 scope, the lineage must be
 * contiguous (1..n — duplicates and gaps are loud typed violations), and the
 * trail id + hash-chained head are minted through the contract's own laws.
 *
 * `verifyTrail(trail)` — THE TAMPER GATE: the trail is re-validated
 * end-to-end. Every record's id is re-derived from its own content (a
 * rewrite — §14's loud violation — is caught at the exact index); every
 * record's scope is re-proven against the trail's scope; the sequence axis
 * is re-walked; the whole digest chain is RECOMPUTED from the scope anchor
 * (a swapped link, an edited provenance citation or a forged head is a typed
 * mismatch naming the exact break); the trail id is re-derived.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md §14 (immutable append-only trails,
 * explicit scope), A9 (determinism), A14 (pure records — no I/O).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  appendToTrail,
  auditLinkOf,
  auditTrailIdOf,
  canonicalScopeContent,
  emptyTrail,
  scopeAnchorOf,
  validateAuditRecord,
  type AuditRecord,
  type AuditRecordViolation,
  type AuditTrail,
} from "observability";

// ---------------------------------------------------------------------------
// Assembly (deterministic — canonical order, one scope, contiguous lineage)
// ---------------------------------------------------------------------------

/** Every law an assembly can violate (closed set — failures name indexes). */
export type TrailAssemblyViolation =
  | {
      readonly kind: "empty-input";
      readonly detail: string;
    }
  | {
      readonly kind: "record-unlawful";
      readonly index: number;
      readonly detail: string;
      readonly violations: readonly AuditRecordViolation[];
    }
  | {
      readonly kind: "duplicate-record-id";
      readonly index: number;
      readonly detail: string;
    }
  | {
      readonly kind: "duplicate-sequence";
      readonly index: number;
      readonly detail: string;
    }
  | {
      readonly kind: "sequence-gap";
      readonly index: number;
      readonly detail: string;
    }
  | {
      readonly kind: "scope-mismatch";
      readonly index: number;
      readonly detail: string;
    };

/** The outcome of a trail assembly. */
export type TrailAssemblyOutcome =
  | { readonly ok: true; readonly trail: AuditTrail }
  | { readonly ok: false; readonly violations: readonly TrailAssemblyViolation[] };

const scopeKey = (scope: AuditRecord["scope"]): string =>
  JSON.stringify(canonicalScopeContent(scope));

/**
 * Assemble a trail from already-minted records — deterministic regardless of
 * input order (the canonical order is the records' own sequence axis). The
 * contract's append-only gate runs as defensive depth on every append.
 */
export function assembleTrail(
  records: readonly AuditRecord[],
): TrailAssemblyOutcome {
  if (records.length === 0) {
    return {
      ok: false,
      violations: [
        {
          kind: "empty-input",
          detail: "an audit trail needs at least one record (the scope comes from the records)",
        },
      ],
    };
  }
  const violations: TrailAssemblyViolation[] = [];
  const scope = records[0]!.scope;
  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  const ordered = [...records].sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index]!;
    const recordViolations = validateAuditRecord(record);
    if (recordViolations.length > 0) {
      violations.push({
        kind: "record-unlawful",
        index,
        detail: `record at position ${String(index)} fails whole-record re-validation`,
        violations: recordViolations,
      });
      continue;
    }
    if (seenIds.has(record.recordId)) {
      violations.push({
        kind: "duplicate-record-id",
        index,
        detail: `record ${record.recordId} appears twice — the trail is immutable append-only (§14)`,
      });
    }
    seenIds.add(record.recordId);
    if (seenSequences.has(record.sequence)) {
      violations.push({
        kind: "duplicate-sequence",
        index,
        detail: `sequence ${String(record.sequence)} appears twice`,
      });
    }
    seenSequences.add(record.sequence);
    if (scopeKey(record.scope) !== scopeKey(scope)) {
      violations.push({
        kind: "scope-mismatch",
        index,
        detail: `record at position ${String(index)} is outside the trail's scope (§14)`,
      });
    }
    if (record.sequence !== index + 1) {
      violations.push({
        kind: "sequence-gap",
        index,
        detail: `sequence ${String(record.sequence)} at position ${String(index)} breaks the contiguous 1..n lineage`,
      });
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  let trail = emptyTrail(scope);
  for (const record of ordered) {
    const appended = appendToTrail(trail, record);
    if (!appended.ok) {
      // Defensive depth: the contract's own append gate refused — carry it.
      return {
        ok: false,
        violations: appended.violations.map((violation) => ({
          kind: "scope-mismatch" as const,
          index: trail.records.length,
          detail: `contract append gate refused: ${violation.kind} — ${violation.detail}`,
        })),
      };
    }
    trail = appended.trail;
  }
  return { ok: true, trail };
}

// ---------------------------------------------------------------------------
// Verification (end-to-end — the tamper gate)
// ---------------------------------------------------------------------------

/** The typed outcome of an end-to-end trail verification. */
export type TrailVerification =
  | { readonly ok: true; readonly recordCount: number; readonly head: string }
  | {
      readonly ok: false;
      readonly kind:
        | "trail-not-an-object"
        | "record-unlawful"
        | "sequence-out-of-order"
        | "sequence-gap"
        | "scope-mismatch"
        | "link-mismatch"
        | "head-mismatch"
        | "trail-id-mismatch";
      readonly index?: number;
      readonly detail: string;
    };

/**
 * Re-verify a trail END-TO-END: every record re-validated (ids re-derived —
 * the rewrite gate), the §14 scope re-proven per record, the sequence axis
 * re-walked in order, the whole hash chain RECOMPUTED from the scope anchor
 * (each link commits to the previous link, the record content digest and the
 * W028 citation digest), the head and the trail id re-derived. Any tamper is
 * a LOUD typed violation naming the exact break. Pure; never throws.
 */
export function verifyTrail(trail: AuditTrail): TrailVerification {
  if (typeof trail !== "object" || trail === null) {
    return { ok: false, kind: "trail-not-an-object", detail: "trail is not an object" };
  }
  const records = trail.records;
  let previous = scopeAnchorOf(trail.scope);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const recordViolations = validateAuditRecord(record);
    if (recordViolations.length > 0) {
      return {
        ok: false,
        kind: "record-unlawful",
        index,
        detail: `record at position ${String(index)} fails whole-record re-validation: ${recordViolations
          .map((violation) => violation.kind)
          .join(", ")}`,
      };
    }
    if (scopeKey(record.scope) !== scopeKey(trail.scope)) {
      return {
        ok: false,
        kind: "scope-mismatch",
        index,
        detail: `record at position ${String(index)} is outside the trail's scope (§14)`,
      };
    }
    if (record.sequence !== index + 1) {
      return {
        ok: false,
        kind: record.sequence < index + 1 ? "sequence-out-of-order" : "sequence-gap",
        index,
        detail: `sequence ${String(record.sequence)} at position ${String(index)} breaks the contiguous ordered lineage`,
      };
    }
    const expectedLink = auditLinkOf(previous, record);
    previous = expectedLink;
  }
  if (trail.head !== previous) {
    return {
      ok: false,
      kind: "head-mismatch",
      index: records.length,
      detail: `trail head ${trail.head} does not match the recomputed head ${previous}`,
    };
  }
  const expectedTrailId = auditTrailIdOf(trail.scope, records);
  if (trail.trailId !== expectedTrailId) {
    return {
      ok: false,
      kind: "trail-id-mismatch",
      index: records.length,
      detail: `trail id ${trail.trailId} does not match the re-derived id ${expectedTrailId}`,
    };
  }
  return { ok: true, recordCount: records.length, head: trail.head };
}
