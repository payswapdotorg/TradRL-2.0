/**
 * The engine-internal decimal kernel (W014 `orderbook` module — the venue
 * layer both `orderbook` and `matching` build on).
 *
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — "Money, price and
 * quantity use explicit decimal/precision policies. Display formatting is
 * never financial truth." The contract boundary (W003 `primitives.ts`) is
 * canonical decimal text; this kernel is the deterministic in-engine
 * implementation: values are held as exact big integers on a fixed 12-decimal
 * scale, so the same input stream always produces bit-identical arithmetic
 * (ARCHITECTURE-LOCK.md A9) with no binary floats anywhere.
 *
 * Laws (enforced by tests):
 * - `parseScaled` accepts only canonical decimal text (no exponent form,
 *   no sign, at most 12 fractional digits) — everything else throws;
 * - `formatScaled` rounds half-up at the requested precision and strips
 *   trailing zeros ("1.50" → "1.5", "2.00" → "2");
 * - `mulDivHalfUp` is the single-rounding primitive used for fees (one
 *   half-up rounding for the whole a*b/d expression, never two).
 */

/** The internal fixed-point scale: values are carried × 10^12. */
export const DECIMAL_SCALE = 12;

const SCALE = 10n ** BigInt(DECIMAL_SCALE);
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** A value carried on the internal 12-decimal fixed-point scale. */
export type Scaled = bigint;

/**
 * Parse canonical decimal text into the internal scale. Accepts "0", "10",
 * "4800.25" (leading zeros, signs and exponent forms are rejected — the
 * contract boundary is canonical text, and violations are engine bugs).
 */
export function parseScaled(text: string): Scaled {
  if (typeof text !== "string" || !DECIMAL_PATTERN.test(text)) {
    throw new Error(`not canonical decimal text: ${String(text)}`);
  }
  const parts = text.split(".");
  const whole = parts[0]!;
  const fraction = parts[1] ?? "";
  if (fraction.length > DECIMAL_SCALE) {
    throw new Error(
      `more than ${String(DECIMAL_SCALE)} fractional digits: ${String(text)}`,
    );
  }
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMAL_SCALE, "0"));
}

/** True for canonical, parseable decimal text (no exponent form, ≤12 dp). */
export function isCanonicalDecimal(text: unknown): text is string {
  if (typeof text !== "string" || !DECIMAL_PATTERN.test(text)) {
    return false;
  }
  const fraction = text.split(".")[1];
  return fraction === undefined || fraction.length <= DECIMAL_SCALE;
}

/**
 * Format a scaled value as canonical decimal text: half-up rounded to
 * `decimals` fractional digits, then trailing zeros (and a trailing dot)
 * are stripped. Zero is formatted as "0".
 */
export function formatScaled(value: Scaled, decimals: number): string {
  if (value < 0n) {
    throw new Error(`cannot format negative scaled value: ${String(value)}`);
  }
  const target = BigInt(decimals);
  if (target >= BigInt(DECIMAL_SCALE)) {
    return stripZeros(value, SCALE);
  }
  const divisor = 10n ** (BigInt(DECIMAL_SCALE) - target);
  return stripZeros(halfUpDiv(value, divisor), 10n ** target);
}

/** Half-up integer division of non-negative values. */
function halfUpDiv(numerator: bigint, divisor: bigint): bigint {
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

function stripZeros(value: bigint, scale: bigint): string {
  const whole = value / scale;
  const fractionDigits = scale.toString().length - 1;
  const fraction = (value % scale).toString().padStart(fractionDigits, "0");
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === "0") end -= 1;
  const kept = fraction.slice(0, end);
  return kept.length === 0 ? whole.toString() : `${whole.toString()}.${kept}`;
}

/**
 * Compute round-half-up(a × b / divisor) in ONE rounding step — the exact
 * rational result is rounded once, so fee amounts never suffer double
 * rounding. All inputs must be non-negative.
 */
export function mulDivHalfUp(a: Scaled, b: Scaled, divisor: bigint): Scaled {
  if (a < 0n || b < 0n || divisor <= 0n) {
    throw new Error("mulDivHalfUp requires non-negative operands and a positive divisor");
  }
  return halfUpDiv(a * b, divisor);
}

/** True when `value` is an exact integer multiple of `unit` (both scaled). */
export function isMultipleOf(value: Scaled, unit: Scaled): boolean {
  if (unit <= 0n) {
    throw new Error("isMultipleOf requires a positive unit");
  }
  return value % unit === 0n;
}

/** Compare two scaled values (ascending ordering helper). */
export function compareScaled(a: Scaled, b: Scaled): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
