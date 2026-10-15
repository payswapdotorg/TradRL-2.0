/**
 * The append-only knowledge-memory store CONTRACT (W054) — what a LAWFUL
 * firm-brain memory store must guarantee. Typed here; implemented
 * elsewhere. The W037 trajectory-store precedent: this package ships NO
 * engine, no persistence, no filesystem, no network.
 *
 * THE LAWS (a lawful implementation must guarantee every one):
 * - M1 APPEND-ONLY: there is no update and no delete seam at all — the
 *   interface simply does not have one. A knowledge record, once appended,
 *   is permanent history (the lineage is immutable; a "correction" is a
 *   NEW record, never a mutation).
 * - M2 VALIDATION AT APPEND: `append` runs
 *   {@link validateKnowledgeRecord} first; a malformed record NEVER enters
 *   the store (`invalid-record`, the record-law errors carried verbatim).
 * - M3 IDENTITY UNIQUENESS: one `mem-<digest>` id is appended once — a
 *   second append of the same id is `duplicate-record`, never an
 *   overwrite.
 * - M4 CANONICAL ORDER + VERBATIM READS: `list` returns the entries in
 *   canonical record-id order (A9: append order never leaks into the
 *   store's value); `read` returns the stored record VERBATIM
 *   (byte-identical data, never re-derived, never re-scored — A14).
 * - M5 FAIL-CLOSED READS: an unknown id is `unknown-record` — never a
 *   silent empty record.
 * - M6 TENANT ISOLATION (R056, ENFORCED STRUCTURALLY): the store is
 *   FOUNDED at exactly one explicit §14 scope and carries it on its face;
 *   `append` refuses any record whose scope disagrees — a tenant
 *   disagreement is the loud `cross-tenant-record` error naming
 *   spec/REQUIREMENTS.md R056 — and the interface simply has NO seam that
 *   can admit, enumerate, or query another tenant's records.
 *
 * Spec: spec/REQUIREMENTS.md R056 — "Firm Brain is tenant isolated."
 * Spec: spec/ARCHITECTURE-LOCK.md §14 — explicit tenant/project/world
 * identity in persistence and transport.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the CONTRACT itself performs no
 * I/O beyond the seam it types; determinism is the implementations' law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  KnowledgeRecord,
  KnowledgeRecordError,
  KnowledgeRecordId,
  KnowledgeScope,
} from "./record.js";

// ---------------------------------------------------------------------------
// The typed outcomes
// ---------------------------------------------------------------------------

export type MemoryStoreErrorCode =
  | "duplicate-record" // M3: the id is already appended
  | "unknown-record" // M5: the id was never appended
  | "invalid-record" // M2: the record failed the record-law gate
  | "cross-tenant-record" // M6: the record's tenant ≠ the store's (R056)
  | "store-scope-mismatch"; // M6: same tenant, another project/world (§14)

/** One typed store error (the offending law's code, the law named loudly). */
export interface MemoryStoreError {
  readonly code: MemoryStoreErrorCode;
  readonly message: string;
  /** Present on `invalid-record`: the record-law errors, verbatim. */
  readonly recordErrors?: readonly KnowledgeRecordError[];
}

export type MemoryAppendOutcome =
  | { readonly ok: true; readonly recordId: KnowledgeRecordId }
  | { readonly ok: false; readonly errors: readonly MemoryStoreError[] };

export type MemoryReadOutcome =
  | { readonly ok: true; readonly record: KnowledgeRecord }
  | { readonly ok: false; readonly errors: readonly MemoryStoreError[] };

/** One listed entry (identity + scope; never the full record). */
export interface MemoryStoreEntry {
  readonly recordId: KnowledgeRecordId;
  readonly scope: KnowledgeScope;
}

export type MemoryListOutcome =
  | { readonly ok: true; readonly entries: readonly MemoryStoreEntry[] }
  | { readonly ok: false; readonly errors: readonly MemoryStoreError[] };

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * A lawful knowledge-memory store (the append-only, tenant-isolated
 * protocol seam — M1..M6 above). Async BY DESIGN: real stores do I/O; the
 * CONTRACT never fabricates latency-free behavior. Implementations MUST
 * run the append gate (`validateKnowledgeRecord`) before admitting any
 * record, and MUST refuse cross-tenant records loudly, naming R056.
 */
export interface MemoryStore {
  /** The founding scope — M6: every appended record must agree with it. */
  readonly scope: KnowledgeScope;
  /**
   * Append one validated record (M2: the record-law gate runs first; M3:
   * the id is unique; M6: the scope must be isolated to this store's
   * tenant — a cross-tenant append is refused LOUDLY, naming R056).
   */
  append(record: KnowledgeRecord): Promise<MemoryAppendOutcome>;
  /** Read one record verbatim (M4) or fail typed (M5). */
  read(recordId: KnowledgeRecordId): Promise<MemoryReadOutcome>;
  /** List the stored entries in canonical record-id order (M4). */
  list(): Promise<MemoryListOutcome>;
}
