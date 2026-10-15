/**
 * The knowledge record (W054) — the firm's accumulated knowledge, as typed
 * DATA. The MEMORY CONTRACT's heart.
 *
 * The chain: W038 evaluates; W040 registers MEASURED capabilities; W051
 * proves search integrity; W053 derives post-mortems + lessons (the carried
 * evidence of what worked and what failed). THIS module seals ONE KNOWLEDGE
 * RECORD: the typed source citation, the payload CARRIED VERBATIM (never
 * re-scored — A14), the explicit tenant/project/world scope (§14), the
 * immutable lineage, the deterministic provenance, the `mem-<digest>` id.
 *
 * R056 ENFORCED STRUCTURALLY: the TENANT scope is part of the record's
 * canonical identity — the id is minted over a canonical form whose FIRST
 * weighed member is the tenant (identical payloads under different tenants
 * are different knowledge), and a payload whose own scope disagrees with the
 * record's declared tenant is a LOUD typed `cross-tenant` refusal naming
 * R056, never a silent adoption.
 *
 * Laws: spec/REQUIREMENTS.md R056 ("Firm Brain is tenant isolated");
 * spec/ARCHITECTURE-LOCK.md §14 (tenant/project/world identity explicit in
 * persistence and transport); A6 (every record cites its source record);
 * A9 (same scope + source + payload ⇒ deep-equal record, same id; no
 * clocks, no randomness, no env reads); A14 (typed records carried, never
 * re-scored). DIVISION OF LABOR: THIS module enforces the record's own
 * identity laws; the DEEP source re-proof (W053/W040/W051's own validators)
 * is the ingestion gate of services/firm-brain.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { LessonSet, PostMortem, PostMortemId } from "outcome-learning";
import type { CapabilityId, CapabilityState, RegistryEntry } from "capability-registry";
import type { SearchHistory, SearchHistoryId } from "search-integrity";

/** R056 — THE tenant-isolation law of the firm brain. */
export const TENANT_ISOLATION_LAW = "spec/REQUIREMENTS.md R056" as const;
/** §14 — explicit tenant/project/world identity in persistence + transport. */
export const EXPLICIT_SCOPE_LAW = "spec/ARCHITECTURE-LOCK.md §14" as const;
/** The canonical law list carried on every record's provenance. */
export const KNOWLEDGE_PROVENANCE_LAWS: readonly string[] = [TENANT_ISOLATION_LAW, EXPLICIT_SCOPE_LAW, "spec/ARCHITECTURE-LOCK.md A6", "spec/ARCHITECTURE-LOCK.md A9", "spec/ARCHITECTURE-LOCK.md A14"];

/** The explicit identity scope every knowledge record carries (§14). */
export interface KnowledgeScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}
/** The scope members, in canonical order (validation + digest order). */
export const KNOWLEDGE_SCOPE_MEMBERS: readonly (keyof KnowledgeScope)[] = ["tenantId", "projectId", "worldId"];
/** The blank scope members (the fail-closed identity gate's offender list). */
export function blankKnowledgeScopeMembers(scope: KnowledgeScope): readonly (keyof KnowledgeScope)[] {
  return KNOWLEDGE_SCOPE_MEMBERS.filter((member) => String(scope[member]).trim().length === 0);
}
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}
/** The closed knowledge-kind vocabulary (the digest's own order). */
export const KNOWLEDGE_KINDS = ["post-mortem", "lesson-set", "capability", "search-history"] as const;
/** One knowledge kind (which source package the knowledge came from). */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
/** The post-mortem citation: the sealed outcome record's own identity. */
export interface PostMortemSourceCitation {
  readonly kind: "post-mortem";
  readonly postMortemId: PostMortemId;
  readonly evaluationId: string;
}
/** The lesson-set citation: the derived lessons + the post-mortem they answer. */
export interface LessonSetSourceCitation {
  readonly kind: "lesson-set";
  readonly postMortemId: PostMortemId;
  readonly lessonSetDigest: string;
  readonly lessonCount: number;
}
/** The capability citation: the registered capability's own identity + state. */
export interface CapabilitySourceCitation {
  readonly kind: "capability";
  readonly capabilityId: CapabilityId;
  readonly state: CapabilityState;
}
/** The search-history citation: the declared history's own identity. */
export interface SearchHistorySourceCitation {
  readonly kind: "search-history";
  readonly historyId: SearchHistoryId;
  readonly experimentId: string;
  readonly trialCount: number;
}
/** The typed source-citation union (A6: the record cites its evidence). */
export type KnowledgeSourceCitation = PostMortemSourceCitation | LessonSetSourceCitation | CapabilitySourceCitation | SearchHistorySourceCitation;
/** The post-mortem payload: the W053 record, carried whole. */
export interface PostMortemPayload {
  readonly kind: "post-mortem";
  readonly postMortem: PostMortem;
}
/** The lesson-set payload: the lesson set AND the post-mortem it answers,
 * carried whole — the record is self-contained (whole-record re-validation
 * never needs a sibling; the post-mortem is the lessons' own A6 evidence). */
export interface LessonSetPayload {
  readonly kind: "lesson-set";
  readonly lessons: LessonSet;
  readonly postMortem: PostMortem;
}
/** The capability payload: one W040 registry entry (descriptor + lifecycle). */
export interface CapabilityPayload {
  readonly kind: "capability";
  readonly entry: RegistryEntry;
}
/** The search-history payload: the W051 record, carried whole. */
export interface SearchHistoryPayload {
  readonly kind: "search-history";
  readonly history: SearchHistory;
}
/** The carried payload union (the kind always agrees with the citation's). */
export type KnowledgePayload = PostMortemPayload | LessonSetPayload | CapabilityPayload | SearchHistoryPayload;
/** The sealing input's source member (payload-first; the citation is derived). */
export type KnowledgeSourceInput = KnowledgePayload;

declare const knowledgeRecordIdBrand: unique symbol;
/** An OPAQUE knowledge-record id (a canonical digest rendering). Produced
 * only by the seal gate / {@link knowledgeRecordDigestOf}; never parsed. */
export type KnowledgeRecordId = string & { readonly [knowledgeRecordIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const KNOWLEDGE_RECORD_ID_PREFIX = "mem-";
/** The immutable lineage (the W037/W051/W052/W053 branch-lineage pattern):
 * a record never branches on its own — a CONTINUATION declares its parent,
 * and the chain's root + ordinal are carried verbatim. */
export interface KnowledgeLineage {
  readonly parent: KnowledgeRecordId | undefined;
  readonly root: KnowledgeRecordId;
  readonly ordinal: number;
}
/** The declared lineage at seal time (a root record omits it). */
export interface KnowledgeLineageInput {
  readonly parent?: KnowledgeRecordId;
  readonly root?: KnowledgeRecordId;
  readonly ordinal?: number;
}
/** The deterministic provenance record (carried as data, re-derivable). */
export interface KnowledgeProvenance {
  readonly deriver: "seal-knowledge-record";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}
/** ONE knowledge record: the opaque content-addressed id, the explicit
 * scope (the TENANT is part of the canonical identity — R056 structural),
 * the typed source citation, the carried payload, the immutable lineage,
 * the deterministic provenance. Typed DATA — never reasoned over, never
 * applied (that is the runtime's job, W044+/W055). */
export interface KnowledgeRecord {
  readonly recordId: KnowledgeRecordId;
  readonly scope: KnowledgeScope;
  readonly citation: KnowledgeSourceCitation;
  readonly payload: KnowledgePayload;
  readonly lineage: KnowledgeLineage;
  readonly provenance: KnowledgeProvenance;
}
/** Everything the seal gate and the re-validator can refuse. */
export type KnowledgeRecordErrorCode =
  | "malformed-input" | "malformed-record" // not lawful typed data
  | "record-id-mismatch" // the id does not re-derive from its own carried bytes (A9)
  | "invalid-scope" // a §14 scope member is blank
  | "unknown-source-kind" // the closed vocabulary, loudly enforced
  | "blank-source-id" // the source record carries no identity
  | "citation-mismatch" // the citation disagrees with the carried payload
  | "cross-tenant" // R056: the payload's tenant ≠ the record's tenant
  | "scope-mismatch" // §14: the payload's project/world disagree
  | "lineage-break" // the immutable lineage is incoherent
  | "provenance-mismatch"; // the provenance does not re-derive (A9)
/** One typed knowledge-record error (fail-closed; the law named in the message). */
export interface KnowledgeRecordError {
  readonly code: KnowledgeRecordErrorCode;
  readonly message: string;
  /** The offending record/source id, when the error belongs to one entry. */
  readonly entryId?: string;
}
/** The seal outcome: the sealed record, or the refusal. */
export type KnowledgeRecordOutcome = { readonly ok: true; readonly record: KnowledgeRecord } | { readonly ok: false; readonly errors: readonly KnowledgeRecordError[] };
/** The sealing input: scope, source payload, optional declared lineage. */
export interface KnowledgeRecordInput {
  readonly scope: KnowledgeScope;
  readonly source: KnowledgeSourceInput;
  readonly lineage?: KnowledgeLineageInput;
}

/** The canonical citation tuple (kind + identity + counts, fixed order). */
function citationTupleOf(citation: KnowledgeSourceCitation): unknown[] {
  switch (citation.kind) {
    case "post-mortem": return [citation.kind, String(citation.postMortemId), String(citation.evaluationId)];
    case "lesson-set": return [citation.kind, String(citation.postMortemId), String(citation.lessonSetDigest), citation.lessonCount];
    case "capability": return [citation.kind, String(citation.capabilityId), String(citation.state)];
    case "search-history": return [citation.kind, String(citation.historyId), String(citation.experimentId), citation.trialCount];
  }
}
/** The canonical bytes the id addresses: the scope rides as an ORDERED
 * TUPLE with the TENANT FIRST — R056 enforced structurally. The lineage
 * rides BESIDE the id, never inside it (the W053 precedent). */
function knowledgeCanonicalContent(scope: KnowledgeScope, citation: KnowledgeSourceCitation, payload: KnowledgePayload): unknown {
  return { payload, scope: [scope.tenantId, scope.projectId, scope.worldId], source: citationTupleOf(citation) };
}
/** The knowledge-record id: `mem-<digest>` over the canonical record
 * bytes. Pure and deterministic (A9): the same scope + citation + payload
 * always yield the same id; ANY differing member — the tenant included —
 * yields a different id. */
export function knowledgeRecordDigestOf(record: KnowledgeRecord): KnowledgeRecordId {
  const digest = canonicalDigestHex(knowledgeCanonicalContent(record.scope, record.citation, record.payload));
  return `${KNOWLEDGE_RECORD_ID_PREFIX}${digest}` as KnowledgeRecordId;
}

/** The payload's OWN §14 scope, when it carries one (the search history's
 * experimentId member is not a §14 member and never participates). The
 * lesson set carries its post-mortem's scope. Defensive: malformed ⇒
 * undefined, never a crash. */
export function payloadScopeOf(payload: KnowledgePayload): KnowledgeScope | undefined {
  if (!isRecordLike(payload)) {
    return undefined;
  }
  switch (payload.kind) {
    case "post-mortem":
    case "lesson-set": {
      const scope = (payload as { postMortem?: { scope?: unknown } }).postMortem?.scope;
      return isRecordLike(scope) ? (scope as unknown as KnowledgeScope) : undefined;
    }
    case "capability": {
      const scope = (payload as { entry?: { descriptor?: { scope?: unknown } } }).entry?.descriptor?.scope;
      return isRecordLike(scope) ? (scope as unknown as KnowledgeScope) : undefined;
    }
    case "search-history": {
      const scope = (payload as { history?: { scope?: unknown } }).history?.scope;
      return isRecordLike(scope) ? (scope as unknown as KnowledgeScope) : undefined;
    }
  }
}
/** The scope-agreement errors: cross-tenant names R056, loudly. */
function scopeAgreementErrors(scope: KnowledgeScope, payload: KnowledgePayload): KnowledgeRecordError[] {
  const carried = payloadScopeOf(payload);
  if (carried === undefined) {
    return [{ code: "malformed-input", message: "the source payload carries no explicit §14 scope — knowledge records never default a scope" }];
  }
  if (String(carried.tenantId) !== String(scope.tenantId)) {
    return [{ code: "cross-tenant", message: `the source record's tenant '${String(carried.tenantId)}' is not the knowledge record's tenant '${scope.tenantId}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant record is refused loudly, never adopted` }];
  }
  const errors: KnowledgeRecordError[] = [];
  for (const member of ["projectId", "worldId"] as const) {
    if (String(carried[member]) !== String(scope[member])) {
      errors.push({ code: "scope-mismatch", message: `the source record's '${member}' '${String(carried[member])}' disagrees with the knowledge record's '${scope[member]}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})` });
    }
  }
  return errors;
}
/** The structural + identity errors of one source payload (seal-time). */
function sourceStructureErrors(source: KnowledgeSourceInput): KnowledgeRecordError[] {
  if (!isRecordLike(source) || !KNOWLEDGE_KINDS.includes(source.kind as KnowledgeKind)) {
    return [{ code: "unknown-source-kind", message: `the source kind '${String(isRecordLike(source) ? source.kind : source)}' is outside the closed vocabulary — knowledge cites ${KNOWLEDGE_KINDS.join(", ")} only` }];
  }
  switch (source.kind) {
    case "post-mortem":
      if (!isRecordLike(source.postMortem)) {
        return [{ code: "malformed-input", message: "the post-mortem payload is not typed data — a sealed record object is required" }];
      }
      if (blank(source.postMortem.postMortemId)) {
        return [{ code: "blank-source-id", message: "the post-mortem carries a blank id — the citation is explicit, never blank" }];
      }
      return [];
    case "lesson-set":
      if (!isRecordLike(source.lessons) || !isRecordLike(source.postMortem)) {
        return [{ code: "malformed-input", message: "the lesson-set payload is not typed data — a lesson set and its post-mortem are required" }];
      }
      if (blank(source.lessons.postMortemId) || blank(source.postMortem.postMortemId)) {
        return [{ code: "blank-source-id", message: "the lesson set or its post-mortem carries a blank id — the citation is explicit, never blank" }];
      }
      if (String(source.lessons.postMortemId) !== String(source.postMortem.postMortemId)) {
        return [{ code: "citation-mismatch", message: `the lesson set answers post-mortem '${String(source.lessons.postMortemId)}' but is carried beside '${String(source.postMortem.postMortemId)}' — a lesson set belongs to exactly one post-mortem (A6 evidence linkage)` }];
      }
      return [];
    case "capability":
      if (!isRecordLike(source.entry) || !isRecordLike(source.entry.descriptor)) {
        return [{ code: "malformed-input", message: "the capability payload is not typed data — a registry entry is required" }];
      }
      if (blank(source.entry.descriptor.capabilityId)) {
        return [{ code: "blank-source-id", message: "the capability entry carries a blank id — the citation is explicit, never blank" }];
      }
      return [];
    case "search-history":
      if (!isRecordLike(source.history)) {
        return [{ code: "malformed-input", message: "the search-history payload is not typed data — a sealed history record is required" }];
      }
      if (blank(source.history.historyId)) {
        return [{ code: "blank-source-id", message: "the search history carries a blank id — the citation is explicit, never blank" }];
      }
      return [];
  }
}
/** Derive the citation from a structurally lawful payload. */
function citationOf(source: KnowledgeSourceInput): KnowledgeSourceCitation {
  switch (source.kind) {
    case "post-mortem": return { kind: "post-mortem", postMortemId: source.postMortem.postMortemId, evaluationId: String(source.postMortem.evaluation.evaluationId) };
    case "lesson-set": return { kind: "lesson-set", postMortemId: source.postMortem.postMortemId, lessonSetDigest: String(source.lessons.digest), lessonCount: source.lessons.lessons.length };
    case "capability": return { kind: "capability", capabilityId: source.entry.descriptor.capabilityId, state: source.entry.state };
    case "search-history": return { kind: "search-history", historyId: source.history.historyId, experimentId: String(source.history.scope.experimentId), trialCount: source.history.trials.length };
  }
}
/** The PRIMARY source id of a citation (the by-source recall key). */
export function sourceIdOf(citation: KnowledgeSourceCitation): string {
  switch (citation.kind) {
    case "post-mortem":
    case "lesson-set": return String(citation.postMortemId);
    case "capability": return String(citation.capabilityId);
    case "search-history": return String(citation.historyId);
  }
}
/** EVERY id a citation carries (the by-citation recall keys): the primary
 * source id plus the evidence ids the citation names. */
export function citedIdsOf(citation: KnowledgeSourceCitation): readonly string[] {
  switch (citation.kind) {
    case "post-mortem": return [String(citation.postMortemId), String(citation.evaluationId)];
    case "lesson-set": return [String(citation.postMortemId), String(citation.lessonSetDigest)];
    case "capability": return [String(citation.capabilityId)];
    case "search-history": return [String(citation.historyId), String(citation.experimentId)];
  }
}
function resolveLineage(input: KnowledgeLineageInput | undefined, recordId: KnowledgeRecordId): { readonly ok: true; readonly lineage: KnowledgeLineage } | { readonly ok: false; readonly errors: readonly KnowledgeRecordError[] } {
  const parent = input?.parent;
  if (parent === undefined) {
    const declaredRoot = input?.root;
    if (declaredRoot !== undefined && declaredRoot !== recordId) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root knowledge record's lineage must cite its own id ('${recordId}') — it declares '${declaredRoot}' (the immutable lineage law)` }] };
    }
    const ordinal = input?.ordinal ?? 0;
    if (ordinal !== 0) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root knowledge record's lineage ordinal is 0 — it declares ${String(ordinal)} (the immutable lineage law)` }] };
    }
    return { ok: true, lineage: { parent: undefined, root: recordId, ordinal: 0 } };
  }
  if (String(parent).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: "the knowledge record declares a blank parent id — the lineage is explicit, never defaulted" }] };
  }
  const root = input?.root;
  if (root === undefined || String(root).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: `the continuation of '${String(parent)}' declares no chain root — a continuation carries the chain's root verbatim (the immutable lineage law)` }] };
  }
  const ordinal = input?.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
    return { ok: false, errors: [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it declares ${String(ordinal)} (the immutable lineage law)` }] };
  }
  return { ok: true, lineage: { parent, root, ordinal } };
}
/** Seal one knowledge record. THE IDENTITY LAWS run here (fail-closed,
 * all violations collected, none silently repaired): lawful typed input,
 * explicit §14 scope, closed source vocabulary, structurally sound payload
 * with a non-blank identity, the payload's OWN scope proven in agreement
 * with the record's declared scope — a TENANT disagreement is the loud
 * `cross-tenant` refusal naming R056 — then the seal: citation derived
 * from the payload, the `mem-<digest>` id minted over the canonical bytes
 * (the TENANT weighed first — R056 structural), the immutable lineage
 * resolved, the deterministic provenance recorded. The DEEP source
 * re-proof is the firm-brain ingestion gate's job (A14 division of labor). */
export function sealKnowledgeRecord(input: KnowledgeRecordInput): KnowledgeRecordOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.scope) || !isRecordLike(input.source)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the sealing input is not typed data — a scope and a source payload are required" }] };
  }
  const scope: KnowledgeScope = input.scope;
  const errors: KnowledgeRecordError[] = [];
  for (const member of blankKnowledgeScopeMembers(scope)) {
    errors.push({ code: "invalid-scope", message: `the knowledge scope's '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank` });
  }
  const source = input.source as KnowledgeSourceInput;
  errors.push(...sourceStructureErrors(source));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  errors.push(...scopeAgreementErrors(scope, source));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const citation = citationOf(source);
  const recordId = `${KNOWLEDGE_RECORD_ID_PREFIX}${canonicalDigestHex(knowledgeCanonicalContent(scope, citation, source))}` as KnowledgeRecordId;
  const lineage = resolveLineage(input.lineage, recordId);
  if (!lineage.ok) {
    return { ok: false, errors: lineage.errors };
  }
  const record: KnowledgeRecord = {
    recordId,
    scope: { tenantId: scope.tenantId, projectId: scope.projectId, worldId: scope.worldId },
    citation,
    payload: source,
    lineage: lineage.lineage,
    provenance: {
      deriver: "seal-knowledge-record",
      inputDigest: canonicalDigestHex({ scope: [scope.tenantId, scope.projectId, scope.worldId], source: citationTupleOf(citation) }),
      laws: KNOWLEDGE_PROVENANCE_LAWS,
    },
  };
  return { ok: true, record: Object.freeze(record) };
}
