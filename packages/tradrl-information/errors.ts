/**
 * Typed information-import errors (W027 `tradrl-information`).
 *
 * Spec: spec/WORK-ITEMS.md W027 — "out-of-order or malformed records are
 * validated loudly (typed errors, never silently dropped)"; the W020
 * `tradrl-data` error law applied to information records: unknown source,
 * malformed record, boundary violation.
 *
 * Every rejection carries the COMPLETE violation list found in one
 * validation pass (the W004 `validateEventStream` pattern): importers see
 * everything wrong with a dataset, not just the first problem. The error's
 * `kind` is the first violation's kind; `violations` carries all of them.
 */

/** Everything that can be wrong with an information dataset import. */
export type InformationImportErrorKind =
  | "invalid-descriptor" // descriptor structural failure (blank fields, malformed range/gaps/kinds)
  | "invalid-source-declaration" // source declaration structural failure (blank name, unknown credibility)
  | "unknown-source" // record cites a source missing from the declared source map
  | "unknown-symbol" // record symbol missing from the symbol→instrument map
  | "malformed-record" // record structural failure (blank headline/source, non-finite times, bad decimal/confidence)
  | "available-before-published" // A7: declared availableAt precedes the record's publication time
  | "record-outside-range" // record published outside the descriptor's declared range
  | "record-in-declared-gap" // record published inside a declared known gap (contradiction)
  | "record-kind-undeclared" // record kind the descriptor does not declare
  | "out-of-order-records" // publication time decreases across the input (journal law: time-not-monotonic)
  | "duplicate-record-id"; // colliding source record ids within one import

/** One violation, with the offending record index when record-scoped. */
export interface InformationViolation {
  readonly kind: InformationImportErrorKind;
  /** Index of the offending record in the input array (record-scoped violations only). */
  readonly index?: number;
  readonly detail: string;
}

/** Thrown by the loader when an information import violates the import laws. */
export class InformationImportError extends Error {
  readonly kind: InformationImportErrorKind;

  constructor(readonly violations: readonly InformationViolation[]) {
    const first = violations[0];
    super(
      `information dataset import rejected: ${String(violations.length)} violation(s) ` +
        `[${first === undefined ? "none" : String(first.kind)}] — ` +
        violations.map((violation) => violation.detail).join("; "),
    );
    this.name = "InformationImportError";
    this.kind = first === undefined ? "invalid-descriptor" : first.kind;
  }
}
