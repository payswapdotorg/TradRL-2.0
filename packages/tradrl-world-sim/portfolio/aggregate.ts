/**
 * The W003 `Portfolio` projection (W015 `portfolio` module): the whole
 * portfolio of one account — open positions, cash, buying power and the
 * realized/unrealized/total P&L breakdown at an explicit as-of time.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md D (cash, buying power, positions,
 * realized P&L, unrealized P&L, portfolio) and F (cross-view consistency).
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — aggregation happens on
 * exact scaled integers; canonical decimal text appears only at the
 * projection boundary (display formatting is never financial truth).
 *
 * CONSISTENCY LAW (the W003 contract fixture): equity = cash + realized +
 * unrealized. Cash is the settled balance (initial deposits minus fees);
 * realized P&L is the lifetime closed-lot P&L; unrealized is the open
 * mark-to-market. The account module computes the figures (margin model);
 * this module only aggregates and formats them — the inputs arrive as an
 * exact structural summary so the two modules stay decoupled.
 */

import type { AccountId, CurrencyCode, Money, Portfolio, Position, PnlBreakdown, TimestampMs, WorldId } from "tradrl-world-contracts";
import type { Scaled } from "../orderbook/index.js";
import { formatSignedMoney } from "./decimal.js";
import { isOpenPosition, projectPosition, type PositionRecord } from "./positions.js";

/** The exact financial figures one account's portfolio aggregates (scaled). */
export interface PortfolioFinancialInputs {
  readonly cash: Scaled;
  readonly realizedPnl: Scaled;
  readonly unrealizedPnl: Scaled;
  readonly equity: Scaled;
  readonly buyingPower: Scaled;
  readonly marginUsed: Scaled;
  readonly marginAvailable: Scaled;
  readonly baseCurrency: CurrencyCode;
}

function moneyOf(scaled: Scaled, currency: CurrencyCode): Money {
  return { amount: formatSignedMoney(scaled) as Money["amount"], currency };
}

/** The W003 `PnlBreakdown` of one account (realized + unrealized = total). */
export function pnlBreakdownOf(input: PortfolioFinancialInputs): PnlBreakdown {
  return {
    realized: moneyOf(input.realizedPnl, input.baseCurrency),
    unrealized: moneyOf(input.unrealizedPnl, input.baseCurrency),
    total: moneyOf(input.realizedPnl + input.unrealizedPnl, input.baseCurrency),
  };
}

/**
 * Project the W003 `Portfolio` of one account. `positions` are the account's
 * ledger records (open and closed); only open quantities project (the
 * closed records' realized P&L is already aggregated into the inputs).
 */
export function projectPortfolio(input: {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly asOf: TimestampMs;
  readonly financials: PortfolioFinancialInputs;
  readonly positions: readonly PositionRecord[];
}): Portfolio {
  const { financials } = input;
  const open = input.positions.filter(isOpenPosition).map(projectPosition) as readonly Position[];
  return {
    accountId: input.accountId,
    worldId: input.worldId,
    positions: open,
    cash: moneyOf(financials.cash, financials.baseCurrency),
    buyingPower: moneyOf(financials.buyingPower, financials.baseCurrency),
    realizedPnl: moneyOf(financials.realizedPnl, financials.baseCurrency),
    unrealizedPnl: moneyOf(financials.unrealizedPnl, financials.baseCurrency),
    equity: moneyOf(financials.equity, financials.baseCurrency),
    asOf: input.asOf,
  };
}
