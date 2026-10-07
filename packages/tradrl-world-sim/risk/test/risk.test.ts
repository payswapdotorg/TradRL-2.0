/**
 * Tests for the W015 `risk` module: the pre-trade gate matrix, the
 * reduce-only position check, and the breach reducer's determinism law
 * (breaches recorded from journaled events only).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 (runtime controls), A9
 * (determinism), spec/REQUIREMENTS.md R024, spec/ACCEPTANCE-WORLD-ALPHA.md
 * C (rejection) + D (risk).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FillId, OrderId, RiskLimits, WorldEventEnvelope } from "tradrl-world-contracts";
import type { OrderFilledPayload } from "../../matching/index.js";
import { initialBookState } from "../../orderbook/index.js";
import type { BookState } from "../../orderbook/index.js";
import type { PositionRecord } from "../../portfolio/index.js";
import type { AccountFinancials, AccountLedger } from "../../account/index.js";
import {
  createReduceOnlyCheck,
  initialRiskRuntimeState,
  projectRiskState,
  reduceRiskEvent,
  runPreTradeRiskGate,
  type RiskRuntimeState,
} from "../index.js";

const TRADER_ACCOUNT = "account-trader";
const INSTRUMENT = "instrument-es-fut";

function ledger(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    accountId: TRADER_ACCOUNT as never,
    balances: { USD: 100000n * 10n ** 12n },
    feesPaid: {},
    leverage: 1,
    baseCurrency: "USD" as never,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
    ...overrides,
  };
}

function financials(overrides: Partial<AccountFinancials> = {}): AccountFinancials {
  return {
    accountId: TRADER_ACCOUNT as never,
    baseCurrency: "USD" as never,
    leverage: 1,
    cash: 100000n * 10n ** 12n,
    realizedPnl: 0n,
    unrealizedPnl: 0n,
    equity: 100000n * 10n ** 12n,
    marginUsed: 0n,
    marginAvailable: 100000n * 10n ** 12n,
    buyingPower: 100000n * 10n ** 12n,
    grossExposure: 0n,
    ...overrides,
  };
}

function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    accountId: TRADER_ACCOUNT as never,
    worldId: "world-w013-tests" as never,
    instrumentId: INSTRUMENT as never,
    quantity: 0n,
    averageEntryPrice: 4800n * 10n ** 12n,
    markPrice: 4800n * 10n ** 12n,
    realizedPnl: 0n,
    unrealizedPnl: 0n,
    quoteCurrency: "USD" as never,
    openedAt: 1_000 as never,
    updatedAt: 1_000 as never,
    ...overrides,
  };
}

function emptyBook(): BookState {
  return initialBookState({
    instrumentId: INSTRUMENT as never,
    worldId: "world-w013-tests" as never,
    venueId: "venue-sim" as never,
    symbol: "ES-TEST",
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
  });
}

function riskState(limits: Record<string, RiskLimits>): RiskRuntimeState {
  return initialRiskRuntimeState({
    declaredLimits: limits,
    accountIds: [TRADER_ACCOUNT],
    initialEquity: { [TRADER_ACCOUNT]: 100000n * 10n ** 12n },
  });
}

function gate(input: {
  limits?: Record<string, RiskLimits>;
  positions?: readonly PositionRecord[];
  financials?: Partial<AccountFinancials>;
  order: Parameters<typeof runPreTradeRiskGate>[0]["order"];
}) {
  return runPreTradeRiskGate({
    risk: riskState(input.limits ?? {}),
    financials: financials(input.financials),
    leverage: 1,
    positions: input.positions ?? [],
    book: emptyBook(),
    order: input.order,
  });
}

test("gate: with no declared limits every gate passes (unset limits are not enforced)", () => {
  const outcome = gate({
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "999999", limitPrice: "4800" },
  });
  assert.deepEqual(outcome, { passed: true, outcomes: [] });
});

test("gate: order-size enforces maxOrderQuantity with typed outcomes", () => {
  const outcome = gate({
    limits: { [TRADER_ACCOUNT]: { maxOrderQuantity: "100" as never } },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "market", side: "buy", quantity: "150" },
  });
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failure, {
    gate: "order-size",
    passed: false,
    limit: "100",
    requested: "150",
    message: outcome.failure?.message,
  });
  assert.match(outcome.failure?.message ?? "", /exceeds maxOrderQuantity 100/);
  // exactly at the limit passes
  const atLimit = gate({
    limits: { [TRADER_ACCOUNT]: { maxOrderQuantity: "100" as never } },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "market", side: "buy", quantity: "100" },
  });
  assert.equal(atLimit.passed, true);
  assert.deepEqual(atLimit.outcomes, [{ gate: "order-size", passed: true }]);
});

test("gate: position-limit projects the signed quantity through the order", () => {
  const limits = { [TRADER_ACCOUNT]: { maxPositionQuantity: "10" as never } };
  // long 6, buy 5 → projected 11 > 10
  const breach = gate({
    limits,
    positions: [position({ quantity: 6n * 10n ** 12n })],
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "5", limitPrice: "4800" },
  });
  assert.equal(breach.passed, false);
  assert.equal(breach.failure?.gate, "position-limit");
  assert.equal(breach.failure?.requested, "11");
  // a reducing sell projects to 0 — passes
  const reduce = gate({
    limits,
    positions: [position({ quantity: 6n * 10n ** 12n })],
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "sell", quantity: "9", limitPrice: "4800" },
  });
  assert.equal(reduce.passed, true);
  // a short opening sell projects -8 → |−8| ≤ 10 passes; -12 fails
  const short = gate({
    limits,
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "sell", quantity: "8", limitPrice: "4800" },
  });
  assert.equal(short.passed, true);
  const tooShort = gate({
    limits,
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "sell", quantity: "12", limitPrice: "4800" },
  });
  assert.equal(tooShort.passed, false);
  assert.equal(tooShort.failure?.requested, "12");
});

test("gate: gross-exposure and leverage size the incremental notional at the reference price", () => {
  const limits = {
    [TRADER_ACCOUNT]: {
      maxGrossExposure: { amount: "50000" as never, currency: "USD" as never },
      maxLeverage: 2,
    },
  };
  // buy 10 @ 4800 → incremental notional 48000 ≤ 50000; leverage 48000/100000 = 0.48 ≤ 2
  const within = gate({
    limits,
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "10", limitPrice: "4800" },
  });
  assert.equal(within.passed, true);
  assert.deepEqual(
    within.outcomes.map((outcome) => outcome.gate),
    ["gross-exposure", "leverage"],
  );
  // buy 11 @ 4800 → 52800 > 50000 breaches gross exposure
  const overGross = gate({
    limits,
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "11", limitPrice: "4800" },
  });
  assert.equal(overGross.passed, false);
  assert.equal(overGross.failure?.gate, "gross-exposure");
  assert.equal(overGross.failure?.requested, "52800");
  // leverage: equity 100000, gross 48000 → fine; shrink the equity and it breaches
  const overLeverage = gate({
    limits,
    financials: { equity: 20000n * 10n ** 12n, marginAvailable: 20000n * 10n ** 12n },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "10", limitPrice: "4800" },
  });
  assert.equal(overLeverage.passed, false);
  assert.equal(overLeverage.failure?.gate, "leverage");
  assert.equal(overLeverage.failure?.requested, "2.4");
  // exhausted equity with open exposure is an infinite leverage breach
  const infinite = gate({
    limits,
    financials: { equity: 0n, marginAvailable: 0n },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "1", limitPrice: "4800" },
  });
  assert.equal(infinite.passed, false);
  assert.equal(infinite.failure?.requested, "∞");
});

test("gate: buying-power floor and drawdown complete the matrix", () => {
  // buying-power floor: after the order the power must stay ≥ the floor
  const floor = gate({
    limits: {
      [TRADER_ACCOUNT]: { minBuyingPowerAfterOrder: { amount: "60000" as never, currency: "USD" as never } },
    },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "10", limitPrice: "4800" },
  });
  assert.equal(floor.passed, false);
  assert.equal(floor.failure?.gate, "buying-power");
  assert.equal(floor.failure?.requested, "52000");
  assert.equal(floor.failure?.limit, "60000");

  // drawdown: equity 90000 vs peak 100000 → drawdown 10000 > 5000 blocks increases
  const drawdownState = riskState({
    [TRADER_ACCOUNT]: { maxDrawdown: { amount: "5000" as never, currency: "USD" as never } },
  });
  // peak equity is seeded at the initial cash (100000); equity is 90000 below
  const blocked = runPreTradeRiskGate({
    risk: drawdownState,
    financials: financials({ equity: 90000n * 10n ** 12n, marginAvailable: 90000n * 10n ** 12n }),
    leverage: 1,
    positions: [],
    book: emptyBook(),
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "1", limitPrice: "4800" },
  });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.failure?.gate, "drawdown");
  assert.equal(blocked.failure?.requested, "10000");
  // a risk-REDUCING order is never refused by the drawdown gate
  const closing = runPreTradeRiskGate({
    risk: drawdownState,
    financials: financials({ equity: 90000n * 10n ** 12n, marginAvailable: 90000n * 10n ** 12n }),
    leverage: 1,
    positions: [position({ quantity: 5n * 10n ** 12n })],
    book: emptyBook(),
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "sell", quantity: "5", limitPrice: "4800" },
  });
  assert.equal(closing.passed, true);
});

test("gate: structurally broken submissions pass through to the venue checks", () => {
  const outcome = gate({
    limits: { [TRADER_ACCOUNT]: { maxOrderQuantity: "100" as never } },
    order: { accountId: TRADER_ACCOUNT, instrumentId: INSTRUMENT, kind: "limit", side: "buy", quantity: "nope", limitPrice: "4800" },
  });
  assert.deepEqual(outcome, { passed: true, outcomes: [] });
});

test("reduce-only: the W014 seam check is directional over real positions", () => {
  const check = createReduceOnlyCheck({
    positions: [position({ quantity: -5n * 10n ** 12n })],
  });
  assert.deepEqual(check({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "buy" }), { wouldIncreasePosition: false });
  assert.deepEqual(check({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "sell" }), { wouldIncreasePosition: true });
  // a flat position: every side would open one
  const flat = createReduceOnlyCheck({ positions: [] });
  assert.deepEqual(flat({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "buy" }), { wouldIncreasePosition: true });
  assert.deepEqual(flat({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "sell" }), { wouldIncreasePosition: true });
  // a long position
  const long = createReduceOnlyCheck({ positions: [position({ quantity: 5n * 10n ** 12n })] });
  assert.deepEqual(long({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "buy" }), { wouldIncreasePosition: true });
  assert.deepEqual(long({ accountId: TRADER_ACCOUNT as never, instrumentId: INSTRUMENT as never, side: "sell" }), { wouldIncreasePosition: false });
});

function fillEnvelope(accountId: string, occurredAt = 1_000): WorldEventEnvelope {
  const payload: OrderFilledPayload = {
    type: "matching.order.filled",
    orderId: "ord:1" as OrderId,
    instrumentId: INSTRUMENT as never,
    accountId: accountId as never,
    fillId: "fil:1" as FillId,
    price: "4800" as never,
    quantity: "1" as never,
    fee: { currency: "USD" as never, amount: "0" as never, liquidity: "taker", rateBps: 0 },
    liquidity: "taker",
    marketRef: { tradeId: "trd:1" as never, sequence: 1 as never },
    cumulativeFilledQuantity: "1" as never,
    status: "filled",
  };
  return {
    worldId: "world-w013-tests" as never,
    sequence: 1 as never,
    eventId: "evt:1" as never,
    eventType: "matching.order.filled",
    occurredAt: occurredAt as never,
    causationId: "cmd:1" as never,
    correlationId: "cmd:1" as never,
    producer: "matching-engine" as never,
    schemaVersion: "tradrl-world-sim.matching@1",
    payload,
  };
}

test("breach reducer: journaled fills crossing a declared limit record exactly one breach", () => {
  const state = riskState({ [TRADER_ACCOUNT]: { maxPositionQuantity: "5" as never } });
  // a fill leaving |position| = 6 > 5 (unreachable through the gate — corrupt
  // journal defense) records the crossing once
  const positions = [position({ quantity: 6n * 10n ** 12n })];
  const breached = reduceRiskEvent(state, fillEnvelope(TRADER_ACCOUNT, 2_000), {
    accounts: { [TRADER_ACCOUNT]: ledger() },
    positions,
  });
  assert.equal(breached.breaches.length, 1);
  assert.deepEqual(
    { gate: breached.breaches[0]?.gate, detail: breached.breaches[0]?.detail, occurredAt: breached.breaches[0]?.occurredAt },
    {
      gate: "position-limit",
      detail: "position quantity 6 exceeds limit 5",
      occurredAt: 2_000,
    },
  );
  // a second fill with the breach persisting records nothing new (episode)
  const still = reduceRiskEvent(breached, fillEnvelope(TRADER_ACCOUNT, 3_000), {
    accounts: { [TRADER_ACCOUNT]: ledger() },
    positions,
  });
  assert.equal(still.breaches.length, 1);
  // recovery clears the episode; a later crossing records a NEW breach
  const recovered = reduceRiskEvent(still, fillEnvelope(TRADER_ACCOUNT, 4_000), {
    accounts: { [TRADER_ACCOUNT]: ledger() },
    positions: [position({ quantity: 4n * 10n ** 12n })],
  });
  const again = reduceRiskEvent(recovered, fillEnvelope(TRADER_ACCOUNT, 5_000), {
    accounts: { [TRADER_ACCOUNT]: ledger() },
    positions,
  });
  assert.equal(again.breaches.length, 2);
  assert.equal(again.breaches[1]?.occurredAt, 5_000);
});

test("breach reducer: non-financial events change nothing; the projection filters per account", () => {
  const state = riskState({ [TRADER_ACCOUNT]: { maxDrawdown: { amount: "5" as never, currency: "USD" as never } } });
  const untouched = reduceRiskEvent(state, {
    eventType: "matching.order.canceled",
    payload: {},
  } as WorldEventEnvelope, { accounts: {}, positions: [] });
  assert.equal(untouched, state);
  const projected = projectRiskState({
    worldId: "world-w013-tests" as never,
    accountId: TRADER_ACCOUNT as never,
    asOf: 5_000 as never,
    risk: state,
  });
  assert.deepEqual(projected, {
    accountId: TRADER_ACCOUNT,
    worldId: "world-w013-tests",
    limits: { maxDrawdown: { amount: "5", currency: "USD" } },
    breaches: [],
    asOf: 5_000,
  });
});
