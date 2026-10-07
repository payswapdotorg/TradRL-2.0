/**
 * Shared record-shape validation helpers (W026 internal).
 *
 * The per-exchange mappers validate exchange-native JSON against the same
 * laws: decimal fields must be canonical decimal text (the W020 record
 * boundary — reusing `tradrl-data`'s law verbatim, parity by construction),
 * OHLC must be internally consistent. Collect-everything discipline: every
 * problem is a typed violation, none is silently dropped.
 */

import type { Price, Quantity, TimestampMs } from "tradrl-world-contracts";
import type { CryptoMappingViolation } from "./errors.js";
import type { TimestampConversion } from "./timestamps.js";
import { compareCanonicalDecimalText, isCanonicalDecimalText } from "tradrl-data";

/** Runtime guard: a plain JSON object. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate one decimal-text field against the W020 canonical law. Returns
 * the typed violation when the value is not canonical decimal text
 * (exchanges send strings; numbers, exponents and blank text are rejected).
 */
export function decimalViolation(
  field: string,
  value: unknown,
): CryptoMappingViolation | undefined {
  if (!isCanonicalDecimalText(value)) {
    return {
      kind: "malformed-record",
      detail: `${field} must be canonical decimal text, got '${String(value)}'`,
    };
  }
  return undefined;
}

/** Cast a validated canonical decimal text to the `Price` brand. */
export function asPrice(text: string): Price {
  return text as Price;
}

/** Cast a validated canonical decimal text to the `Quantity` brand. */
export function asQuantity(text: string): Quantity {
  return text as Quantity;
}

/**
 * OHLC consistency (the W020 bar law, mirrored at mapping time so provider
 * garbage is rejected before it ever reaches the import): high covers open
 * and close, low is covered by open and close, low never exceeds high.
 * Inputs must already be canonical decimal texts.
 */
export function ohlcvViolation(
  label: string,
  open: string,
  high: string,
  low: string,
  close: string,
): CryptoMappingViolation | undefined {
  const inconsistent =
    compareCanonicalDecimalText(high, open) < 0 ||
    compareCanonicalDecimalText(high, close) < 0 ||
    compareCanonicalDecimalText(low, open) > 0 ||
    compareCanonicalDecimalText(low, close) > 0 ||
    compareCanonicalDecimalText(low, high) > 0;
  if (inconsistent) {
    return {
      kind: "malformed-record",
      detail: `${label}: inconsistent OHLC (o=${open} h=${high} l=${low} c=${close})`,
    };
  }
  return undefined;
}

/** Missing-field violation with the documented-shape explanation. */
export function missingField(field: string, why: string): CryptoMappingViolation {
  return { kind: "missing-field", detail: `${field}: ${why}` };
}

/**
 * Push a timestamp conversion's violation (if any) and return the ms value
 * (undefined when the conversion failed) — the mappers' narrow-friendly
 * collect-everything helper.
 */
export function timestampOrPush(
  conversion: TimestampConversion,
  violations: CryptoMappingViolation[],
): TimestampMs | undefined {
  if (conversion.ok) {
    return conversion.ms;
  }
  violations.push(conversion.violation);
  return undefined;
}

/**
 * Push a decimal field's violation (if any) and return the validated text
 * (undefined when invalid).
 */
export function decimalOrPush(
  field: string,
  value: unknown,
  violations: CryptoMappingViolation[],
): string | undefined {
  const problem = decimalViolation(field, value);
  if (problem !== undefined) {
    violations.push(problem);
    return undefined;
  }
  return value as string;
}
