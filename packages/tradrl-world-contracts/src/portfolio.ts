/**
 * Position and portfolio contracts, including P&L.
 *
 * Spec: spec/ARCHITECTURE.md §5 — Position: quantity, average entry, mark
 * price, realized/unrealized P&L.
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md D Financial state — cash, buying
 * power, positions, realized P&L, unrealized P&L, portfolio.
 * Spec: spec/REQUIREMENTS.md R023 — causal portfolio/risk updates.
 */

import type { AccountId, InstrumentId, WorldId } from "./ids.js";
import type { Money, Price, Quantity, TimestampMs } from "./primitives.js";

/**
 * A position in one instrument. `quantity` is signed: positive long,
 * negative short. Realized and unrealized P&L are explicit money values in
 * the instrument quote currency.
 */
export interface Position {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly instrumentId: InstrumentId;
  readonly quantity: Quantity;
  readonly averageEntryPrice: Price;
  readonly markPrice?: Price;
  readonly realizedPnl: Money;
  readonly unrealizedPnl: Money;
  readonly openedAt: TimestampMs;
  readonly updatedAt: TimestampMs;
}

/** P&L breakdown (R023: causal, explicit). */
export interface PnlBreakdown {
  readonly realized: Money;
  readonly unrealized: Money;
  readonly total: Money;
}

/** The whole portfolio of one account inside one world. */
export interface Portfolio {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly positions: readonly Position[];
  readonly cash: Money;
  readonly buyingPower: Money;
  readonly realizedPnl: Money;
  readonly unrealizedPnl: Money;
  readonly equity: Money;
  readonly asOf: TimestampMs;
}
