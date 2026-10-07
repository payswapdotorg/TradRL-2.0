/**
 * Matching state reducer tests (W014 `matching` module): event laws on
 * replay — legal order transitions, cumulative-quantity monotonicity, the
 * book-delta verification, halt/reopen transitions and the fail-closed
 * behavior for corrupt/foreign journals.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6/A9 (state advances only by reducing
 * journaled events — live and replay share this exact path).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingEventDraft } from "../../journal/eventJournal.js";
import { EngineInvariantError } from "../../world/index.js";
import {
  INSTRUMENT,
  MAKER,
  MAKER_ACCOUNT,
  START,
  TAKER,
  WORLD,
  drive,
  matchingDefinition,
  sealDrafts,
  submitOrder,
  testInstrument,
} from "./helpers.js";
import {
  MATCHING_PRODUCER,
  initialMatchingState,
  reduceMatchingEvent,
} from "../index.js";

function envelopeOf(draft: Partial<PendingEventDraft> & { eventType: string }, sequence: number) {
  const full: PendingEventDraft = {
    occurredAt: START as never,
    causationId: "cmd-x" as never,
    correlationId: "cmd-x" as never,
    producer: MATCHING_PRODUCER,
    schemaVersion: "tradrl-world-sim.matching@1",
    payload: {},
    ...draft,
  };
  return sealDrafts([full], sequence)[0]!;
}

test("initialMatchingState seeds one book per instrument from the definition", () => {
  const definition = matchingDefinition({
    instruments: [
      testInstrument(),
      testInstrument({ instrumentId: "instrument-other" as never, symbol: "OTHER" }),
    ],
  });
  const state = initialMatchingState(definition);
  assert.equal(Object.keys(state.books).length, 2);
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "open");
  assert.deepEqual(state.orders, []);
  assert.deepEqual(state.fills, []);
  assert.deepEqual(state.trades, []);
  assert.deepEqual(state.armedStops, []);
});

test("reducing the same event twice (duplicate order id) is an invariant violation", () => {
  const definition = matchingDefinition();
  const run = drive([submitOrder({ commandId: "cmd-1" as never })]);
  const accepted = run.envelopes[0]!;
  let state = initialMatchingState(definition);
  state = reduceMatchingEvent(state, accepted);
  assert.throws(
    () => reduceMatchingEvent(state, accepted),
    (error: unknown) => {
      assert.ok(error instanceof EngineInvariantError);
      assert.match(error.message, /duplicate order id/);
      return true;
    },
  );
});

test("fills for unknown orders and illegal transitions are invariant violations", () => {
  const definition = matchingDefinition();
  const state = initialMatchingState(definition);
  const ghostFill = envelopeOf(
    {
      eventType: "matching.order.filled",
      payload: {
        type: "matching.order.filled",
        orderId: "ord:world-w014-tests:99",
        instrumentId: INSTRUMENT,
        accountId: MAKER_ACCOUNT,
        fillId: "fil:world-w014-tests:1",
        price: "4801",
        quantity: "1",
        fee: { currency: "USD", amount: "0.1", liquidity: "taker", rateBps: 5 },
        liquidity: "taker",
        marketRef: { tradeId: "trd:world-w014-tests:1", sequence: 2 },
        cumulativeFilledQuantity: "1",
        status: "filled",
      },
    },
    1,
  );
  assert.throws(() => reduceMatchingEvent(state, ghostFill), EngineInvariantError);

  // terminal orders have no outgoing transitions: a second cancel throws
  const run = drive([
    submitOrder({ commandId: "cmd-1" as never }),
    {
      kind: "cancel-order",
      commandId: "cmd-2" as never,
      worldId: WORLD,
      issuedBy: TAKER,
      issuedAt: START as never,
      orderId: "ord:world-w014-tests:1" as never,
    },
  ]);
  let drive_ = initialMatchingState(definition);
  for (const envelope of run.envelopes) drive_ = reduceMatchingEvent(drive_, envelope);
  assert.equal(drive_.orders[0]?.status, "canceled");
  const cancelTwice = envelopeOf(
    {
      eventType: "matching.order.canceled",
      payload: {
        type: "matching.order.canceled",
        orderId: "ord:world-w014-tests:1",
        instrumentId: INSTRUMENT,
        accountId: MAKER_ACCOUNT,
        cancelReason: "user-request",
        remainingQuantity: "10",
      },
    },
    5,
  );
  assert.throws(() => reduceMatchingEvent(drive_, cancelTwice), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /illegal order transition/);
    return true;
  });
});

test("cumulative quantity beyond the order quantity is an invariant violation", () => {
  const definition = matchingDefinition();
  const run = drive([submitOrder({ commandId: "cmd-1" as never })]);
  let state = initialMatchingState(definition);
  for (const envelope of run.envelopes) state = reduceMatchingEvent(state, envelope);
  const overfill = envelopeOf(
    {
      eventType: "matching.order.filled",
      payload: {
        type: "matching.order.filled",
        orderId: "ord:world-w014-tests:1",
        instrumentId: INSTRUMENT,
        accountId: MAKER_ACCOUNT,
        fillId: "fil:world-w014-tests:1",
        price: "4800.25",
        quantity: "11",
        fee: { currency: "USD", amount: "0.1", liquidity: "maker", rateBps: 2 },
        liquidity: "maker",
        marketRef: { tradeId: "trd:world-w014-tests:1", sequence: 3 },
        cumulativeFilledQuantity: "11",
        status: "filled",
      },
    },
    5,
  );
  assert.throws(() => reduceMatchingEvent(state, overfill), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /cumulative quantity/);
    return true;
  });
});

test("matching-produced book deltas must agree with the queue-derived book", () => {
  const definition = matchingDefinition();
  const run = drive([submitOrder({ commandId: "cmd-1" as never })]);
  let state = initialMatchingState(definition);
  const [accepted, delta] = run.envelopes;
  state = reduceMatchingEvent(state, accepted!);
  state = reduceMatchingEvent(state, delta!);
  assert.equal(state.books[String(INSTRUMENT)]?.bids.length, 1);

  // a lying delta (wrong quantity) is journal corruption
  const lying = envelopeOf(
    {
      eventType: "market.book.delta",
      payload: {
        type: "market.book.delta",
        instrumentId: INSTRUMENT,
        operations: [{ op: "set", side: "bid", price: "4800.25", quantity: "999", orderCount: 1 }],
      },
    },
    5,
  );
  assert.throws(() => reduceMatchingEvent(state, lying), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /disagrees with the book/);
    return true;
  });
});

test("foreign book deltas fail closed (W017's surface, not reducible here)", () => {
  const definition = matchingDefinition();
  const state = initialMatchingState(definition);
  const foreign = envelopeOf(
    {
      eventType: "market.book.delta",
      producer: "market-generator" as never,
      payload: {
        type: "market.book.delta",
        instrumentId: INSTRUMENT,
        operations: [],
      },
    },
    1,
  );
  assert.throws(() => reduceMatchingEvent(state, foreign), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /W017/);
    return true;
  });
});

test("market.halted / market.reopened transition the book (instrument and venue scopes)", () => {
  const definition = matchingDefinition();
  const halt = envelopeOf(
    {
      eventType: "market.halted",
      producer: "market-generator" as never,
      payload: {
        type: "market.halted",
        scope: { kind: "instrument", instrumentId: INSTRUMENT },
        reason: "volatility",
      },
    },
    1,
  );
  const reopen = envelopeOf(
    {
      eventType: "market.reopened",
      producer: "market-generator" as never,
      payload: {
        type: "market.reopened",
        scope: { kind: "instrument", instrumentId: INSTRUMENT },
      },
    },
    2,
  );
  let state = reduceMatchingEvent(initialMatchingState(definition), halt);
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "halted");
  state = reduceMatchingEvent(state, reopen);
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "open");

  const venueHalt = envelopeOf(
    {
      eventType: "market.halted",
      producer: "market-generator" as never,
      payload: {
        type: "market.halted",
        scope: { kind: "venue", venueId: "venue-sim" as never },
        reason: "circuit-breaker",
      },
    },
    3,
  );
  state = reduceMatchingEvent(state, venueHalt);
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "halted");
});

test("trade prints update the tape and the last-trade price (stop reference)", () => {
  const run = drive([
    submitOrder({
      commandId: "cmd-1" as never,
      issuedBy: MAKER,
      accountId: MAKER_ACCOUNT,
      submission: {
        kind: "limit",
        side: "sell",
        quantity: "5" as never,
        limitPrice: "4801" as never,
        constraints: { timeInForce: "GTC" },
      },
    }),
    submitOrder({
      commandId: "cmd-2" as never,
      submission: {
        kind: "market",
        side: "buy",
        quantity: "2" as never,
        constraints: { timeInForce: "GTC" },
      },
    }),
  ]);
  const state = run.state;
  assert.equal(state.trades.length, 1);
  assert.equal(String(state.trades[0]?.tradeId), "trd:world-w014-tests:1");
  assert.equal(String(state.books[String(INSTRUMENT)]?.lastTradePrice), "4801");
  assert.equal(state.trades[0]?.aggressorSide, "buy");
  assert.equal(state.trades[0]?.sequence, run.envelopes.find((e) => e.eventType === "market.trade.printed")?.sequence);
});

// --- producer verification (the W014 deferral, delivered with W017) --------------

test("foreign producers cannot forge order lifecycle events or trade prints", () => {
  const definition = matchingDefinition();
  const state = initialMatchingState(definition);
  // a foreign matching.order.accepted (e.g. the market generator pretending
  // to be the venue) is journal corruption — the order lifecycle is the
  // matching engine's alone
  const forgedAccept = envelopeOf(
    {
      eventType: "matching.order.accepted",
      producer: "market-generator" as never,
      payload: {
        type: "matching.order.accepted",
        orderId: "ord:world-w014-tests:1",
        instrumentId: INSTRUMENT,
        accountId: MAKER_ACCOUNT,
        submittedBy: MAKER,
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: "4800",
        constraints: { timeInForce: "GTC" },
        restingQuantity: "1",
        submittedAt: START as never,
      },
    },
    1,
  );
  assert.throws(() => reduceMatchingEvent(state, forgedAccept), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /may not produce/);
    return true;
  });
  // and a foreign trade print never reaches the tape
  const forgedTrade = envelopeOf(
    {
      eventType: "market.trade.printed",
      producer: "market-generator" as never,
      payload: {
        type: "market.trade.printed",
        tradeId: "trd:world-w014-tests:1",
        instrumentId: INSTRUMENT,
        price: "4800",
        quantity: "1",
        aggressorSide: "buy",
      },
    },
    1,
  );
  assert.throws(() => reduceMatchingEvent(state, forgedTrade), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /market\.trade\.printed/);
    return true;
  });
});

test("trading-state transitions accept the matching engine and the market generator, nothing else", () => {
  const definition = matchingDefinition();
  const haltOf = (producer: string, sequence: number) =>
    envelopeOf(
      {
        eventType: "market.halted",
        producer: producer as never,
        payload: {
          type: "market.halted",
          scope: { kind: "instrument", instrumentId: INSTRUMENT },
          reason: "regime",
        },
      },
      sequence,
    );
  // both lawful producers transition the book
  let state = reduceMatchingEvent(initialMatchingState(definition), haltOf("market-generator", 1));
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "halted");
  state = reduceMatchingEvent(initialMatchingState(definition), haltOf("matching-engine", 1));
  assert.equal(state.books[String(INSTRUMENT)]?.tradingState, "halted");
  // anyone else fails closed
  assert.throws(() => reduceMatchingEvent(initialMatchingState(definition), haltOf("rogue-producer", 1)), (error: unknown) => {
    assert.ok(error instanceof EngineInvariantError);
    assert.match(error.message, /may not produce market\.halted/);
    return true;
  });
});
