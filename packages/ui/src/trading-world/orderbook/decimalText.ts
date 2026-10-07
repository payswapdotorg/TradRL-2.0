/**
 * Exact decimal-text arithmetic — W009 (DOM ladder + Time & Sales).
 *
 * The W003 contracts carry prices and quantities as CANONICAL DECIMAL TEXT
 * (`Price`/`Quantity` are branded strings — `packages/tradrl-world-contracts/
 * src/primitives.ts`), and the engine's own book keeps them on a 12-decimal
 * fixed-point scale (`tradrl-world-sim/orderbook/decimal.ts`). The ladder and
 * the tape must AGGREGATE that text (cumulative depth, totals, spread, mid)
 * without ever introducing a floating-point artifact — `0.1 + 0.2` must be
 * `0.3`, not `0.30000000000000004` — so this module does all arithmetic on
 * scaled BigInt integers derived deterministically from the text, exactly
 * like the engine's own kernel, and formats back to canonical minimal text.
 *
 * PURE functions: no React, no DOM, no engine imports (the W006/W007 `.d.ts`
 * shim rationale — packages/ui does not import the sim/contracts packages).
 * Every parse is VALIDATED: malformed decimal text is a typed error, never a
 * guessed value (ARCHITECTURE-LOCK A6 — a projection invents no facts).
 */

/** Typed error for projection input that violates the canonical contracts. */
export class OrderBookProjectionDataError extends Error {
  constructor(detail: string) {
    super(`[trading-world/orderbook] refusing to project malformed market data: ${detail}`);
    this.name = "OrderBookProjectionDataError";
  }
}

/** An exact decimal value: `units / 10^scale` (units carries the sign). */
export interface DecimalParts {
  readonly units: bigint;
  readonly scale: number;
}

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

/**
 * Parse canonical decimal text into exact scaled parts. Accepts the W003
 * canonical form (optional leading `-`, no leading zeros, no exponent); a
 * `0.x` fraction keeps its leading zero. Anything else is a typed error.
 */
export function parseDecimalText(value: string, field: string): DecimalParts {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new OrderBookProjectionDataError(
      `${field} must be canonical decimal text, got ${JSON.stringify(value)}`,
    );
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dotIndex = unsigned.indexOf(".");
  const whole = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fraction = dotIndex === -1 ? "" : unsigned.slice(dotIndex + 1);
  const units = BigInt((negative ? "-" : "") + (whole + fraction));
  return { units, scale: fraction.length };
}

/**
 * Format exact scaled parts back to canonical minimal decimal text: trailing
 * fraction zeros are stripped (`1.50` → `1.5`, `2.0` → `2`), negative zero
 * normalizes to `0`, and `-0.5` keeps its sign. Deterministic for any input.
 */
export function formatDecimalParts(value: DecimalParts): string {
  let { units, scale } = value;
  if (units === 0n) {
    return "0";
  }
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();
  if (scale === 0) {
    return negative ? `-${digits}` : digits;
  }
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Scale `value` up to `scale` (multiply units by 10^(scale - value.scale)). */
function atScale(value: DecimalParts, scale: number): bigint {
  if (value.scale === scale) {
    return value.units;
  }
  return value.units * 10n ** BigInt(scale - value.scale);
}

/** Exact decimal-text addition (`a + b`), returned as canonical text. */
export function addDecimalText(a: DecimalParts, b: DecimalParts): DecimalParts {
  const scale = Math.max(a.scale, b.scale);
  return { units: atScale(a, scale) + atScale(b, scale), scale };
}

/** Exact decimal-text subtraction (`a - b`), returned as canonical text. */
export function subtractDecimalText(a: DecimalParts, b: DecimalParts): DecimalParts {
  const scale = Math.max(a.scale, b.scale);
  return { units: atScale(a, scale) - atScale(b, scale), scale };
}

/**
 * Exact decimal-text halving (`a / 2`): `units * 5` at `scale + 1` always
 * terminates, so the mid price of two real prices stays exact.
 */
export function halveDecimalText(a: DecimalParts): DecimalParts {
  return { units: a.units * 5n, scale: a.scale + 1 };
}

/** Exact comparison of two decimal values (never goes through a float). */
export function compareDecimalParts(a: DecimalParts, b: DecimalParts): number {
  const scale = Math.max(a.scale, b.scale);
  const left = atScale(a, scale);
  const right = atScale(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Decimal places of canonical decimal text (0 for integer text). */
export function decimalPlacesOf(value: string): number {
  const dotIndex = value.indexOf(".");
  return dotIndex === -1 ? 0 : value.length - dotIndex - 1;
}
