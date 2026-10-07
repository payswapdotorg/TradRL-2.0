/**
 * Tests for the W015 `account` module: the ledger reducer (fees), the
 * margin/buying-power math and the order acceptance checks.
 *
 * Spec: spec/ARCHITECTURE.md §5 (Account), spec/ARCHITECTURE-LOCK.md A13
 * (runtime gates), spec/DOMAIN-MODEL.md "Financial precision" — every
 * expected value is a hand-computed exact decimal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FillId, OrderId, WorldEventEnvelope } from "tradrl-world-contracts";
import {
  checkOrderAcceptance,
  computeAccountFinancials,
  initialAccountLedgerState,
  ledgerOf,
  marginForPosition,
  projectAccount,
  reduceAccountLedgerEvent,
  worstCaseMarketPrice,
  type AccountLedgerState,
} from "../index.js";
import type { OrderFilledPayload } from "../../matching/index.js";
import { initialBookState, type BookState } from "../../orderbook/index.js";
import type { PositionRecord } from "../../portfolio/index.js";
import type { Instrument } from "tradrl-world-contracts";
import type { WorldDefinition } from "../../world/definition.js";

const TRADER_ACCOUNT = "account-trader";
const OTHER_ACCOUNT = "account-other";
const INSTRUMENT = "instrument-es-fut";

function definition(): WorldDefinition {
  return {
    scope: { tenantId: "t", projectId: "p", worldId: "world-w013-tests" } as never,
    mode: "reactive-replay",
    seed: "s",
    worldDefinitionVersion: "v1",
    inputDataSource: "synthetic://test",
    clock: { start: 0 as never, initialWallTime: 0 as never },
    instruments: [],
    accounts: [
      {
        accountId: TRADER_ACCOUNT as never,
        worldId: "world-w013-tests" as never,
        balances: { USD: { amount: "100000" as never, currency: "USD" as never } } as never,
        buyingPower: { amount: "100000" as never, currency: "USD" as never },
        marginUsed: { amount: "0" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
      {
        accountId: OTHER_ACCOUNT as never,
        worldId: "world-w013-tests" as never,
        balances: { USD: { amount: "1000" as never, currency: "USD" as never } } as never,
        buyingPower: { amount: "1000" as never, currency: "USD" as never },
        marginUsed: { amount: "0" as never, currency: "USD" as never },
        marginAvailable: { amount: "1000" as never, currency: "USD" as never },
        leverage: 2,
        permissions: { canTrade: true, canShort: false, liveExecutionAllowed: false },
      },
    ],
    participants: [],
  } as unknown as WorldDefinition;
}

function fillEnvelope(input: {
  accountId: string;
  feeAmount?: string;
  feeCurrency?: string;
}): WorldEventEnvelope {
  const payload: OrderFilledPayload = {
    type: "matching.order.filled",
    orderId: "ord:1" as OrderId,
    instrumentId: INSTRUMENT as never,
    accountId: input.accountId as never,
    fillId: "fil:1" as FillId,
    price: "4800.25" as never,
    quantity: "1" as never,
    fee: {
      currency: (input.feeCurrency ?? "USD") as never,
      amount: (input.feeAmount ?? "0") as never,
      liquidity: "taker",
      rateBps: 5,
    },
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
    occurredAt: 1_000 as never,
    causationId: "cmd:1" as never,
    correlationId: "cmd:1" as never,
    producer: "matching-engine" as never,
    schemaVersion: "tradrl-world-sim.matching@1",
    payload,
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

function testInstrument(): Instrument {
  return {
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
  };
}

test("the initial ledger state carries declared balances, leverage and permissions", () => {
  const state = initialAccountLedgerState(definition());
  const trader = ledgerOf(state, TRADER_ACCOUNT as never);
  assert.equal(trader?.balances["USD"], 100000n * 10n ** 12n);
  assert.equal(trader?.leverage, 1);
  assert.equal(trader?.permissions.liveExecutionAllowed, false);
  assert.equal(trader?.baseCurrency, "USD");
  const other = ledgerOf(state, OTHER_ACCOUNT as never);
  assert.equal(other?.leverage, 2);
  assert.equal(other?.permissions.canShort, false);
  assert.equal(ledgerOf(state, "account-ghost" as never), undefined);
});

test("fills charge their fee against the matching currency balance", () => {
  let state: AccountLedgerState = initialAccountLedgerState(definition());
  state = reduceAccountLedgerEvent(state, fillEnvelope({ accountId: TRADER_ACCOUNT, feeAmount: "2.40000005" }));
  const trader = ledgerOf(state, TRADER_ACCOUNT as never);
  assert.equal(trader?.balances["USD"], 100000n * 10n ** 12n - 2_400_000_050_000n);
  assert.equal(trader?.feesPaid["USD"], 2_400_000_050_000n);
  // zero fees are a no-op (same slice reference)
  const untouched = reduceAccountLedgerEvent(state, fillEnvelope({ accountId: TRADER_ACCOUNT, feeAmount: "0" }));
  assert.equal(untouched, state);
  // non-financial events pass through
  const passthrough = reduceAccountLedgerEvent(state, {
    eventType: "matching.order.canceled",
    payload: {},
  } as WorldEventEnvelope);
  assert.equal(passthrough, state);
  // a fee in a currency the account never held starts from zero (honest books)
  const foreign = reduceAccountLedgerEvent(state, fillEnvelope({ accountId: TRADER_ACCOUNT, feeAmount: "1", feeCurrency: "EUR" }));
  const after = ledgerOf(foreign, TRADER_ACCOUNT as never);
  assert.equal(after?.balances["EUR"], -1n * 10n ** 12n);
  assert.equal(after?.balances["USD"], trader?.balances["USD"]);
});

test("a fill for an undeclared account fails closed (corrupt journal)", () => {
  const state = initialAccountLedgerState(definition());
  assert.throws(
    () => reduceAccountLedgerEvent(state, fillEnvelope({ accountId: "account-ghost" })),
    /unknown account/,
  );
});

test("margin math: |qty| × mark / leverage with one rounding", () => {
  const SCALE = 10n ** 12n;
  // 10 × 4800 / 1 = 48000
  assert.equal(marginForPosition(10n * SCALE, 4800n * SCALE, 1), 48000n * SCALE);
  // 10 × 4800 / 2 = 24000
  assert.equal(marginForPosition(10n * SCALE, 4800n * SCALE, 2), 24000n * SCALE);
  // zero quantity needs no margin
  assert.equal(marginForPosition(0n, 4800n * SCALE, 1), 0n);
});

test("account financials: equity = cash + realized + unrealized; margin and power follow", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  // long 10 @ 4800 marked 4900: unrealized +1000, margin 48000
  const financials = computeAccountFinancials(ledger, [
    position({ quantity: 10n * 10n ** 12n, unrealizedPnl: 1000n * 10n ** 12n }),
    position({
      instrumentId: "instrument-other" as never,
      quantity: 0n,
      realizedPnl: 250n * 10n ** 12n, // closed record contributes realized only
    }),
  ]);
  assert.equal(financials.cash, 100000n * 10n ** 12n);
  assert.equal(financials.realizedPnl, 250n * 10n ** 12n);
  assert.equal(financials.unrealizedPnl, 1000n * 10n ** 12n);
  assert.equal(financials.equity, 101250n * 10n ** 12n);
  assert.equal(financials.marginUsed, 48000n * 10n ** 12n);
  assert.equal(financials.marginAvailable, 53250n * 10n ** 12n);
  assert.equal(financials.buyingPower, 53250n * 10n ** 12n, "leverage 1: power = available margin");
  assert.equal(financials.grossExposure, 48000n * 10n ** 12n);
  // leverage 2 halves the margin and doubles the power
  const leveraged = ledgerOf(state, OTHER_ACCOUNT as never)!;
  const other = computeAccountFinancials(leveraged, [
    position({ quantity: 10n * 10n ** 12n, unrealizedPnl: 0n }),
  ]);
  assert.equal(other.marginUsed, 24000n * 10n ** 12n);
  assert.equal(other.marginAvailable, (1000n - 24000n) * 10n ** 12n, "negative availability is honest, never floored");
  assert.equal(other.buyingPower, (1000n - 24000n) * 2n * 10n ** 12n);
});

test("the W003 Account projection carries balances and derived margin figures", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  const projected = projectAccount(ledger, financials, "world-w013-tests" as never);
  assert.equal(projected.accountId, TRADER_ACCOUNT);
  assert.deepEqual(projected.balances["USD" as never], { amount: "100000", currency: "USD" });
  assert.deepEqual(projected.buyingPower, { amount: "100000", currency: "USD" });
  assert.deepEqual(projected.marginUsed, { amount: "0", currency: "USD" });
  assert.deepEqual(projected.marginAvailable, { amount: "100000", currency: "USD" });
  assert.equal(projected.leverage, 1);
  assert.deepEqual(projected.permissions, { canTrade: true, canShort: true, liveExecutionAllowed: false });
});

function emptyBook(): BookState {
  return initialBookState(testInstrument());
}

test("acceptance: an opening order sized within margin accepts", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  const outcome = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book: emptyBook(),
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "buy",
      quantity: "10",
      limitPrice: "4800",
    },
  });
  assert.deepEqual(outcome, { accepted: true });
});

test("acceptance: an oversized order rejects insufficient-buying-power with exact figures", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  const outcome = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book: emptyBook(),
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "buy",
      quantity: "100",
      limitPrice: "4800", // requires 480000 > 100000
    },
  });
  assert.equal(outcome.accepted, false);
  if (!outcome.accepted) {
    assert.equal(outcome.code, "insufficient-buying-power");
    assert.equal(outcome.requiredMargin, "480000");
    assert.equal(outcome.marginAvailable, "100000");
    assert.match(outcome.message, /requires margin 480000/);
  }
});

test("acceptance: reductions never require margin (they free it)", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  // long 10 @ 4800, cash 100000 → margin used 48000, available 53250
  const positions = [position({ quantity: 10n * 10n ** 12n, unrealizedPnl: 1000n * 10n ** 12n })];
  const financials = computeAccountFinancials(ledger, positions);
  const outcome = checkOrderAcceptance({
    ledger,
    financials,
    positions,
    book: emptyBook(),
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "market",
      side: "sell",
      quantity: "4",
    },
  });
  // a market sell into an EMPTY book has no reference price AND reduces — accepted
  assert.deepEqual(outcome, { accepted: true });
});

test("acceptance: market orders size at the worst-case book walk", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  // build a book: asks 4800.25 × 5, 4800.50 × 5
  let book = emptyBook();
  book = {
    ...book,
    asks: [
      { priceScaled: 480025n * 10n ** 10n, price: "4800.25" as never, entries: [{ orderId: "ord:a" as never, remaining: 5n * 10n ** 12n, arrivalSequence: 1 as never }] },
      { priceScaled: 480050n * 10n ** 10n, price: "4800.5" as never, entries: [{ orderId: "ord:b" as never, remaining: 5n * 10n ** 12n, arrivalSequence: 2 as never }] },
    ],
  } as unknown as BookState;
  // worst case for a 7-lot buy: touches 4800.50
  assert.equal(worstCaseMarketPrice(book, "buy", 7n * 10n ** 12n), 480050n * 10n ** 10n);
  // 10 lots exhaust the book: deepest level
  assert.equal(worstCaseMarketPrice(book, "buy", 50n * 10n ** 12n), 480050n * 10n ** 10n);
  // empty book: no reference
  assert.equal(worstCaseMarketPrice(emptyBook(), "buy", 1n), undefined);
  // a 7-lot buy at worst 4800.50 needs 33603.5 ≤ 100000 → accepted
  const outcome = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book,
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "market",
      side: "buy",
      quantity: "7",
    },
  });
  assert.deepEqual(outcome, { accepted: true });
  // but 300 lots priced at the deepest level need more than available
  const bigBook = {
    ...book,
    asks: [
      { priceScaled: 480050n * 10n ** 10n, price: "4800.5" as never, entries: [{ orderId: "ord:b" as never, remaining: 500n * 10n ** 12n, arrivalSequence: 2 as never }] },
    ],
  } as unknown as BookState;
  const rejected = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book: bigBook,
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "market",
      side: "buy",
      quantity: "300",
    },
  });
  assert.equal(rejected.accepted, false);
  if (!rejected.accepted) {
    assert.equal(rejected.requiredMargin, "1440150");
  }
});

test("acceptance: a canShort=false account cannot end short", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, OTHER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  const shortOpen = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book: emptyBook(),
    order: {
      accountId: OTHER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "sell",
      quantity: "1",
      limitPrice: "4800",
    },
  });
  assert.equal(shortOpen.accepted, false);
  if (!shortOpen.accepted) {
    assert.equal(shortOpen.code, "account-cannot-short");
  }
  // reducing an existing long stays allowed even on canShort=false
  const reduce = checkOrderAcceptance({
    ledger,
    financials,
    positions: [
      position({ accountId: OTHER_ACCOUNT as never, quantity: 5n * 10n ** 12n }),
    ],
    book: emptyBook(),
    order: {
      accountId: OTHER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "sell",
      quantity: "5",
      limitPrice: "4800",
    },
  });
  assert.deepEqual(reduce, { accepted: true });
  // but selling 6 against a 5-lot long flips short — rejected
  const flip = checkOrderAcceptance({
    ledger,
    financials,
    positions: [
      position({ accountId: OTHER_ACCOUNT as never, quantity: 5n * 10n ** 12n }),
    ],
    book: emptyBook(),
    order: {
      accountId: OTHER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "sell",
      quantity: "6",
      limitPrice: "4800",
    },
  });
  assert.equal(flip.accepted, false);
});

test("acceptance: structurally broken submissions pass through to the venue checks", () => {
  const state = initialAccountLedgerState(definition());
  const ledger = ledgerOf(state, TRADER_ACCOUNT as never)!;
  const financials = computeAccountFinancials(ledger, []);
  const outcome = checkOrderAcceptance({
    ledger,
    financials,
    positions: [],
    book: emptyBook(),
    order: {
      accountId: TRADER_ACCOUNT as never,
      instrumentId: INSTRUMENT as never,
      kind: "limit",
      side: "buy",
      quantity: "not-a-number",
      limitPrice: "4800",
    },
  });
  assert.deepEqual(outcome, { accepted: true }, "the venue's invalid-quantity owns this rejection");
});
