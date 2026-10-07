/**
 * Internal decimal helpers for the reference substrates (W033): thin,
 * disclosed wrappers over the W014 engine's decimal kernel
 * (`tradrl-world-sim/orderbook`) — the contract boundary is canonical
 * decimal text and this module NEVER re-derives the kernel's laws, it adds
 * exactly the two things a deciding mind needs and the unsigned kernel
 * does not carry:
 *
 * - SIGNED canonical decimal text (positions and P&L are signed; the
 *   kernel's `parseScaled` is deliberately unsigned);
 * - a deterministic RATIO (a number in [0,1] from two scaled values) —
 *   computed as BigInt integer division truncated at 4 decimal places, so
 *   the same inputs always produce bit-identical confidence values (A9);
 *   never a binary-float division.
 */

import { formatScaled, isCanonicalDecimal, parseScaled, type Scaled } from "tradrl-world-sim/orderbook";

/** True for canonical decimal text with an optional leading sign (≤12 dp). */
export function isCanonicalSignedDecimal(text: unknown): text is string {
  if (typeof text !== "string") {
    return false;
  }
  return isCanonicalDecimal(text.startsWith("-") ? text.slice(1) : text);
}

/** Parse signed canonical decimal text into a signed scaled value (throws on malformed). */
export function parseSigned(text: string): Scaled {
  const negative = text.startsWith("-");
  const magnitude = parseScaled(negative ? text.slice(1) : text);
  return negative ? -magnitude : magnitude;
}

/**
 * A deterministic ratio `numerator / divisor` as a JS number in [0,1],
 * truncated (never rounded) at 4 decimal places via BigInt integer
 * division. `divisor` must be > 0; a negative numerator clamps to 0.
 */
export function ratioOf(numerator: Scaled, divisor: Scaled): number {
  if (divisor <= 0n) {
    throw new Error("ratioOf requires a positive divisor");
  }
  const clamped = numerator < 0n ? 0n : numerator;
  const basis = 10_000n;
  const truncated = (clamped * basis) / divisor;
  return Number(truncated > basis ? basis : truncated) / Number(basis);
}

/** Clamp a number into [0,1] (confidence bounds; pure, no rounding). */
export function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The mid of two scaled prices, half-up at the engine's 12-decimal scale
 * (the W014 kernel's own rounding law). Exact for the engine's price
 * scales (e.g. 2-decimal prices never round).
 */
export function midOf(bid: Scaled, ask: Scaled): Scaled {
  const sum = bid + ask;
  const quotient = sum / 2n;
  return sum % 2n === 0n ? quotient : quotient + 1n;
}

/** Format a signed scaled value as canonical decimal text (kernel format, sign prefixed). */
export function formatSigned(value: Scaled): string {
  return value < 0n ? `-${formatScaled(-value, 12)}` : formatScaled(value, 12);
}
