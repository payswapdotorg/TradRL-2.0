/**
 * The append-only trajectory store CONTRACT (W037) — what a LAWFUL
 * trajectory store must guarantee. Typed here; implemented elsewhere.
 *
 * THE LAWS (a lawful implementation must guarantee every one):
 * - L1 APPEND-ONLY: there is no update and no delete seam at all — the
 *   interface simply does not have one. A trajectory record, once appended,
 *   is permanent history (branch lineage is immutable; a "correction" is a
 *   NEW trajectory, never a mutation).
 * - L2 VALIDATION AT APPEND: `append` runs {@link validateTrajectoryRecord}
 *   first; a malformed record NEVER enters the store (`invalid-record`,
 *   the capture-law errors carried verbatim).
 * - L3 IDENTITY UNIQUENESS: one trajectory id is appended once — a second
 *   append of the same id is `duplicate-trajectory`, never an overwrite.
 * - L4 ORDERED: the append ordinal is the total order; `list` returns
 *   entries in append order; `read` returns the stored record VERBATIM
 *   (byte-identical data, never re-derived).
 * - L5 FAIL-CLOSED READS: an unknown id is `unknown-trajectory` — never a
 *   silent empty record.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — the store holds records (typed
 * data), never re-proves world state. A9 — the CONTRACT itself performs no
 * I/O beyond the seam it types; this package ships NO engine, no
 * persistence, no filesystem, no network — implementations live in their
 * own work items.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { TrajectoryError } from "./record.js";
import type { TrajectoryRecord } from "./record.js";
import type { TrajectoryId, TrajectoryScope } from "./identity.js";

// ---------------------------------------------------------------------------
// The typed outcomes
// ---------------------------------------------------------------------------

export type TrajectoryStoreErrorCode =
  | "duplicate-trajectory" // L3: the id is already appended
  | "unknown-trajectory" // L5: the id was never appended
  | "invalid-record"; // L2: the record failed the capture-law gate

/** One typed store error (the offending law's code). */
export interface TrajectoryStoreError {
  readonly code: TrajectoryStoreErrorCode;
  readonly message: string;
  /** Present on `invalid-record`: the capture-law errors, verbatim. */
  readonly recordErrors?: readonly TrajectoryError[];
}

export type TrajectoryAppendOutcome =
  | { readonly ok: true; readonly trajectoryId: TrajectoryId; readonly appendOrdinal: number }
  | { readonly ok: false; readonly errors: readonly TrajectoryStoreError[] };

export type TrajectoryReadOutcome =
  | { readonly ok: true; readonly record: TrajectoryRecord; readonly appendOrdinal: number }
  | { readonly ok: false; readonly errors: readonly TrajectoryStoreError[] };

/** One listed entry (identity + scope + position; never the full record). */
export interface TrajectoryStoreEntry {
  readonly trajectoryId: TrajectoryId;
  readonly scope: TrajectoryScope;
  readonly appendOrdinal: number;
}

export type TrajectoryListOutcome =
  | { readonly ok: true; readonly entries: readonly TrajectoryStoreEntry[] }
  | { readonly ok: false; readonly errors: readonly TrajectoryStoreError[] };

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * A lawful trajectory store (the append-only protocol seam — L1..L5 above).
 * Async BY DESIGN: real stores do I/O; the CONTRACT never fabricates
 * latency-free behavior. Implementations MUST run the append gate
 * (`validateTrajectoryRecord`) before admitting any record.
 */
export interface TrajectoryStore {
  /**
   * Append one validated record (L2: the capture-law gate runs first; L3:
   * the id is unique; the ordinal is assigned by append order).
   */
  append(record: TrajectoryRecord): Promise<TrajectoryAppendOutcome>;
  /** Read one record verbatim (L4) or fail typed (L5). */
  read(trajectoryId: TrajectoryId): Promise<TrajectoryReadOutcome>;
  /** List the stored entries in append order (L4). */
  list(): Promise<TrajectoryListOutcome>;
}
