/**
 * The deterministic recall surface (W054) — typed queries over the firm
 * brain's accumulated knowledge.
 *
 * §14: "Tenant/project/world identity is explicit in persistence AND
 * TRANSPORT" — so every query CARRIES its explicit scope. A query whose
 * tenant is not the brain's tenant is the LOUD `cross-tenant-query`
 * refusal naming R056 (Firm Brain is tenant isolated — there is no seam
 * here that can enumerate another tenant's knowledge); a same-tenant
 * project/world disagreement is the §14 `query-scope-mismatch`.
 *
 * The results are CARRIED, never re-scored, never re-derived (A14): the
 * matching records verbatim, in the brain's own canonical record-id order
 * (A9 — deterministic recall ordering). The brain is re-validated first
 * (fail-closed at every seam): recall over an invalid brain is refused
 * with the invariant errors carried verbatim.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { EXPLICIT_SCOPE_LAW, KNOWLEDGE_KINDS, TENANT_ISOLATION_LAW, citedIdsOf, sourceIdOf } from "memory";
import type { KnowledgeKind, KnowledgeRecord, KnowledgeScope } from "memory";
import { brainDigestOf } from "./brain.js";
import type { BrainValidationError, FirmBrain } from "./brain.js";
import { validateFirmBrain } from "./validate.js";

/** The closed recall-query kind vocabulary. */
export const RECALL_QUERY_KINDS = ["by-kind", "by-source", "by-citation"] as const;

/** The typed recall-query union (§14: the scope is explicit in transport). */
export type RecallQuery =
  | { readonly kind: "by-kind"; readonly scope: KnowledgeScope; readonly knowledgeKind: KnowledgeKind }
  | { readonly kind: "by-source"; readonly scope: KnowledgeScope; readonly sourceId: string }
  | { readonly kind: "by-citation"; readonly scope: KnowledgeScope; readonly citedId: string };

/** Everything recall can refuse. */
export type RecallErrorCode =
  | "malformed-input" // the query (or brain) is not lawful typed data
  | "invalid-brain" // the brain failed its own invariants (carried verbatim)
  | "invalid-scope" // a §14 scope member is blank
  | "cross-tenant-query" // R056: the query's tenant ≠ the brain's tenant
  | "query-scope-mismatch" // §14: same tenant, another project/world
  | "unknown-recall-kind" // the closed query vocabulary, loudly enforced
  | "unknown-knowledge-kind" // by-kind: outside the closed knowledge vocabulary
  | "blank-query-id"; // by-source/by-citation: a blank id

/** One typed recall error (fail-closed; the law named in the message). */
export interface RecallError {
  readonly code: RecallErrorCode;
  readonly message: string;
  /** `invalid-brain` only: the brain-invariant errors, carried VERBATIM. */
  readonly brainErrors?: readonly BrainValidationError[];
}

/** The recall outcome: the carried records in canonical order, or the refusal. */
export type RecallOutcome =
  | { readonly ok: true; readonly brainId: FirmBrain["brainId"]; readonly generation: number; readonly records: readonly KnowledgeRecord[] }
  | { readonly ok: false; readonly errors: readonly RecallError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function blankMembers(scope: KnowledgeScope): readonly string[] {
  const members: readonly (keyof KnowledgeScope)[] = ["tenantId", "projectId", "worldId"];
  return members.filter((member) => String(scope[member]).trim().length === 0);
}

function scopeErrors(brain: FirmBrain, query: KnowledgeScope): RecallError | undefined {
  for (const member of blankMembers(query)) {
    return { code: "invalid-scope", message: `the query scope's '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), in transport too` };
  }
  if (String(query.tenantId) !== String(brain.scope.tenantId)) {
    return { code: "cross-tenant-query", message: `the query's tenant '${String(query.tenantId)}' is not the brain's tenant '${brain.scope.tenantId}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant query is refused loudly, never answered` };
  }
  for (const member of ["projectId", "worldId"] as const) {
    if (String(query[member]) !== String(brain.scope[member])) {
      return { code: "query-scope-mismatch", message: `the query's '${member}' '${String(query[member])}' disagrees with the brain's '${String(brain.scope[member])}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), in transport too` };
    }
  }
  return undefined;
}

function matches(query: RecallQuery, record: KnowledgeRecord): boolean {
  switch (query.kind) {
    case "by-kind":
      return record.citation.kind === query.knowledgeKind;
    case "by-source":
      return sourceIdOf(record.citation) === query.sourceId;
    case "by-citation":
      return citedIdsOf(record.citation).includes(query.citedId);
  }
}

/**
 * Recall knowledge from the brain — the DETERMINISTIC recall surface: the
 * brain is re-validated first (fail-closed), the query's explicit §14 scope
 * proven against the brain's (a cross-tenant query is the LOUD refusal
 * naming R056), then the matching records are CARRIED VERBATIM in the
 * brain's canonical record-id order. Never re-scores, never re-ranks,
 * never re-derives (A14 + A9: the same brain + the same query ⇒ the same
 * results, always).
 */
export function recall(brain: FirmBrain, query: RecallQuery): RecallOutcome {
  if (!isRecordLike(brain) || !isRecordLike(query)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "recall takes a founded brain value and a typed query — a scope-carrying query object is required" }] };
  }
  const validation = validateFirmBrain(brain);
  if (!validation.ok) {
    return { ok: false, errors: [{ code: "invalid-brain", message: "the brain failed its own whole-brain invariants — recall is refused, the errors carried verbatim", brainErrors: validation.errors }] };
  }
  if (!RECALL_QUERY_KINDS.includes(query.kind as (typeof RECALL_QUERY_KINDS)[number])) {
    return { ok: false, errors: [{ code: "unknown-recall-kind", message: `the recall query kind '${String(query.kind)}' is outside the closed vocabulary — recall answers ${RECALL_QUERY_KINDS.join(", ")} only` }] };
  }
  const scopeFailure = scopeErrors(brain, query.scope as KnowledgeScope);
  if (scopeFailure !== undefined) {
    return { ok: false, errors: [scopeFailure] };
  }
  if (query.kind === "by-kind" && !KNOWLEDGE_KINDS.includes(query.knowledgeKind as KnowledgeKind)) {
    return { ok: false, errors: [{ code: "unknown-knowledge-kind", message: `the knowledge kind '${String(query.knowledgeKind)}' is outside the closed vocabulary — knowledge is ${KNOWLEDGE_KINDS.join(", ")} only` }] };
  }
  if (query.kind !== "by-kind" && String(query.kind === "by-source" ? query.sourceId : query.citedId).trim().length === 0) {
    return { ok: false, errors: [{ code: "blank-query-id", message: `the '${String(query.kind)}' query carries a blank id — the queried identity is explicit, never blank` }] };
  }
  const typedQuery = query as RecallQuery;
  const records = brain.records.filter((record) => matches(typedQuery, record));
  return { ok: true, brainId: brainDigestOf(brain), generation: brain.generation, records };
}
