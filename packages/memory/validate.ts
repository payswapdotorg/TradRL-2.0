/**
 * Whole-record re-validation (W054) — a knowledge record re-proven from
 * its OWN carried data, never trusted (A9).
 *
 * The id must re-derive from the carried bytes (a rewritten record is
 * caught loudly), the §14 scope must be explicit, the citation must agree
 * with the carried payload member for member (A6 — the citation is the
 * payload's own identity, re-derived and compared), the payload's own
 * scope must still agree with the record's (a cross-tenant edit is the
 * loud `cross-tenant` refusal naming R056), the lineage must be coherent,
 * and the deterministic provenance must re-derive. Never re-scores one
 * carried number (A14 — carry never re-score).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "trajectory";
import {
  EXPLICIT_SCOPE_LAW,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_PROVENANCE_LAWS,
  KNOWLEDGE_RECORD_ID_PREFIX,
  TENANT_ISOLATION_LAW,
  blankKnowledgeScopeMembers,
  knowledgeRecordDigestOf,
  payloadScopeOf,
} from "./record.js";
import type {
  KnowledgeRecord,
  KnowledgeRecordError,
  KnowledgeSourceCitation,
} from "./record.js";

/** The whole-record re-validation outcome. */
export type KnowledgeRecordValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly KnowledgeRecordError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Citation ↔ payload coherence (A6: the citation IS the payload's identity)
// ---------------------------------------------------------------------------

function citationCoherenceErrors(record: KnowledgeRecord): KnowledgeRecordError[] {
  const errors: KnowledgeRecordError[] = [];
  const citation = record.citation as KnowledgeSourceCitation | undefined;
  const payload = record.payload as KnowledgeRecord["payload"] | undefined;
  if (!isRecordLike(citation) || !isRecordLike(payload)) {
    return [{ code: "malformed-record", message: "the citation or payload is not typed data — both are required on every knowledge record" }];
  }
  if (!KNOWLEDGE_KINDS.includes(citation.kind as KnowledgeRecord["citation"]["kind"])) {
    return [{ code: "unknown-source-kind", message: `the citation kind '${String(citation.kind)}' is outside the closed vocabulary — knowledge cites ${KNOWLEDGE_KINDS.join(", ")} only` }];
  }
  if (String(citation.kind) !== String(payload.kind)) {
    errors.push({ code: "citation-mismatch", message: `the citation names kind '${String(citation.kind)}' but the payload carries '${String(payload.kind)}' — the citation is the payload's own identity` });
    return errors;
  }
  switch (citation.kind) {
    case "post-mortem": {
      const carried = payload as { postMortem?: { postMortemId?: unknown; evaluation?: { evaluationId?: unknown } } };
      if (String(citation.postMortemId) !== String(carried.postMortem?.postMortemId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names post-mortem '${String(citation.postMortemId)}' but the payload carries '${String(carried.postMortem?.postMortemId)}' — the citation is the payload's own identity (A6)` });
      }
      if (String(citation.evaluationId) !== String(carried.postMortem?.evaluation?.evaluationId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names evaluation '${String(citation.evaluationId)}' but the payload carries '${String(carried.postMortem?.evaluation?.evaluationId)}' — the citation is the payload's own identity (A6)` });
      }
      break;
    }
    case "lesson-set": {
      const carried = payload as { lessons?: { postMortemId?: unknown; digest?: unknown; lessons?: readonly unknown[] }; postMortem?: { postMortemId?: unknown } };
      if (String(citation.postMortemId) !== String(carried.postMortem?.postMortemId) || String(citation.postMortemId) !== String(carried.lessons?.postMortemId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names post-mortem '${String(citation.postMortemId)}' but the lesson set answers '${String(carried.lessons?.postMortemId)}' beside post-mortem '${String(carried.postMortem?.postMortemId)}' — a lesson set belongs to exactly one post-mortem (A6)` });
      }
      if (String(citation.lessonSetDigest) !== String(carried.lessons?.digest)) {
        errors.push({ code: "citation-mismatch", message: `the citation names lesson-set digest '${String(citation.lessonSetDigest)}' but the payload carries '${String(carried.lessons?.digest)}' — the citation is the payload's own identity (A6)` });
      }
      if (citation.lessonCount !== carried.lessons?.lessons?.length) {
        errors.push({ code: "citation-mismatch", message: `the citation names ${String(citation.lessonCount)} lessons but the payload carries ${String(carried.lessons?.lessons?.length)} — carried counts are re-proven` });
      }
      break;
    }
    case "capability": {
      const carried = payload as { entry?: { descriptor?: { capabilityId?: unknown }; state?: unknown } };
      if (String(citation.capabilityId) !== String(carried.entry?.descriptor?.capabilityId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names capability '${String(citation.capabilityId)}' but the payload carries '${String(carried.entry?.descriptor?.capabilityId)}' — the citation is the payload's own identity (A6)` });
      }
      if (String(citation.state) !== String(carried.entry?.state)) {
        errors.push({ code: "citation-mismatch", message: `the citation names state '${String(citation.state)}' but the payload carries '${String(carried.entry?.state)}' — the lifecycle state is carried verbatim` });
      }
      break;
    }
    case "search-history": {
      const carried = payload as { history?: { historyId?: unknown; scope?: { experimentId?: unknown }; trials?: readonly unknown[] } };
      if (String(citation.historyId) !== String(carried.history?.historyId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names history '${String(citation.historyId)}' but the payload carries '${String(carried.history?.historyId)}' — the citation is the payload's own identity (A6)` });
      }
      if (String(citation.experimentId) !== String(carried.history?.scope?.experimentId)) {
        errors.push({ code: "citation-mismatch", message: `the citation names experiment '${String(citation.experimentId)}' but the payload carries '${String(carried.history?.scope?.experimentId)}' — the citation is the payload's own identity (A6)` });
      }
      if (citation.trialCount !== carried.history?.trials?.length) {
        errors.push({ code: "citation-mismatch", message: `the citation names ${String(citation.trialCount)} trials but the payload carries ${String(carried.history?.trials?.length)} — carried counts are re-proven` });
      }
      break;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Lineage + provenance re-proofs
// ---------------------------------------------------------------------------

function lineageErrors(record: KnowledgeRecord): KnowledgeRecordError[] {
  const lineage = record.lineage as KnowledgeRecord["lineage"] | undefined;
  if (!isRecordLike(lineage)) {
    return [{ code: "malformed-record", message: "the lineage is not typed data — every knowledge record carries one" }];
  }
  const parent = lineage.parent;
  const root = String(lineage.root ?? "");
  const ordinal = lineage.ordinal;
  if (parent === undefined) {
    if (root !== String(record.recordId)) {
      return [{ code: "lineage-break", message: `a root knowledge record's lineage must cite its own id ('${String(record.recordId)}') — it carries '${root}' (the immutable lineage law)` }];
    }
    if (ordinal !== 0) {
      return [{ code: "lineage-break", message: `a root knowledge record's lineage ordinal is 0 — it carries ${String(ordinal)} (the immutable lineage law)` }];
    }
    return [];
  }
  if (String(parent).trim().length === 0) {
    return [{ code: "lineage-break", message: "the knowledge record declares a blank parent id — the lineage is explicit, never defaulted" }];
  }
  if (root.trim().length === 0) {
    return [{ code: "lineage-break", message: `the continuation of '${String(parent)}' carries no chain root — a continuation carries the chain's root verbatim (the immutable lineage law)` }];
  }
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
    return [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it carries ${String(ordinal)} (the immutable lineage law)` }];
  }
  return [];
}

function provenanceErrors(record: KnowledgeRecord): KnowledgeRecordError[] {
  const provenance = record.provenance as KnowledgeRecord["provenance"] | undefined;
  if (!isRecordLike(provenance)) {
    return [{ code: "malformed-record", message: "the provenance is not typed data — every knowledge record carries one" }];
  }
  const errors: KnowledgeRecordError[] = [];
  if (provenance.deriver !== "seal-knowledge-record") {
    errors.push({ code: "provenance-mismatch", message: `the provenance names deriver '${String(provenance.deriver)}' — the closed deriver vocabulary is 'seal-knowledge-record'` });
  }
  if (canonicalString([...provenance.laws]) !== canonicalString([...KNOWLEDGE_PROVENANCE_LAWS])) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not match the canonical knowledge law list — the laws are carried verbatim" });
  }
  const inputDigest = canonicalDigestHex({
    scope: [record.scope.tenantId, record.scope.projectId, record.scope.worldId],
    source: [record.citation.kind, ...citedIdProjectionOf(record.citation)],
  });
  if (String(provenance.inputDigest) !== inputDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the carried scope + citation — deterministic provenance is re-proven (A9)" });
  }
  return errors;
}

/** The citation's id projection (the provenance digest's source member). */
function citedIdProjectionOf(citation: KnowledgeSourceCitation): readonly unknown[] {
  switch (citation.kind) {
    case "post-mortem":
      return [String(citation.postMortemId), String(citation.evaluationId)];
    case "lesson-set":
      return [String(citation.postMortemId), String(citation.lessonSetDigest), citation.lessonCount];
    case "capability":
      return [String(citation.capabilityId), String(citation.state)];
    case "search-history":
      return [String(citation.historyId), String(citation.experimentId), citation.trialCount];
  }
}

// ---------------------------------------------------------------------------
// THE RE-VALIDATOR
// ---------------------------------------------------------------------------

/**
 * Re-validate one knowledge record whole, from its own recorded data: the
 * content-addressed id must re-derive from the carried bytes (A9), the §14
 * scope must be explicit, the citation must agree with the payload member
 * for member (A6), the payload's own scope must agree with the record's —
 * a tenant disagreement is the loud `cross-tenant` refusal naming R056 —
 * the lineage must be coherent, the provenance re-derivable. Never
 * re-scores, never reasons (A14).
 */
export function validateKnowledgeRecord(record: KnowledgeRecord): KnowledgeRecordValidation {
  if (!isRecordLike(record)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the knowledge record is not typed data — a record object is required" }] };
  }
  const recordId = String(record.recordId ?? "");
  if (recordId.trim().length === 0) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the knowledge record carries a blank id — ids are explicit, never blank" }] };
  }
  if (!recordId.startsWith(KNOWLEDGE_RECORD_ID_PREFIX)) {
    return { ok: false, errors: [{ code: "record-id-mismatch", message: `the knowledge record id '${recordId}' is not a '${KNOWLEDGE_RECORD_ID_PREFIX}' rendering — the id vocabulary is required` }] };
  }
  const errors: KnowledgeRecordError[] = [];
  if (knowledgeRecordDigestOf(record) !== recordId) {
    errors.push({ code: "record-id-mismatch", message: `the knowledge record id '${recordId}' does not re-derive from its own carried bytes — recorded data is re-proven, never trusted (A9)` });
  }
  if (!isRecordLike(record.scope)) {
    return { ok: false, errors: [...errors, { code: "invalid-scope", message: "the carried scope is not typed data — the §14 scope is explicit" }] };
  }
  for (const member of blankKnowledgeScopeMembers(record.scope)) {
    errors.push({ code: "invalid-scope", message: `the carried scope member '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})` });
  }
  errors.push(...citationCoherenceErrors(record));
  const carriedScope = payloadScopeOf(record.payload as KnowledgeRecord["payload"]);
  if (carriedScope !== undefined && isRecordLike(carriedScope)) {
    if (String(carriedScope.tenantId) !== String(record.scope.tenantId)) {
      errors.push({ code: "cross-tenant", message: `the carried payload's tenant '${String(carriedScope.tenantId)}' is not the record's tenant '${String(record.scope.tenantId)}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant record is refused loudly` });
    } else {
      for (const member of ["projectId", "worldId"] as const) {
        if (String(carriedScope[member]) !== String(record.scope[member])) {
          errors.push({ code: "scope-mismatch", message: `the carried payload's '${member}' '${String(carriedScope[member])}' disagrees with the record's '${String(record.scope[member])}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})` });
        }
      }
    }
  }
  errors.push(...lineageErrors(record));
  errors.push(...provenanceErrors(record));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
