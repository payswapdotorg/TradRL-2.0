/**
 * Typed evidence-projection errors (W028 `tradrl-evidence`).
 *
 * Spec: spec/WORK-ITEMS.md W028 — the evidence/provenance projection is a
 * PURE projection over the journal; it never mints facts and never invents
 * citations. Two failure families, both loud and typed, never silent:
 *
 * - `EvidenceProjectionError` — the INPUT violates the laws the projection
 *   consumes (world mismatch, W004 stream-law violations, malformed or
 *   missing W027 provenance identities, unresolvable W020 import causation
 *   ids, ambiguous/duplicate declared source identities). The complete
 *   violation list is collected in ONE pass (the W004
 *   `validateEventStream` / W020/W027 loader pattern): importers see
 *   everything wrong with the input, not just the first problem. Never a
 *   partial projection, never a silently dropped citation.
 * - `UnknownEvidenceEntityError` — a QUERY names an id the evidence view
 *   does not know (event, artifact or dataset). Unknown is a typed error,
 *   never an undefined, never an empty list that looks like "cited by
 *   nothing" — known-but-uncited is a DIFFERENT, honest state.
 */

/** Everything that can be wrong with an evidence-projection input. */
export type EvidenceViolationKind =
  | "world-mismatch" // a record or artifact belongs to another world
  | "invalid-journal-stream" // the envelopes violate the W004 ordered-stream laws
  | "malformed-identity" // a payload identity is present but structurally malformed
  | "information-event-without-identity" // W027 law: import-produced information event with no identity
  | "information-event-outside-taxonomy" // W027 law: import producer with a non-taxonomy event type
  | "unresolvable-import-causation" // W020 law: import-produced event whose causation is not import:<datasetId>
  | "duplicate-dataset-id" // two provided dataset descriptors share a datasetId
  | "ambiguous-artifact-id"; // two provided artifacts share an artifactId with different identities

/** One violation, with the offending input index when scoped. */
export interface EvidenceViolation {
  readonly kind: EvidenceViolationKind;
  /** Index of the offending record/artifact/descriptor in the input (when scoped). */
  readonly index?: number;
  readonly detail: string;
}

/** Thrown by `projectEvidence` when the input violates the projection laws. */
export class EvidenceProjectionError extends Error {
  readonly kind: EvidenceViolationKind;

  constructor(readonly violations: readonly EvidenceViolation[]) {
    const first = violations[0];
    super(
      `evidence projection rejected: ${String(violations.length)} violation(s) ` +
        `[${first === undefined ? "none" : String(first.kind)}] — ` +
        violations.map((violation) => violation.detail).join("; "),
    );
    this.name = "EvidenceProjectionError";
    this.kind = first === undefined ? "world-mismatch" : first.kind;
  }
}

/** The entity kinds a typed evidence lookup can name. */
export type EvidenceEntityKind = "event" | "artifact" | "dataset";

/**
 * Thrown by the evidence query surface when a lookup names an id the
 * projection does not know. Unknown ≠ uncited: a KNOWN artifact with no
 * citing events is the honest empty answer; an id that appears nowhere in
 * the evidence view is this typed error.
 */
export class UnknownEvidenceEntityError extends Error {
  constructor(
    readonly entity: EvidenceEntityKind,
    readonly id: string,
  ) {
    super(`unknown ${entity} in the evidence view: ${id}`);
    this.name = "UnknownEvidenceEntityError";
  }
}
