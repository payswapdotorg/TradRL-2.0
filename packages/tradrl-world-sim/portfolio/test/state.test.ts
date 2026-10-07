/**
 * Tests for the portfolio state reducer (W015 `portfolio` module): fills
 * build position ledgers, trade prints re-mark them, and reduction is a
 * pure function of the journal (A6/A9 single-path law).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FillId, OrderId } from "tradrl-world-contracts";
import {
  FINANCIAL_EVENT_TYPES,
  initialPortfolioState,
  isFinancialEventType,
  positionOf,
  reducePortfolioEvent,
  type PortfolioState,
} from "../index.js";
import type { OrderFilledPayload } from "../../matching/index.js";

const ACCOUNT = "account-trader";
const ACCOUNT_B = "account-maker";
const INSTRUMENT = "instrument-es-fut";
const ORDER_BUY: OrderId = "ord:1" as OrderId;
const ORDER_SELL: OrderId = "ord:2" as OrderId;

function filledEnvelope(input: {
  orderId: OrderId;
  accountId: string;
  price: string;
  quantity: string;
  occurredAt?: number;
}): Parameters<typeof reducePortfolioEvent>[1] {
  const payload: OrderFilledPayload = {
    type: "matching.order.filled",
    orderId: input.orderId,
    instrumentId: INSTRUMENT as never,
    accountId: input.accountId as never,
    fillId: `fil:${String(input.orderId)}` as FillId,
    price: input.price as never,
    quantity: input.quantity as never,
    fee: { currency: "USD" as never, amount: "0" as never, liquidity: "taker", rateBps: 0 },
    liquidity: "taker",
    marketRef: { tradeId: "trd:1" as never, sequence: 1 as never },
    cumulativeFilledQuantity: input.quantity as never,
    status: "filled",
  };
  return {
    worldId: "world-w013-tests" as never,
    sequence: 1 as never,
    eventId: "evt:1" as never,
    eventType: "matching.order.filled",
    occurredAt: (input.occurredAt ?? 1_000) as never,
    causationId: "cmd:1" as never,
    correlationId: "cmd:1" as never,
    producer: "matching-engine" as never,
    schemaVersion: "tradrl-world-sim.matching@1",
    payload,
  };
}

function tradePrintEnvelope(input: { price: string; occurredAt?: number; sequence?: number }): Parameters<typeof reducePortfolioEvent>[1] {
  return {
    worldId: "world-w013-tests" as never,
    sequence: (input.sequence ?? 2) as never,
    eventId: "evt:2" as never,
    eventType: "market.trade.printed",
    occurredAt: (input.occurredAt ?? 2_000) as never,
    causationId: "cmd:1" as never,
    correlationId: "cmd:1" as never,
    producer: "matching-engine" as never,
    schemaVersion: "tradrl-world-sim.matching@1",
    payload: {
      type: "market.trade.printed",
      tradeId: "trd:1",
      instrumentId: INSTRUMENT,
      price: input.price,
      quantity: "1",
      aggressorSide: "buy",
    },
  };
}

const sideOf = (orderId: string): "buy" | "sell" =>
  orderId === String(ORDER_BUY) ? "buy" : "sell";

function reduce(state: PortfolioState, envelope: Parameters<typeof reducePortfolioEvent>[1]): PortfolioState {
  const eventType = envelope.eventType;
  const orderSideOf = (orderId: string): "buy" | "sell" => {
    assert.equal(eventType, "matching.order.filled", "side lookups happen for fills");
    return sideOf(orderId);
  };
  return reducePortfolioEvent(state, envelope, orderSideOf);
}

test("the financial event set is the W014 fill + trade-print taxonomy", () => {
  assert.deepEqual(FINANCIAL_EVENT_TYPES, ["matching.order.filled", "market.trade.printed"]);
  assert.equal(isFinancialEventType("matching.order.filled"), true);
  assert.equal(isFinancialEventType("market.trade.printed"), true);
  assert.equal(isFinancialEventType("matching.order.accepted"), false);
  assert.equal(isFinancialEventType("world.annotation.added"), false);
});

test("fills build per-account ledgers; one record per (account, instrument)", () => {
  let state = initialPortfolioState();
  state = reduce(state, filledEnvelope({ orderId: ORDER_BUY, accountId: ACCOUNT, price: "100", quantity: "3" }));
  state = reduce(state, filledEnvelope({ orderId: ORDER_SELL, accountId: ACCOUNT_B, price: "100", quantity: "5", occurredAt: 1_500 }));
  assert.equal(state.positions.length, 2, "two accounts, two ledgers");
  const trader = positionOf(state, ACCOUNT as never, INSTRUMENT as never);
  assert.equal(trader?.quantity, 3n * 10n ** 12n);
  const maker = positionOf(state, ACCOUNT_B as never, INSTRUMENT as never);
  assert.equal(maker?.quantity, -5n * 10n ** 12n);
  // a second fill in the same ledger reuses the record
  state = reduce(state, filledEnvelope({ orderId: ORDER_BUY, accountId: ACCOUNT, price: "101", quantity: "2", occurredAt: 2_000 }));
  assert.equal(state.positions.length, 2);
  assert.equal(positionOf(state, ACCOUNT as never, INSTRUMENT as never)?.quantity, 5n * 10n ** 12n);
});

test("trade prints re-mark every open position of the instrument", () => {
  let state = initialPortfolioState();
  state = reduce(state, filledEnvelope({ orderId: ORDER_BUY, accountId: ACCOUNT, price: "100", quantity: "10" }));
  assert.equal(positionOf(state, ACCOUNT as never, INSTRUMENT as never)?.unrealizedPnl, 0n);
  state = reduce(state, tradePrintEnvelope({ price: "101" }));
  const marked = positionOf(state, ACCOUNT as never, INSTRUMENT as never);
  assert.equal(marked?.unrealizedPnl, 10n * 10n ** 12n, "(101 − 100) × 10");
  assert.equal(marked?.updatedAt, 2_000);
  // a trade print for another instrument changes nothing (shape mismatch on instrument)
  const otherPrint = tradePrintEnvelope({ price: "1", sequence: 3 });
  (otherPrint.payload as { instrumentId: string }).instrumentId = "instrument-other";
  const unchanged = reduce(state, otherPrint);
  assert.equal(unchanged, state, "no records of that instrument — same slice reference");
});

test("non-financial events pass the reducer through untouched", () => {
  const state = initialPortfolioState();
  const envelope = {
    eventType: "matching.order.accepted",
    payload: {},
  } as Parameters<typeof reducePortfolioEvent>[1];
  assert.equal(reducePortfolioEvent(state, envelope, () => "buy"), state);
});
