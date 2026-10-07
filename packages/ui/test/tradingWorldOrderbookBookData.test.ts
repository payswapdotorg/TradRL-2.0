/**
 * DOM ladder transform tests (W009) — the pure projection laws.
 *
 * Guards `src/trading-world/orderbook/bookData.ts` + `decimalText.ts`: exact
 * decimal-text arithmetic (no float artifacts), the ladder projection over an
 * `OrderBookSnapshot` (per-level size, cumulative depth, spread/mid derived
 * only from the real top of book), the W003 side-ordering convention
 * (validated, never re-sorted) and the typed refusal on malformed input
 * (ARCHITECTURE-LOCK A6 — a projection invents no facts).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldOrderbookBookData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  addDecimalText,
  compareDecimalParts,
  decimalPlacesOf,
  formatDecimalParts,
  halveDecimalText,
  OrderBookProjectionDataError,
  parseDecimalText,
  subtractDecimalText,
} from "../src/trading-world/orderbook/decimalText.js";
import {
  alphaInstrumentIdForWorld,
  buildDomLadderProjection,
  windowDomLadderSide,
  type BookLevelProjection,
  type OrderBookSnapshotProjection,
} from "../src/trading-world/orderbook/bookData.js";

test("exact decimal arithmetic: canonical text in, canonical text out", () => {
  // The float-artifact proof: 0.1 + 0.2 must be exactly 0.3 as text.
  const sum = addDecimalText(parseDecimalText("0.1", "a"), parseDecimalText("0.2", "b"));
  assert.equal(formatDecimalParts(sum), "0.3");
  assert.equal(
    formatDecimalParts(
      addDecimalText(
        addDecimalText(parseDecimalText("0.1", "a"), parseDecimalText("0.2", "b")),
        parseDecimalText("0.3", "c"),
      ),
    ),
    "0.6",
  );
  // Scale alignment: mixed-precision addition stays exact.
  assert.equal(
    formatDecimalParts(addDecimalText(parseDecimalText("16", "a"), parseDecimalText("0.25", "b"))),
    "16.25",
  );
  // Subtraction and exact halving (the mid-price law: units*5 at scale+1).
  assert.equal(
    formatDecimalParts(subtractDecimalText(parseDecimalText("4800.25", "a"), parseDecimalText("4799.75", "b"))),
    "0.5",
  );
  assert.equal(
    formatDecimalParts(halveDecimalText(addDecimalText(parseDecimalText("4800.25", "a"), parseDecimalText("4800.75", "b")))),
    "4800.5",
  );
  assert.equal(
    formatDecimalParts(halveDecimalText(parseDecimalText("4799.75", "a"))),
    "2399.875",
  );
  // Comparison never goes through a float: exact decimals distinguish values
  // that a double would collapse (0.1 !== 0.10000000000000001 exactly).
  assert.equal(compareDecimalParts(parseDecimalText("4800.25", "a"), parseDecimalText("4800.5", "b")), -1);
  assert.equal(compareDecimalParts(parseDecimalText("0.1", "a"), parseDecimalText("0.10000000000000001", "b")), -1);
  assert.equal(compareDecimalParts(parseDecimalText("0.3", "a"), addDecimalText(parseDecimalText("0.1", "b"), parseDecimalText("0.2", "c"))), 0);
  // Formatting: trailing zeros stripped, negative zero normalized, sign kept.
  assert.equal(formatDecimalParts(parseDecimalText("1.50", "a")), "1.5");
  assert.equal(formatDecimalParts(parseDecimalText("2.0", "a")), "2");
  assert.equal(formatDecimalParts({ units: 0n, scale: 3 }), "0");
  assert.equal(formatDecimalParts(parseDecimalText("-0.50", "a")), "-0.5");
  assert.equal(decimalPlacesOf("4800.25"), 2);
  assert.equal(decimalPlacesOf("16"), 0);
});

test("parseDecimalText rejects malformed decimal text (typed, loud)", () => {
  for (const bad of ["", "abc", "1e3", " 1", "1 ", "+1", "01.5", "1.", ".5", "1..2", "1.2.3"]) {
    assert.throws(
      () => parseDecimalText(bad, "Price"),
      (error: unknown) => error instanceof OrderBookProjectionDataError,
      `expected typed error for ${JSON.stringify(bad)}`,
    );
  }
  // The canonical forms are accepted.
  for (const good of ["0", "16", "4800.25", "0.25", "-0.5", "100000.00"]) {
    assert.doesNotThrow(() => parseDecimalText(good, "Price"));
  }
});

function snapshot(
  overrides: Partial<OrderBookSnapshotProjection> = {},
): OrderBookSnapshotProjection {
  return {
    instrumentId: "instrument-es-world-alpha",
    asOf: 1_700_000_010_000,
    sequence: 42,
    bids: [
      { price: "4799.75", quantity: "16", orderCount: 2 },
      { price: "4799.50", quantity: "4", orderCount: 1 },
      { price: "4799.25", quantity: "6.5", orderCount: 3 },
    ],
    asks: [
      { price: "4800.25", quantity: "10", orderCount: 1 },
      { price: "4800.50", quantity: "0.1", orderCount: 1 },
      { price: "4800.75", quantity: "0.2", orderCount: 1 },
    ],
    ...overrides,
  };
}

test("buildDomLadderProjection projects levels verbatim with exact cumulative depth", () => {
  const ladder = buildDomLadderProjection(snapshot());
  assert.equal(ladder.instrumentId, "instrument-es-world-alpha");
  assert.equal(ladder.asOf, 1_700_000_010_000);
  assert.equal(ladder.sequence, 42);
  assert.equal(ladder.levelCount, 6);
  assert.equal(ladder.priceDisplayPrecision, 2);
  // Bids stay best-first (descending) — the snapshot's order, verbatim.
  assert.deepEqual(
    ladder.bids.levels.map((row) => [row.price, row.quantity, row.orderCount, row.cumulative]),
    [
      ["4799.75", "16", 2, "16"],
      ["4799.50", "4", 1, "20"],
      ["4799.25", "6.5", 3, "26.5"],
    ],
  );
  // Asks stay best-first (ascending) — the snapshot's order, verbatim; the
  // cumulative runs from the best ask outward (exact: 0.1 + 0.2 = 0.3).
  assert.deepEqual(
    ladder.asks.levels.map((row) => [row.price, row.quantity, row.orderCount, row.cumulative]),
    [
      ["4800.25", "10", 1, "10"],
      ["4800.50", "0.1", 1, "10.1"],
      ["4800.75", "0.2", 1, "10.3"],
    ],
  );
  // Side totals are exact sums over ALL levels.
  assert.equal(ladder.bids.totalQuantity, "26.5");
  assert.equal(ladder.asks.totalQuantity, "10.3");
  // Spread/mid derive only from the real best bid/ask (exact arithmetic).
  assert.equal(ladder.bestBid?.price, "4799.75");
  assert.equal(ladder.bestAsk?.price, "4800.25");
  assert.equal(ladder.spread, "0.5");
  assert.equal(ladder.mid, "4800");
});

test("an empty book projects empty — no seeded or guessed levels", () => {
  const ladder = buildDomLadderProjection({
    ...snapshot(),
    bids: [],
    asks: [],
  });
  assert.equal(ladder.levelCount, 0);
  assert.deepEqual(ladder.bids.levels, []);
  assert.deepEqual(ladder.asks.levels, []);
  assert.equal(ladder.bids.totalQuantity, "0");
  assert.equal(ladder.asks.totalQuantity, "0");
  assert.equal(ladder.bestBid, undefined);
  assert.equal(ladder.bestAsk, undefined);
  assert.equal(ladder.spread, undefined);
  assert.equal(ladder.mid, undefined);
});

test("a one-sided book projects its side with no spread (honest absence)", () => {
  const ladder = buildDomLadderProjection({ ...snapshot(), asks: [] });
  assert.equal(ladder.levelCount, 3);
  assert.equal(ladder.bids.levels.length, 3);
  assert.equal(ladder.asks.levels.length, 0);
  assert.equal(ladder.spread, undefined);
  assert.equal(ladder.mid, undefined);
});

test("malformed snapshots are refused with the typed error — never re-sorted, never guessed", () => {
  const badPrice: BookLevelProjection = { price: "not-a-price", quantity: "1" };
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), bids: [badPrice] }),
    OrderBookProjectionDataError,
  );
  // Non-descending bids (snapshot-order violation) — loud, not re-sorted.
  assert.throws(
    () =>
      buildDomLadderProjection({
        ...snapshot(),
        bids: [
          { price: "4799.50", quantity: "1" },
          { price: "4799.75", quantity: "1" },
        ],
      }),
    OrderBookProjectionDataError,
  );
  // Non-ascending asks — loud, not re-sorted.
  assert.throws(
    () =>
      buildDomLadderProjection({
        ...snapshot(),
        asks: [
          { price: "4800.50", quantity: "1" },
          { price: "4800.25", quantity: "1" },
        ],
      }),
    OrderBookProjectionDataError,
  );
  // A crossed book is malformed venue truth.
  assert.throws(
    () =>
      buildDomLadderProjection({
        ...snapshot(),
        bids: [{ price: "4801", quantity: "1" }],
        asks: [{ price: "4800.25", quantity: "1" }],
      }),
    OrderBookProjectionDataError,
  );
  // Negative quantity, malformed quantity, non-finite asOf/sequence, empty id.
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), bids: [{ price: "1", quantity: "-5" }] }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), asks: [{ price: "1", quantity: "1e2" }] }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), asOf: Number.NaN }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), sequence: Number.POSITIVE_INFINITY }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildDomLadderProjection({ ...snapshot(), instrumentId: "" }),
    OrderBookProjectionDataError,
  );
});

test("windowDomLadderSide windows the BEST levels (display batching only)", () => {
  const ladder = buildDomLadderProjection(snapshot());
  const windowed = windowDomLadderSide(ladder.bids, 2);
  assert.deepEqual(
    windowed.map((row) => row.price),
    ["4799.75", "4799.50"],
  );
  assert.equal(windowDomLadderSide(ladder.bids, 99).length, 3);
  assert.throws(() => windowDomLadderSide(ladder.bids, 0), OrderBookProjectionDataError);
  assert.throws(() => windowDomLadderSide(ladder.bids, 1.5), OrderBookProjectionDataError);
});

test("the default instrument id follows the alpha-world convention", () => {
  assert.equal(alphaInstrumentIdForWorld("world-alpha"), "instrument-es-world-alpha");
  assert.equal(alphaInstrumentIdForWorld("world-beta-7"), "instrument-es-world-beta-7");
});
