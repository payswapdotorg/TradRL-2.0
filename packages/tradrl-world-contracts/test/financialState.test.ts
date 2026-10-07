/**
 * Account / position / portfolio / P&L / risk contract tests.
 *
 * Spec: spec/ARCHITECTURE.md §5 (Account/Position state),
 * spec/ACCEPTANCE-WORLD-ALPHA.md D (financial state incl. risk),
 * spec/ARCHITECTURE-LOCK.md A13/A14 (risk gates outside prompts; World Alpha
 * has no live execution authority).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Account, AccountPermissions } from "../src/account.js";
import type { Portfolio, Position, PnlBreakdown } from "../src/portfolio.js";
import type { RiskCheckOutcome, RiskGateId, RiskLimits, RiskState } from "../src/risk.js";
import type { AccountId, InstrumentId, WorldId } from "../src/ids.js";
import { asCurrency, asDecimal, asId, asPrice, asQuantity, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

// A14 fail-closed: no simulated account can grant live execution. The field
// type is the literal `false`.
type _liveExecutionFailClosed = Expect<
  Equal<AccountPermissions["liveExecutionAllowed"], false>
>;

// ARCHITECTURE.md §5 account attributes are required.
type _accountKeys = Expect<
  Equal<
    | "balances"
    | "buyingPower"
    | "marginUsed"
    | "marginAvailable"
    | "leverage"
    | "permissions" extends RequiredKeys<Account>
      ? true
      : false,
    true
  >
>;

// Position P&L is explicit and required (acceptance D).
type _positionPnl = Expect<
  Equal<
    | "realizedPnl"
    | "unrealizedPnl"
    | "averageEntryPrice" extends RequiredKeys<Position>
      ? true
      : false,
    true
  >
>;

type _pnlBreakdown = Expect<
  Equal<RequiredKeys<PnlBreakdown>, "realized" | "unrealized" | "total">
>;

const RISK_GATES = [
  "buying-power",
  "order-size",
  "position-limit",
  "leverage",
  "gross-exposure",
  "drawdown",
] as const;

type _riskGates = Expect<Equal<RiskGateId, (typeof RISK_GATES)[number]>>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const accountId = asId<AccountId>("account-1");
const instrumentId = asId<InstrumentId>("instr-1");
const usd = asCurrency("USD");

const account: Account = {
  accountId,
  worldId,
  balances: {
    [usd]: { amount: asDecimal("100000.00"), currency: usd },
  },
  buyingPower: { amount: asDecimal("100000.00"), currency: usd },
  marginUsed: { amount: asDecimal("0.00"), currency: usd },
  marginAvailable: { amount: asDecimal("100000.00"), currency: usd },
  leverage: 1,
  permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
};

const position: Position = {
  accountId,
  worldId,
  instrumentId,
  quantity: asQuantity("10"),
  averageEntryPrice: asPrice("100.25"),
  markPrice: asPrice("101.00"),
  realizedPnl: { amount: asDecimal("0.00"), currency: usd },
  unrealizedPnl: { amount: asDecimal("7.50"), currency: usd },
  openedAt: asTimestamp(1_000),
  updatedAt: asTimestamp(2_000),
};

const portfolio: Portfolio = {
  accountId,
  worldId,
  positions: [position],
  cash: { amount: asDecimal("99742.50"), currency: usd },
  buyingPower: { amount: asDecimal("99742.50"), currency: usd },
  realizedPnl: { amount: asDecimal("0.00"), currency: usd },
  unrealizedPnl: { amount: asDecimal("7.50"), currency: usd },
  equity: { amount: asDecimal("99750.00"), currency: usd },
  asOf: asTimestamp(2_000),
};

const limits: RiskLimits = {
  maxOrderQuantity: asQuantity("100"),
  maxPositionQuantity: asQuantity("200"),
  maxLeverage: 2,
  minBuyingPowerAfterOrder: { amount: asDecimal("1000.00"), currency: usd },
};

const riskState: RiskState = {
  accountId,
  worldId,
  limits,
  breaches: [],
  asOf: asTimestamp(2_000),
};

// --- runtime invariants --------------------------------------------------------

test("account permissions fail closed on live execution", () => {
  assert.equal(account.permissions.liveExecutionAllowed, false);
  assert.equal(account.permissions.canTrade, true);
});

test("account carries balances, buying power and margin explicitly", () => {
  const usdBalance = account.balances[usd];
  assert.ok(usdBalance);
  assert.equal(usdBalance.amount as string, "100000.00");
  assert.ok(account.buyingPower);
  assert.ok(account.marginUsed);
  assert.ok(account.marginAvailable);
});

test("positions are signed quantities with average entry and both P&L kinds", () => {
  assert.ok(Number(position.quantity as string) > 0);
  assert.ok(position.markPrice);
  assert.equal(position.realizedPnl.amount as string, "0.00");
  assert.equal(position.unrealizedPnl.amount as string, "7.50");
});

test("short positions are negative quantities", () => {
  const short: Position = { ...position, quantity: asQuantity("-5") };
  assert.ok(Number(short.quantity as string) < 0);
});

test("portfolio aggregates cash, positions and P&L at an explicit asOf time", () => {
  assert.equal(portfolio.positions.length, 1);
  assert.ok(portfolio.asOf >= position.updatedAt);
  const cash = Number(portfolio.cash.amount as string);
  const realized = Number(portfolio.realizedPnl.amount as string);
  const unrealized = Number(portfolio.unrealizedPnl.amount as string);
  const equity = Number(portfolio.equity.amount as string);
  // sample fixture is internally consistent (display is never truth, but
  // fixtures must be)
  assert.ok(Math.abs(equity - (cash + realized + unrealized)) < 1e-9);
});

test("risk gates are typed runtime controls with explicit outcomes", () => {
  const pass: RiskCheckOutcome = { gate: "buying-power", passed: true };
  const fail: RiskCheckOutcome = {
    gate: "order-size",
    passed: false,
    limit: "100",
    requested: "150",
    message: "order quantity exceeds max order size",
  };
  assert.equal(pass.passed, true);
  assert.equal(fail.passed, false);
  if (!fail.passed) {
    assert.equal(fail.gate, "order-size");
    assert.equal(fail.limit, "100");
    assert.equal(fail.requested, "150");
  }
});

test("risk state carries limits and breach history", () => {
  assert.deepEqual(riskState.breaches, []);
  assert.equal(riskState.limits.maxLeverage, 2);
  const breaching: RiskState = {
    ...riskState,
    breaches: [
      { gate: "drawdown", detail: "max drawdown exceeded", occurredAt: asTimestamp(3_000) },
    ],
  };
  assert.equal(breaching.breaches.length, 1);
  assert.equal(breaching.breaches[0]!.gate, "drawdown");
});
