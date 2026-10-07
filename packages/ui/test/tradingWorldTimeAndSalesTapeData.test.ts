/**
 * Time & Sales tape transform tests (W009) — the pure projection laws.
 *
 * Guards `src/trading-world/orderbook/tapeData.ts`: the tape rows are the
 * engine's own prints verbatim (time/price/size/side, true tradeId/sequence),
 * the display is the exact REVERSE of the journal order (newest print on top)
 * plus a most-recent display window — never a client-side re-sort — and
 * malformed input (out-of-journal-order, malformed decimals, unlawful side)
 * is refused with the typed error (ARCHITECTURE-LOCK A6).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldTimeAndSalesTapeData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  OrderBookProjectionDataError,
} from "../src/trading-world/orderbook/decimalText.js";
import {
  buildTimeAndSalesProjection,
  describeAggressorSide,
  formatTapeTimestampMs,
  type TapeTradePrint,
} from "../src/trading-world/orderbook/tapeData.js";

function print(overrides: Partial<TapeTradePrint> = {}, index: number): TapeTradePrint {
  return {
    tradeId: `trade-${index}`,
    price: "4800.25",
    quantity: "3",
    aggressorSide: index % 2 === 0 ? "buy" : "sell",
    occurredAt: 1_700_000_000_000 + index * 500,
    sequence: 10 + index,
    ...overrides,
  };
}

test("tape rows are the exact reverse of the journal order, verbatim", () => {
  const trades = [print({}, 0), print({}, 1), print({}, 2), print({}, 3), print({}, 4)];
  const tape = buildTimeAndSalesProjection(trades, { maxRows: 10 });
  // Newest first: sequences 14,13,12,11,10 — the reverse of the projection.
  assert.deepEqual(
    tape.rows.map((row) => row.sequence),
    [14, 13, 12, 11, 10],
  );
  // Every value is the projection's own, verbatim — nothing renumbered.
  const newest = tape.rows[0]!;
  assert.equal(newest.tradeId, "trade-4");
  assert.equal(newest.price, "4800.25");
  assert.equal(newest.quantity, "3");
  assert.equal(newest.aggressorSide, "buy");
  assert.equal(newest.occurredAt, 1_700_000_002_000);
  assert.equal(newest.sequence, 14);
  // Counts and ranges reflect the FULL projection.
  assert.equal(tape.totalPrints, 5);
  assert.equal(tape.fromSequence, 10);
  assert.equal(tape.toSequence, 14);
  assert.equal(tape.lastPrice, "4800.25");
});

test("the display window keeps the most recent prints (the tail, never the head)", () => {
  const trades = Array.from({ length: 10 }, (_, index) => print({}, index));
  const tape = buildTimeAndSalesProjection(trades, { maxRows: 3 });
  assert.deepEqual(
    tape.rows.map((row) => row.sequence),
    [19, 18, 17],
  );
  assert.equal(tape.totalPrints, 10);
  assert.equal(tape.fromSequence, 10);
  assert.equal(tape.toSequence, 19);
  // The windowed rows keep their true journal sequence — nothing renumbered.
  assert.ok(tape.rows.every((row) => trades.some((trade) => trade.sequence === row.sequence)));
});

test("equal occurrence times are lawful; out-of-journal-order input is refused", () => {
  const sameTime = [
    print({ occurredAt: 1_700_000_005_000, sequence: 10 }, 0),
    print({ occurredAt: 1_700_000_005_000, sequence: 11 }, 1),
  ];
  assert.doesNotThrow(() => buildTimeAndSalesProjection(sameTime, { maxRows: 5 }));
  // Sequence not strictly ascending — the projection is not in journal order.
  assert.throws(
    () =>
      buildTimeAndSalesProjection(
        [print({ sequence: 12 }, 0), print({ sequence: 11 }, 1)],
        { maxRows: 5 },
      ),
    OrderBookProjectionDataError,
  );
  // Duplicate sequence — not journal order either.
  assert.throws(
    () =>
      buildTimeAndSalesProjection(
        [print({ sequence: 12 }, 0), print({ sequence: 12 }, 1)],
        { maxRows: 5 },
      ),
    OrderBookProjectionDataError,
  );
  // Occurrence time going backwards — not chronological.
  assert.throws(
    () =>
      buildTimeAndSalesProjection(
        [print({ occurredAt: 1_700_000_002_000, sequence: 10 }, 0), print({ occurredAt: 1_700_000_001_000, sequence: 11 }, 1)],
        { maxRows: 5 },
      ),
    OrderBookProjectionDataError,
  );
});

test("malformed prints are refused with the typed error", () => {
  assert.throws(
    () => buildTimeAndSalesProjection([print({ price: "nope" }, 0)], { maxRows: 5 }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildTimeAndSalesProjection([print({ quantity: "1e3" }, 0)], { maxRows: 5 }),
    OrderBookProjectionDataError,
  );
  // An unlawful aggressor side (typed past the print helper on purpose —
  // malformed input must be refused at runtime, not screened out by types).
  assert.throws(
    () =>
      buildTimeAndSalesProjection(
        [{ ...print({}, 0), aggressorSide: "both" as unknown as "buy" }],
        { maxRows: 5 },
      ),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildTimeAndSalesProjection([print({ occurredAt: Number.NaN }, 0)], { maxRows: 5 }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildTimeAndSalesProjection([print({ sequence: Number.POSITIVE_INFINITY }, 0)], { maxRows: 5 }),
    OrderBookProjectionDataError,
  );
  assert.throws(
    () => buildTimeAndSalesProjection([print({ tradeId: "" }, 0)], { maxRows: 5 }),
    OrderBookProjectionDataError,
  );
  assert.throws(() => buildTimeAndSalesProjection([], { maxRows: 0 }), OrderBookProjectionDataError);
  assert.throws(() => buildTimeAndSalesProjection([], { maxRows: 1.5 }), OrderBookProjectionDataError);
});

test("an empty tape projects empty — no invented prints", () => {
  const tape = buildTimeAndSalesProjection([], { maxRows: 5 });
  assert.deepEqual(tape.rows, []);
  assert.equal(tape.totalPrints, 0);
  assert.equal(tape.fromSequence, undefined);
  assert.equal(tape.toSequence, undefined);
  assert.equal(tape.lastPrice, undefined);
});

test("formatTapeTimestampMs is deterministic UTC with milliseconds", () => {
  assert.equal(formatTapeTimestampMs(1_700_000_000_000), "22:13:20.000");
  assert.equal(formatTapeTimestampMs(1_700_000_002_350), "22:13:22.350");
  assert.equal(formatTapeTimestampMs(0), "00:00:00.000");
  assert.throws(() => formatTapeTimestampMs(Number.NaN), OrderBookProjectionDataError);
});

test("aggressor side is labeled as text — never color alone", () => {
  assert.equal(describeAggressorSide("buy"), "BUY");
  assert.equal(describeAggressorSide("sell"), "SELL");
});
