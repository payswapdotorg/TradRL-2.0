/**
 * The account margin model (W015 `account` module): buying power, margin
 * usage and the per-account financial aggregates — all exact.
 *
 * Spec: spec/ARCHITECTURE.md §5 (Account: balances, buying power, margin,
 * leverage), spec/ACCEPTANCE-WORLD-ALPHA.md D (cash, buying power).
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — one half-up rounding
 * per figure, exact scaled bigints, canonical text at the boundary.
 *
 * MODEL (documented, World Alpha — a derivatives margin account):
 * - base currency = the account's declared `buyingPower` currency. All
 *   aggregates (cash, P&L, margin, buying power) are expressed in it.
 *   World Alpha performs NO FX conversion: position P&L in an instrument
 *   whose quote currency differs from the base currency aggregates 1:1
 *   (documented known limitation — honest and deterministic, visible in
 *   projections).
 * - cash            = base-currency balance (initial deposits − fees).
 * - realized/unrealized = Σ over the account's position records (open and
 *   closed for realized; open only for unrealized) — 1:1 into base.
 * - equity          = cash + realized + unrealized (the W003 law).
 * - marginUsed      = Σ |open quantity| × mark × 1/leverage (one rounding
 *   per position; leverage is a validated integer ≥ 1, so 1/leverage is an
 *   exact rational divisor — never a float).
 * - marginAvailable = equity − marginUsed (may go negative — a margin call
 *   condition is visible, never hidden by flooring).
 * - buyingPower     = marginAvailable × leverage (exact integer multiply).
 * - grossExposure   = Σ |open quantity| × mark (the un-leveraged notional).
 */

import type { Account, AccountId } from "tradrl-world-contracts";
import type { Scaled } from "../orderbook/index.js";
import { mulDivHalfUp } from "../orderbook/index.js";
import { absScaled, formatSignedMoney } from "../portfolio/index.js";
import type { PositionRecord } from "../portfolio/index.js";
import type { AccountLedger } from "./state.js";
import { projectBalances } from "./state.js";

const SCALE = 10n ** 12n;

/** The exact per-account financial aggregates (all in the base currency). */
export interface AccountFinancials {
  readonly accountId: AccountId;
  readonly baseCurrency: string;
  readonly leverage: number;
  readonly cash: Scaled;
  readonly realizedPnl: Scaled;
  readonly unrealizedPnl: Scaled;
  readonly equity: Scaled;
  readonly marginUsed: Scaled;
  readonly marginAvailable: Scaled;
  readonly buyingPower: Scaled;
  readonly grossExposure: Scaled;
}

function markOf(record: PositionRecord): Scaled {
  return record.markPrice ?? record.averageEntryPrice;
}

/** Margin for one open position: |qty| × mark / leverage (one rounding). */
export function marginForPosition(
  quantity: Scaled,
  markPrice: Scaled,
  leverage: number,
): Scaled {
  const absQuantity = absScaled(quantity);
  if (absQuantity === 0n) {
    return 0n;
  }
  return mulDivHalfUp(absQuantity, markPrice, SCALE * BigInt(leverage));
}

/** Gross notional for one open position: |qty| × mark (exact). */
export function notionalForPosition(quantity: Scaled, markPrice: Scaled): Scaled {
  const absQuantity = absScaled(quantity);
  return absQuantity === 0n ? 0n : mulDivHalfUp(absQuantity, markPrice, SCALE);
}

/**
 * Compute one account's financial aggregates from its ledger and its
 * position records (all of them — open and closed; closed records
 * contribute realized P&L only).
 */
export function computeAccountFinancials(
  ledger: AccountLedger,
  positions: readonly PositionRecord[],
): AccountFinancials {
  let realized = 0n;
  let unrealized = 0n;
  let marginUsed = 0n;
  let grossExposure = 0n;
  for (const record of positions) {
    realized += record.realizedPnl;
    if (record.quantity === 0n) {
      continue;
    }
    unrealized += record.unrealizedPnl;
    const mark = markOf(record);
    marginUsed += marginForPosition(record.quantity, mark, ledger.leverage);
    grossExposure += notionalForPosition(record.quantity, mark);
  }
  const cash = ledger.balances[String(ledger.baseCurrency)] ?? 0n;
  const equity = cash + realized + unrealized;
  const marginAvailable = equity - marginUsed;
  return {
    accountId: ledger.accountId,
    baseCurrency: String(ledger.baseCurrency),
    leverage: ledger.leverage,
    cash,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    equity,
    marginUsed,
    marginAvailable,
    buyingPower: marginAvailable * BigInt(ledger.leverage),
    grossExposure,
  };
}

/** Format a financial figure as canonical signed decimal text. */
export function formatFinancials(scaled: Scaled): string {
  return formatSignedMoney(scaled);
}

/**
 * Project the W003 `Account` contract view: declared permissions carried
 * verbatim (fail-closed A14), balances per currency, and the DERIVED
 * buying power / margin figures from the live financial state (the
 * definition's static declarations are the initial state, not the truth).
 */
export function projectAccount(ledger: AccountLedger, financials: AccountFinancials, worldId: Account["worldId"]): Account {
  const money = (scaled: Scaled) => ({
    amount: formatSignedMoney(scaled) as Account["buyingPower"]["amount"],
    currency: ledger.baseCurrency,
  });
  return {
    accountId: ledger.accountId,
    worldId,
    balances: Object.fromEntries(
      projectBalances(ledger).map((entry) => [String(entry.currency), entry]),
    ) as Account["balances"],
    buyingPower: money(financials.buyingPower),
    marginUsed: money(financials.marginUsed),
    marginAvailable: money(financials.marginAvailable),
    leverage: ledger.leverage,
    permissions: ledger.permissions,
  };
}
