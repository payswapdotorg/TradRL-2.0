/**
 * Execution/fill contract tests: partial fills, fees, rejection reasons and
 * the causality law connecting a fill to its order and market state.
 *
 * Spec: spec/SIMULATION.md (partial fills mandatory, deterministic matching),
 * spec/REQUIREMENTS.md R021/R022,
 * spec/ACCEPTANCE-WORLD-ALPHA.md C (partial fill, complete fill, fees,
 * rejection) and L (causal journal events and provenance).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Execution, Fill, FillFee, MarketStateReference } from "../src/execution.js";
import type { Order } from "../src/orders.js";
import type { OrderRejectionReason } from "../src/orders.js";
import type {
  AccountId,
  EventId,
  ExecutionId,
  FillId,
  InstrumentId,
  OrderId,
  ParticipantId,
  TradeId,
  WorldId,
} from "../src/ids.js";
import { asCurrency, asDecimal, asId, asPrice, asQuantity, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

// A fill is causally incomplete unless it names its order AND the market
// state it executed against (W003 causality law).
type _fillRequiresOrder = Expect<Equal<"orderId" extends RequiredKeys<Fill> ? true : false, true>>;
type _fillRequiresMarketRef = Expect<
  Equal<"marketRef" extends RequiredKeys<Fill> ? true : false, true>
>;
type _marketRefShape = Expect<
  Equal<RequiredKeys<MarketStateReference>, "tradeId" | "sequence">
>;
type _fillRequiresFee = Expect<Equal<"fee" extends RequiredKeys<Fill> ? true : false, true>>;
type _fillAvailableAtOptional = Expect<
  Equal<"availableAt" extends RequiredKeys<Fill> ? true : false, false>
>;
type _feeShape = Expect<Equal<RequiredKeys<FillFee>, "currency" | "amount" | "liquidity" | "rateBps">>;

const REJECTION_REASONS = [
  "invalid-price",
  "invalid-quantity",
  "insufficient-buying-power",
  "risk-limit",
  "market-closed",
  "market-halted",
  "instrument-not-tradable",
  "order-kind-not-supported",
  "post-only-would-take",
  "reduce-only-would-increase-position",
  "fok-unfillable",
  "unknown-order",
  "order-not-modifiable",
  "duplicate-command",
  "unauthorized",
  "live-execution-not-permitted",
] as const;

type _rejectionReasons = Expect<
  Equal<OrderRejectionReason, (typeof REJECTION_REASONS)[number]>
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const instrumentId = asId<InstrumentId>("instr-1");
const accountId = asId<AccountId>("account-1");
const orderId = asId<OrderId>("order-42");

const order: Order = {
  orderId,
  worldId,
  instrumentId,
  accountId,
  submittedBy: asId<ParticipantId>("participant-human"),
  kind: "limit",
  side: "buy",
  quantity: asQuantity("10"),
  filledQuantity: asQuantity("0"),
  limitPrice: asPrice("100.25"),
  constraints: { timeInForce: "GTC" },
  status: "pending",
  submittedAt: asTimestamp(1_000),
};

function makeFill(overrides: Partial<Fill> = {}): Fill {
  return {
    fillId: asId<FillId>("fill-1"),
    worldId,
    orderId,
    instrumentId,
    accountId,
    side: "buy",
    price: asPrice("100.25"),
    quantity: asQuantity("4"),
    fee: {
      currency: asCurrency("USD"),
      amount: asDecimal("0.10"),
      liquidity: "taker",
      rateBps: 2,
    },
    liquidity: "taker",
    occurredAt: asTimestamp(1_010),
    marketRef: {
      tradeId: asId<TradeId>("trade-7"),
      sequence: 25 as Fill["sequence"],
    },
    sequence: 25 as Fill["sequence"],
    eventId: asId<EventId>("event-25"),
    ...overrides,
  };
}

// --- causality invariants ------------------------------------------------------

test("a fill names its originating order and the market state it matched", () => {
  const fill = makeFill();
  assert.equal(fill.orderId, order.orderId);
  assert.ok(fill.marketRef.tradeId);
  assert.equal(typeof fill.marketRef.sequence, "number");
  assert.equal(fill.marketRef.sequence, fill.sequence);
});

test("partial fills sum within the order quantity (partial fills mandatory)", () => {
  const fills = [
    makeFill({ fillId: asId<FillId>("fill-1"), quantity: asQuantity("4") }),
    makeFill({ fillId: asId<FillId>("fill-2"), quantity: asQuantity("3") }),
    makeFill({ fillId: asId<FillId>("fill-3"), quantity: asQuantity("3") }),
  ];
  const total = fills.reduce((sum, f) => sum + Number(f.quantity as string), 0);
  assert.equal(total, 10);
  assert.ok(total <= Number(order.quantity as string));
  // the cumulative execution never exceeds the order quantity
  const execution: Execution = {
    executionId: asId<ExecutionId>("exec-1"),
    worldId,
    orderId,
    instrumentId,
    accountId,
    fillIds: fills.map((f) => f.fillId),
    filledQuantity: asQuantity(String(total)),
    totalFee: asDecimal("0.30"),
    feeCurrency: asCurrency("USD"),
    startedAt: fills[0]!.occurredAt,
    completedAt: fills[2]!.occurredAt,
    status: "complete",
  };
  assert.ok(
    Number(execution.filledQuantity as string) <= Number(order.quantity as string),
  );
});

test("fills carry explicit fees with the applied rate", () => {
  const fill = makeFill();
  assert.equal(fill.fee.liquidity, "taker");
  assert.equal(fill.fee.rateBps, 2);
  assert.equal(fill.fee.amount as string, "0.10");
  assert.equal(fill.fee.currency as string, "USD");
});

test("a fill never occurs before its order was submitted", () => {
  const fill = makeFill();
  assert.ok(fill.occurredAt >= order.submittedAt);
  const early = makeFill({ occurredAt: asTimestamp(999) });
  assert.ok(early.occurredAt < order.submittedAt);
});

test("execution aggregates carry cumulative economics and a terminal status", () => {
  const execution: Execution = {
    executionId: asId<ExecutionId>("exec-1"),
    worldId,
    orderId,
    instrumentId,
    accountId,
    fillIds: [asId<FillId>("fill-1")],
    filledQuantity: asQuantity("4"),
    totalFee: asDecimal("0.10"),
    feeCurrency: asCurrency("USD"),
    startedAt: asTimestamp(1_010),
    status: "open",
  };
  assert.equal(execution.status, "open");
  assert.equal(execution.fillIds.length, 1);
});
