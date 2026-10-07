/**
 * Typed dataset-import errors (W020 `tradrl-data`).
 *
 * Spec: spec/WORK-ITEMS.md W020 — "out-of-order or overlapping records are
 * validated loudly (typed errors, never silently dropped)" and "Error
 * behavior: typed dataset errors (unknown symbol mapping, malformed record,
 * unavailable boundary violation)".
 *
 * Every rejection carries the COMPLETE violation list found in one
 * validation pass (the W004 `validateEventStream` pattern): importers see
 * everything wrong with a dataset, not just the first problem. The error's
 * `kind` is the first violation's kind; `violations` carries all of them.
 */

/** Everything that can be wrong with a historical dataset import. */
export type DatasetImportErrorKind =
  | "invalid-descriptor" // descriptor structural failure (blank fields, malformed range/gaps/kinds)
  | "unknown-symbol" // record symbol missing from the symbol→instrument map
  | "malformed-record" // record structural failure (non-canonical decimal, blank symbol, bad bar interval/OHLC)
  | "available-before-occurred" // A7: declared availableAt precedes the record's event-time basis
  | "record-outside-range" // record falls outside the descriptor's declared range
  | "record-in-declared-gap" // record inside a declared known gap (contradiction)
  | "record-kind-undeclared" // record kind the descriptor does not declare
  | "out-of-order-records" // event-time basis decreases across the input (journal law: time-not-monotonic)
  | "overlapping-bars" // same-symbol bar intervals overlap (including duplicates)
  | "missing-aggressor-side" // trade without aggressorSide (required by the W004 trade payload — never fabricated)
  | "duplicate-trade-id"; // colliding source trade ids within one import

/** One violation, with the offending record index when record-scoped. */
export interface DatasetViolation {
  readonly kind: DatasetImportErrorKind;
  /** Index of the offending record in the input array (record-scoped violations only). */
  readonly index?: number;
  readonly detail: string;
}

/** Thrown by the loader when a dataset import violates the import laws. */
export class DatasetImportError extends Error {
  readonly kind: DatasetImportErrorKind;

  constructor(readonly violations: readonly DatasetViolation[]) {
    const first = violations[0];
    super(
      `historical dataset import rejected: ${String(violations.length)} violation(s) ` +
        `[${first === undefined ? "none" : String(first.kind)}] — ` +
        violations.map((violation) => violation.detail).join("; "),
    );
    this.name = "DatasetImportError";
    this.kind = first === undefined ? "invalid-descriptor" : first.kind;
  }
}
