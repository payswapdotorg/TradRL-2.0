/**
 * Exact signed money arithmetic on canonical decimal text — W011
 * (positions / portfolio / risk).
 *
 * The W015 financial engine carries every money, price and quantity figure
 * as a SIGNED scaled integer on a 12-decimal fixed point
 * (`tradrl-world-sim/portfolio/decimal.ts`, the DOMAIN-MODEL.md "Financial
 * precision" law) and formats canonical decimal text at the contract
 * boundary (`Money.amount` / `Price` / `Quantity` are branded strings). The
 * portfolio surfaces must AGGREGATE that text — position notional, margin
 * usage, gross exposure, P&L totals, limit consumption — without ever
 * introducing a floating-point artifact (`0.1 + 0.2` must stay `0.3`), so
 * this module re-implements the engine's own kernel laws locally:
 *
 * - PARSE: canonical decimal text with an optional leading `-`, no leading
 *   zeros, no exponent form, at most 12 fractional digits — anything else is
 *   a typed error (ARCHITECTURE-LOCK A6: a projection invents no facts, and
 *   never guesses a malformed figure into a number).
 * - FORMAT: trailing fraction zeros stripped, negative zero normalized to
 *   `0` (negative zero is never a financial fact).
 * - ONE ROUNDING PER FIGURE: products of two 12-decimal values round
 *   half-up exactly once at the 12-decimal scale — the same single-rounding
 *   law as the engine's `mulDivHalfUp`, so client-side aggregates (gross
 *   exposure = Σ |qty| × mark) are bit-identical to the engine's own
 *   financial state.
 * - EXACT DIVISION: the leverage solve divides once and REQUIRES a zero
 *   remainder — an inexact result is `undefined`, never a rounded guess.
 *
 * PURE functions: no React, no DOM, no engine imports (the W006/W007 seam
 * law — packages/ui compiles against contract types only).
 */

/** The engine kernel's money scale: values are units × 10^-12. */
export const MONEY_SCALE_DECIMALS = 12;

const SCALE = 10n ** BigInt(MONEY_SCALE_DECIMALS);

/** Canonical signed decimal text: optional `-`, no leading zeros, ≤12 dp. */
const SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/u;

/** Typed error for projection input that violates the canonical contracts. */
export class PortfolioProjectionDataError extends Error {
  constructor(detail: string) {
    super(`[trading-world/portfolio] refusing to project malformed financial data: ${detail}`);
    this.name = "PortfolioProjectionDataError";
  }
}

/** An exact signed money value at the 12-decimal kernel scale. */
export type MoneyUnits = bigint;

/** Parse canonical signed decimal text into exact kernel units. */
export function parseMoneyText(value: string, field: string): MoneyUnits {
  if (typeof value !== "string" || !SIGNED_DECIMAL_PATTERN.test(value)) {
    throw new PortfolioProjectionDataError(
      `${field} must be canonical signed decimal text (≤${MONEY_SCALE_DECIMALS} fraction digits), got ${JSON.stringify(value)}`,
    );
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dotIndex = unsigned.indexOf(".");
  const whole = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fraction = dotIndex === -1 ? "" : unsigned.slice(dotIndex + 1);
  const units =
    BigInt(whole + fraction) * 10n ** BigInt(MONEY_SCALE_DECIMALS - fraction.length);
  return negative ? -units : units;
}

/** Format exact kernel units back to canonical minimal decimal text. */
export function formatMoneyUnits(units: MoneyUnits): string {
  if (units === 0n) {
    return "0";
  }
  const negative = units < 0n;
  let magnitude = negative ? -units : units;
  let scale = MONEY_SCALE_DECIMALS;
  while (scale > 0 && magnitude % 10n === 0n) {
    magnitude /= 10n;
    scale -= 1;
  }
  const digits = magnitude.toString();
  if (scale === 0) {
    return negative ? `-${digits}` : digits;
  }
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Absolute value (position quantities are signed: long positive). */
export function absMoneyUnits(units: MoneyUnits): MoneyUnits {
  return units < 0n ? -units : units;
}

/** Exact addition / subtraction at the kernel scale (no rounding). */
export function addMoneyUnits(a: MoneyUnits, b: MoneyUnits): MoneyUnits {
  return a + b;
}

export function subtractMoneyUnits(a: MoneyUnits, b: MoneyUnits): MoneyUnits {
  return a - b;
}

/**
 * The engine's one-rounding product of two 12-decimal values:
 * round-half-up(a × b / 10^12) — `signedMulDivHalfUp(a, b, SCALE)` in the
 * W015 kernel. Used for |qty| × mark notionals (the same figure the engine's
 * `notionalForPosition` computes).
 */
export function multiplyMoneyHalfUp(a: MoneyUnits, b: MoneyUnits): MoneyUnits {
  const negative = a < 0n !== b < 0n;
  const product = absMoneyUnits(a) * absMoneyUnits(b);
  const half = SCALE / 2n;
  const quotient = (product + half) / SCALE;
  return negative ? -quotient : quotient;
}

/**
 * The engine's one-rounding scaled multiply-divide:
 * round-half-up(a × b / divisor), divisor > 0, sign carried through. Used
 * for margin (|qty| × mark / leverage — `marginForPosition` in the W015
 * account module).
 */
export function mulDivMoneyHalfUp(a: MoneyUnits, b: MoneyUnits, divisor: bigint): MoneyUnits {
  if (divisor <= 0n) {
    throw new PortfolioProjectionDataError(
      `mulDiv requires a positive divisor, got ${divisor}`,
    );
  }
  const negative = a < 0n !== b < 0n;
  const product = absMoneyUnits(a) * absMoneyUnits(b);
  const half = divisor / 2n;
  const quotient = (product + half) / divisor;
  return negative ? -quotient : quotient;
}

/** Exact comparison of two kernel-unit values. */
export function compareMoneyUnits(a: MoneyUnits, b: MoneyUnits): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Exact division with a REQUIRED zero remainder: `a / b` as units, or
 * `undefined` when the division is not exact (never a rounded guess — the
 * leverage solve must be the engine's own integer, not an approximation).
 * `b` must be non-zero.
 */
export function divideMoneyExact(a: MoneyUnits, b: MoneyUnits): MoneyUnits | undefined {
  if (b === 0n) {
    return undefined;
  }
  const quotient = a / b;
  return quotient * b === a ? quotient : undefined;
}

/**
 * A ratio at the kernel scale, half-up: numerator × 10^12 / denominator,
 * formatted as canonical text — the mirror of the engine's `leverageScaled`
 * (gross × 10^12 / equity). `undefined` means infinite (denominator ≤ 0
 * with a positive numerator — the honest leverage breach).
 */
export function ratioUnitsText(
  numerator: MoneyUnits,
  denominator: MoneyUnits,
): string | undefined {
  if (denominator <= 0n) {
    return numerator > 0n ? undefined : "0";
  }
  return formatMoneyUnits(mulDivMoneyHalfUp(numerator, SCALE, denominator));
}

/** Format a ratio with an explicit "×" for display (e.g. "1.5×"). */
export function formatRatioText(text: string): string {
  return `${text}×`;
}
