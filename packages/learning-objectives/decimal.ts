/**
 * Deterministic decimal helpers (W036) — the money-reading discipline the
 * reward components and constraint checkers share.
 *
 * Spec: spec/DOMAIN-MODEL.md — "Financial precision": "Money, price and
 * quantity use explicit decimal/precision policies. Display formatting is
 * never financial truth." The contract boundary carries money as canonical
 * decimal text (`DecimalString`); this module is the EVALUATION-side reader
 * of that text, deterministic by construction (A9): no floats enter before
 * the parse, comparisons are EXACT (scaled BigInt on the canonical digits —
 * never a float epsilon), and the numeric conversion is the single defined
 * seam where decimal truth becomes a score input.
 *
 * License: Apache-2.0 (the repository LICENSE).
 *
 * These helpers THROW on malformed input (`decimalContractError`); the
 * package's public evaluation seams convert those throws into typed
 * fail-closed errors ("malformed-decimal" / "non-finite-reading") — never
 * silent defaults.
 */

import type { DecimalString } from "tradrl-world-contracts";

/** Canonical decimal text: optional minus, no leading zeros, no exponent. */
const CANONICAL_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** The malformed-decimal throw (converted to typed errors at the seams). */
export class DecimalContractError extends Error {
  constructor(
    message: string,
    readonly value: string,
  ) {
    super(message);
    this.name = "DecimalContractError";
  }
}

/** Is this string a canonical decimal text (the `DecimalString` form)? */
export function isCanonicalDecimal(value: string): boolean {
  return CANONICAL_DECIMAL_PATTERN.test(value);
}

/** One parsed decimal, exact: sign + unscaled digits + fractional scale. */
interface ExactDecimal {
  readonly negative: boolean;
  readonly intDigits: string;
  readonly fracDigits: string;
}

function parseExact(value: string): ExactDecimal {
  if (!isCanonicalDecimal(value)) {
    throw new DecimalContractError(
      `[learning-objectives] not a canonical decimal string: '${value}'`,
      value,
    );
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dot = unsigned.indexOf(".");
  const intDigits = dot < 0 ? unsigned : unsigned.slice(0, dot);
  const fracDigits = dot < 0 ? "" : unsigned.slice(dot + 1);
  return { negative, intDigits, fracDigits };
}

/** Compare magnitudes on a common fractional scale (exact BigInt). */
function compareMagnitude(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const scale = Math.max(left.fracDigits.length, right.fracDigits.length);
  const leftScaled = BigInt(left.intDigits + left.fracDigits.padEnd(scale, "0"));
  const rightScaled = BigInt(right.intDigits + right.fracDigits.padEnd(scale, "0"));
  if (leftScaled < rightScaled) {
    return -1;
  }
  return leftScaled > rightScaled ? 1 : 0;
}

/**
 * EXACT comparison of two canonical decimal strings (never a float, never an
 * epsilon). Throws {@link DecimalContractError} on malformed input.
 */
export function compareDecimal(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const left = parseExact(a);
  const right = parseExact(b);
  if (left.negative !== right.negative) {
    // Differing signs: the negative one is smaller (a "-0" magnitude compares
    // equal to "0", handled below by the magnitude path).
    const leftZero = left.intDigits === "0" && left.fracDigits === "";
    const rightZero = right.intDigits === "0" && right.fracDigits === "";
    if (leftZero || rightZero) {
      if (leftZero && rightZero) {
        return 0;
      }
      if (leftZero) {
        return right.negative ? 1 : -1;
      }
      return left.negative ? -1 : 1;
    }
    return left.negative ? -1 : 1;
  }
  const magnitude = compareMagnitude(left, right);
  if (magnitude === 0) {
    return 0;
  }
  return left.negative ? (magnitude === 1 ? -1 : 1) : magnitude;
}

/**
 * The single decimal→number seam (the score input): `Number()` over the
 * canonical text. Deterministic; may return ±Infinity for astronomically
 * long digit strings (callers treat non-finite readings as typed
 * fail-closed errors, never silent scores). Throws on malformed input.
 */
export function decimalToNumber(value: DecimalString): number {
  if (!isCanonicalDecimal(value)) {
    throw new DecimalContractError(
      `[learning-objectives] not a canonical decimal string: '${value}'`,
      value,
    );
  }
  return Number(value);
}

/**
 * Render a number as a deterministic decimal-ish string for records
 * (provenance renderings, observed/limit renderings). Never a financial
 * truth — a record rendering only (DOMAIN-MODEL: "Display formatting is
 * never financial truth").
 */
export function renderNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return String(Math.round(value * 1e10) / 1e10);
}
