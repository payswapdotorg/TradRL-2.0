/**
 * Historical record helpers (W020 `tradrl-data`).
 *
 * Pure functions over the `HistoricalRecord` contracts (W020
 * `contracts/data`): the event-time basis law, the record time extent, the
 * canonical-decimal text law and the explicit deterministic sort helper.
 * No IO, no clock reads, no RNG (ARCHITECTURE-LOCK.md A9).
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type {
  HistoricalBarRecord,
  HistoricalQuoteRecord,
  HistoricalRecord,
  HistoricalTradeRecord,
} from "tradrl-world-contracts/data";

/** Type guard: is this record a bar? */
export function isHistoricalBarRecord(
  record: HistoricalRecord,
): record is HistoricalBarRecord {
  return record.kind === "bar";
}

/** Type guard: is this record a trade? */
export function isHistoricalTradeRecord(
  record: HistoricalRecord,
): record is HistoricalTradeRecord {
  return record.kind === "trade";
}

/** Type guard: is this record a quote? */
export function isHistoricalQuoteRecord(
  record: HistoricalRecord,
): record is HistoricalQuoteRecord {
  return record.kind === "quote";
}

/**
 * The event-time basis of a record — the timestamp that becomes the journal
 * envelope's `occurredAt`:
 * - trade/quote → `timestamp` (verbatim from the record);
 * - bar → `closeTime` (a bar is an INTERVAL fact, complete exactly when it
 *   closes; an open-time basis would leak the bar's close/high/low before
 *   the interval ends — an A7 violation by construction).
 *
 * This is a mapping LAW over record fields, never an invention: every input
 * comes from the record itself.
 */
export function historicalRecordEventTime(record: HistoricalRecord): TimestampMs {
  return record.kind === "bar" ? record.closeTime : record.timestamp;
}

/** The record's full time extent (bar interval; point records collapse to one instant). */
export function historicalRecordExtent(
  record: HistoricalRecord,
): { readonly from: TimestampMs; readonly to: TimestampMs } {
  return record.kind === "bar"
    ? { from: record.openTime, to: record.closeTime }
    : { from: record.timestamp, to: record.timestamp };
}

/**
 * Canonical decimal text law (the W003 `primitives.ts` contract boundary):
 * no sign, no leading zeros, no exponent form, at most 12 fractional
 * digits. Mirrors the W014 engine kernel's `isCanonicalDecimal`
 * (`tradrl-world-sim/orderbook/decimal.ts`); parity is asserted by tests —
 * this local mirror keeps the import surface from depending on the engine's
 * internal kernel module graph.
 */
export function isCanonicalDecimalText(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return false;
  }
  const fraction = value.split(".")[1];
  return fraction === undefined || fraction.length <= 12;
}

/**
 * Exact comparison of two canonical decimal texts (the W014 kernel law: no
 * binary floats anywhere). Returns < 0 when `left < right`, 0 when equal,
 * > 0 when `left > right`. Both inputs must already be canonical (asserted
 * by validation before use); non-canonical input throws — it can never
 * legitimately reach a comparison.
 */
export function compareCanonicalDecimalText(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const wholeDelta = integerTextDelta(leftWhole ?? "", rightWhole ?? "");
  if (wholeDelta !== 0) {
    return wholeDelta;
  }
  const shared = Math.min(leftFraction.length, rightFraction.length);
  for (let i = 0; i < shared; i += 1) {
    const digitDelta = leftFraction.charCodeAt(i) - rightFraction.charCodeAt(i);
    if (digitDelta !== 0) {
      return digitDelta;
    }
  }
  // Only trailing zeros may remain on the longer fraction ("1.5" == "1.50");
  // any nonzero remainder decides the order.
  const remainder =
    leftFraction.length > rightFraction.length
      ? leftFraction.slice(shared)
      : rightFraction.slice(shared);
  if (remainder.length === 0 || /^[0]+$/.test(remainder)) {
    return 0;
  }
  return leftFraction.length > rightFraction.length ? 1 : -1;
}

/** Compare two non-negative canonical integer texts without parsing to float. */
function integerTextDelta(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let i = 0; i < left.length; i += 1) {
    const digitDelta = left.charCodeAt(i) - right.charCodeAt(i);
    if (digitDelta !== 0) {
      return digitDelta;
    }
  }
  return 0;
}

/**
 * Deterministic stable sort of records by event-time basis. Ties keep input
 * order (a stable sort of a pure comparison — same input array ⇒ same
 * output array, always). NEVER applied implicitly by the loader: out-of-order
 * input is validated loudly there; this helper exists for importers (W021
 * catalogs, W026 feeds) that must deterministically repair provider order
 * BEFORE importing.
 */
export function sortHistoricalRecords(
  records: readonly HistoricalRecord[],
): readonly HistoricalRecord[] {
  return [...records].sort((left, right) => {
    const delta = historicalRecordEventTime(left) - historicalRecordEventTime(right);
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
    return 0; // stable sort keeps input order on ties
  });
}
