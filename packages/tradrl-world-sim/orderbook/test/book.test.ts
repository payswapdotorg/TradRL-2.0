/**
 * Tests for the limit-order book (W014 `orderbook` module): price-time
 * priority, FIFO queue positions, halt/reopen transitions, the snapshot
 * projection and the W004 book-delta diff.
 *
 * Spec: spec/SIMULATION.md "Matching" (price-time priority; deterministic),
 * spec/ARCHITECTURE-LOCK.md A9 (same input stream ⇒ same book state).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Instrument, OrderId, OrderSide, Price } from "tradrl-world-contracts";
import {
  aggressiveLevels,
  bestLevel,
  bookSnapshot,
  diffBookStates,
  findBookOrder,
  haltBook,
  initialBookState,
  placeOrder,
  quantityScaled,
  reduceOrder,
  removeOrder,
  reopenBook,
  withLastTradePrice,
} from "../index.js";

const INSTRUMENT: Instrument = {
  instrumentId: "instrument-es" as Instrument["instrumentId"],
  worldId: "world-book-tests" as Instrument["worldId"],
  venueId: "venue-sim" as Instrument["venueId"],
  symbol: "ES-TEST",
  assetClass: "future",
  quoteCurrency: "USD" as never,
  tickSize: "0.25" as never,
  lotSize: "1" as never,
  pricePrecision: 2,
  quantityPrecision: 0,
  tradingState: "open",
  tradable: true,
};

function place(
  book: ReturnType<typeof initialBookState>,
  orderId: string,
  side: OrderSide,
  price: string,
  remaining: string,
  arrivalSequence: number,
) {
  return placeOrder(book, {
    orderId: orderId as OrderId,
    side,
    price: price as Price,
    remaining: quantityScaled(remaining as never),
    arrivalSequence: arrivalSequence as never,
  });
}

test("initialBookState seeds the trading state from the instrument", () => {
  const book = initialBookState({ ...INSTRUMENT, tradingState: "halted" });
  assert.equal(book.tradingState, "halted");
  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
  assert.equal(book.instrumentId, INSTRUMENT.instrumentId);
});

test("levels stay sorted: bids best-first descending, asks ascending", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "b1", "buy", "4800.25", "5", 1);
  book = place(book, "b2", "buy", "4801.00", "3", 2);
  book = place(book, "b3", "buy", "4800.75", "7", 3);
  book = place(book, "a1", "sell", "4802.25", "4", 4);
  book = place(book, "a2", "sell", "4801.75", "6", 5);
  assert.deepEqual(
    book.bids.map((level) => String(level.price)),
    ["4801", "4800.75", "4800.25"],
  );
  assert.deepEqual(
    book.asks.map((level) => String(level.price)),
    ["4801.75", "4802.25"],
  );
});

test("same-price orders share a level and queue in arrival (FIFO) order", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "first", "buy", "4800.25", "5", 10);
  book = place(book, "second", "buy", "4800.25", "3", 11);
  book = place(book, "third", "buy", "4800.25", "2", 12);
  assert.equal(book.bids.length, 1);
  assert.deepEqual(
    book.bids[0]!.entries.map((entry) => String(entry.orderId)),
    ["first", "second", "third"],
  );
  const located = findBookOrder(book, "second" as OrderId);
  assert.equal(located?.side, "buy");
  assert.equal(String(located?.level.price), "4800.25");
});

test("'4800.25' and '4800.250' are one numeric level with a canonical price", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "a", "sell", "4800.25", "1", 1);
  book = place(book, "b", "sell", "4800.250", "2", 2);
  assert.equal(book.asks.length, 1);
  assert.equal(String(book.asks[0]!.price), "4800.25");
  assert.equal(book.asks[0]!.entries.length, 2);
});

test("reduceOrder applies maker fills, dropping entries and empty levels", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "m1", "sell", "4801.00", "10", 1);
  book = place(book, "m2", "sell", "4801.00", "4", 2);
  // partial fill of m1: 3 of 10
  book = reduceOrder(book, "m1" as OrderId, quantityScaled("3" as never));
  assert.equal(book.asks[0]!.entries[0]!.remaining, quantityScaled("7" as never));
  assert.equal(book.asks[0]!.entries.length, 2);
  // fill m1 fully: entry drops, level survives with m2
  book = reduceOrder(book, "m1" as OrderId, quantityScaled("7" as never));
  assert.deepEqual(
    book.asks[0]!.entries.map((entry) => String(entry.orderId)),
    ["m2"],
  );
  // fill m2 fully: the level disappears
  book = reduceOrder(book, "m2" as OrderId, quantityScaled("4" as never));
  assert.deepEqual(book.asks, []);
  // reducing an unknown order is a no-op, overfill throws
  assert.equal(reduceOrder(book, "ghost" as OrderId, 1n), book);
  book = place(book, "m3", "sell", "4801.00", "2", 3);
  assert.throws(() => reduceOrder(book, "m3" as OrderId, quantityScaled("3" as never)), /book law/);
});

test("removeOrder cancels resting liquidity; unknown orders are no-ops", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "m1", "buy", "4800.00", "10", 1);
  book = place(book, "m2", "buy", "4800.00", "5", 2);
  const before = book;
  assert.equal(removeOrder(book, "ghost" as OrderId), before);
  book = removeOrder(book, "m1" as OrderId);
  assert.deepEqual(
    book.bids[0]!.entries.map((entry) => String(entry.orderId)),
    ["m2"],
  );
  book = removeOrder(book, "m2" as OrderId);
  assert.deepEqual(book.bids, []);
});

test("aggressiveLevels walks the opposite side in priority order up to the limit", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "a1", "sell", "4801.00", "5", 1);
  book = place(book, "a2", "sell", "4801.50", "5", 2);
  book = place(book, "a3", "sell", "4802.00", "5", 3);
  book = place(book, "b1", "buy", "4800.00", "5", 4);
  // a buy with no limit sweeps every ask ascending
  assert.deepEqual(
    aggressiveLevels(book, "buy").map((level) => String(level.price)),
    ["4801", "4801.5", "4802"],
  );
  // limited to 4801.5: the 4802 ask is untouchable
  assert.deepEqual(
    aggressiveLevels(book, "buy", quantityScaled("4801.5" as never)).map((level) =>
      String(level.price),
    ),
    ["4801", "4801.5"],
  );
  // a sell aggressor sweeps bids descending
  assert.deepEqual(
    aggressiveLevels(book, "sell").map((level) => String(level.price)),
    ["4800"],
  );
});

test("bestLevel is the top of each side", () => {
  let book = initialBookState(INSTRUMENT);
  assert.equal(bestLevel(book, "buy"), undefined);
  book = place(book, "b1", "buy", "4800.00", "5", 1);
  book = place(book, "b2", "buy", "4800.50", "5", 2);
  assert.equal(String(bestLevel(book, "buy")?.price), "4800.5");
  assert.equal(bestLevel(book, "sell"), undefined);
});

test("halt/reopen transitions and last-trade recording", () => {
  const book = withLastTradePrice(haltBook(initialBookState(INSTRUMENT)), "4801.25" as never);
  assert.equal(book.tradingState, "halted");
  assert.equal(String(book.lastTradePrice), "4801.25");
  assert.equal(reopenBook(book).tradingState, "open");
  assert.equal(reopenBook(book).lastTradePrice, book.lastTradePrice);
});

test("bookSnapshot aggregates levels with counts and honors depth", () => {
  let book = initialBookState(INSTRUMENT);
  book = place(book, "b1", "buy", "4800.00", "10", 1);
  book = place(book, "b2", "buy", "4800.00", "5", 2);
  book = place(book, "b3", "buy", "4799.75", "3", 3);
  book = place(book, "a1", "sell", "4801.00", "7", 4);
  const snapshot = bookSnapshot(book, { asOf: 1_700_000_000_000 as never, sequence: 42 as never });
  assert.deepEqual(snapshot.bids, [
    { price: "4800", quantity: "15", orderCount: 2 },
    { price: "4799.75", quantity: "3", orderCount: 1 },
  ]);
  assert.deepEqual(snapshot.asks, [{ price: "4801", quantity: "7", orderCount: 1 }]);
  assert.equal(snapshot.sequence, 42);
  const shallow = bookSnapshot(book, { asOf: 0 as never, sequence: 1 as never, depth: 1 });
  assert.equal(shallow.bids.length, 1);
});

test("diffBookStates produces ordered W004 delta operations", () => {
  let before = initialBookState(INSTRUMENT);
  before = place(before, "b1", "buy", "4800.00", "10", 1);
  before = place(before, "a1", "sell", "4801.00", "7", 2);
  before = place(before, "a2", "sell", "4801.50", "4", 3);

  let after = reduceOrder(before, "a1" as OrderId, quantityScaled("2" as never));
  after = removeOrder(after, "a2" as OrderId);
  after = place(after, "b2", "buy", "4800.25", "6", 4);

  assert.deepEqual(diffBookStates(before, before), []);
  assert.deepEqual(diffBookStates(before, after), [
    { op: "set", side: "bid", price: "4800.25", quantity: "6", orderCount: 1 },
    { op: "set", side: "ask", price: "4801", quantity: "5", orderCount: 1 },
    { op: "remove", side: "ask", price: "4801.5" },
  ]);
});

test("determinism: identical operation streams rebuild identical books", () => {
  function build() {
    let book = initialBookState(INSTRUMENT);
    book = place(book, "b1", "buy", "4800.00", "10", 1);
    book = place(book, "b2", "buy", "4800.00", "5", 2);
    book = place(book, "a1", "sell", "4801.00", "7", 3);
    book = reduceOrder(book, "b1" as OrderId, quantityScaled("4" as never));
    book = removeOrder(book, "b2" as OrderId);
    book = withLastTradePrice(book, "4801" as never);
    return book;
  }
  assert.deepEqual(build(), build());
});
