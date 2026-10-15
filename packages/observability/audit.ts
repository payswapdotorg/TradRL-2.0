/**
 * The AuditRecord contract (W061 `observability`) — immutable, append-only
 * records citing W028 provenance, and the audit-trail lineage laws.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md §14 — immutable append-only audit trails:
 * a rewrite is a LOUD typed violation (duplicate record ids and
 * non-successive sequences are refused here); tenant/project/world identity
 * is EXPLICIT on every record.
 * The provenance law (W028 carried): every audit record cites its source
 * through W028's own `SourceCitation` vocabulary — an artifact identity, a
 * dataset identity, or the HONEST `no-declared-source` marker. A record
 * WITHOUT provenance is refused; a malformed citation is refused.
 * Spec: A9 — determinism: record ids and trail ids are content-addressed
 * over canonical content; chain links are hash-chained DIGESTS AS DATA
 * (`link[i]` commits to `link[i-1]`, the record's own content digest and
 * the record's citation digest through W028's `citationDigestOf`); declared
 * timestamps only — no clocks, no randomness, no env reads.
 * Spec: A14 — contracts only: no serving, no alerting, no I/O.
 *
 * NOTE (disclosed): W028 ships per-kind citation guards
 * (`isArtifactCitation` / `isDatasetCitation`) but no union guard; the
 * structural union guard below mirrors W028's closed union exactly (kind ∈
 * {information-artifact, dataset, none} + each member's own field laws).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { citationDigestOf, type SourceCitation } from "tradrl-evidence";
import { canonicalDigestHex } from "trajectory";
import {
  canonicalScopeContent,
  OPS_ACTOR_KINDS,
  validateOpsScope,
  type OpsActor,
  type OpsScope,
  type OpsScopeViolation,
} from "./events.js";

// ---------------------------------------------------------------------------
// The provenance law (W028's vocabulary, structurally guarded)
// ---------------------------------------------------------------------------

/** Structural guard for W028's closed `SourceCitation` union. */
export function isSourceCitation(value: unknown): value is SourceCitation {
  if (typeof value !== "object" || value === null) return false;
  const citation = value as Record<string, unknown>;
  if (citation.kind === "none") return citation.reason === "no-declared-source";
  if (citation.kind === "dataset") {
    return (
      citation.basis === "import-causation" &&
      typeof citation.datasetId === "string" &&
      citation.datasetId.length > 0
    );
  }
  if (citation.kind === "information-artifact") {
    return (
      citation.basis === "payload-identity" &&
      typeof citation.artifactId === "string" &&
      citation.artifactId.length > 0 &&
      typeof citation.datasetId === "string" &&
      citation.datasetId.length > 0 &&
      typeof citation.recordDigest === "string" &&
      citation.recordDigest.length > 0
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// The closed audit-action vocabulary
// ---------------------------------------------------------------------------

/** The closed audit-action vocabulary (what the audited act was). */
export type AuditActionKind =
  | "config-declared"
  | "data-exported"
  | "policy-changed"
  | "record-written"
  | "report-composed"
  | "verification-run"
  | "world-accessed";
/** The closed audit-action vocabulary, canonical order. */
export const AUDIT_ACTION_KINDS: readonly AuditActionKind[] = [
  "config-declared",
  "data-exported",
  "policy-changed",
  "record-written",
  "report-composed",
  "verification-run",
  "world-accessed",
];

// ---------------------------------------------------------------------------
// The AuditRecord (immutable, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const auditRecordIdBrand: unique symbol;

/**
 * An OPAQUE content-addressed audit-record id: `aud-<digest>` over the
 * record's canonical content. Produced only by {@link auditRecordIdOf};
 * never parsed — the action/scope/subject travel explicitly on the record.
 */
export type AuditRecordId = string & { readonly [auditRecordIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const AUDIT_RECORD_ID_PREFIX = "aud-";

/**
 * One audit record: DECLARED DATA. `sequence` is the trail's own
 * strictly-increasing integer order; `declaredAt` is a declared timestamp
 * (integer ms the caller carries — A9: never a clock read); `subject` is
 * the opaque id of the thing acted upon; `detail` carries the audited
 * facts; `provenance` cites the source through W028's vocabulary.
 */
export interface AuditRecord {
  readonly recordId: AuditRecordId;
  readonly sequence: number;
  readonly action: AuditActionKind;
  readonly scope: OpsScope;
  readonly actor: OpsActor;
  readonly subject: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly provenance: SourceCitation;
  readonly declaredAt: number;
}

/** The canonical content a record id addresses (every law-bearing member). */
export function canonicalAuditContent(
  record: Omit<AuditRecord, "recordId">,
): Record<string, unknown> {
  return {
    action: record.action,
    actor: record.actor,
    declaredAt: record.declaredAt,
    detail: record.detail,
    provenance: record.provenance,
    scope: canonicalScopeContent(record.scope),
    sequence: record.sequence,
    subject: record.subject,
  };
}

/** The content digest of one record's canonical content (A9). */
export function auditRecordDigestOf(record: Omit<AuditRecord, "recordId">): string {
  return canonicalDigestHex(canonicalAuditContent(record));
}

/**
 * The content-addressed record id: `aud-<digest>`. Pure and deterministic —
 * the same declaration always mints the same id; any law-bearing edit mints
 * another (a rewrite is detectable by id re-derivation).
 */
export function auditRecordIdOf(record: Omit<AuditRecord, "recordId">): AuditRecordId {
  return `${AUDIT_RECORD_ID_PREFIX}${auditRecordDigestOf(record)}` as AuditRecordId;
}

// ---------------------------------------------------------------------------
// The construction gate (fail-closed)
// ---------------------------------------------------------------------------

/** Every law an audit-record declaration can violate (closed set). */
export type AuditRecordViolation =
  | OpsScopeViolation
  | {
      readonly kind:
        | "unknown-audit-action"
        | "unknown-actor-kind"
        | "blank-actor-id"
        | "blank-subject"
        | "detail-not-record"
        | "provenance-missing"
        | "provenance-malformed"
        | "non-integer-sequence"
        | "non-positive-sequence"
        | "non-integer-timestamp"
        | "negative-timestamp"
        | "record-id-mismatch";
      readonly detail: string;
    };

/** The outcome of the audit-record construction gate. */
export type MintAuditRecordOutcome =
  | { readonly ok: true; readonly record: AuditRecord }
  | { readonly ok: false; readonly violations: readonly AuditRecordViolation[] };

/**
 * The fail-closed construction gate: validates every law — §14 scope, the
 * closed action set, the W028 PROVENANCE CITATION (missing or malformed ⇒
 * refused) — then mints the content-addressed id. Never partial.
 */
export function mintAuditRecord(
  declaration: Omit<AuditRecord, "recordId">,
): MintAuditRecordOutcome {
  const violations: AuditRecordViolation[] = [];
  if (
    typeof declaration.action !== "string" ||
    !(AUDIT_ACTION_KINDS as readonly string[]).includes(declaration.action)
  ) {
    violations.push({
      kind: "unknown-audit-action",
      detail: `audit action ${JSON.stringify(declaration.action)} is outside the closed vocabulary`,
    });
  }
  violations.push(...validateOpsScope(declaration.scope));
  if (typeof declaration.actor?.kind !== "string" ||
    !(OPS_ACTOR_KINDS as readonly string[]).includes(declaration.actor?.kind)) {
    violations.push({
      kind: "unknown-actor-kind",
      detail: `actor kind ${JSON.stringify(declaration.actor?.kind)} is outside the closed vocabulary`,
    });
  }
  if (typeof declaration.actor?.actorId !== "string" || declaration.actor.actorId.length === 0) {
    violations.push({ kind: "blank-actor-id", detail: "actor id is blank" });
  }
  if (typeof declaration.subject !== "string" || declaration.subject.length === 0) {
    violations.push({ kind: "blank-subject", detail: "subject is blank" });
  }
  if (typeof declaration.detail !== "object" || declaration.detail === null || Array.isArray(declaration.detail)) {
    violations.push({ kind: "detail-not-record", detail: "detail is not a JSON record" });
  }
  if (declaration.provenance === undefined || declaration.provenance === null) {
    violations.push({
      kind: "provenance-missing",
      detail: "an audit record without provenance is refused (W028 law)",
    });
  } else if (!isSourceCitation(declaration.provenance)) {
    violations.push({
      kind: "provenance-malformed",
      detail: "provenance is not a W028 SourceCitation (closed union: information-artifact | dataset | none)",
    });
  }
  if (typeof declaration.sequence !== "number" || !Number.isSafeInteger(declaration.sequence)) {
    violations.push({ kind: "non-integer-sequence", detail: "sequence is not a safe integer" });
  } else if (declaration.sequence < 1) {
    violations.push({ kind: "non-positive-sequence", detail: `sequence ${String(declaration.sequence)} is below 1` });
  }
  if (typeof declaration.declaredAt !== "number" || !Number.isSafeInteger(declaration.declaredAt)) {
    violations.push({ kind: "non-integer-timestamp", detail: "declaredAt is not a safe integer" });
  } else if (declaration.declaredAt < 0) {
    violations.push({ kind: "negative-timestamp", detail: `declaredAt ${String(declaration.declaredAt)} is negative` });
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true, record: { ...declaration, recordId: auditRecordIdOf(declaration) } };
}

// ---------------------------------------------------------------------------
// The audit trail (append-only lineage, hash-chained digests as data)
// ---------------------------------------------------------------------------

declare const auditTrailIdBrand: unique symbol;

/** An OPAQUE content-addressed trail id: `atr-<digest>`. */
export type AuditTrailId = string & { readonly [auditTrailIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const AUDIT_TRAIL_ID_PREFIX = "atr-";

/**
 * The audit trail: ONE scope, the records in strictly-increasing sequence
 * order, and the chain head. Append-only — {@link appendToTrail} is the ONLY
 * sanctioned growth law; any rewrite is refused loudly.
 */
export interface AuditTrail {
  readonly trailId: AuditTrailId;
  readonly scope: OpsScope;
  readonly records: readonly AuditRecord[];
  readonly head: string;
}

/** The scope anchor: the chain's genesis digest (an empty trail's head). */
export function scopeAnchorOf(scope: OpsScope): string {
  return canonicalDigestHex({ anchor: canonicalScopeContent(scope) });
}

/**
 * One chain link: commits to the previous link, the record's own content
 * digest and the record's citation digest (W028 `citationDigestOf`) — a
 * provenance edit or a record rewrite both break the chain (A9).
 */
export function auditLinkOf(previous: string, record: AuditRecord): string {
  const recordCore: Omit<AuditRecord, "recordId"> = record;
  return canonicalDigestHex({
    previous,
    provenance: citationDigestOf(record.provenance),
    record: auditRecordDigestOf(recordCore),
  });
}

/** The trail's chain head over its records (the scope anchor when empty). */
export function trailHeadOf(scope: OpsScope, records: readonly AuditRecord[]): string {
  let link = scopeAnchorOf(scope);
  for (const record of records) {
    link = auditLinkOf(link, record);
  }
  return link;
}

/** The content-addressed trail id over the scope + the record ids (A9). */
export function auditTrailIdOf(scope: OpsScope, records: readonly AuditRecord[]): AuditTrailId {
  const digest = canonicalDigestHex({
    recordIds: records.map((record) => record.recordId),
    scope: canonicalScopeContent(scope),
  });
  return `${AUDIT_TRAIL_ID_PREFIX}${digest}` as AuditTrailId;
}

/** Every law an append can violate (closed set — the rewrite refusals). */
export type TrailAppendViolation =
  | {
      readonly kind:
        | "duplicate-record-id"
        | "non-successive-sequence"
        | "scope-mismatch"
        | "record-unlawful";
      readonly detail: string;
    }
  | { readonly kind: "unknown"; readonly detail: string };

/** The outcome of the append-only gate. */
export type TrailAppendOutcome =
  | { readonly ok: true; readonly trail: AuditTrail }
  | { readonly ok: false; readonly violations: readonly TrailAppendViolation[] };

/** The canonical order law: strictly by sequence (the trail's own axis). */
export function compareAuditRecords(left: AuditRecord, right: AuditRecord): number {
  return left.sequence - right.sequence;
}

/**
 * THE APPEND-ONLY LAW: grow a trail by exactly one ALREADY-MINTED record.
 * Refused loudly: re-appending a record id (immutable — a rewrite), a
 * sequence that is not exactly last+1, a record outside the trail's scope,
 * or a record that fails its own whole-record laws.
 */
export function appendToTrail(trail: AuditTrail, record: AuditRecord): TrailAppendOutcome {
  const violations: TrailAppendViolation[] = [];
  const last = trail.records[trail.records.length - 1];
  if (trail.records.some((existing) => existing.recordId === record.recordId)) {
    violations.push({
      kind: "duplicate-record-id",
      detail: `record ${record.recordId} already exists — the trail is immutable append-only (§14)`,
    });
  }
  if (last !== undefined && record.sequence !== last.sequence + 1) {
    violations.push({
      kind: "non-successive-sequence",
      detail: `sequence ${String(record.sequence)} does not succeed ${String(last.sequence)}`,
    });
  }
  if (
    JSON.stringify(canonicalScopeContent(record.scope)) !==
    JSON.stringify(canonicalScopeContent(trail.scope))
  ) {
    violations.push({
      kind: "scope-mismatch",
      detail: "record scope does not equal the trail's scope (§14)",
    });
  }
  if (auditRecordIdOf(record) !== record.recordId) {
    violations.push({
      kind: "record-unlawful",
      detail: `record ${String(record.recordId)} fails whole-record re-validation (id re-derivation)`,
    });
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const records = [...trail.records, record];
  return {
    ok: true,
    trail: {
      trailId: auditTrailIdOf(trail.scope, records),
      scope: trail.scope,
      records,
      head: trailHeadOf(trail.scope, records),
    },
  };
}

/** The empty trail of one scope (the genesis — append from here). */
export function emptyTrail(scope: OpsScope): AuditTrail {
  return {
    trailId: auditTrailIdOf(scope, []),
    scope,
    records: [],
    head: scopeAnchorOf(scope),
  };
}
