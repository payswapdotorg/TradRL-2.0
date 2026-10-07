/**
 * Tests for the historical-import validator (W020 `tradrl-data`).
 *
 * Laws under test (spec/WORK-ITEMS.md W020): every violation kind is
 * surfaced loudly with the offending record index — unknown symbol mapping,
 * malformed record, the A7 unavailable-boundary violation, range coverage,
 * declared-gap honesty, out-of-order records, overlapping bars, missing
 * aggressor side, duplicate trade ids, undeclared kinds, invalid
 * descriptors — and NOTHING is ever silently dropped: one pass collects
 * every violation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HistoricalRecord } from "tradrl-world-contracts/data";
import { validateHistoricalImport } from "../validate.js";
import type { DatasetViolation } from "../errors.js";
import {
  ETH_SYMBOL,
  MINUTE,
  SYMBOL_MAP,
  T0,
  aBar,
  aDescriptor,
  aQuote,
  aTrade,
  at,
  happyImportRecords,
  price,
  qty,
} from "./fixtures.js";

function validate(records: readonly HistoricalRecord[], overrides: Partial<Parameters<typeof validateHistoricalImport>[0]> = {}) {
  return validateHistoricalImport({
    worldId: "world-w020-tests" as never,
    descriptor: aDescriptor(),
    records,
    symbolMap: SYMBOL_MAP,
    ...overrides,
  });
}

function kinds(violations: readonly DatasetViolation[]): string[] {
  return violations.map((violation) => violation.kind);
}

test("the happy-path fixture import is valid", () => {
  const result = validate(happyImportRecords());
  assert.deepEqual(result, { ok: true });
});

test("unknown symbol mapping is rejected loudly (both missing and blank)", () => {
  const result = validate([aTrade({ symbol: "DOGE-USD" })]);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unknown-symbol");
  assert.equal(result.violations[0]?.index, 0);

  const blankMap = validate([aTrade()], {
    symbolMap: { "BTC-USD": "" as never },
  });
  assert.ok(!blankMap.ok);
  assert.equal(blankMap.violations[0]?.kind, "unknown-symbol");
  assert.ok(blankMap.violations[0]?.detail.includes("blank"));
});

test("malformed records: non-canonical decimals, blank symbol, bad bar law", () => {
  const result = validate([
    aTrade({ price: price("4800.25.1"), tradeId: undefined }),
    aTrade({ symbol: " " }),
    aBar({ openTime: at(T0 + 10_000), closeTime: at(T0 + 5_000) }),
    aBar({
      symbol: ETH_SYMBOL,
      openTime: at(T0 + 6_000),
      closeTime: at(T0 + 9_000),
      high: price("180.00"),
      open: price("180.10"),
      low: price("180.05"),
      close: price("180.40"),
    }),
    aQuote({ timestamp: at(T0 + 10_000), bid: price("-1") }),
    aTrade({ timestamp: Number.NaN as never, tradeId: undefined }),
  ]);
  assert.ok(!result.ok);
  assert.deepEqual(result.violations.map((violation) => violation.kind), [
    "malformed-record",
    "malformed-record",
    "malformed-record",
    "malformed-record",
    "malformed-record",
    "malformed-record",
  ]);
  assert.ok(result.violations[3]?.detail.includes("inconsistent OHLC"));
});

test("garbage record objects are malformed, never crashes", () => {
  const result = validate([null as never, { kind: "tick" } as never]);
  assert.ok(!result.ok);
  assert.deepEqual(kinds(result.violations), ["malformed-record", "malformed-record"]);
});

test("A7: availableAt before the event-time basis is the unavailable-boundary violation", () => {
  const tradeResult = validate([aTrade({ availableAt: at(T0 - 1) })]);
  assert.ok(!tradeResult.ok);
  assert.equal(tradeResult.violations[0]?.kind, "available-before-occurred");

  // A bar's basis is its closeTime: availability between open and close is
  // still an A7 violation (the bar's close would be observable early).
  const barResult = validate([
    aBar({ availableAt: at(T0 + 30_000) }),
  ]);
  assert.ok(!barResult.ok);
  assert.equal(barResult.violations[0]?.kind, "available-before-occurred");
  assert.ok(barResult.violations[0]?.detail.includes(String(T0 + 60_000)));
});

test("A7 boundary: availableAt exactly at the basis is legal (observable on occurrence)", () => {
  const result = validate([
    aTrade({ availableAt: at(T0 + 500) }),
    aBar({ availableAt: at(T0 + 60_000) }),
  ]);
  assert.deepEqual(result, { ok: true });
});

test("records outside the declared range are rejected (both edges, bars by extent)", () => {
  const result = validate([
    aQuote({ timestamp: at(T0 - 1) }),
    aQuote({ timestamp: at(T0 + 5 * MINUTE + 1) }),
    aBar({ openTime: at(T0 + 4 * MINUTE), closeTime: at(T0 + 5 * MINUTE + 1) }),
  ]);
  assert.ok(!result.ok);
  assert.deepEqual(kinds(result.violations), [
    "record-outside-range",
    "record-outside-range",
    "record-outside-range",
  ]);
});

test("records inside a declared gap contradict the declaration (with boundary laws)", () => {
  const gap = { from: at(T0 + 2 * MINUTE), to: at(T0 + 3 * MINUTE) };
  const result = validate([
    aTrade({ timestamp: at(T0 + 2 * MINUTE + 1), availableAt: at(T0 + 2 * MINUTE + 2) }),
    aBar({ openTime: at(T0 + 90_000), closeTime: at(T0 + 2 * MINUTE + 1) }),
    aBar({ openTime: at(T0 + 2 * MINUTE + 30_000), closeTime: at(T0 + 3 * MINUTE + 30_000) }),
  ]);
  assert.ok(!result.ok);
  assert.deepEqual(kinds(result.violations), [
    "record-in-declared-gap",
    "record-in-declared-gap",
    "record-in-declared-gap",
  ]);

  // Boundary: exactly at gap.to and exactly ending at gap.from are legal
  // (event-time basis order maintained: the bar closes before the quote).
  const boundary = validate([
    aBar({ openTime: at(T0 + MINUTE), closeTime: gap.from }),
    aQuote({ timestamp: at(gap.to) }),
  ]);
  assert.deepEqual(boundary, { ok: true });
});

test("records of an undeclared kind contradict the descriptor", () => {
  const result = validate([aQuote()], {
    descriptor: aDescriptor({ recordKinds: ["bar", "trade"] }),
  });
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "record-kind-undeclared");
});

test("out-of-order records are rejected loudly, never silently reordered", () => {
  const result = validate([
    aTrade({ timestamp: at(T0 + 10_000) }),
    aTrade({ timestamp: at(T0 + 5_000), tradeId: "later" }),
  ]);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "out-of-order-records");
  assert.equal(result.violations[0]?.index, 1);
  assert.ok(result.violations[0]?.detail.includes("sort explicitly"));
});

test("same-timestamp records are legal (ties keep input order)", () => {
  const result = validate([
    aQuote({ timestamp: at(T0) }),
    aTrade({ timestamp: at(T0) }),
  ]);
  assert.deepEqual(result, { ok: true });
});

test("overlapping same-symbol bars are rejected; different symbols may interleave", () => {
  const overlap = validate([
    aBar(),
    aBar({ openTime: at(T0 + 30_000), closeTime: at(T0 + 90_000) }),
  ]);
  assert.ok(!overlap.ok);
  assert.equal(overlap.violations[0]?.kind, "overlapping-bars");

  const duplicate = validate([aBar(), aBar()]);
  assert.ok(!duplicate.ok);
  assert.equal(duplicate.violations[0]?.kind, "overlapping-bars");

  const interleaved = validate([
    aBar(),
    aBar({ symbol: ETH_SYMBOL, openTime: at(T0 + 10_000), closeTime: at(T0 + 60_000) }),
  ]);
  assert.deepEqual(interleaved, { ok: true });
});

test("trades without aggressor side cannot be mapped to the W004 payload", () => {
  const result = validate([aTrade({ aggressorSide: undefined })]);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "missing-aggressor-side");
  assert.ok(result.violations[0]?.detail.includes("never fabricated"));
});

test("duplicate source trade ids are rejected with both indexes", () => {
  const result = validate([
    aTrade({ timestamp: at(T0), tradeId: "dup" }),
    aTrade({ timestamp: at(T0 + 1_000), tradeId: "dup" }),
  ]);
  assert.ok(!result.ok);
  const violation = result.violations[0];
  assert.equal(violation?.kind, "duplicate-trade-id");
  assert.equal(violation?.index, 1);
  assert.ok(violation?.detail.includes("record 0"));
});

test("invalid descriptors surface as invalid-descriptor violations", () => {
  const result = validate([], { descriptor: aDescriptor({ granularity: "" }) });
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "invalid-descriptor");
});

test("one pass collects EVERY violation (never just the first)", () => {
  const result = validate([
    aTrade({ symbol: "DOGE-USD", price: price("oops") }),
    aQuote({ timestamp: at(T0 - 1) }),
    aTrade({ timestamp: at(T0 + 500), tradeId: "fine" }),
  ]);
  assert.ok(!result.ok);
  assert.deepEqual(kinds(result.violations), [
    "unknown-symbol",
    "malformed-record",
    "out-of-order-records",
    "record-outside-range",
  ]);
});

test("empty record sets are valid (an empty import is a legal no-op)", () => {
  assert.deepEqual(validate([]), { ok: true });
});

test("volume must be canonical decimal text", () => {
  const result = validate([aBar({ volume: qty("12,5") })]);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "malformed-record");
  assert.ok(result.violations[0]?.detail.includes("volume"));
});
