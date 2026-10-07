/**
 * Deterministic journal replay — the core of world-state recomputation.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 (a fixed world definition, engine
 * version, seed and command stream reproduces the identical run — replay is
 * how that claim is verified) and A6 (the journal is the authoritative
 * history; state is a function of it).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I (headless parity: the same command
 * stream produces the same deterministic result hash).
 *
 * The journal module owns the MECHANISM (apply records in sequence order to
 * a reducer, verify order); the world module owns the REDUCER
 * (`reduceWorldEvent`) and wires it in. This keeps the dependency direction
 * journal ← world (the journal never imports the world).
 */

import type { JournalRecord } from "./eventJournal.js";

/** Result of replaying a record set into a state. */
export interface ReplayOutcome<TState> {
  /** The state after applying every record in sequence order. */
  readonly state: TState;
  /** Number of applied records. */
  readonly appliedCount: number;
  /** Domain time of the final record, when the record set is non-empty. */
  readonly lastEventTime?: number;
}

/**
 * Fold a journal record set into a state, strictly in stored order. The
 * reducer must be pure (state in, state out) — that purity is what makes
 * replay bit-identical to the live run: the live engine advances state by
 * reducing exactly the envelopes it just journaled.
 */
export function replayJournal<TState>(
  records: readonly JournalRecord[],
  reducer: (state: TState, record: JournalRecord) => TState,
  initial: TState,
): ReplayOutcome<TState> {
  let state = initial;
  for (const record of records) {
    state = reducer(state, record);
  }
  const last = records[records.length - 1];
  return last === undefined
    ? { state, appliedCount: 0 }
    : {
        state,
        appliedCount: records.length,
        ...(last.envelope.occurredAt === undefined ? {} : { lastEventTime: last.envelope.occurredAt }),
      };
}
