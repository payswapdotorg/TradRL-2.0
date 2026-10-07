/**
 * The position ledger math (W015 `portfolio` module) — exact, deterministic
 * position updates from W014 fill events and mark-to-market refreshes.
 *
 * Spec: spec/DOMAIN-MODEL.md (Position/P&L semantics: signed quantity,
 * average entry, mark price, realized/unrealized P&L),
 * spec/ACCEPTANCE-WORLD-ALPHA.md D (positions, realized P&L, unrealized P&L).
 *
 * MODEL (documented, exact — DOMAIN-MODEL.md "Financial precision"):
 * - One position record per (accountId, instrumentId), kept forever (a
 *   closed position keeps its lifetime realized P&L; a later fill in the
 *   same instrument reuses the record). `openedAt` is the first time the
 *   position opened; `updatedAt` follows fills and mark refreshes.
 * - A fill signed by side (buy +q, sell −q) moves the position in three
 *   exclusive cases (discriminated by sign change, never by size):
 *   INCREASE (same direction, larger): re-weight the average entry over the
 *   open quantity; no realized P&L.
 *   REDUCTION (same direction, smaller, possibly to exactly zero): realize
 *   (price − avg) × closed × direction on the closed lots; average entry
 *   unchanged.
 *   FLIP (sign change): the whole old side is closed (realized on all of
 *   it at the fill price) and the remainder opens at the fill price.
 * - Realized P&L on closing `c` lots of a long at `price` with entry `avg`:
 *   (price − avg) × c; on closing a short: (avg − price) × c — both equal
 *   (price − avg) × c × sign(position), computed with ONE half-up rounding
 *   at the 12-digit money scale (`signedMulDivHalfUp`).
 * - Unrealized P&L = (mark − avg) × quantity (signed) — the same formula,
 *   evaluated against the last printed trade price. Every fill carries its
 *   own mark (W014 fills cite the market trade that generated them), so a
 *   position always has a mark price.
 */

import type {
  AccountId,
  CurrencyCode,
  InstrumentId,
  Money,
  Position,
  Price,
  Quantity,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import { parseScaled, type Scaled } from "../orderbook/index.js";
import { absScaled, formatSignedMoney, signedMulDivHalfUp } from "./decimal.js";

/** The internal scale divisor (kernel SCALE). */
const SCALE = 10n ** 12n;

/**
 * The authoritative position record. Money values are carried as exact
 * scaled integers (DOMAIN-MODEL.md: display formatting is never financial
 * truth); projections format them through the contracts' Money shape.
 */
export interface PositionRecord {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly instrumentId: InstrumentId;
  /** Signed quantity: positive long, negative short, 0 when closed. */
  readonly quantity: Scaled;
  /** Volume-weighted average entry price of the open quantity (unsigned). */
  readonly averageEntryPrice: Scaled;
  /** Last trade price observed for the instrument (always set in practice). */
  readonly markPrice: Scaled | undefined;
  /** Lifetime realized P&L of this (account, instrument) ledger (signed). */
  readonly realizedPnl: Scaled;
  /** Mark-to-market unrealized P&L of the open quantity (signed). */
  readonly unrealizedPnl: Scaled;
  /** The instrument's quote currency (P&L currency). */
  readonly quoteCurrency: CurrencyCode;
  readonly openedAt: TimestampMs;
  readonly updatedAt: TimestampMs;
}

/** The fill facts a position update needs (from `matching.order.filled`). */
export interface FillInput {
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly side: "buy" | "sell";
  readonly price: string;
  readonly quantity: string;
  /** The instrument's quote currency (the fill fee carries it). */
  readonly quoteCurrency: CurrencyCode;
  readonly occurredAt: TimestampMs;
}

/** Result of applying one fill: the next record plus the realized delta. */
export interface PositionUpdate {
  readonly record: PositionRecord;
  /** Realized P&L of THIS fill (signed; zero on opening/increasing fills). */
  readonly realizedDelta: Scaled;
  /** True when the record did not exist before (first fill). */
  readonly opened: boolean;
}

function unrealizedOf(mark: Scaled, averageEntry: Scaled, quantity: Scaled): Scaled {
  return signedMulDivHalfUp(mark - averageEntry, quantity, SCALE);
}

function realizedOn(price: Scaled, averageEntry: Scaled, closed: Scaled, direction: 1n | -1n): Scaled {
  return signedMulDivHalfUp(price - averageEntry, closed * direction, SCALE);
}

/**
 * Apply one fill to a position ledger (record may be undefined: first fill).
 * Pure; exact; one rounding per money figure. See the module header for the
 * INCREASE / REDUCTION / FLIP case law.
 */
export function applyFillToPosition(
  previous: PositionRecord | undefined,
  fill: FillInput,
  worldId: WorldId,
): PositionUpdate {
  const price = parseScaled(fill.price);
  const fillQuantity = parseScaled(fill.quantity);
  const signedFill = fill.side === "buy" ? fillQuantity : -fillQuantity;
  const currentQuantity = previous?.quantity ?? 0n;
  const currentAverage = previous?.averageEntryPrice ?? price;
  const nextQuantity = currentQuantity + signedFill;
  const realizedBase = previous?.realizedPnl ?? 0n;
  const openedAt = previous?.openedAt ?? fill.occurredAt;
  const direction: 1n | -1n = currentQuantity >= 0n ? 1n : -1n;

  const flips = currentQuantity !== 0n && nextQuantity !== 0n && (nextQuantity > 0n) !== (currentQuantity > 0n);
  const nextAbs = absScaled(nextQuantity);
  const currentAbs = absScaled(currentQuantity);

  let realizedDelta = 0n;
  let averageEntry = currentAverage;

  if (flips) {
    // the whole old side closes at the fill price; the remainder opens there
    realizedDelta = realizedOn(price, currentAverage, currentAbs, direction);
    averageEntry = price;
  } else if (currentQuantity === 0n || nextAbs > currentAbs) {
    // opening or increasing (same direction): re-weight the average entry
    if (currentQuantity === 0n) {
      averageEntry = price;
    } else {
      const added = nextAbs - currentAbs;
      const numerator = currentAverage * currentAbs + price * added;
      const divisor = nextAbs;
      averageEntry = numerator / divisor + (numerator % divisor * 2n >= divisor ? 1n : 0n);
    }
  } else {
    // reduction (same direction, possibly to exactly zero)
    const closed = currentAbs - nextAbs;
    realizedDelta = realizedOn(price, currentAverage, closed, direction);
  }

  const record: PositionRecord = {
    accountId: fill.accountId,
    worldId,
    instrumentId: fill.instrumentId,
    quantity: nextQuantity,
    // a closed record keeps its historical average entry (audit trail)
    averageEntryPrice: nextQuantity === 0n ? currentAverage : averageEntry,
    markPrice: price,
    realizedPnl: realizedBase + realizedDelta,
    unrealizedPnl: nextQuantity === 0n ? 0n : unrealizedOf(price, averageEntry, nextQuantity),
    quoteCurrency: fill.quoteCurrency,
    openedAt,
    updatedAt: fill.occurredAt,
  };
  return { record, realizedDelta, opened: previous === undefined };
}

/**
 * Re-mark one record at a printed trade price (mark-to-market refresh):
 * updates `markPrice`, recomputes `unrealizedPnl`, stamps `updatedAt`.
 * Closed records only refresh the mark (no P&L effect).
 */
export function remarkPosition(record: PositionRecord, markPrice: string, at: TimestampMs): PositionRecord {
  const mark = parseScaled(markPrice);
  return {
    ...record,
    markPrice: mark,
    unrealizedPnl: record.quantity === 0n ? 0n : unrealizedOf(mark, record.averageEntryPrice, record.quantity),
    updatedAt: at,
  };
}

/** True when the record has an open quantity (the projection filter). */
export function isOpenPosition(record: PositionRecord): boolean {
  return record.quantity !== 0n;
}

/** Format a record into the W003 `Position` contract projection. */
export function projectPosition(record: PositionRecord): Position {
  return {
    accountId: record.accountId,
    worldId: record.worldId,
    instrumentId: record.instrumentId,
    quantity: formatSignedMoney(record.quantity) as Quantity,
    averageEntryPrice: formatSignedMoney(record.averageEntryPrice) as Price,
    ...(record.markPrice === undefined
      ? {}
      : { markPrice: formatSignedMoney(record.markPrice) as Price }),
    realizedPnl: moneyOf(record.realizedPnl, record.quoteCurrency),
    unrealizedPnl: moneyOf(record.unrealizedPnl, record.quoteCurrency),
    openedAt: record.openedAt,
    updatedAt: record.updatedAt,
  };
}

function moneyOf(scaled: Scaled, currency: CurrencyCode): Money {
  return { amount: formatSignedMoney(scaled) as Money["amount"], currency };
}
