/**
 * Signed exact-money arithmetic for the W015 financial modules (portfolio /
 * account / risk), built ON the W014 decimal kernel (orderbook/decimal.ts).
 *
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — money, price and
 * quantity use explicit decimal/precision policies, canonical decimal text
 * at the contract boundary, never binary floats. The kernel's `Scaled`
 * fixed-point (× 10^12) carries unsigned values only; positions are SIGNED
 * (W003 `Position`: positive long, negative short) and P&L can be negative,
 * so this module adds the sign-carrying parse/format/mulDiv layer while
 * reusing the kernel's single-rounding laws:
 * - `parseSignedMoney` accepts canonical decimal text with an optional
 *   leading "-" (position quantities and P&L amounts);
 * - `formatSignedMoney` formats a signed scaled value at the kernel scale
 *   with trailing zeros stripped (negative zero normalizes to "0");
 * - `signedMulDivHalfUp` is the kernel's one-rounding `mulDivHalfUp` with a
 *   sign carried through (exact rationals, rounded once, never twice).
 */

import { formatScaled, mulDivHalfUp, parseScaled, type Scaled } from "../orderbook/index.js";

/** Canonical money text precision: values live on the kernel's 12-dec scale. */
export const MONEY_DECIMALS = 12;

/**
 * Parse signed canonical decimal text ("-5", "3.5", "0") into the internal
 * scale. Unsigned text parses through the kernel law (throws on malformed
 * input); a leading "-" negates the result.
 */
export function parseSignedMoney(text: string): Scaled {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error(`not canonical signed decimal text: ${String(text)}`);
  }
  if (text.startsWith("-")) {
    return -parseScaled(text.slice(1));
  }
  return parseScaled(text);
}

/**
 * True for canonical signed decimal text (optional leading "-", ≤ 12 dp,
 * no exponent form) — the P&L/position boundary shape.
 */
export function isCanonicalSignedMoney(text: unknown): text is string {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  const unsigned = text.startsWith("-") ? text.slice(1) : text;
  if (unsigned.length === 0) {
    return false;
  }
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    return false;
  }
  const fraction = unsigned.split(".")[1];
  return fraction === undefined || fraction.length <= MONEY_DECIMALS;
}

/**
 * Format a signed scaled value as canonical decimal text: trailing zeros
 * stripped, "-0"/negative zero normalized to "0" (negative zero is never a
 * financial fact).
 */
export function formatSignedMoney(value: Scaled): string {
  if (value === 0n) {
    return "0";
  }
  if (value < 0n) {
    return `-${formatScaled(-value, MONEY_DECIMALS)}`;
  }
  return formatScaled(value, MONEY_DECIMALS);
}

/**
 * Compute round-half-up(a × b / divisor) in ONE rounding step with the sign
 * carried through (the kernel's `mulDivHalfUp` is non-negative-only; P&L
 * products are signed). `divisor` must be positive; operands may be negative.
 */
export function signedMulDivHalfUp(a: Scaled, b: Scaled, divisor: bigint): Scaled {
  if (divisor <= 0n) {
    throw new Error("signedMulDivHalfUp requires a positive divisor");
  }
  const negative = (a < 0n && b > 0n) || (a > 0n && b < 0n);
  const magnitude = mulDivHalfUp(a < 0n ? -a : a, b < 0n ? -b : b, divisor);
  return negative ? -magnitude : magnitude;
}

/** Absolute value of a scaled quantity (positions: |signed quantity|). */
export function absScaled(value: Scaled): Scaled {
  return value < 0n ? -value : value;
}

/** Sum an ordered list of scaled values (deterministic fold, no rounding). */
export function sumScaled(values: readonly Scaled[]): Scaled {
  let total = 0n;
  for (const value of values) {
    total += value;
  }
  return total;
}

/** Compare two canonical decimal texts numerically (scaled, exact). */
export function compareDecimalText(a: string, b: string): number {
  const left = parseSignedMoney(a);
  const right = parseSignedMoney(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
