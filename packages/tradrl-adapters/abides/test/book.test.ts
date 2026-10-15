/**
 * The order-book semantics (W024 `./book.ts`): price-time priority, the
 * two-phase match (plan, then apply), aggregated depth, and crossing
 * detection — the venue core's book laws, in isolation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createLimitOrderBook, type RestingOrder } from "../book.js";
import { abidesInstrument, scaled } from "./fixtures.js";

const instrument = abidesInstrument();

let orderCounter = 0;

function resting(side: "buy" | "sell", price: string, quantity: string): RestingOrder {
  orderCounter += 1;
  return {
    orderId: `o${orderCounter}` as never,
    side,
    price: scaled(price),
    quantity: scaled(quantity),
    accountId: "acct" as never,
    participantId: "p" as never,
    arrivalSeq: orderCounter,
  };
}

test("an empty book serves empty depth and no top of book", () => {
  const book = createLimitOrderBook(instrument);
  assert.deepEqual(book.depth(), { bids: [], asks: [] });
  assert.equal(book.bestBid(), undefined);
  assert.equal(book.bestAsk(), undefined);
  assert.equal(book.restingCount(), 0);
  assert.equal(book.wouldCross("buy", scaled("100.00")), false);
});

test("depth aggregates one price level and reports the order count", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("buy", "99.00", "10"));
  book.place(resting("buy", "99.00", "7"));
  book.place(resting("buy", "98.00", "5"));
  const { bids, asks } = book.depth();
  assert.deepEqual(
    bids.map((level) => ({ price: String(level.price), quantity: String(level.quantity), count: level.orderCount })),
    [
      { price: "99", quantity: "17", count: 2 },
      { price: "98", quantity: "5", count: 1 },
    ],
  );
  assert.deepEqual(asks, []);
  assert.equal(book.bestBid()?.price, scaled("99.00"));
  assert.equal(book.bestBid()?.quantity, scaled("17"));
  assert.equal(book.restingCount(), 3);
});

test("bids descend and asks ascend (the convention)", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("buy", "99.00", "1"));
  book.place(resting("buy", "100.00", "1"));
  book.place(resting("sell", "101.00", "1"));
  book.place(resting("sell", "100.50", "1"));
  assert.deepEqual(book.depth().bids.map((level) => String(level.price)), ["100", "99"]);
  assert.deepEqual(book.depth().asks.map((level) => String(level.price)), ["100.5", "101"]);
});

test("depth truncation keeps only the first N levels per side", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("buy", "99.00", "1"));
  book.place(resting("buy", "98.00", "1"));
  book.place(resting("buy", "97.00", "1"));
  book.place(resting("sell", "101.00", "1"));
  book.place(resting("sell", "102.00", "1"));
  const { bids, asks } = book.depth(2);
  assert.deepEqual(bids.map((level) => String(level.price)), ["99", "98"]);
  assert.deepEqual(asks.map((level) => String(level.price)), ["101", "102"]);
});

test("wouldCross detects a limit that would take liquidity", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("sell", "101.00", "10"));
  assert.equal(book.wouldCross("buy", scaled("101.00")), true);
  assert.equal(book.wouldCross("buy", scaled("100.99")), false);
  book.place(resting("buy", "99.00", "10"));
  assert.equal(book.wouldCross("sell", scaled("99.00")), true);
  assert.equal(book.wouldCross("sell", scaled("99.01")), false);
});

test("planning a match does not mutate the book (two-phase law)", () => {
  const book = createLimitOrderBook(instrument);
  const restingAsk = resting("sell", "101.00", "10");
  book.place(restingAsk);
  const plan = book.planMatch({ side: "buy", quantity: scaled("4"), limitPrice: scaled("101.00") });
  assert.equal(plan.fills.length, 1);
  assert.equal(String(plan.fills[0]?.restingOrderId), String(restingAsk.orderId));
  assert.equal(plan.fills[0]?.price, scaled("101.00"));
  assert.equal(plan.fills[0]?.quantity, scaled("4"));
  assert.equal(plan.remainder, scaled("0"));
  // Nothing moved yet: the resting order is intact.
  assert.equal(book.restingOf(restingAsk.orderId)?.quantity, scaled("10"));
  assert.equal(book.restingCount(), 1);
});

test("PRICE priority: the cheaper ask fills before the dearer one", () => {
  const book = createLimitOrderBook(instrument);
  const dearer = resting("sell", "101.50", "10");
  const cheaper = resting("sell", "101.00", "10");
  book.place(dearer);
  book.place(cheaper);
  const plan = book.planMatch({ side: "buy", quantity: scaled("10"), limitPrice: scaled("101.50") });
  assert.equal(plan.fills.length, 1);
  assert.equal(String(plan.fills[0]?.restingOrderId), String(cheaper.orderId));
  assert.equal(plan.fills[0]?.price, scaled("101.00"));
});

test("TIME priority: at one price the earlier arrival fills first", () => {
  const book = createLimitOrderBook(instrument);
  const earlier = resting("sell", "101.00", "10");
  const later = resting("sell", "101.00", "10");
  book.place(earlier);
  book.place(later);
  const plan = book.planMatch({ side: "buy", quantity: scaled("15") });
  assert.equal(plan.fills.length, 2);
  assert.equal(String(plan.fills[0]?.restingOrderId), String(earlier.orderId));
  assert.equal(plan.fills[0]?.quantity, scaled("10"));
  assert.equal(String(plan.fills[1]?.restingOrderId), String(later.orderId));
  assert.equal(plan.fills[1]?.quantity, scaled("5"));
  assert.equal(plan.remainder, scaled("0"));
});

test("applying a plan removes filled orders and reduces partial ones", () => {
  const book = createLimitOrderBook(instrument);
  const earlier = resting("sell", "101.00", "10");
  const later = resting("sell", "101.00", "10");
  book.place(earlier);
  book.place(later);
  const plan = book.planMatch({ side: "buy", quantity: scaled("15") });
  book.applyFills(plan);
  assert.equal(book.restingCount(), 1);
  assert.equal(book.restingOf(earlier.orderId), undefined);
  assert.equal(book.restingOf(later.orderId)?.quantity, scaled("5"));
  assert.deepEqual(
    book.depth().asks.map((level) => ({ price: String(level.price), quantity: String(level.quantity) })),
    [{ price: "101", quantity: "5" }],
  );
});

test("a market order's plan reports the unfilled remainder (partial fills mandatory)", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("sell", "101.00", "10"));
  const plan = book.planMatch({ side: "buy", quantity: scaled("25") });
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.fills[0]?.quantity, scaled("10"));
  assert.equal(plan.remainder, scaled("15"));
});

test("a limit below the best ask plans nothing (it would rest, not take)", () => {
  const book = createLimitOrderBook(instrument);
  book.place(resting("sell", "101.00", "10"));
  const plan = book.planMatch({ side: "buy", quantity: scaled("10"), limitPrice: scaled("100.99") });
  assert.equal(plan.fills.length, 0);
  assert.equal(plan.remainder, scaled("10"));
});

test("cancel removes a resting order and leaves the rest intact", () => {
  const book = createLimitOrderBook(instrument);
  const one = resting("buy", "99.00", "10");
  const two = resting("buy", "99.00", "6");
  book.place(one);
  book.place(two);
  const removed = book.cancel(one.orderId);
  assert.equal(String(removed?.orderId), String(one.orderId));
  assert.equal(book.cancel(one.orderId), undefined);
  assert.equal(book.restingCount(), 1);
  assert.deepEqual(
    book.depth().bids.map((level) => String(level.quantity)),
    ["6"],
  );
});
