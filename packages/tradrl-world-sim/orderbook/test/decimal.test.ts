/**
 * Tests for the engine-internal decimal kernel (W014 `orderbook` module).
 *
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — canonical decimal text
 * at the boundary, exact deterministic arithmetic inside (no binary floats).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECIMAL_SCALE,
  formatScaled,
  isCanonicalDecimal,
  isMultipleOf,
  mulDivHalfUp,
  parseScaled,
} from "../index.js";

test("parseScaled accepts canonical decimal text and rejects everything else", () => {
  assert.equal(parseScaled("0"), 0n);
  assert.equal(parseScaled("10"), 10n * 10n ** 12n);
  assert.equal(parseScaled("4800.25"), 480025n * 10n ** 10n);
  assert.equal(parseScaled("0.000000000001"), 1n);
  for (const bad of ["", ".5", "1.", "01", "-1", "+1", "1e3", "1.2.3", "NaN", "1,5"]) {
    assert.throws(() => parseScaled(bad), { message: /not canonical decimal text/ });
  }
  assert.throws(() => parseScaled("0.0000000000001"), {
    message: /fractional digits/,
  });
});

test("isCanonicalDecimal mirrors parseScaled acceptance", () => {
  assert.equal(isCanonicalDecimal("4800.25"), true);
  assert.equal(isCanonicalDecimal("0"), true);
  assert.equal(isCanonicalDecimal("1e3"), false);
  assert.equal(isCanonicalDecimal(4800.25), false);
  assert.equal(isCanonicalDecimal("0.0000000000001"), false);
});

test("formatScaled rounds half-up at the target precision and strips zeros", () => {
  assert.equal(formatScaled(parseScaled("4800.25"), 2), "4800.25");
  assert.equal(formatScaled(parseScaled("2.00"), 2), "2");
  assert.equal(formatScaled(parseScaled("1.50"), 2), "1.5");
  assert.equal(formatScaled(0n, 8), "0");
  // half-up at 2 decimals: 1.005 → 1.01, 1.004 → 1
  assert.equal(formatScaled(parseScaled("1.005"), 2), "1.01");
  assert.equal(formatScaled(parseScaled("1.004"), 2), "1");
  assert.equal(formatScaled(parseScaled("1.999"), 2), "2");
  assert.equal(formatScaled(parseScaled("0.123456789"), 8), "0.12345679");
  assert.equal(formatScaled(parseScaled("0.123456780"), 8), "0.12345678");
});

test("formatScaled with full precision is lossless", () => {
  for (const text of ["1", "4800.25", "0.000000000001", "123456789.123456789"]) {
    assert.equal(formatScaled(parseScaled(text), DECIMAL_SCALE), text);
  }
});

test("mulDivHalfUp rounds the whole expression once (no double rounding)", () => {
  // 2.675 × 10000 / 10000 = 2.675 exactly
  assert.equal(mulDivHalfUp(parseScaled("2.675"), 10000n, 10000n), parseScaled("2.675"));
  // fee-style: notional 3 × 7 bps / 10000 = 0.0021
  assert.equal(
    mulDivHalfUp(parseScaled("3"), 7n, 10000n),
    parseScaled("0.0021"),
  );
  // half-up at the last digit: 1 × 5 / 10000 = 0.0005 exactly
  assert.equal(mulDivHalfUp(parseScaled("1"), 5n, 10000n), parseScaled("0.0005"));
  // 1 × 25 / 100000 = 0.00025 → half-up on the 12-decimal scale keeps it exact
  assert.equal(mulDivHalfUp(parseScaled("1"), 25n, 100000n), parseScaled("0.00025"));
  assert.throws(() => mulDivHalfUp(-1n, 1n, 10n), /non-negative/);
  assert.throws(() => mulDivHalfUp(1n, 1n, 0n), /positive divisor/);
});

test("isMultipleOf implements the tick/lot grid check", () => {
  const tick = parseScaled("0.25");
  assert.equal(isMultipleOf(parseScaled("4800.25"), tick), true);
  assert.equal(isMultipleOf(parseScaled("4800.30"), tick), false);
  assert.equal(isMultipleOf(parseScaled("4800"), tick), true);
  const lot = parseScaled("1");
  assert.equal(isMultipleOf(parseScaled("10"), lot), true);
  assert.equal(isMultipleOf(parseScaled("10.5"), lot), false);
  assert.throws(() => isMultipleOf(1n, 0n), /positive unit/);
});
