/**
 * Typed crypto-provider mapping violations (W026 `tradrl-adapters-crypto`).
 *
 * Spec: spec/WORK-ITEMS.md W026 — "typed provider errors (unknown symbol,
 * malformed record, missing field, out-of-range timestamp)". The first four
 * kinds below are the work order's required taxonomy; the rest are the
 * structural failures of the provider/feed layer itself.
 *
 * Discipline (the W020 `DatasetViolation` pattern): one mapping pass
 * collects EVERY violation — importers see all problems, never just the
 * first, and no record is ever silently dropped. Mappings are pure value
 * results (`{ ok: false, violations }`); the W020 loader remains the one
 * throwing boundary (`DatasetImportError`) at the import step.
 */

/**
 * Everything that can be wrong when mapping exchange-native records onto the
 * W020 historical-record shapes.
 */
export type CryptoMappingErrorKind =
  | "unknown-symbol" // record/context symbol missing from the provider's symbol mapping
  | "malformed-record" // record structural failure (wrong shape, non-canonical decimal, unparseable time text, inconsistent OHLC)
  | "missing-field" // a field the documented record shape requires is absent (incl. a feed with no timestamp at all, or a missing mapping-context declaration)
  | "timestamp-out-of-range" // timestamp outside the loud sanity window — the classic ms/s unit-swap corruption, caught loudly
  | "unsupported-feed" // feedId not offered by the provider
  | "unmappable-feed" // feed is offered but declared unmappable in this baseline (e.g. a quote endpoint whose records carry no timestamp — the event-time basis is never invented)
  | "invalid-provider" // provider descriptor structural failure (blank fields, duplicate feed ids, dishonest polling claim)
  | "interval-length-mismatch"; // bar interval contradicts the caller-declared granularity

/** One violation, with the offending record index when record-scoped. */
export interface CryptoMappingViolation {
  readonly kind: CryptoMappingErrorKind;
  /** Index of the offending record in the input payload (record-scoped violations only). */
  readonly index?: number;
  readonly detail: string;
}
