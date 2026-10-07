/**
 * Shared record-shape validation helpers (W021 internal).
 *
 * The per-dtype mappers validate documented NautilusTrader JSON rows against
 * the same laws: float64 columns convert to the W020 canonical decimal text
 * (via the shortest round-trip decimal representation — deterministic), OHLC
 * must be internally consistent, ns timestamps convert through the loud
 * `./nanoseconds.js` laws. Collect-everything discipline: every problem is a
 * typed violation, none is silently dropped.
 */

import type { Price, Quantity, TimestampMs } from "tradrl-world-contracts";
import type { NautilusMappingViolation } from "./errors.js";
import type { InstrumentResolution } from "./instruments.js";
import { epochMsFromNanos, type NanosecondConversion } from "./nanoseconds.js";
import { compareCanonicalDecimalText, isCanonicalDecimalText } from "tradrl-data";

/** Runtime guard: a plain JSON object. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Missing-field violation with the documented-shape explanation. */
export function missingField(field: string, why: string): NautilusMappingViolation {
  return { kind: "missing-field", detail: `${field}: ${why}` };
}

/**
 * Convert one documented float64 column to the W020 canonical decimal text.
 * The conversion is the shortest round-trip decimal representation (JS
 * `String(number)`) — deterministic for every double; values whose shortest
 * form is exponential (|v| < 1e-6 or >= 1e21) or has more than 12 fraction
 * digits are NOT canonical and are rejected loudly (never silently rounded).
 */
export function canonicalDecimalFromFloat(
  field: string,
  value: unknown,
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly violation: NautilusMappingViolation } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      violation: {
        kind: "malformed-record",
        detail: `${field} must be a finite number (the documented float64 column), got '${String(value)}'`,
      },
    };
  }
  const text = String(value);
  if (!isCanonicalDecimalText(text)) {
    return {
      ok: false,
      violation: {
        kind: "malformed-record",
        detail:
          `${field}: the float64 value ${text} has no canonical decimal form ` +
          `(no sign, no exponent, at most 12 fraction digits) — re-export the column at exchange precision; ` +
          `it is never silently rounded here`,
      },
    };
  }
  return { ok: true, text };
}

/** Push a float64 column's violation (if any) and return the canonical text. */
export function decimalOrPush(
  field: string,
  value: unknown,
  violations: NautilusMappingViolation[],
): string | undefined {
  const result = canonicalDecimalFromFloat(field, value);
  if (result.ok) {
    return result.text;
  }
  violations.push(result.violation);
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
 * OHLC consistency (the W020 bar law, mirrored at mapping time so catalog
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
): NautilusMappingViolation | undefined {
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

/** Push an ns conversion's violation (if any) and return the ms value. */
export function nsOrPush(
  conversion: NanosecondConversion,
  violations: NautilusMappingViolation[],
): TimestampMs | undefined {
  if (conversion.ok) {
    return conversion.ms;
  }
  violations.push(conversion.violation);
  return undefined;
}

/**
 * One documented ns field: absent -> a typed missing-field violation (the
 * dtype requires it); present -> the loud ns->ms conversion law.
 */
export function nsFieldOrPush(
  field: string,
  value: unknown,
  violations: NautilusMappingViolation[],
): TimestampMs | undefined {
  if (value === undefined) {
    violations.push(missingField(field, "the documented dtype field is required"));
    return undefined;
  }
  return nsOrPush(epochMsFromNanos(value, field), violations);
}

/** Push an instrument resolution's violation (if any) and return the instrument. */
export function instrumentOrPush(
  resolution: InstrumentResolution,
  violations: NautilusMappingViolation[],
): string | undefined {
  if (resolution.ok) {
    return resolution.instrumentId;
  }
  violations.push(resolution.violation);
  return undefined;
}

/**
 * A7 boundary at mapping time: declared availability (`ts_init`) must never
 * precede the record's event-time basis. Loud, typed, never repaired.
 */
export function availabilityViolation(
  label: string,
  availableAt: TimestampMs,
  basis: TimestampMs,
): NautilusMappingViolation | undefined {
  if (availableAt < basis) {
    return {
      kind: "availability-boundary",
      detail:
        `${label}: ts_init ${String(availableAt)} (-> availableAt) precedes the event-time basis ` +
        `${String(basis)} (A7: availability is part of the record — never invented, never repaired)`,
    };
  }
  return undefined;
}

/** Is the value a plain finite number (the float64 column carrier)? */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
