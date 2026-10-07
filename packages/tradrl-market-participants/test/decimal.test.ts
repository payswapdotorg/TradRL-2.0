/**
 * The participant decimal kernel laws (W023) — the exact-arithmetic
 * discipline every agent decision is built on: canonical parsing, half-up
 * display rounding, exact tick/lot arithmetic, cross-multiplied ratio
 * comparisons and the display-only ratio text.
 *
 * The two display bugs found during calibration (padStart vs padEnd on the
 * fractional digits; the ratio approximation not placed on the decimal
 * scale) are pinned here as regression laws — display text is never
 * financial truth, but it must still be CORRECT text.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareRatio,
  formatParticipantDecimal,
  lotsOf,
  mulScaled,
  parseParticipantDecimal,
  ratioText,
  tickOffset,
} from "../src/decimal.js";

test("parse: canonical decimal text maps onto the 12-decimal scale", () => {
  assert.equal(parseParticipantDecimal("0"), 0n);
  assert.equal(parseParticipantDecimal("1"), 1_000_000_000_000n);
  assert.equal(parseParticipantDecimal("0.25"), 250_000_000_000n);
  assert.equal(parseParticipantDecimal("4799.75"), 4_799_750_000_000_000n);
  assert.equal(parseParticipantDecimal("4800.25"), 4_800_250_000_000_000n);
  // The regression pin: the fractional digits pad on the RIGHT (they are
  // the low-order scale digits), never the left.
  assert.equal(
    parseParticipantDecimal("0.25"),
    parseParticipantDecimal("0.250000000000"),
  );
});

test("parse: non-canonical text fails loudly (never silently absorbed)", () => {
  for (const bad of ["", "-1", "+1", "01", "1.", ".5", "1e3", "4800,25", "0.1234567890123"]) {
    assert.throws(() => parseParticipantDecimal(bad), `expected rejection: ${bad}`);
  }
});

test("format: half-up rounding at the requested precision, trailing zeros stripped", () => {
  assert.equal(formatParticipantDecimal(0n, 2), "0");
  assert.equal(formatParticipantDecimal(parseParticipantDecimal("4800.75"), 2), "4800.75");
  assert.equal(formatParticipantDecimal(parseParticipantDecimal("4800.50"), 2), "4800.5");
  assert.equal(formatParticipantDecimal(parseParticipantDecimal("2.00"), 0), "2");
  // half-up at 2 decimals: 1.005 → 1.01
  assert.equal(formatParticipantDecimal(parseParticipantDecimal("1.005"), 2), "1.01");
  assert.equal(formatParticipantDecimal(parseParticipantDecimal("1.004"), 2), "1");
  assert.throws(() => formatParticipantDecimal(-1n, 2));
});

test("exact agent arithmetic: tick offsets and integer lots", () => {
  const tick = parseParticipantDecimal("0.25");
  const bid = parseParticipantDecimal("4799.75");
  assert.equal(tickOffset(bid, 2, tick), parseParticipantDecimal("4800.25"));
  assert.equal(tickOffset(bid, -2, tick), parseParticipantDecimal("4799.25"));
  assert.equal(tickOffset(bid, 0, tick), bid);
  const lot = parseParticipantDecimal("1");
  assert.equal(lotsOf(lot, 3), parseParticipantDecimal("3"));
  const halfLot = parseParticipantDecimal("0.5");
  assert.equal(lotsOf(halfLot, 3), parseParticipantDecimal("1.5"));
});

test("mulScaled: scale-preserving multiply is exact for scale-12 operands", () => {
  assert.equal(
    mulScaled(parseParticipantDecimal("4800.25"), parseParticipantDecimal("3")),
    parseParticipantDecimal("14400.75"),
  );
  assert.equal(
    mulScaled(parseParticipantDecimal("0.25"), parseParticipantDecimal("0.5")),
    parseParticipantDecimal("0.125"),
  );
});

test("compareRatio: cross-multiplied comparisons are exact (no division)", () => {
  // 1/3 < 2/5 exactly; 2/6 == 1/3; VWAP-band shapes stay exact.
  assert.equal(compareRatio(1n, 3n, 2n, 5n), -1);
  assert.equal(compareRatio(2n, 6n, 1n, 3n), 0);
  assert.equal(compareRatio(7n, 3n, 2n, 5n), 1);
  assert.throws(() => compareRatio(1n, 0n, 1n, 1n));
});

test("ratioText: exact integer text, else a scale-correct ≈ approximation", () => {
  const tick = parseParticipantDecimal("0.25");
  // Exact: a 2-tick move over a 1-tick unit.
  assert.equal(ratioText(parseParticipantDecimal("0.5"), tick), "2");
  // The regression pin: the approximation is placed on the DECIMAL scale
  // before display (6.588 ticks must display ≈6.59, never ≈0).
  const numerator = 56_000_000_000_000_000_000_000_000n; // dev × 2 × Σqty × scale²
  const denominator = 8_500_000_000_000_000_000_000_000n; // 2 × tick × Σqty × scale²
  assert.equal(ratioText(numerator, denominator), "≈6.59");
  assert.equal(ratioText(0n, tick), "0");
  assert.throws(() => ratioText(1n, 0n));
});
