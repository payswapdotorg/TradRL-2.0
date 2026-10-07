/**
 * The participant-side decimal kernel (W023) — exact fixed-point arithmetic
 * for agent price/quantity math, with NO engine imports.
 *
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — money/price/quantity
 * use explicit decimal policies; display formatting is never financial
 * truth. Spec: spec/ARCHITECTURE-LOCK.md A9 — no binary floats anywhere, so
 * the same views always produce bit-identical decisions.
 *
 * WHY A LOCAL KERNEL: participants may not import engine internals (the
 * W023 law — the public adapter/provider surface + contracts only), and the
 * engine's own kernel (tradrl-world-sim/orderbook/decimal.ts) is internal.
 * This module is an INDEPENDENT implementation of the same fixed-point
 * discipline the contracts define at the boundary (canonical decimal text,
 * 12-decimal scale, half-up display rounding): same laws, no shared code, no
 * dependency edge into the engine. Where a value must agree with the engine
 * bit-for-bit (tick-multiple prices, lot-multiple quantities), the AGENT
 * LAWS below guarantee it by construction:
 *
 * AGENT LAWS (the only arithmetic agents need — all exact, no rounding):
 * - prices move by ±integer ticks: `tickOffset(price, ±n, tick)` — exact;
 * - quantities are integer lots: `lotsOf(lotSize, n)` — exact;
 * - comparisons are cross-multiplied (never divided): `compareRatio`.
 */

/** The fixed-point scale: values are carried × 10^12 (the house discipline). */
export const PARTICIPANT_DECIMAL_SCALE = 12;

const SCALE = 10n ** BigInt(PARTICIPANT_DECIMAL_SCALE);
const CANONICAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** A value carried on the 12-decimal fixed-point scale. */
export type Scaled = bigint;

/**
 * Parse canonical decimal text (no sign, no exponent, ≤12 fractional
 * digits). Everything else throws — contract-boundary violations are agent
 * bugs, never silently absorbed.
 */
export function parseParticipantDecimal(text: string): Scaled {
  if (typeof text !== "string" || !CANONICAL.test(text)) {
    throw new Error(`[participants] not canonical decimal text: ${String(text)}`);
  }
  const parts = text.split(".");
  const whole = parts[0]!;
  const fraction = parts[1] ?? "";
  if (fraction.length > PARTICIPANT_DECIMAL_SCALE) {
    throw new Error(
      `[participants] more than ${String(PARTICIPANT_DECIMAL_SCALE)} fractional digits: ${String(text)}`,
    );
  }
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(PARTICIPANT_DECIMAL_SCALE, "0"));
}

/** Strip trailing zeros from the fractional part ("1.50" → "1.5", "2.00" → "2"). */
function stripZeros(digits: string): string {
  if (!digits.includes(".")) {
    return digits;
  }
  return digits.replace(/\.?0+$/, "");
}

/**
 * Format a non-negative scaled value as canonical decimal text with
 * half-up rounding at the requested precision (the display discipline —
 * financial truth is the scaled value, never the text).
 */
export function formatParticipantDecimal(value: Scaled, decimals: number): string {
  if (value < 0n) {
    throw new Error(`[participants] cannot format negative scaled value: ${String(value)}`);
  }
  if (decimals >= PARTICIPANT_DECIMAL_SCALE) {
    return stripZeros(
      `${value / SCALE}.${(value % SCALE).toString().padStart(PARTICIPANT_DECIMAL_SCALE, "0")}`,
    );
  }
  const divisor = 10n ** BigInt(PARTICIPANT_DECIMAL_SCALE - decimals);
  const quotient = value / divisor;
  const remainder = value % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const scale = 10n ** BigInt(decimals);
  return stripZeros(`${rounded / scale}.${(rounded % scale).toString().padStart(decimals, "0")}`);
}

/** Exact: `price ± n × tick` (n may be negative; prices stay tick-multiples). */
export function tickOffset(price: Scaled, ticks: number, tick: Scaled): Scaled {
  return price + BigInt(ticks) * tick;
}

/** Exact: `n × lotSize` (integer lots — quantities stay lot-multiples). */
export function lotsOf(lotSize: Scaled, count: number): Scaled {
  return BigInt(count) * lotSize;
}

/**
 * Exact scale-preserving multiply: `(a×b)/scale` — the product of two
 * 12-decimal scaled values re-expressed on the 12-decimal scale. Always
 * exact (each operand is a multiple of the scale, so the product is a
 * multiple of scale²); the assertion guards the invariant loudly.
 */
export function mulScaled(a: Scaled, b: Scaled): Scaled {
  const product = a * b;
  if (product % SCALE !== 0n) {
    throw new Error("[participants] mulScaled lost exactness (invariant breach)");
  }
  return product / SCALE;
}

/**
 * Compare `numeratorA/denominatorA` against `numeratorB/denominatorB`
 * exactly by cross-multiplication — the no-division comparison law (VWAP
 * bands, momentum thresholds: never rounded, never divided).
 */
export function compareRatio(
  numeratorA: Scaled,
  denominatorA: Scaled,
  numeratorB: Scaled,
  denominatorB: Scaled,
): number {
  if (denominatorA <= 0n || denominatorB <= 0n) {
    throw new Error("[participants] ratio comparison needs positive denominators");
  }
  const left = numeratorA * denominatorB;
  const right = numeratorB * denominatorA;
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * DISPLAY-ONLY ratio text (rationale strings): exact integer text when the
 * division is exact, otherwise "≈" plus a half-up 2-decimal approximation.
 * Never financial truth — decisions use `compareRatio`, never this.
 */
export function ratioText(numerator: Scaled, denominator: Scaled): string {
  if (denominator <= 0n) {
    throw new Error("[participants] ratio text needs a positive denominator");
  }
  if (numerator % denominator === 0n) {
    return (numerator / denominator).toString();
  }
  // The ratio, expressed on the 12-decimal scale (one half-up rounding for
  // the whole expression), then displayed at 2 decimals.
  const approx = formatParticipantDecimal(halfUpDiv(numerator * SCALE, denominator), 2);
  return `≈${approx}`;
}

/** Half-up integer division of non-negative values (display path only). */
function halfUpDiv(numerator: bigint, divisor: bigint): bigint {
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}
