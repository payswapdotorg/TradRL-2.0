/**
 * Whole-record re-validation (W050) — the point-in-time laws re-proven
 * from recorded data.
 *
 * The W047 episode / W048 plan re-validation pattern: nothing recorded is
 * ever trusted — a query (or a sealed view) handed back to the machine is
 * re-proven through its own laws: the query id is RE-DERIVED from the
 * carried scope + cutoff + families; the firewall digest and the view id
 * are RE-DERIVED from the carried records and proof; every sealed record
 * is re-proven ≤ cutoff through its own timestamps (R016); the canonical
 * order is re-derived. Every violation is collected and named (fail-closed
 * at every seam — W004/W027 errors carried verbatim where the query's own
 * re-proof is the source).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the re-derivations are pure: same
 * recorded data ⇒ same verdicts, always.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  PointInTimeCutoff,
  PointInTimeQuery,
  PointInTimeQueryError,
  TimeMachineRecordFamily,
  TimeMachineScope,
} from "./query.js";
import {
  blankTimeMachineScopeMembers,
  isLegalCutoff,
  isTimeMachineRecordFamily,
  pointInTimeQueryIdOf,
} from "./query.js";
import type {
  FirewallProofEntry,
  PointInTimeView,
  ViewRecord,
} from "./firewall.js";
import {
  compareViewRecords,
  firewallDigestOf,
  pointInViewIdOf,
  viewRecordOccurredAt,
  viewRecordObservableAt,
} from "./firewall.js";

// ---------------------------------------------------------------------------
// The query re-proof
// ---------------------------------------------------------------------------

/** Result of re-validating one point-in-time query. */
export type PointInTimeQueryValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly PointInTimeQueryError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeViolations(scope: unknown): PointInTimeQueryError[] {
  if (!isRecordLike(scope)) {
    return [
      {
        code: "blank-scope-member",
        message: "scope is not an object — tenantId, projectId, worldId are required",
      },
    ];
  }
  const typed = scope as unknown as TimeMachineScope;
  return blankTimeMachineScopeMembers(typed).map((member) => ({
    code: "blank-scope-member" as const,
    message: `scope member ${String(member)} is blank — the scope must be explicit`,
  }));
}

function familyViolations(families: unknown): PointInTimeQueryError[] {
  if (!Array.isArray(families)) {
    return [
      {
        code: "empty-family-set",
        message: "families is not an array — the declared record families are required",
      },
    ];
  }
  const errors: PointInTimeQueryError[] = [];
  if (families.length === 0) {
    errors.push({
      code: "empty-family-set",
      message: "no declared record families — a query over nothing is never silently built",
    });
  }
  const seen = new Set<string>();
  for (const family of families) {
    if (!isTimeMachineRecordFamily(family)) {
      errors.push({
        code: "unknown-family",
        message: `record family ${JSON.stringify(String(family))} is outside the closed vocabulary`,
      });
    } else if (seen.has(family)) {
      errors.push({
        code: "duplicate-family",
        message: `record family ${JSON.stringify(family)} is declared twice — never silently deduplicated`,
      });
    } else {
      seen.add(family);
    }
  }
  return errors;
}

/**
 * Re-validate one point-in-time query completely: structural laws (scope,
 * families, cutoff legality) plus the identity law — the `queryId` must
 * RE-DERIVE from the carried scope + cutoff + families. Pure and total:
 * malformed input is refused with named errors, never thrown at.
 */
export function validatePointInTimeQuery(query: PointInTimeQuery): PointInTimeQueryValidation {
  const errors: PointInTimeQueryError[] = [];
  if (!isRecordLike(query)) {
    return {
      ok: false,
      errors: [
        {
          code: "query-id-mismatch",
          message: "query is not an object — a point-in-time query is typed data",
        },
      ],
    };
  }
  errors.push(...scopeViolations(query.scope));
  errors.push(...familyViolations(query.families));
  const cutoff = query.cutoff as unknown as number;
  if (!isLegalCutoff(cutoff)) {
    errors.push({
      code: "illegal-cutoff",
      message: `cutoff ${String(query.cutoff)} is not a finite non-negative integer (simulation axis)`,
    });
  }
  if (
    errors.length === 0 &&
    Array.isArray(query.families) &&
    isRecordLike(query.scope)
  ) {
    const derived = pointInTimeQueryIdOf(
      query.scope,
      cutoff as PointInTimeCutoff,
      [...(query.families as TimeMachineRecordFamily[])].sort(),
    );
    if (derived !== query.queryId) {
      errors.push({
        code: "query-id-mismatch",
        message:
          `queryId ${JSON.stringify(String(query.queryId))} does not re-derive from the ` +
          `carried scope/cutoff/families (expected ${JSON.stringify(derived)})`,
      });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The sealed view re-proof
// ---------------------------------------------------------------------------

/** Everything that can be wrong with a sealed point-in-time view. */
export type PointInViewErrorCode =
  | "invalid-query" // the carried query failed re-proof (errors carried verbatim)
  | "family-not-declared" // a sealed record of an undeclared family (R016 scope law)
  | "duplicate-record-id" // two sealed records cite the same opaque id
  | "post-cutoff-record" // THE R016 LAW: a sealed record observable only after the cutoff
  | "records-not-canonical" // the records are not in canonical order
  | "proof-records-mismatch" // the proof entries do not match the records 1:1, in order
  | "firewall-digest-mismatch" // the firewall digest does not re-derive
  | "view-id-mismatch"; // the view id does not re-derive

/** One typed view error (fail-closed). */
export interface PointInViewError {
  readonly code: PointInViewErrorCode;
  readonly message: string;
  /** `invalid-query` only: the query re-proof errors, carried verbatim. */
  readonly queryErrors?: readonly PointInTimeQueryError[];
}

/** Result of re-validating one sealed point-in-time view. */
export type PointInTimeViewValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly PointInViewError[] };

/**
 * Re-validate one sealed point-in-time view completely: the carried query
 * re-proven, every sealed record re-proven ≤ cutoff through its own
 * timestamps (R016 — the firewall re-proven, never trusted), the canonical
 * order re-derived, the proof entries matched 1:1 to the records, and the
 * firewall digest + view id RE-DERIVED. Pure and total.
 */
export function validatePointInTimeView(view: PointInTimeView): PointInTimeViewValidation {
  const errors: PointInViewError[] = [];
  if (!isRecordLike(view) || !isRecordLike(view.query) || !Array.isArray(view.records)) {
    return {
      ok: false,
      errors: [
        {
          code: "view-id-mismatch",
          message: "view is not structurally a sealed point-in-time view (typed data)",
        },
      ],
    };
  }
  const queryValidation = validatePointInTimeQuery(view.query);
  if (!queryValidation.ok) {
    errors.push({
      code: "invalid-query",
      message:
        `the carried query failed re-proof (${String(queryValidation.errors.length)} ` +
        `error(s), first: ${String(queryValidation.errors[0]?.code ?? "none")})`,
      queryErrors: queryValidation.errors,
    });
    return { ok: false, errors };
  }
  const query = view.query;
  const declared = new Set<TimeMachineRecordFamily>(query.families);
  const seenIds = new Set<string>();
  for (const record of view.records as readonly ViewRecord[]) {
    const recordId = String(record.recordId);
    if (!isRecordLike(record) || !isTimeMachineRecordFamily(record.family)) {
      errors.push({
        code: "family-not-declared",
        message: `record ${JSON.stringify(recordId)} is not a viewable record`,
      });
      continue;
    }
    if (!declared.has(record.family)) {
      errors.push({
        code: "family-not-declared",
        message:
          `record ${JSON.stringify(recordId)} is of family ` +
          `${JSON.stringify(String(record.family))}, which the query does not declare (R016)`,
      });
    }
    if (seenIds.has(recordId)) {
      errors.push({
        code: "duplicate-record-id",
        message: `record id ${JSON.stringify(recordId)} appears twice in one view`,
      });
    }
    seenIds.add(recordId);
    const observableAt = viewRecordObservableAt(record);
    if (observableAt > query.cutoff) {
      errors.push({
        code: "post-cutoff-record",
        message:
          `record ${JSON.stringify(recordId)} is observable at ${String(observableAt)}, ` +
          `after the cutoff ${String(query.cutoff)} — R016 violated`,
      });
    }
  }
  const records = view.records as readonly ViewRecord[];
  for (let index = 1; index < records.length; index += 1) {
    if (compareViewRecords(records[index - 1]!, records[index]!) > 0) {
      errors.push({
        code: "records-not-canonical",
        message: `records at indexes ${String(index - 1)}/${String(index)} are not in canonical order`,
      });
      break;
    }
  }
  const entries = (view.proof?.entries ?? []) as readonly FirewallProofEntry[];
  if (entries.length !== records.length) {
    errors.push({
      code: "proof-records-mismatch",
      message:
        `proof carries ${String(entries.length)} entries for ` +
        `${String(records.length)} records — the proof must match the records 1:1`,
    });
  } else {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const record = records[index]!;
      if (
        entry.recordId !== String(record.recordId) ||
        entry.family !== record.family ||
        entry.occurredAt !== viewRecordOccurredAt(record) ||
        entry.observableAt !== viewRecordObservableAt(record)
      ) {
        errors.push({
          code: "proof-records-mismatch",
          message: `proof entry ${String(index)} does not match record ${String(index)}`,
        });
        break;
      }
    }
  }
  const derivedDigest = firewallDigestOf(query.cutoff, entries);
  if (view.proof?.firewallDigest !== derivedDigest) {
    errors.push({
      code: "firewall-digest-mismatch",
      message:
        `firewallDigest ${JSON.stringify(String(view.proof?.firewallDigest))} does not ` +
        `re-derive (expected ${JSON.stringify(derivedDigest)})`,
    });
  }
  const proof = view.proof;
  if (proof === undefined || proof === null || typeof proof !== "object") {
    return { ok: false, errors };
  }
  const derivedViewId = pointInViewIdOf(query, records, view.proof);
  if (view.viewId !== derivedViewId) {
    errors.push({
      code: "view-id-mismatch",
      message:
        `viewId ${JSON.stringify(String(view.viewId))} does not re-derive from the ` +
        `carried query/records/proof (expected ${JSON.stringify(derivedViewId)})`,
    });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
