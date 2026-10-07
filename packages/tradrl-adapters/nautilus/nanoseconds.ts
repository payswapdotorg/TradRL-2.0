/**
 * Nanosecond timestamp laws (W021 `tradrl-adapters-nautilus`).
 *
 * Spec: spec/WORK-ITEMS.md W021 — "ns→ms timestamp conversion is explicit and
 * validated loudly (the classic silent-corruption site — W026's unit-swap
 * discipline)".
 *
 * NautilusTrader's documented convention: EVERY data timestamp is UNIX epoch
 * NANOSECONDS int64 (`ts_event`, `ts_init`). The world's `TimestampMs`
 * contract is epoch milliseconds, so the adapter converts explicitly and
 * validates a loud sanity window — precisely because the unit swaps produce
 * plausible-looking garbage: a milliseconds value in an ns field lands in
 * 1970, a microseconds value in 1970, a seconds value in 1970 — all below
 * the window floor and all rejected with the raw value in the detail text.
 *
 * INT64 PRECISION HONESTY (disclosed, never hidden): epoch nanoseconds
 * (~1.7e18 for 2023) exceed IEEE-754 double safe-integer range (~9.0e15), so
 * a JS number CANNOT carry arbitrary int64 ns faithfully. The converter
 * therefore accepts BOTH documented forms:
 * - STRING digits (canonical integer text, 10–19 digits) — full int64
 *   fidelity; the high-fidelity form a catalog export should use;
 * - NUMBER — accepted when integer-valued and printed by JS in fixed
 *   notation. JSON number parsing may already have rounded an int64 ns value
 *   to a multiple of 256 BEFORE this adapter sees it (undetectable here);
 *   non-integer doubles (genuinely corrupted values) are rejected loudly.
 * Both forms are converted to ms by exact digit truncation — never binary
 * float division (which can mis-floor by 1ms near sub-ms remainders).
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type { NautilusMappingViolation } from "./errors.js";

/**
 * Sanity-window floor: 1990-01-01T00:00:00Z (631152000000000000 ns) — the
 * modern electronic-market-data era. NautilusTrader serves crypto, FX and
 * equities; a value below this floor in an ns field is almost certainly a
 * µs/ms/s value (the classic unit swap) or garbage.
 */
export const NAUTILUS_EPOCH_FLOOR_NS = 631_152_000_000_000_000;

/**
 * Sanity-window ceiling: 2100-01-01T00:00:00Z (4102444800000000000 ns). A
 * value above it is almost certainly garbage (or a unit already applied
 * twice).
 */
export const NAUTILUS_EPOCH_CEILING_NS = 4_102_444_800_000_000_000;

/** Canonical integer digits (the string form's law): 10-19 digits, no sign. */
const NS_DIGITS = /^[0-9]{10,19}$/;

/** Typed outcome of one ns -> ms conversion. */
export type NanosecondConversion =
  | { readonly ok: true; readonly ms: TimestampMs }
  | { readonly ok: false; readonly violation: NautilusMappingViolation };

function malformed(field: string, value: unknown): NautilusMappingViolation {
  return {
    kind: "malformed-record",
    detail:
      `${field}: expected the documented int64-nanoseconds value (canonical integer digits as a string, ` +
      `or an integer-valued number in fixed notation), got '${String(value)}'`,
  };
}

function outOfRange(field: string, nsText: string, hint: string): NautilusMappingViolation {
  return {
    kind: "timestamp-out-of-range",
    detail:
      `${field}: value ${nsText} ns is outside the nanoseconds sanity window ` +
      `[${String(NAUTILUS_EPOCH_FLOOR_NS)}, ${String(NAUTILUS_EPOCH_CEILING_NS)}] — ${hint}`,
  };
}

function rangeHint(ns: number): string {
  if (ns < 1_000_000_000_000_000) {
    return "a value this small in an ns field is likely a milliseconds, microseconds or seconds value (the classic unit swap)";
  }
  if (ns < 100_000_000_000_000_000) {
    return "a value this small in an ns field is likely a microseconds value (the classic unit swap)";
  }
  return "a value this large is likely garbage or a unit applied twice";
}

/**
 * Is the number an acceptable ns carrier (integer-valued, fixed notation)?
 * JS prints integer-valued doubles below 1e21 without exponent or fraction;
 * anything else (fraction, exponent, NaN, Infinity) cannot be an int64 ns
 * value and is rejected loudly.
 */
function nsDigitsOfNumber(
  value: number,
  field: string,
): { readonly ok: true; readonly digits: string } | { readonly ok: false; readonly violation: NautilusMappingViolation } {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, violation: malformed(field, value) };
  }
  const digits = String(value);
  if (digits.includes("e") || digits.includes("E") || !NS_DIGITS.test(digits)) {
    return { ok: false, violation: malformed(field, value) };
  }
  return { ok: true, digits };
}

/**
 * Convert one documented ns timestamp (`ts_event` / `ts_init`) to the world's
 * epoch milliseconds. Pure; the sub-millisecond remainder is TRUNCATED (a
 * declared, deterministic conversion — the world's `TimestampMs` contract has
 * no sub-ms precision, the W026 microsecond-truncation precedent). The range
 * check runs on the ns value BEFORE truncation, so unit-swapped values are
 * caught loudly at full resolution.
 */
export function epochMsFromNanos(value: unknown, field: string): NanosecondConversion {
  let digits: string;
  if (typeof value === "string") {
    if (!NS_DIGITS.test(value)) {
      return { ok: false, violation: malformed(field, value) };
    }
    digits = value;
  } else if (typeof value === "number") {
    const carrier = nsDigitsOfNumber(value, field);
    if (!carrier.ok) {
      return carrier;
    }
    digits = carrier.digits;
  } else {
    return { ok: false, violation: malformed(field, value) };
  }
  // Range gate on the ns value (via double comparison — the window is a
  // coarse sanity gate, not a precision operation).
  const ns = Number(digits);
  if (ns < NAUTILUS_EPOCH_FLOOR_NS || ns > NAUTILUS_EPOCH_CEILING_NS) {
    return { ok: false, violation: outOfRange(field, digits, rangeHint(ns)) };
  }
  // Exact truncation by digit slicing: drop the last 6 digits (10^6 ns = 1 ms).
  const msDigits = digits.slice(0, digits.length - 6);
  const ms = Number(msDigits);
  if (!Number.isSafeInteger(ms)) {
    // Unreachable while the window spans 1990..2100 (ms <= ~4.1e12) — belt
    // and braces against a future window widening.
    return { ok: false, violation: outOfRange(field, digits, "the value converts outside the safe millisecond range") };
  }
  return { ok: true, ms: ms as TimestampMs };
}
