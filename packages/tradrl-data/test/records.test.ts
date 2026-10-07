/**
 * Tests for the pure record helpers (W020 `tradrl-data`): the event-time
 * basis law (A7 — a bar is an interval fact, complete at close), the record
 * time extent, the canonical-decimal text law (parity with the W014 kernel),
 * exact decimal comparison (no binary floats) and the explicit deterministic
 * sort.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCanonicalDecimal } from "tradrl-world-sim/orderbook";
import {
  compareCanonicalDecimalText,
  historicalRecordEventTime,
  historicalRecordExtent,
  isCanonicalDecimalText,
  isHistoricalBarRecord,
  isHistoricalQuoteRecord,
  isHistoricalTradeRecord,
  sortHistoricalRecords,
} from "../records.js";
import { aBar, aQuote, aTrade, at, T0 } from "./fixtures.js";

test("event-time basis: bar → closeTime, trade/quote → timestamp (verbatim fields)", () => {
  const bar = aBar({ openTime: at(T0), closeTime: at(T0 + 60_000) });
  assert.equal(historicalRecordEventTime(bar), T0 + 60_000);
  const trade = aTrade({ timestamp: at(T0 + 123) });
  assert.equal(historicalRecordEventTime(trade), T0 + 123);
  const quote = aQuote({ timestamp: at(T0 + 456) });
  assert.equal(historicalRecordEventTime(quote), T0 + 456);
});

test("extent: bars carry their interval; point records collapse to the instant", () => {
  assert.deepEqual(historicalRecordExtent(aBar()), {
    from: T0,
    to: T0 + 60_000,
  });
  assert.deepEqual(historicalRecordExtent(aTrade()), { from: T0 + 500, to: T0 + 500 });
  assert.deepEqual(historicalRecordExtent(aQuote()), { from: T0, to: T0 });
});

test("kind guards discriminate the record union", () => {
  assert.equal(isHistoricalBarRecord(aBar()), true);
  assert.equal(isHistoricalTradeRecord(aBar()), false);
  assert.equal(isHistoricalTradeRecord(aTrade()), true);
  assert.equal(isHistoricalQuoteRecord(aTrade()), false);
  assert.equal(isHistoricalQuoteRecord(aQuote()), true);
  assert.equal(isHistoricalBarRecord(aQuote()), false);
});

test("canonical decimal text law: the W003 contract boundary", () => {
  const valid = ["0", "1", "4800.25", "0.5", "12.000000000001"];
  const invalid = ["-1", "+1", "01", "1.", ".5", "1e5", "4800,25", "", "1.0000000000001", 42];
  for (const text of valid) {
    assert.equal(isCanonicalDecimalText(text), true, `expected valid: '${String(text)}'`);
  }
  for (const text of invalid) {
    assert.equal(isCanonicalDecimalText(text), false, `expected invalid: '${String(text)}'`);
  }
});

test("decimal text law parity with the W014 engine kernel (isCanonicalDecimal)", () => {
  const corpus = [
    "0",
    "1",
    "4800.25",
    "0.000000000001",
    "0.0000000000001",
    "007",
    "-0.5",
    "1.",
    "9007199254740993",
    "",
    "1.500",
  ];
  for (const text of corpus) {
    assert.equal(
      isCanonicalDecimalText(text),
      isCanonicalDecimal(text),
      `parity divergence at '${text}'`,
    );
  }
});

test("exact decimal comparison: no binary floats anywhere", () => {
  assert.equal(compareCanonicalDecimalText("1.5", "1.50"), 0);
  assert.equal(compareCanonicalDecimalText("0", "0.0"), 0);
  assert.ok(compareCanonicalDecimalText("9", "10") < 0);
  assert.ok(compareCanonicalDecimalText("10", "9") > 0);
  assert.ok(compareCanonicalDecimalText("9.9", "10") < 0);
  assert.ok(compareCanonicalDecimalText("1.000000000001", "1") > 0);
  assert.ok(compareCanonicalDecimalText("1.0000000000009", "1.000000000001") < 0);
  assert.ok(compareCanonicalDecimalText("0.1", "0.100000000001") < 0);
  // Exactness beyond float64 precision:
  assert.ok(
    compareCanonicalDecimalText("9007199254740993", "9007199254740992") > 0,
  );
});

test("sortHistoricalRecords sorts by event-time basis and never mutates the input", () => {
  const barLate = aBar({ openTime: at(T0 + 120_000), closeTime: at(T0 + 180_000) });
  const tradeEarly = aTrade({ timestamp: at(T0 + 10) });
  const quoteMid = aQuote({ timestamp: at(T0 + 90_000) });
  const input = [barLate, tradeEarly, quoteMid];
  const sorted = sortHistoricalRecords(input);
  assert.deepEqual(
    sorted.map((record) => record.kind),
    ["trade", "quote", "bar"],
  );
  assert.deepEqual(
    input.map((record) => record.kind),
    ["bar", "trade", "quote"],
    "the input array is untouched",
  );
});

test("sortHistoricalRecords is stable on event-time ties (input order preserved)", () => {
  const first = aQuote({ timestamp: at(T0 + 1_000) });
  const second = aTrade({ timestamp: at(T0 + 1_000) });
  const third = aBar({ openTime: at(T0), closeTime: at(T0 + 1_000) });
  const sorted = sortHistoricalRecords([third, first, second]);
  assert.deepEqual(
    sorted.map((record) => record.kind),
    ["bar", "quote", "trade"],
  );
  assert.equal(sorted[0], third);
  assert.equal(sorted[1], first);
  assert.equal(sorted[2], second);
});

test("sortHistoricalRecords is a pure identity on empty input", () => {
  assert.deepEqual(sortHistoricalRecords([]), []);
});
