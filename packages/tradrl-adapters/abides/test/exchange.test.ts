/**
 * The exchange-process semantics (W024 `./exchange.ts` + `./orders.ts` +
 * `./matching.ts` + `./ledger.ts`): the four order commands' full lifecycle
 * through the venue — resting, crossing, partial fills, IOC remainders,
 * price-time priority, exact fill economics, the availability law, and the
 * typed-rejection paths (fail-closed outcomes, never silent throws).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createExchangeProcess, type ExchangeProcess, type VenueCommandContext } from "../exchange.js";
import { ABIDES_EVENT_TYPES } from "../events.js";
import type { CommandResult, Order, TimestampMs, Trade } from "tradrl-world-contracts";
import {
  CLOCK_ORIGIN,
  INSTRUMENT_ID,
  NOISE_ACCOUNT,
  NOISE_PARTICIPANT,
  SEED_ACCOUNT,
  SEED_PARTICIPANT,
  abidesWorld,
  cancelCommand,
  replaceCommand,
  scaled,
  submitCommand,
} from "./fixtures.js";

/** A clean venue (no seed orders) driven through the real command path. */
function cleanVenue(): ExchangeProcess {
  return createExchangeProcess(abidesWorld({ seedOrders: [] }));
}

let commandCounter = 0;

function contextOf(exchange: ExchangeProcess, now: number): VenueCommandContext {
  commandCounter += 1;
  return {
    now: now as TimestampMs,
    causationId: `test-${String(commandCounter)}` as never,
    correlationId: `test-${String(commandCounter)}` as never,
    nextStamp: () => exchange.nextStamp(),
  };
}

function rejectionOf(result: CommandResult): { stage: string; code: string; message: string } {
  assert.equal(result.status, "rejected");
  assert.ok(result.rejection !== undefined);
  return result.rejection;
}

function orderOf(exchange: ExchangeProcess, orderId: string): Order {
  const found = exchange.ordersOf(undefined).find((order) => String(order.orderId) === orderId);
  assert.ok(found !== undefined, `order ${orderId} exists`);
  return found;
}

function tradesOf(exchange: ExchangeProcess): readonly Trade[] {
  return exchange.tradesOf(INSTRUMENT_ID, undefined, (CLOCK_ORIGIN + 10_000) as TimestampMs);
}

test("a resting limit is acknowledged, rests, and updates book and quote", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  const outcome = exchange.process(
    submitCommand({ commandId: "c1", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  assert.equal(outcome.result.status, "acked");
  const [order] = exchange.ordersOf({ accountId: SEED_ACCOUNT });
  assert.equal(order?.status, "accepted");
  assert.equal(order?.kind, "limit");
  assert.equal(String(order?.limitPrice), "101.00");
  const book = exchange.bookOf(INSTRUMENT_ID, undefined, now as TimestampMs);
  assert.deepEqual(
    book.asks.map((level) => ({ price: String(level.price), quantity: String(level.quantity), count: level.orderCount })),
    [{ price: "101", quantity: "10", count: 1 }],
  );
  assert.deepEqual(book.bids, []);
  const quote = exchange.quoteOf(INSTRUMENT_ID, now as TimestampMs);
  assert.equal(String(quote.ask), "101");
  assert.equal(String(quote.askSize), "10");
  assert.equal(quote.bid, undefined);
  assert.deepEqual(tradesOf(exchange), []);
});

test("a crossing limit fills fully, prints one trade, and moves the ledger exactly", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  const outcome = exchange.process(
    submitCommand({ commandId: "cross", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  assert.equal(outcome.result.status, "acked");
  assert.equal(orderOf(exchange, "order-2").status, "filled");
  assert.equal(orderOf(exchange, "order-1").status, "filled");
  const trades = tradesOf(exchange);
  assert.equal(trades.length, 1);
  assert.equal(String(trades[0]?.price), "101");
  assert.equal(String(trades[0]?.quantity), "10");
  assert.equal(trades[0]?.aggressorSide, "buy");
  assert.equal(exchange.fillsOf(NOISE_ACCOUNT).length, 1);
  assert.equal(exchange.fillsOf(SEED_ACCOUNT).length, 1);
  const buyer = exchange.portfolioOf(NOISE_ACCOUNT, now as TimestampMs);
  const seller = exchange.portfolioOf(SEED_ACCOUNT, now as TimestampMs);
  assert.equal(scaled(String(buyer.cash.amount)), scaled("998987.50")); // 1,000,000 − 1,010.00 − 2.50 (taker fixed fee)
  assert.equal(scaled(String(seller.cash.amount)), scaled("1001007.50")); // 1,000,000 + 1,010.00 − 2.50 (maker fixed fee)
  assert.deepEqual(
    buyer.positions.map((position) => [String(position.quantity), String(position.averageEntryPrice)]),
    [["10", "101"]],
  );
  assert.deepEqual(
    seller.positions.map((position) => [String(position.quantity), String(position.averageEntryPrice)]),
    [["-10", "101"]],
  );
});

test("a partial aggressor leaves the resting order partially-filled and working", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  exchange.process(
    submitCommand({ commandId: "part", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "4", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  const resting = orderOf(exchange, "order-1");
  assert.equal(resting.status, "partially-filled");
  assert.equal(String(resting.filledQuantity), "4");
  const book = exchange.bookOf(INSTRUMENT_ID, undefined, now as TimestampMs);
  assert.deepEqual(book.asks.map((level) => [String(level.price), String(level.quantity)]), [["101", "6"]]);
  assert.equal(orderOf(exchange, "order-2").status, "filled");
  assert.equal(String(tradesOf(exchange)[0]?.quantity), "4");
});

test("a market order into an empty book is canceled with the IOC remainder", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  const outcome = exchange.process(
    submitCommand({ commandId: "thin-air", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "5" }),
    contextOf(exchange, now),
  );
  assert.equal(outcome.result.status, "acked");
  const order = orderOf(exchange, "order-1");
  assert.equal(order.status, "canceled");
  assert.equal(order.cancelReason, "ioc-remainder");
  assert.deepEqual(tradesOf(exchange), []);
});

test("a market order fills what the book offers and cancels the remainder", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "3", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  exchange.process(
    submitCommand({ commandId: "hit", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "7" }),
    contextOf(exchange, now),
  );
  assert.equal(String(tradesOf(exchange)[0]?.quantity), "3");
  assert.equal(orderOf(exchange, "order-1").status, "filled");
  const aggressor = orderOf(exchange, "order-2");
  assert.equal(aggressor.status, "canceled");
  assert.equal(aggressor.cancelReason, "ioc-remainder");
  assert.equal(String(aggressor.filledQuantity), "3");
  assert.deepEqual(exchange.bookOf(INSTRUMENT_ID, undefined, now as TimestampMs).asks, []);
});

test("price-time priority through the venue: the earlier ask fills first", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "first", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "6", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  exchange.process(
    submitCommand({ commandId: "second", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "6", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  exchange.process(
    submitCommand({ commandId: "take", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "8", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  assert.equal(orderOf(exchange, "order-1").status, "filled");
  const later = orderOf(exchange, "order-2");
  assert.equal(later.status, "partially-filled");
  assert.equal(String(later.filledQuantity), "2");
  assert.deepEqual(
    tradesOf(exchange).map((trade) => String(trade.quantity)),
    ["6", "2"],
  );
});

test("typed rejections: duplicate command, unknown instrument/participant/account/world", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  const valid = submitCommand({ commandId: "c1", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" });
  assert.equal(exchange.process(valid, contextOf(exchange, now)).result.status, "acked");
  const duplicate = rejectionOf(exchange.process(valid, contextOf(exchange, now)).result);
  assert.equal(duplicate.code, "duplicate-command");
  assert.equal(duplicate.stage, "validate");
  assert.equal(
    rejectionOf(
      exchange.process(
        submitCommand({ commandId: "c2", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00", instrumentId: "EQ-9" as never }),
        contextOf(exchange, now),
      ).result,
    ).code,
    "unknown-instrument",
  );
  assert.equal(
    rejectionOf(
      exchange.process(
        submitCommand({ commandId: "c3", issuedBy: "p-ghost" as never, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
        contextOf(exchange, now),
      ).result,
    ).code,
    "unknown-participant",
  );
  assert.equal(
    rejectionOf(
      exchange.process(
        submitCommand({ commandId: "c4", issuedBy: SEED_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
        contextOf(exchange, now),
      ).result,
    ).code,
    "unknown-account",
  );
  assert.equal(
    rejectionOf(
      exchange.process({ ...valid, commandId: "c5" as never, worldId: "world-x" as never }, contextOf(exchange, now)).result,
    ).code,
    "unknown-world",
  );
});

test("cancel laws: unknown order fails, foreign orders fail, own working orders cancel", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  assert.equal(
    rejectionOf(exchange.process(cancelCommand({ commandId: "k1", issuedBy: SEED_PARTICIPANT, orderId: "order-99" }), contextOf(exchange, now)).result).code,
    "unknown-order",
  );
  assert.equal(
    rejectionOf(exchange.process(cancelCommand({ commandId: "k2", issuedBy: NOISE_PARTICIPANT, orderId: "order-1" }), contextOf(exchange, now)).result).code,
    "unauthorized",
  );
  const cancel = exchange.process(cancelCommand({ commandId: "k3", issuedBy: SEED_PARTICIPANT, orderId: "order-1" }), contextOf(exchange, now));
  assert.equal(cancel.result.status, "acked");
  assert.equal(orderOf(exchange, "order-1").status, "canceled");
  assert.deepEqual(exchange.bookOf(INSTRUMENT_ID, undefined, now as TimestampMs).asks, []);
});

test("replace = cancel + fresh successor (priority re-earned, chain recorded)", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  exchange.process(
    submitCommand({ commandId: "another", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  const replaced = exchange.process(replaceCommand({ commandId: "r1", issuedBy: SEED_PARTICIPANT, orderId: "order-1", limitPrice: "102.00" }), contextOf(exchange, now));
  assert.equal(replaced.result.status, "acked");
  const old = orderOf(exchange, "order-1");
  assert.equal(old.status, "replaced");
  assert.ok(old.replacedByOrderId !== undefined);
  const successor = orderOf(exchange, String(old.replacedByOrderId));
  assert.equal(successor.status, "accepted");
  assert.equal(String(successor.limitPrice), "102.00");
  assert.equal(String(successor.quantity), "10");
  assert.deepEqual(
    exchange.bookOf(INSTRUMENT_ID, undefined, now as TimestampMs).asks.map((level) => [String(level.price), String(level.quantity)]),
    [["101", "10"], ["102", "10"]],
  );
});

test("the availability law and the monotonic journal hold on every outcome", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  const rest = exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  const cross = exchange.process(
    submitCommand({ commandId: "cross", issuedBy: NOISE_PARTICIPANT, accountId: NOISE_ACCOUNT, side: "buy", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  for (const outcome of [rest, cross]) {
    let previous = 0;
    for (const event of outcome.events) {
      assert.ok(Number(event.sequence) > previous, "sequences strictly increase");
      previous = Number(event.sequence);
      if (event.availableAt !== undefined) {
        assert.ok(Number(event.availableAt) >= Number(event.occurredAt), "availability never precedes occurrence (A7)");
      }
    }
  }
  const accepted = rest.events[0];
  assert.equal(accepted?.eventType, ABIDES_EVENT_TYPES.orderAccepted);
  assert.equal(Number(accepted?.availableAt), now + 10); // venue acknowledgementMs
  const printed = cross.events.find((event) => event.eventType === ABIDES_EVENT_TYPES.tradePrinted);
  assert.ok(printed !== undefined);
  assert.equal(Number(printed.availableAt), now + 25); // venue fillPropagationMs
  assert.equal(Number(printed.occurredAt), now);
});

test("book depth is served per recipient and the venue exposes its registers", () => {
  const exchange = cleanVenue();
  const now = Number(CLOCK_ORIGIN) + 100;
  exchange.process(
    submitCommand({ commandId: "rest", issuedBy: SEED_PARTICIPANT, accountId: SEED_ACCOUNT, side: "sell", quantity: "10", limitPrice: "101.00" }),
    contextOf(exchange, now),
  );
  const depth1 = exchange.bookOf(INSTRUMENT_ID, 1, now as TimestampMs);
  assert.equal(depth1.asks.length, 1);
  assert.equal(String(exchange.instrumentOf(INSTRUMENT_ID).symbol), "ABD");
  assert.equal(String(exchange.venueConfigOf(INSTRUMENT_ID).venueId), "VX");
  assert.deepEqual(exchange.venueIds.map(String), ["VX"]);
  assert.equal(exchange.accounts.length, 3);
  assert.equal(exchange.participants.length, 3);
});
