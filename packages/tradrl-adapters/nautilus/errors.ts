/**
 * Typed NautilusTrader mapping violations (W021 `tradrl-adapters-nautilus`).
 *
 * Spec: spec/WORK-ITEMS.md W021 — "typed errors (unknown instrument mapping,
 * malformed record, boundary violation)". The first three kinds below are the
 * work order's required taxonomy; the rest are the structural failures of the
 * catalog/dtype layer itself.
 *
 * Discipline (the W020 `DatasetViolation` / W026 `CryptoMappingViolation`
 * pattern): one mapping pass collects EVERY violation — importers see all
 * problems, never just the first, and no record is ever silently dropped.
 * Mappings are pure value results (`{ ok: false, violations }`); the W020
 * loader remains the one throwing boundary (`DatasetImportError`).
 */

/**
 * Everything that can be wrong when mapping NautilusTrader-style historical
 * dtype records onto the W020 historical-record shapes.
 */
export type NautilusMappingErrorKind =
  | "unknown-instrument" // record/context instrument_id missing from the catalog's declared instrument mapping
  | "malformed-record" // record structural failure (wrong shape, non-canonical decimal, unparseable bar_type, inconsistent OHLC)
  | "missing-field" // a field the documented dtype requires is absent (incl. a required mapping-context declaration)
  | "timestamp-out-of-range" // ns timestamp outside the loud sanity window — the classic ns/µs/ms unit-swap corruption, caught loudly
  | "availability-boundary" // ts_init (-> availableAt) precedes the record's event-time basis (A7 law, validated at mapping time)
  | "interval-length-mismatch" // bar interval contradicts the derived or declared granularity
  | "unsupported-dtype" // dtypeId not offered by the catalog
  | "unmappable-dtype" // dtype is offered but declared unmappable in this baseline (e.g. order-book deltas — never a guessed mapping)
  | "invalid-catalog"; // catalog descriptor structural failure (blank fields, duplicate dtype ids, dishonest acquisition claim)

/** One violation, with the offending record index when record-scoped. */
export interface NautilusMappingViolation {
  readonly kind: NautilusMappingErrorKind;
  /** Index of the offending record in the input payload (record-scoped violations only). */
  readonly index?: number;
  readonly detail: string;
}
