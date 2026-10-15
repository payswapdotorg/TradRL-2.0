/**
 * The firm brain (W054) — the pure composition service over the memory
 * contract: the firm's accumulated, tenant-isolated knowledge store as an
 * immutable value.
 *
 * `foundBrain(scope)` founds ONE brain at ONE explicit §14 scope (R056: the
 * brain IS tenant-isolated — its tenant is part of its identity).
 * `ingest(brain, records)` is THE INGESTION GATE, fail-closed at every
 * seam: the input brain's own invariants re-proven, every candidate record
 * re-proven through the MEMORY contract's whole-record re-validation, its
 * payload re-proven through its SOURCE PACKAGE's own validators (W053's
 * validatePostMortem/validateLessonSet, W040's validateCapabilityRegistry,
 * W051's validateSearchHistory — their errors carried VERBATIM), and the
 * record's scope proven ISOLATED to the brain's tenant — a cross-tenant
 * record is the loud `cross-tenant` refusal naming R056; a
 * same-tenant/other-world record is the §14 `scope-mismatch`. Then the new
 * brain GENERATION is sealed: records merged in canonical record-id order
 * (A9: ingest order never leaks), the lineage EXTENDED (parent = the
 * previous generation's id, ordinal = generation), never rewritten, the
 * new content-addressed `brain-<digest>` id minted.
 *
 * Laws: spec/REQUIREMENTS.md R056 ("Firm Brain is tenant isolated");
 * spec/ARCHITECTURE-LOCK.md §14 (explicit identity in persistence and
 * transport); A6 (evidence-linked); A9 (same records ⇒ deep-equal brain +
 * recall; canonical ids; no clocks, no randomness, no env reads); A14
 * (composes typed records — never reasons, never decides; carry never
 * re-score). W055 (autonomous improvement) and W060 (security) build ON
 * this; W064's journey exercises it. This service never trains, never
 * merges, never decides.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "trajectory";
import { validateLessonSet, validatePostMortem } from "outcome-learning";
import type { PostMortemValidationError } from "outcome-learning";
import { validateCapabilityRegistry } from "capability-registry";
import type { CapabilityError } from "capability-registry";
import { validateSearchHistory } from "search-integrity";
import type { SearchHistoryError } from "search-integrity";
import { EXPLICIT_SCOPE_LAW, TENANT_ISOLATION_LAW, blankKnowledgeScopeMembers, validateKnowledgeRecord } from "memory";
import type { KnowledgeRecord, KnowledgeRecordError, KnowledgeRecordId, KnowledgeScope } from "memory";

/** The canonical law list carried on every brain generation's provenance. */
export const BRAIN_PROVENANCE_LAWS: readonly string[] = [TENANT_ISOLATION_LAW, EXPLICIT_SCOPE_LAW, "spec/ARCHITECTURE-LOCK.md A6", "spec/ARCHITECTURE-LOCK.md A9", "spec/ARCHITECTURE-LOCK.md A14"];
declare const brainIdBrand: unique symbol;
/** An OPAQUE brain id (a canonical digest rendering) — produced only by the
 * founding/ingest gates and {@link brainDigestOf}; never parsed. */
export type BrainId = string & { readonly [brainIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const BRAIN_ID_PREFIX = "brain-";

/** The brain's own immutable lineage: one link per generation, extended
 * (parent = the previous generation's id), never rewritten. */
export interface BrainLineage {
  readonly parent: BrainId | undefined;
  readonly root: BrainId;
  readonly ordinal: number;
}

/** The deterministic provenance of one brain generation (re-derivable). */
export interface BrainProvenance {
  readonly deriver: "found-brain" | "ingest-knowledge";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * ONE firm brain: the content-addressed id, the founding scope (the brain
 * is tenant-isolated — R056), the generation counter, the immutable
 * lineage, the knowledge records in CANONICAL record-id order, the
 * deterministic provenance. An immutable VALUE: every ingest returns a NEW
 * brain generation, never a mutation.
 */
export interface FirmBrain {
  readonly brainId: BrainId;
  readonly scope: KnowledgeScope;
  readonly generation: number;
  readonly lineage: BrainLineage;
  readonly records: readonly KnowledgeRecord[];
  readonly provenance: BrainProvenance;
}

/** The whole-brain invariant error family (validate.ts's surface; shared
 * with the ingestion gate). */
export type BrainValidationErrorCode =
  | "malformed-record" // the brain is not typed data
  | "brain-id-mismatch" // the id does not re-derive from its own carried bytes (A9)
  | "invalid-scope" // a §14 scope member is blank
  | "generation-lineage-break" // the lineage does not extend one link per generation
  | "non-canonical-order" // the records are not in canonical record-id order (A9)
  | "duplicate-record" // one mem id twice — identity is exact
  | "invalid-record" // memory's whole-record re-validation failed (carried verbatim)
  | "cross-tenant" // R056: a carried record's tenant ≠ the brain's
  | "scope-mismatch" // §14: same tenant, another project/world
  | "provenance-mismatch"; // the provenance does not re-derive (A9)

/** One typed brain-invariant error (fail-closed; the law named). */
export interface BrainValidationError {
  readonly code: BrainValidationErrorCode;
  readonly message: string;
  readonly entryId?: string;
  /** `invalid-record` only: memory's own errors, carried VERBATIM. */
  readonly recordErrors?: readonly KnowledgeRecordError[];
}

/** Everything the founding + ingestion gates can refuse. */
export type BrainErrorCode =
  | "malformed-input" // not lawful typed data
  | "invalid-scope" // founding: a §14 scope member is blank
  | "invalid-brain" // the input brain failed its own invariants (carried verbatim)
  | "invalid-record" // memory's whole-record re-validation failed (carried verbatim)
  | "invalid-post-mortem" // W053's validatePostMortem failed (carried verbatim)
  | "invalid-lesson-set" // W053's validateLessonSet failed (carried verbatim)
  | "invalid-capability" // W040's validateCapabilityRegistry failed (carried verbatim)
  | "invalid-history" // W051's validateSearchHistory failed (carried verbatim)
  | "cross-tenant" // R056: the record's tenant ≠ the brain's
  | "scope-mismatch" // §14: same tenant, another project/world
  | "duplicate-record"; // one mem id once (append-only — never an overwrite)

/** One typed brain error (fail-closed; the law named in the message). */
export interface BrainError {
  readonly code: BrainErrorCode;
  readonly message: string;
  readonly entryId?: string;
  /** `invalid-brain` only: the brain-invariant errors, carried VERBATIM. */
  readonly brainErrors?: readonly BrainValidationError[];
  /** `invalid-record` only: memory's own errors, carried VERBATIM. */
  readonly recordErrors?: readonly KnowledgeRecordError[];
  /** `invalid-post-mortem`/`invalid-lesson-set` only: W053's own errors, VERBATIM. */
  readonly postMortemErrors?: readonly PostMortemValidationError[];
  /** `invalid-capability` only: W040's own errors, carried VERBATIM. */
  readonly capabilityErrors?: readonly CapabilityError[];
  /** `invalid-history` only: W051's own errors, carried VERBATIM. */
  readonly historyErrors?: readonly SearchHistoryError[];
}

/** The founding outcome: the empty generation-0 brain, or the refusal. */
export type BrainFoundingOutcome =
  | { readonly ok: true; readonly brain: FirmBrain }
  | { readonly ok: false; readonly errors: readonly BrainError[] };

/** The ingestion outcome: the new sealed generation, or the refusal. */
export type BrainIngestOutcome =
  | { readonly ok: true; readonly brain: FirmBrain; readonly appended: readonly KnowledgeRecordId[] }
  | { readonly ok: false; readonly errors: readonly BrainError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function canonicalOrder(records: readonly KnowledgeRecord[]): readonly KnowledgeRecord[] {
  return [...records].sort((left, right) => compareCodeUnits(String(left.recordId), String(right.recordId)));
}
function scopeOf(value: { readonly tenantId: string; readonly projectId: string; readonly worldId: string }): KnowledgeScope {
  return { tenantId: value.tenantId, projectId: value.projectId, worldId: value.worldId };
}
function recordIdsOf(brain: FirmBrain): readonly string[] {
  return brain.records.map((record) => String(record.recordId));
}
/** The brain id: `brain-<digest>` over the canonical brain bytes — the
 * founding scope (TENANT first — R056 structural), the generation, the
 * canonical record ids. Pure and deterministic (A9). */
export function brainDigestOf(brain: FirmBrain): BrainId {
  const digest = canonicalDigestHex({
    generation: brain.generation,
    records: recordIdsOf(brain),
    scope: [brain.scope.tenantId, brain.scope.projectId, brain.scope.worldId],
  });
  return `${BRAIN_ID_PREFIX}${digest}` as BrainId;
}

// THE WHOLE-BRAIN INVARIANTS (the ingestion gate's input proof; the
// re-validator's surface — validate.ts wraps this)
export function brainInvariantsOf(brain: FirmBrain): BrainValidationError[] {
  const errors: BrainValidationError[] = [];
  if (!isRecordLike(brain) || !isRecordLike(brain.scope) || !isRecordLike(brain.lineage) || !isRecordLike(brain.provenance) || !Array.isArray(brain.records)) {
    return [{ code: "malformed-record", message: "the firm brain is not typed data — a scope, a lineage, a provenance and a record list are required" }];
  }
  if (brainDigestOf(brain) !== String(brain.brainId)) {
    errors.push({ code: "brain-id-mismatch", message: `the brain id '${String(brain.brainId)}' does not re-derive from its own carried bytes — recorded data is re-proven, never trusted (A9)` });
  }
  for (const member of blankKnowledgeScopeMembers(brain.scope)) {
    errors.push({ code: "invalid-scope", message: `the brain scope's '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})` });
  }
  const generation = brain.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) {
    errors.push({ code: "generation-lineage-break", message: `the brain's generation '${String(generation)}' is not a non-negative integer — one generation per ingest, starting at 0` });
  }
  if (brain.lineage.ordinal !== generation) {
    errors.push({ code: "generation-lineage-break", message: `the brain's lineage ordinal '${String(brain.lineage.ordinal)}' disagrees with its generation '${String(generation)}' — the lineage extends exactly one link per generation` });
  }
  if (generation === 0) {
    if (brain.lineage.parent !== undefined) {
      errors.push({ code: "generation-lineage-break", message: "the founding brain declares a parent — generation 0 has no ancestor" });
    }
    if (String(brain.lineage.root) !== String(brain.brainId)) {
      errors.push({ code: "generation-lineage-break", message: `the founding brain's lineage root must be its own id — it carries '${String(brain.lineage.root)}'` });
    }
    if (brain.records.length > 0) {
      errors.push({ code: "generation-lineage-break", message: `the founding brain carries ${String(brain.records.length)} records — generation 0 is the empty brain` });
    }
  } else {
    if (String(brain.lineage.parent ?? "").trim().length === 0 || String(brain.lineage.root).trim().length === 0) {
      errors.push({ code: "generation-lineage-break", message: `generation '${String(generation)}' declares no parent/root — an ingested generation carries the chain verbatim` });
    }
  }
  const provenance = brain.provenance as FirmBrain["provenance"];
  if (provenance.deriver !== "found-brain" && provenance.deriver !== "ingest-knowledge") {
    errors.push({ code: "provenance-mismatch", message: `the provenance names deriver '${String(provenance.deriver)}' — the closed deriver vocabulary is 'found-brain', 'ingest-knowledge'` });
  } else if ((provenance.deriver === "found-brain") !== (generation === 0)) {
    errors.push({ code: "provenance-mismatch", message: `the provenance names deriver '${String(provenance.deriver)}' at generation '${String(generation)}' — the founding deriver belongs to generation 0 only` });
  }
  if (canonicalString([...provenance.laws]) !== canonicalString([...BRAIN_PROVENANCE_LAWS])) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not match the canonical brain law list — the laws are carried verbatim" });
  }
  const inputDigest = provenance.deriver === "found-brain"
    ? canonicalDigestHex({ scope: [brain.scope.tenantId, brain.scope.projectId, brain.scope.worldId] })
    : canonicalDigestHex({ brain: String(brain.lineage.parent ?? ""), generation, records: recordIdsOf(brain) });
  if (String(provenance.inputDigest) !== inputDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the carried scope/generation/records — deterministic provenance is re-proven (A9)" });
  }
  const seen = new Set<string>();
  const records = [...brain.records];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const id = String(record.recordId);
    if (seen.has(id)) {
      errors.push({ code: "duplicate-record", message: `the knowledge record '${id}' is carried twice — brain identity is exact canonical-id identity`, entryId: id });
    }
    seen.add(id);
    const previous = records[index - 1];
    if (previous !== undefined && compareCodeUnits(String(previous.recordId), id) > 0) {
      errors.push({ code: "non-canonical-order", message: `the brain's records are not in canonical record-id order at index ${String(index)} ('${id}' before '${String(previous.recordId)}') — ingest order never leaks into the brain value (A9)`, entryId: id });
    }
    const recordValidation = validateKnowledgeRecord(record);
    if (!recordValidation.ok) {
      errors.push({ code: "invalid-record", message: `the knowledge record '${id}' failed the memory contract's whole-record re-validation — errors carried verbatim`, entryId: id, recordErrors: recordValidation.errors });
      continue;
    }
    if (String(record.scope.tenantId) !== String(brain.scope.tenantId)) {
      errors.push({ code: "cross-tenant", message: `the knowledge record '${id}' belongs to tenant '${String(record.scope.tenantId)}' but the brain is tenant '${brain.scope.tenantId}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant record is refused loudly`, entryId: id });
      continue;
    }
    for (const member of ["projectId", "worldId"] as const) {
      if (String(record.scope[member]) !== String(brain.scope[member])) {
        errors.push({ code: "scope-mismatch", message: `the knowledge record '${id}' carries '${member}' '${String(record.scope[member])}' but the brain's is '${String(brain.scope[member])}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})`, entryId: id });
      }
    }
  }
  return errors;
}

// THE FOUNDING GATE
/** Found ONE brain at ONE explicit §14 scope — the tenant-isolated (R056)
 * empty generation-0 brain. A blank scope member is a loud refusal. */
export function foundBrain(scope: KnowledgeScope): BrainFoundingOutcome {
  if (!isRecordLike(scope)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the founding scope is not typed data — a tenant/project/world scope is required" }] };
  }
  const blanks = blankKnowledgeScopeMembers(scope);
  if (blanks.length > 0) {
    return { ok: false, errors: blanks.map((member) => ({ code: "invalid-scope" as const, message: `the brain scope's '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank` })) };
  }
  const foundingScope = scopeOf(scope);
  const brainId = brainDigestOf({ brainId: "" as BrainId, scope: foundingScope, generation: 0, lineage: { parent: undefined, root: "" as BrainId, ordinal: 0 }, records: [], provenance: { deriver: "found-brain", inputDigest: "", laws: [] } });
  const brain: FirmBrain = {
    brainId,
    scope: foundingScope,
    generation: 0,
    lineage: { parent: undefined, root: brainId, ordinal: 0 },
    records: [],
    provenance: { deriver: "found-brain", inputDigest: canonicalDigestHex({ scope: [foundingScope.tenantId, foundingScope.projectId, foundingScope.worldId] }), laws: BRAIN_PROVENANCE_LAWS },
  };
  return { ok: true, brain: Object.freeze(brain) };
}

// THE INGESTION GATE — THE GATES
function sourceReproofErrors(record: KnowledgeRecord): BrainError | undefined {
  const entryId = String(record.recordId);
  const payload = record.payload as KnowledgeRecord["payload"];
  switch (payload.kind) {
    case "post-mortem": {
      const validation = validatePostMortem(payload.postMortem);
      if (!validation.ok) {
        return { code: "invalid-post-mortem", message: `the post-mortem record '${entryId}' failed W053's own whole-record re-validation — errors carried verbatim`, entryId, postMortemErrors: validation.errors };
      }
      return undefined;
    }
    case "lesson-set": {
      const postMortem = validatePostMortem(payload.postMortem);
      if (!postMortem.ok) {
        return { code: "invalid-post-mortem", message: `the lesson-set record '${entryId}' carries a post-mortem that failed W053's own whole-record re-validation — errors carried verbatim`, entryId, postMortemErrors: postMortem.errors };
      }
      const lessons = validateLessonSet(payload.lessons, payload.postMortem);
      if (!lessons.ok) {
        return { code: "invalid-lesson-set", message: `the lesson-set record '${entryId}' failed W053's own lesson-set re-validation — errors carried verbatim`, entryId, postMortemErrors: lessons.errors };
      }
      return undefined;
    }
    case "capability": {
      const validation = validateCapabilityRegistry({ scope: payload.entry.descriptor.scope, entries: [payload.entry] });
      if (!validation.ok) {
        return { code: "invalid-capability", message: `the capability record '${entryId}' failed W040's own registry re-validation (re-proven as the entry's own single-entry registry) — errors carried verbatim`, entryId, capabilityErrors: validation.errors };
      }
      return undefined;
    }
    case "search-history": {
      const validation = validateSearchHistory(payload.history);
      if (!validation.ok) {
        return { code: "invalid-history", message: `the search-history record '${entryId}' failed W051's own whole-record re-validation — errors carried verbatim`, entryId, historyErrors: validation.errors };
      }
      return undefined;
    }
  }
}

function isolationErrors(brain: FirmBrain, record: KnowledgeRecord): BrainError | undefined {
  const entryId = String(record.recordId);
  if (String(record.scope.tenantId) !== String(brain.scope.tenantId)) {
    return { code: "cross-tenant", message: `the knowledge record '${entryId}' belongs to tenant '${String(record.scope.tenantId)}' but the brain is tenant '${brain.scope.tenantId}' — Firm Brain is tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant record is refused loudly, never adopted`, entryId };
  }
  for (const member of ["projectId", "worldId"] as const) {
    if (String(record.scope[member]) !== String(brain.scope[member])) {
      return { code: "scope-mismatch", message: `the knowledge record '${entryId}' carries '${member}' '${String(record.scope[member])}' but the brain's is '${String(brain.scope[member])}' — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW})`, entryId };
    }
  }
  return undefined;
}

/** Ingest knowledge records — THE GATES, fail-closed, every violation
 * collected, none silently repaired: (1) the input brain's own invariants
 * re-proven (a broken brain is never extended); (2) every candidate record
 * re-proven through the MEMORY contract's whole-record re-validation
 * (errors verbatim); (3) every payload re-proven through its SOURCE
 * package's own validators (W053/W040/W051 — errors verbatim); (4) scope
 * isolation proven per record (R056 named loudly); (5) identity uniqueness
 * (one mem id once — append-only, never an overwrite); then the new
 * generation sealed: canonical record order, lineage EXTENDED, the new
 * `brain-<digest>` id, deterministic provenance. Pure (A9): the same brain
 * + the same record SET ⇒ the same new generation, order never leaks. */
export function ingest(brain: FirmBrain, records: readonly KnowledgeRecord[]): BrainIngestOutcome {
  if (!isRecordLike(brain)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the brain is not typed data — a founded brain value is required" }] };
  }
  if (!Array.isArray(records)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the records are not a list — ingest takes a list of knowledge records" }] };
  }
  const brainErrors = brainInvariantsOf(brain);
  if (brainErrors.length > 0) {
    return { ok: false, errors: [{ code: "invalid-brain", message: "the input brain failed its own whole-brain invariants — a broken brain is never extended (errors carried verbatim)", brainErrors }] };
  }
  const errors: BrainError[] = [];
  const known = new Set(brain.records.map((record) => String(record.recordId)));
  const appended: KnowledgeRecord[] = [];
  for (const candidate of records) {
    const entryId = String(isRecordLike(candidate) ? candidate.recordId : "");
    const recordValidation = validateKnowledgeRecord(candidate);
    if (!recordValidation.ok) {
      errors.push({ code: "invalid-record", message: `the knowledge record '${entryId}' failed the memory contract's whole-record re-validation — errors carried verbatim`, entryId, recordErrors: recordValidation.errors });
      continue;
    }
    const source = sourceReproofErrors(candidate);
    if (source !== undefined) {
      errors.push(source);
      continue;
    }
    const isolation = isolationErrors(brain, candidate);
    if (isolation !== undefined) {
      errors.push(isolation);
      continue;
    }
    if (known.has(entryId)) {
      errors.push({ code: "duplicate-record", message: `the knowledge record '${entryId}' is already in the brain — one mem id once (append-only, never an overwrite)`, entryId });
      continue;
    }
    known.add(entryId);
    appended.push(candidate);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const generation = brain.generation + 1;
  const all = canonicalOrder([...brain.records, ...appended]);
  const ids = all.map((record) => String(record.recordId));
  const brainId = brainDigestOf({ brainId: "" as BrainId, scope: brain.scope, generation, lineage: { parent: undefined, root: "" as BrainId, ordinal: generation }, records: all, provenance: { deriver: "ingest-knowledge", inputDigest: "", laws: [] } });
  const next: FirmBrain = {
    brainId,
    scope: brain.scope,
    generation,
    lineage: { parent: brain.brainId, root: brain.lineage.root, ordinal: generation },
    records: all,
    provenance: { deriver: "ingest-knowledge", inputDigest: canonicalDigestHex({ brain: String(brain.brainId), generation, records: ids }), laws: BRAIN_PROVENANCE_LAWS },
  };
  return { ok: true, brain: Object.freeze(next), appended: canonicalOrder(appended).map((record) => record.recordId) };
}
