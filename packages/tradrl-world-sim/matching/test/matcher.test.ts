/**
 * Matching engine unit tests (W014 `matching` module) — the order kind ×
 * TIF × policy matrix of SIMULATION.md "Matching", driven through the typed
 * seam the world core uses. State assertions come from the externally
 * reduced envelopes (exactly what the engine + replay compute).
 *
 * Spec: spec/SIMULATION.md "Matching"; spec/ACCEPTANCE-WORLD-ALPHA.md C
 * (market/limit/cancel/replace/partial fill/complete fill/fees/rejection);
 * spec/DOMAIN-MODEL.md Fill/Execution semantics (the causal law).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Price, Quantity } from "tradrl-world-contracts";
import {
  INSTRUMENT,
  MAKER,
  MAKER_ACCOUNT,
  START,
  TAKER,
  TAKER_ACCOUNT,
  cancelOrder,
  drive,
  eventTypes,
  matchingDefinition,
  replaceOrder,
  submitOrder,
  testInstrument,
  testVenue,
} from "./helpers.js";

function makerSell(price: string, quantity: string, commandId: string, extra = {}) {
  return submitOrder({
    commandId: commandId as never,
    issuedBy: MAKER,
    accountId: MAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: quantity as Quantity,
      limitPrice: price as Price,
      constraints: { timeInForce: "GTC" },
      ...extra,
    },
  });
}

function takerBuy(quantity: string, commandId: string, extra = {}) {
  return submitOrder({
    commandId: commandId as never,
    issuedBy: TAKER,
    accountId: TAKER_ACCOUNT,
    submission: {
      kind: "market",
      side: "buy",
      quantity: quantity as Quantity,
      constraints: { timeInForce: "GTC" },
      ...extra,
    },
  });
}

test("a non-crossing GTC limit rests on the book with a W004 delta", () => {
  const run = drive([makerSell("4801", "10", "cmd-1")]);
  assert.equal(run.outcomes[0]?.kind, "applied");
  assert.deepEqual(eventTypes(run.envelopes), [
    "matching.order.accepted",
    "market.book.delta",
  ]);
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(
    book.asks.map((level) => [String(level.price), String(level.entries[0]?.remaining)]),
    [["4801", "10000000000000"]],
  );
  const delta = run.envelopes[1]?.payload as { operations: unknown[] };
  assert.deepEqual(delta.operations, [
    { op: "set", side: "ask", price: "4801", quantity: "10", orderCount: 1 },
  ]);
  assert.equal(run.state.orders[0]?.status, "accepted");
  assert.equal(String(run.state.orders[0]?.orderId), "ord:world-w014-tests:1");
});

test("a market buy sweeps levels in price-time priority with fees per side", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    makerSell("4801.5", "6", "cmd-2"),
    takerBuy("12", "cmd-3"),
  ]);
  assert.deepEqual(eventTypes(run.envelopes), [
    "matching.order.accepted",
    "market.book.delta",
    "matching.order.accepted",
    "market.book.delta",
    "matching.order.accepted",
    "market.trade.printed",
    "matching.order.filled",
    "matching.order.filled",
    "market.trade.printed",
    "matching.order.filled",
    "matching.order.filled",
    "market.book.delta",
  ]);
  // taker: filled 12/12 across two trades; maker1 filled; maker2 partially filled
  const orders = run.state.orders;
  assert.deepEqual(
    orders.map((order) => [String(order.orderId), order.status, String(order.filledQuantity)]),
    [
      ["ord:world-w014-tests:1", "filled", "10"],
      ["ord:world-w014-tests:2", "partially-filled", "2"],
      ["ord:world-w014-tests:3", "filled", "12"],
    ],
  );
  // fees: taker 5 bps (+0.10 fixed on first fill), maker 2 bps (+0.10 fixed)
  const fills = run.state.fills;
  assert.deepEqual(
    fills.map((fill) => [String(fill.orderId), fill.liquidity, fill.fee.amount, fill.fee.rateBps]),
    [
      ["ord:world-w014-tests:3", "taker", "24.105", 5],
      ["ord:world-w014-tests:1", "maker", "9.702", 2],
      ["ord:world-w014-tests:3", "taker", "4.8015", 5],
      ["ord:world-w014-tests:2", "maker", "2.0206", 2],
    ],
  );
  // the book keeps only the maker2 remainder
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(
    book.asks.map((level) => [String(level.price), String(level.entries[0]?.remaining)]),
    [["4801.5", "4000000000000"]],
  );
  assert.deepEqual(book.bids, []);
});

test("partial fill: a taker consumes part of a maker, both states are honest", () => {
  const run = drive([makerSell("4801", "10", "cmd-1"), takerBuy("4", "cmd-2")]);
  const [maker, taker] = run.state.orders;
  assert.equal(maker?.status, "partially-filled");
  assert.equal(String(maker?.filledQuantity), "4");
  assert.equal(taker?.status, "filled");
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.equal(String(book.asks[0]?.price), "4801");
  assert.equal(String(book.asks[0]?.entries[0]?.remaining), "6000000000000");
});

test("a GTC limit that partially crosses rests its remainder (never takeable)", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "14" as Quantity,
        limitPrice: "4801" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  const taker = run.state.orders[1]!;
  assert.equal(taker.status, "partially-filled");
  assert.equal(String(taker.filledQuantity), "10");
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(book.asks, []);
  assert.deepEqual(
    book.bids.map((level) => [String(level.price), String(level.entries[0]?.remaining)]),
    [["4801", "4000000000000"]],
  );
  // the final book delta reflects the net end-of-batch state
  const delta = run.envelopes[run.envelopes.length - 1]?.payload as { operations: unknown[] };
  assert.deepEqual(delta.operations, [
    { op: "set", side: "bid", price: "4801", quantity: "4", orderCount: 1 },
    { op: "remove", side: "ask", price: "4801" },
  ]);
});

test("market orders never rest: the remainder cancels as ioc-remainder", () => {
  const empty = drive([takerBuy("5", "cmd-1")]);
  assert.deepEqual(eventTypes(empty.envelopes), [
    "matching.order.accepted",
    "matching.order.canceled",
  ]);
  assert.equal(empty.state.orders[0]?.status, "canceled");
  assert.equal(empty.state.orders[0]?.cancelReason, "ioc-remainder");

  const partial = drive([
    makerSell("4801", "10", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "14" as Quantity,
        limitPrice: "4801" as Price,
        constraints: { timeInForce: "IOC" },
      },
    }),
  ]);
  const taker = partial.state.orders[1]!;
  assert.equal(taker.status, "canceled");
  assert.equal(taker.cancelReason, "ioc-remainder");
  assert.equal(String(taker.filledQuantity), "10");
});

test("FOK: all-or-nothing — unfillable rejects the command, fillable fills fully", () => {
  const unfillable = drive([
    makerSell("4801", "10", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "14" as Quantity,
        limitPrice: "4801" as Price,
        constraints: { timeInForce: "FOK" },
      },
    }),
  ]);
  const outcome = unfillable.outcomes[1];
  assert.equal(outcome?.kind, "rejected");
  if (outcome?.kind !== "rejected") return;
  assert.deepEqual(outcome.rejection, {
    stage: "domain-rules",
    code: "fok-unfillable",
    message: outcome.rejection.message,
  });
  assert.equal(unfillable.state.orders.length, 1, "the FOK order never existed");

  const fillable = drive([
    makerSell("4801", "10", "cmd-1"),
    makerSell("4801.5", "4", "cmd-2"),
    submitOrder({
      commandId: "cmd-3" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "14" as Quantity,
        limitPrice: "4801.5" as Price,
        constraints: { timeInForce: "FOK" },
      },
    }),
  ]);
  assert.equal(fillable.state.orders[2]?.status, "filled");
  assert.equal(fillable.state.trades.length, 2);
});

test("post-only: would-take rejects; non-crossing rests; market+post-only always rejects", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "4" as Quantity,
        limitPrice: "4801" as Price,
        constraints: { timeInForce: "GTC", postOnly: true },
      },
    }),
    submitOrder({
      commandId: "cmd-3" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "4" as Quantity,
        limitPrice: "4800.75" as Price,
        constraints: { timeInForce: "GTC", postOnly: true },
      },
    }),
    takerBuy("4", "cmd-4", { constraints: { timeInForce: "GTC", postOnly: true } }),
  ]);
  const codes = run.outcomes.map((outcome) =>
    outcome.kind === "rejected" ? outcome.rejection.code : "applied",
  );
  assert.deepEqual(codes, ["applied", "post-only-would-take", "applied", "post-only-would-take"]);
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(
    book.bids.map((level) => String(level.price)),
    ["4800.75"],
  );
});

test("reduce-only: the typed W015 seam rejects would-increase; absent check is permissive", () => {
  const command = submitOrder({
    commandId: "cmd-1" as never,
    issuedBy: TAKER,
    accountId: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "5" as Quantity,
      limitPrice: "4800.75" as Price,
      constraints: { timeInForce: "GTC", reduceOnly: true },
    },
  });
  const guarded = drive([command], {
    reduceOnlyCheck: () => ({ wouldIncreasePosition: true }),
  });
  assert.deepEqual(
    guarded.outcomes[0]?.kind === "rejected" && guarded.outcomes[0].rejection.code,
    "reduce-only-would-increase-position",
  );
  const permissive = drive([command]);
  assert.equal(permissive.outcomes[0]?.kind, "applied");
});

test("venue gates: halted, non-tradable, unsupported kind, bad tick/lot", () => {
  const halted = drive([takerBuy("5", "cmd-1")], {
    definition: matchingDefinition({
      instruments: [testInstrument({ tradingState: "halted" })],
    }),
  });
  assert.deepEqual(
    halted.outcomes[0]?.kind === "rejected" && halted.outcomes[0].rejection.code,
    "market-halted",
  );

  const closed = drive([takerBuy("5", "cmd-1")], {
    definition: matchingDefinition({
      instruments: [testInstrument({ tradingState: "closed" })],
    }),
  });
  assert.deepEqual(
    closed.outcomes[0]?.kind === "rejected" && closed.outcomes[0].rejection.code,
    "market-closed",
  );

  const untradable = drive([takerBuy("5", "cmd-1")], {
    definition: matchingDefinition({ instruments: [testInstrument({ tradable: false })] }),
  });
  assert.deepEqual(
    untradable.outcomes[0]?.kind === "rejected" && untradable.outcomes[0].rejection.code,
    "instrument-not-tradable",
  );

  const kindless = drive([takerBuy("5", "cmd-1")], {
    definition: matchingDefinition({
      venues: [testVenue({ allowedOrderKinds: ["limit"] })],
    }),
  });
  assert.deepEqual(
    kindless.outcomes[0]?.kind === "rejected" && kindless.outcomes[0].rejection.code,
    "order-kind-not-supported",
  );

  const offTick = drive([
    submitOrder({
      commandId: "cmd-1" as never,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "5" as Quantity,
        limitPrice: "4800.3" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  assert.deepEqual(
    offTick.outcomes[0]?.kind === "rejected" && offTick.outcomes[0].rejection.code,
    "invalid-price",
  );

  const offLot = drive([takerBuy("5.5", "cmd-1")]);
  assert.deepEqual(
    offLot.outcomes[0]?.kind === "rejected" && offLot.outcomes[0].rejection.code,
    "invalid-quantity",
  );
});

test("stops: armed at acceptance, triggered by trades, executed as market", () => {
  const run = drive([
    makerSell("4801.25", "5", "cmd-1"),
    makerSell("4801.5", "5", "cmd-2"),
    submitOrder({
      commandId: "cmd-3" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "stop",
        side: "buy",
        quantity: "3" as Quantity,
        stopPrice: "4801.25" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
    submitOrder({
      commandId: "cmd-4" as never,
      issuedBy: MAKER,
      accountId: MAKER_ACCOUNT,
      submission: {
        kind: "market",
        side: "buy",
        quantity: "5" as Quantity,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  // the stop armed without touching the book
  const stopOrder = run.state.orders[2]!;
  assert.equal(stopOrder.status, "filled", "the stop filled after the trigger");
  assert.equal(String(stopOrder.orderId), "ord:world-w014-tests:3");
  const batch = run.envelopes.filter((envelope) => envelope.causationId === ("cmd-4" as never));
  assert.deepEqual(eventTypes(batch), [
    "matching.order.accepted",
    "market.trade.printed",
    "matching.order.filled",
    "matching.order.filled",
    "matching.order.triggered",
    "market.trade.printed",
    "matching.order.filled",
    "matching.order.filled",
    "market.book.delta",
  ]);
  const triggered = batch.find(
    (envelope) => envelope.eventType === "matching.order.triggered",
  )?.payload as { executionKind: string; triggerPrice: string };
  assert.equal(triggered.executionKind, "market");
  assert.equal(triggered.triggerPrice, "4801.25");
  // the stop consumed the second maker level
  const secondMaker = run.state.orders[1]!;
  assert.equal(secondMaker.status, "partially-filled");
  assert.equal(String(secondMaker.filledQuantity), "3");
});

test("stop-limit: triggered into a non-crossing limit that rests", () => {
  const run = drive([
    makerSell("4801.25", "5", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "stop-limit",
        side: "buy",
        quantity: "5" as Quantity,
        stopPrice: "4801.25" as Price,
        limitPrice: "4800.75" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
    submitOrder({
      commandId: "cmd-3" as never,
      issuedBy: MAKER,
      accountId: MAKER_ACCOUNT,
      submission: {
        kind: "market",
        side: "buy",
        quantity: "2" as Quantity,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  const stopLimit = run.state.orders[1]!;
  assert.equal(stopLimit.status, "accepted");
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(
    book.bids.map((level) => [String(level.price), String(level.entries[0]?.remaining)]),
    [["4800.75", "5000000000000"]],
  );
  assert.deepEqual(
    book.asks.map((level) => String(level.price)),
    ["4801.25"],
  );
});

test("post-only stops reject at trigger time (order-level rejection events)", () => {
  const run = drive([
    makerSell("4801.25", "5", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "stop",
        side: "buy",
        quantity: "3" as Quantity,
        stopPrice: "4801.25" as Price,
        constraints: { timeInForce: "GTC", postOnly: true },
      },
    }),
    submitOrder({
      commandId: "cmd-3" as never,
      issuedBy: MAKER,
      accountId: MAKER_ACCOUNT,
      submission: {
        kind: "market",
        side: "buy",
        quantity: "5" as Quantity,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  const stopOrder = run.state.orders[1]!;
  assert.equal(stopOrder.status, "rejected");
  assert.equal(stopOrder.rejectionReason, "post-only-would-take");
  const rejectedEvent = run.envelopes.find(
    (envelope) => envelope.eventType === "matching.order.rejected",
  );
  assert.ok(rejectedEvent, "the venue rejection is journaled as an event");
});

test("cancel: user-request removes resting liquidity; foreign orders are unauthorized", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    cancelOrder({
      commandId: "cmd-2" as never,
      issuedBy: MAKER,
      orderId: "ord:world-w014-tests:1" as never,
    }),
  ]);
  assert.deepEqual(eventTypes(run.envelopes), [
    "matching.order.accepted",
    "market.book.delta",
    "matching.order.canceled",
    "market.book.delta",
  ]);
  assert.equal(run.state.orders[0]?.status, "canceled");
  assert.equal(run.state.orders[0]?.cancelReason, "user-request");
  assert.deepEqual(run.state.books[String(INSTRUMENT)]!.asks, []);

  const foreign = drive([
    makerSell("4801", "10", "cmd-1"),
    submitOrder({
      commandId: "cmd-2" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "5" as Quantity,
        limitPrice: "4800.75" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
    cancelOrder({
      commandId: "cmd-3" as never,
      orderId: "ord:world-w014-tests:1" as never,
    }),
  ]);
  assert.deepEqual(
    foreign.outcomes[2]?.kind === "rejected" && foreign.outcomes[2].rejection.code,
    "unauthorized",
    "the taker cannot cancel the maker's order",
  );
  assert.equal(foreign.state.orders[0]?.status, "accepted", "the maker order still works");
});

test("replace: cancel-and-replace with a fresh successor order id", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    replaceOrder({
      commandId: "cmd-2" as never,
      issuedBy: MAKER,
      orderId: "ord:world-w014-tests:1" as never,
      quantity: "6" as Quantity,
      limitPrice: "4801.25" as Price,
    }),
  ]);
  assert.deepEqual(eventTypes(run.envelopes), [
    "matching.order.accepted",
    "market.book.delta",
    "matching.order.replaced",
    "matching.order.accepted",
    "market.book.delta",
  ]);
  const [oldOrder, successor] = run.state.orders;
  assert.equal(oldOrder?.status, "replaced");
  assert.equal(String(oldOrder?.replacedByOrderId), "ord:world-w014-tests:2");
  assert.equal(successor?.status, "accepted");
  assert.equal(String(successor?.quantity), "6");
  assert.equal(String(successor?.limitPrice), "4801.25");
  const book = run.state.books[String(INSTRUMENT)]!;
  assert.deepEqual(book.asks.map((level) => String(level.price)), ["4801.25"]);

  // terminal orders are not modifiable; a bad replacement price leaves the old order working
  const replaceRun = drive([
    makerSell("4801", "10", "cmd-1"),
    replaceOrder({
      commandId: "cmd-2" as never,
      issuedBy: MAKER,
      orderId: "ord:world-w014-tests:1" as never,
      limitPrice: "4800.3" as Price,
    }),
  ]);
  assert.deepEqual(
    replaceRun.outcomes[1]?.kind === "rejected" && replaceRun.outcomes[1].rejection.code,
    "invalid-price",
  );
  assert.equal(replaceRun.state.orders[0]?.status, "accepted");

  const terminalRun = drive([
    makerSell("4801", "10", "cmd-1"),
    takerBuy("10", "cmd-2"),
    replaceOrder({
      commandId: "cmd-3" as never,
      issuedBy: MAKER,
      orderId: "ord:world-w014-tests:1" as never,
      quantity: "5" as Quantity,
    }),
  ]);
  assert.deepEqual(
    terminalRun.outcomes[2]?.kind === "rejected" && terminalRun.outcomes[2].rejection.code,
    "order-not-modifiable",
    "a filled order cannot be replaced",
  );
});

test("replace can make the successor cross and fill (same pipeline as submit)", () => {
  const run = drive([
    submitOrder({
      commandId: "cmd-1" as never,
      issuedBy: TAKER,
      accountId: TAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "5" as Quantity,
        limitPrice: "4800.75" as Price,
        constraints: { timeInForce: "GTC" },
      },
    }),
    makerSell("4801", "5", "cmd-2"),
    replaceOrder({
      commandId: "cmd-3" as never,
      issuedBy: MAKER,
      orderId: "ord:world-w014-tests:2" as never,
      limitPrice: "4800.25" as Price,
    }),
  ]);
  const [restingBuy, oldOrder, successor] = run.state.orders;
  assert.equal(restingBuy?.status, "filled");
  assert.equal(String(restingBuy?.filledQuantity), "5");
  assert.equal(oldOrder?.status, "replaced");
  assert.equal(successor?.status, "filled");
  assert.equal(String(successor?.filledQuantity), "5");
  assert.equal(String(successor?.limitPrice), "4800.25");
  assert.equal(run.state.trades.length, 1);
  assert.equal(String(run.state.trades[0]?.price), "4800.75");
});

test("latency policy: acknowledgement and fill-propagation become availableAt delays", () => {
  const definition = matchingDefinition({
    venues: [
      testVenue({
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        feeSchedule: { makerRateBps: 0, takerRateBps: 0 },
      }),
    ],
  });
  const run = drive(
    [makerSell("4801", "10", "cmd-1"), takerBuy("4", "cmd-2")],
    { definition },
  );
  const accepted = run.envelopes.find(
    (envelope) => envelope.eventType === "matching.order.accepted",
  );
  assert.equal(accepted?.occurredAt, START);
  assert.equal(accepted?.availableAt, START + 250);
  const trade = run.envelopes.find((envelope) => envelope.eventType === "market.trade.printed");
  assert.equal(trade?.availableAt, START + 750);
  const fill = run.envelopes.find((envelope) => envelope.eventType === "matching.order.filled");
  assert.equal(fill?.availableAt, START + 750);
  assert.equal(run.state.fills[0]?.availableAt, START + 750);
  // zero-latency venues omit availableAt entirely
  const zero = drive([makerSell("4801", "10", "cmd-1")]);
  assert.equal(zero.envelopes[0]?.availableAt, undefined);
});

test("fill causal law: every fill cites the trade event that generated it", () => {
  const run = drive([
    makerSell("4801", "10", "cmd-1"),
    makerSell("4801.5", "6", "cmd-2"),
    takerBuy("12", "cmd-3"),
  ]);
  const tradesBySequence = new Map(
    run.envelopes
      .filter((envelope) => envelope.eventType === "market.trade.printed")
      .map((envelope) => [envelope.sequence, envelope]),
  );
  assert.equal(run.state.fills.length, 4);
  const fillEnvelopes = new Map(
    run.envelopes.map((envelope) => [String(envelope.eventId), envelope]),
  );
  for (const fill of run.state.fills) {
    const trade = tradesBySequence.get(fill.marketRef.sequence);
    assert.ok(trade, `fill ${String(fill.fillId)} cites a journaled trade`);
    assert.equal(
      String(fill.marketRef.tradeId),
      String((trade.payload as { tradeId: string }).tradeId),
    );
    assert.equal(fill.sequence, fill.marketRef.sequence);
    const own = fill.eventId === undefined ? undefined : fillEnvelopes.get(String(fill.eventId));
    assert.ok(own, "the fill carries the emitting event id");
    assert.ok(
      own !== undefined && own.sequence > trade.sequence,
      "the fill event follows the trade event",
    );
  }
  // the trade ids are dense and deterministic
  assert.deepEqual(
    run.state.trades.map((trade) => String(trade.tradeId)),
    ["trd:world-w014-tests:1", "trd:world-w014-tests:2"],
  );
  assert.deepEqual(
    run.state.fills.map((fill) => String(fill.fillId)),
    [
      "fil:world-w014-tests:1",
      "fil:world-w014-tests:2",
      "fil:world-w014-tests:3",
      "fil:world-w014-tests:4",
    ],
  );
});
