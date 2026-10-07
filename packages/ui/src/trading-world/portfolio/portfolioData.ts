/**
 * Position + portfolio financial transforms — W011 (pure, framework-free).
 *
 * Spec: spec/WORK-ITEMS.md W011 ("the trader's portfolio surface — positions
 * (per instrument: signed quantity, entry/reference, mark, unrealized P&L in
 * exact decimal text), account financials (balances, margin used/available,
 * buying power from the real financial state)"); spec/WORLD-PROTOCOL.md "UI
 * projection law" (never fabricate financial facts); spec/ARCHITECTURE-LOCK.md
 * A6 (the engine is the authority — these transforms only RE-FORMAT and
 * aggregate its own projected values).
 *
 * EXACTNESS LAWS (all arithmetic on the 12-decimal kernel of
 * `./decimalText.ts`, mirroring the W015 financial modules):
 * - Position rows carry the engine's own `Position` verbatim; display text
 *   is the canonical decimal text as projected (signed quantities, exact
 *   P&L money) — never reformatted through a float.
 * - The financial summary verifies the W003 consistency law
 *   `equity = cash + realized + unrealized` on exact units and FAILS CLOSED
 *   (typed error) when a projection violates it — a corrupt figure is not
 *   projectable.
 * - Gross exposure = Σ |open quantity| × (mark ?? average entry) with ONE
 *   half-up rounding per position — the same figure the engine's
 *   `notionalForPosition` computes internally.
 * - Margin used/available are NOT projected by the W003 QueryPort (the
 *   `Portfolio` contract carries cash/buyingPower/equity/P&L only). They are
 *   DERIVED here by reproducing the W015 margin model
 *   (`account/margin.ts`: marginUsed = Σ |qty| × mark / leverage,
 *   marginAvailable = equity − marginUsed, buyingPower = marginAvailable ×
 *   leverage) and solving for the integer leverage that reproduces the
 *   PROJECTED buying power EXACTLY, bit-for-bit. No candidate ⇒ the margin
 *   figures stay honestly underived (undefined) — never a guessed number.
 */

import type { Portfolio, Position } from "tradrl-world-contracts";

import {
  absMoneyUnits,
  addMoneyUnits,
  compareMoneyUnits,
  formatMoneyUnits,
  multiplyMoneyHalfUp,
  mulDivMoneyHalfUp,
  parseMoneyText,
  subtractMoneyUnits,
} from "./decimalText.js";

/** The engine's money scale (10^12) — margin divides by scale × leverage. */
const SCALE = 10n ** 12n;

/**
 * Upper bound of the leverage solve. Leverage is a validated integer ≥ 1
 * (W015 margin model); practical accounts sit far below this bound. When no
 * candidate in [1, bound] reproduces the projected buying power exactly, the
 * margin figures are honestly not derived.
 */
const MAX_LEVERAGE_SEARCH = 1000;

/** Consistency-law violation (corrupt projection — fail closed, A6). */
export class PortfolioDataConsistencyError extends Error {
  constructor(detail: string) {
    super(
      `[trading-world/portfolio] refusing to project an inconsistent financial state: ${detail}`,
    );
    this.name = "PortfolioDataConsistencyError";
  }
}

/** Display row for one open position (engine Position + derived labels). */
export interface PositionRowModel {
  readonly position: Position;
  /** Direction as text (never color alone): "long" | "short". */
  readonly side: "long" | "short";
  /** Signed quantity text as projected (positive long, negative short). */
  readonly quantityText: string;
  readonly entryText: string;
  /** Mark text, or undefined when the projection carries no mark (honest). */
  readonly markText: string | undefined;
  /** Signed unrealized P&L text (exact decimal, e.g. "-2.5"). */
  readonly unrealizedText: string;
  /** Lifetime realized P&L of this instrument ledger (signed text). */
  readonly realizedText: string;
  readonly quoteCurrency: string;
  readonly openedAtMs: number;
  readonly updatedAtMs: number;
  /** True while the position is open (always true for projected rows). */
  readonly canClose: boolean;
}

/** Derive the display row for one projected position (pure). */
export function derivePositionRow(position: Position): PositionRowModel {
  const quantity = parseMoneyText(position.quantity, "position.quantity");
  return {
    position,
    side: quantity >= 0n ? "long" : "short",
    quantityText: position.quantity,
    entryText: position.averageEntryPrice,
    ...(position.markPrice === undefined ? {} : { markText: position.markPrice }),
    unrealizedText: position.unrealizedPnl.amount,
    realizedText: position.realizedPnl.amount,
    quoteCurrency: position.realizedPnl.currency,
    openedAtMs: position.openedAt,
    updatedAtMs: position.updatedAt,
    canClose: quantity !== 0n,
  };
}

/** Sort positions for display: by instrument id, stable (deterministic). */
export function sortPositionsForDisplay(
  positions: readonly Position[],
): readonly Position[] {
  return [...positions].sort((a, b) =>
    a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0,
  );
}

/** Derive the ordered display rows for a position projection (pure). */
export function derivePositionRows(
  positions: readonly Position[],
): readonly PositionRowModel[] {
  return sortPositionsForDisplay(positions).map(derivePositionRow);
}

/** The mark reference of a record (the engine's `markOf` law). */
function referencePriceOf(position: Position): string {
  return position.markPrice === undefined ? position.averageEntryPrice : position.markPrice;
}

/**
 * Aggregate the open positions' gross exposure exactly:
 * Σ |quantity| × (mark ?? average entry), one half-up rounding per position
 * (the engine's `notionalForPosition` + `markOf` laws, mirrored).
 */
export function grossExposureUnitsOf(positions: readonly Position[]): bigint {
  let gross = 0n;
  for (const position of positions) {
    const quantity = absMoneyUnits(parseMoneyText(position.quantity, "position.quantity"));
    if (quantity === 0n) {
      continue;
    }
    const mark = parseMoneyText(referencePriceOf(position), "position.markPrice");
    gross = addMoneyUnits(gross, multiplyMoneyHalfUp(quantity, mark));
  }
  return gross;
}

/** Margin figures derived from the projected financial state (see header). */
export interface DerivedMarginModel {
  /** The solved integer leverage (engine-validated ≥ 1). */
  readonly leverage: bigint;
  /** Display text, e.g. "2×". */
  readonly leverageText: string;
  readonly marginUsedText: string;
  readonly marginAvailableText: string;
}

/**
 * Reproduce the W015 margin model for one candidate leverage:
 * marginUsed = Σ |qty| × mark / (10^12 × L) (one rounding per position —
 * `marginForPosition`), marginAvailable = equity − marginUsed,
 * buyingPower = marginAvailable × L (exact integer multiply — `margin.ts`).
 */
function marginModelAtLeverage(
  equity: bigint,
  positions: readonly Position[],
  leverage: bigint,
): { readonly marginUsed: bigint; readonly marginAvailable: bigint; readonly buyingPower: bigint } {
  let marginUsed = 0n;
  for (const position of positions) {
    const quantity = absMoneyUnits(parseMoneyText(position.quantity, "position.quantity"));
    if (quantity === 0n) {
      continue;
    }
    const mark = parseMoneyText(referencePriceOf(position), "position.markPrice");
    marginUsed = addMoneyUnits(
      marginUsed,
      mulDivMoneyHalfUp(quantity, mark, SCALE * leverage),
    );
  }
  const marginAvailable = subtractMoneyUnits(equity, marginUsed);
  return { marginUsed, marginAvailable, buyingPower: marginAvailable * leverage };
}

/**
 * Solve the engine's integer leverage from the projected figures: the
 * candidate whose margin model reproduces the PROJECTED buying power exactly
 * (bit-for-bit) is the account's leverage, and its margin figures are the
 * engine's own. No exact candidate ⇒ undefined (honest, never guessed).
 */
function deriveMargin(
  equity: bigint,
  buyingPower: bigint,
  positions: readonly Position[],
): DerivedMarginModel | undefined {
  for (let candidate = 1; candidate <= MAX_LEVERAGE_SEARCH; candidate += 1) {
    const leverage = BigInt(candidate);
    const model = marginModelAtLeverage(equity, positions, leverage);
    if (model.buyingPower !== buyingPower) {
      continue;
    }
    return {
      leverage,
      leverageText: `${formatMoneyUnits(leverage)}×`,
      marginUsedText: formatMoneyUnits(model.marginUsed),
      marginAvailableText: formatMoneyUnits(model.marginAvailable),
    };
  }
  return undefined;
}

/** The account financial summary the portfolio surface renders. */
export interface FinancialSummaryModel {
  readonly accountId: string;
  readonly currency: string;
  readonly asOfMs: number;
  readonly cashText: string;
  readonly buyingPowerText: string;
  readonly equityText: string;
  readonly realizedText: string;
  readonly unrealizedText: string;
  /** realized + unrealized (exact addition — the W003 total P&L law). */
  readonly totalPnlText: string;
  readonly openPositionCount: number;
  /** Σ |open qty| × mark (exact, engine-law mirror). */
  readonly grossExposureText: string;
  /**
   * Margin used/available — derived by reproducing the W015 margin model and
   * requiring the projected buying power bit-for-bit; undefined when the
   * ports do not carry enough to derive them honestly.
   */
  readonly margin: DerivedMarginModel | undefined;
}

/**
 * Derive the financial summary of one account from its REAL projections.
 * `portfolio` is the engine's own `query.getPortfolio` value; `positions`
 * the account's own open positions (`query.getPositions(accountId)`).
 *
 * Throws {@link PortfolioDataConsistencyError} when the W003 consistency law
 * (equity = cash + realized + unrealized) is violated — fail closed.
 */
export function deriveFinancialSummary(
  portfolio: Portfolio,
  positions: readonly Position[] = portfolio.positions,
): FinancialSummaryModel {
  const cash = parseMoneyText(portfolio.cash.amount, "portfolio.cash");
  const realized = parseMoneyText(portfolio.realizedPnl.amount, "portfolio.realizedPnl");
  const unrealized = parseMoneyText(portfolio.unrealizedPnl.amount, "portfolio.unrealizedPnl");
  const equity = parseMoneyText(portfolio.equity.amount, "portfolio.equity");
  const buyingPower = parseMoneyText(portfolio.buyingPower.amount, "portfolio.buyingPower");
  if (
    compareMoneyUnits(addMoneyUnits(addMoneyUnits(cash, realized), unrealized), equity) !== 0
  ) {
    throw new PortfolioDataConsistencyError(
      "portfolio.equity must equal cash + realizedPnl + unrealizedPnl (the W003 consistency law)",
    );
  }
  const gross = grossExposureUnitsOf(positions);
  return {
    accountId: portfolio.accountId,
    currency: portfolio.buyingPower.currency,
    asOfMs: portfolio.asOf,
    cashText: portfolio.cash.amount,
    buyingPowerText: portfolio.buyingPower.amount,
    equityText: portfolio.equity.amount,
    realizedText: portfolio.realizedPnl.amount,
    unrealizedText: portfolio.unrealizedPnl.amount,
    totalPnlText: formatMoneyUnits(addMoneyUnits(realized, unrealized)),
    openPositionCount: positions.filter(
      (position) => parseMoneyText(position.quantity, "position.quantity") !== 0n,
    ).length,
    grossExposureText: formatMoneyUnits(gross),
    margin: deriveMargin(equity, buyingPower, positions),
  };
}
