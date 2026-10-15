/**
 * The price-time-priority limit-order book (W024) — the exchange process's
 * book, with TWO-PHASE matching (plan, then apply) so FOK feasibility and
 * post-only checks can be decided BEFORE any mutation.
 *
 * Spec: spec/SIMULATION.md "Matching" — deterministic price-time priority
 * with mandatory partial fills. Spec: spec/ARCHITECTURE-LOCK.md A6 — the
 * book is authoritative venue state mutated only through the command
 * lifecycle (./exchange.ts); this module is the pure data structure.
 *
 * CANONICAL-SEMANTICS NOTE (README.md): price-time-priority resting books
 * are owned canonically by the W014 engine (tradrl-world-sim/orderbook +
 * matching). This adapter RE-IMPLEMENTED the minimal core in original
 * TypeScript behind the SAME contract types (BookLevel, OrderBookSnapshot,
 * Trade, Order) because an adapter must be engine-independent (A10) and
 * self-contained behind the World Protocol; the semantics it ADDS — latency
 * queues, agent-visible depth truncation, availability-delayed market data —
 * are the ABIDES-style part and are entirely this adapter's.
 *
 * Arithmetic is exact fixed-point on the W023 12-decimal kernel
 * (tradrl-market-participants/decimal — our own package, reused); no binary
 * floats anywhere (A9).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import {
  formatParticipantDecimal,
  parseParticipantDecimal,
} from "tradrl-market-participants/decimal";
import type {
  AccountId,
  BookLevel,
  Instrument,
  InstrumentId,
  OrderBookSnapshot,
  OrderId,
  OrderSide,
  ParticipantId,
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
} from "tradrl-world-contracts";

/** A scaled value on the 12-decimal fixed-point kernel (the W023 discipline). */
export type Scaled = bigint;

/** Parse canonical decimal text, or undefined when it is not canonical (validation path). */
export function parseScaled(text: string): Scaled | undefined {
  try {
    return parseParticipantDecimal(text);
  } catch {
    return undefined;
  }
}

/** Format a scaled value at the instrument's price precision. */
export function formatPrice(value: Scaled, instrument: Instrument): Price {
  return formatParticipantDecimal(value, instrument.pricePrecision) as Price;
}

/** Format a scaled value at the instrument's quantity precision. */
export function formatQuantity(value: Scaled, instrument: Instrument): Quantity {
  return formatParticipantDecimal(value, instrument.quantityPrecision) as Quantity;
}

/** Format a SIGNED quantity (positions are signed: long positive, short negative). */
export function formatSignedQuantity(value: Scaled, instrument: Instrument): Quantity {
  const magnitude = value < 0n ? -value : value;
  const text = formatParticipantDecimal(magnitude, instrument.quantityPrecision);
  return (value < 0n ? `-${text}` : text) as Quantity;
}

/** One resting order on the book (the mutable internal entry is copied out on read). */
export interface RestingOrder {
  readonly orderId: OrderId;
  readonly side: OrderSide;
  readonly price: Scaled;
  readonly quantity: Scaled;
  readonly accountId: AccountId;
  readonly participantId: ParticipantId;
  readonly arrivalSeq: number;
}

/** One planned fill against a resting order (no mutation yet). */
export interface PlannedFill {
  readonly restingOrderId: OrderId;
  readonly restingSide: OrderSide;
  readonly restingAccountId: AccountId;
  readonly restingParticipantId: ParticipantId;
  readonly price: Scaled;
  readonly quantity: Scaled;
}

/** A two-phase match plan: the fills to apply and the unfilled remainder. */
export interface MatchPlan {
  readonly fills: readonly PlannedFill[];
  readonly remainder: Scaled;
}

/** An aggressor order to match (limit orders carry their limit price; market orders do not). */
export interface AggressorOrder {
  readonly side: OrderSide;
  readonly quantity: Scaled;
  readonly limitPrice?: Scaled;
}

/** The book. */
export interface LimitOrderBook {
  readonly instrumentId: Instrument["instrumentId"];
  place(order: RestingOrder): void;
  cancel(orderId: OrderId): RestingOrder | undefined;
  /** Plan a match WITHOUT mutating (FOK feasibility, post-only, IOC all decide on the plan). */
  planMatch(aggressor: AggressorOrder): MatchPlan;
  /** Apply a plan's fills (mutates resting quantities; removes fully-filled orders). */
  applyFills(plan: MatchPlan): void;
  /** Aggregated depth, bids descending / asks ascending, optionally truncated. */
  depth(levels?: number): { readonly bids: readonly BookLevel[]; readonly asks: readonly BookLevel[] };
  bestBid(): { readonly price: Scaled; readonly quantity: Scaled } | undefined;
  bestAsk(): { readonly price: Scaled; readonly quantity: Scaled } | undefined;
  /** Would a limit order at this price take liquidity (cross the opposite side)? */
  wouldCross(side: OrderSide, limitPrice: Scaled): boolean;
  restingCount(): number;
  restingOf(orderId: OrderId): RestingOrder | undefined;
}

/** One mutable book entry (internal only). */
interface BookEntry {
  orderId: OrderId;
  side: OrderSide;
  price: Scaled;
  quantity: Scaled;
  accountId: AccountId;
  participantId: ParticipantId;
  arrivalSeq: number;
}

/** Create one book for one instrument. */
export function createLimitOrderBook(instrument: Instrument): LimitOrderBook {
  const levels = new Map<Scaled, BookEntry[]>();
  let arrivalSeq = 0;

  const entries = (side: OrderSide): BookEntry[] => {
    const out: BookEntry[] = [];
    for (const queue of levels.values()) {
      for (const entry of queue) {
        if (entry.side === side) out.push(entry);
      }
    }
    return out;
  };

  const best = (side: OrderSide): { price: Scaled; quantity: Scaled } | undefined => {
    let bestPrice: Scaled | undefined;
    let total = 0n;
    for (const queue of levels.values()) {
      for (const entry of queue) {
        if (entry.side !== side) continue;
        if (
          bestPrice === undefined ||
          (side === "buy" ? entry.price > bestPrice : entry.price < bestPrice)
        ) {
          bestPrice = entry.price;
          total = entry.quantity;
        } else if (entry.price === bestPrice) {
          total += entry.quantity;
        }
      }
    }
    return bestPrice === undefined ? undefined : { price: bestPrice, quantity: total };
  };

  const toResting = (entry: BookEntry): RestingOrder => ({ ...entry });

  return {
    instrumentId: instrument.instrumentId,
    place(order) {
      arrivalSeq += 1;
      const entry: BookEntry = { ...order, arrivalSeq };
      const queue = levels.get(entry.price);
      if (queue === undefined) {
        levels.set(entry.price, [entry]);
      } else {
        queue.push(entry); // FIFO within one price level (time priority)
      }
    },
    cancel(orderId) {
      for (const [price, queue] of levels.entries()) {
        const index = queue.findIndex((entry) => entry.orderId === orderId);
        if (index >= 0) {
          const [removed] = queue.splice(index, 1);
          if (queue.length === 0) {
            levels.delete(price);
          }
          return removed === undefined ? undefined : toResting(removed);
        }
      }
      return undefined;
    },
    planMatch(aggressor) {
      const fills: PlannedFill[] = [];
      let remaining = aggressor.quantity;
      const opposite: OrderSide = aggressor.side === "buy" ? "sell" : "buy";
      // Collect the opposite side, best-price-first; within a price, FIFO by arrival.
      const oppositeEntries = entries(opposite).sort((a, b) => {
        const byPrice = opposite === "sell" ? a.price - b.price : b.price - a.price;
        return byPrice !== 0n ? (byPrice < 0n ? -1 : 1) : a.arrivalSeq - b.arrivalSeq;
      });
      for (const entry of oppositeEntries) {
        if (remaining <= 0n) break;
        if (aggressor.limitPrice !== undefined) {
          const crosses =
            aggressor.side === "buy" ? entry.price <= aggressor.limitPrice : entry.price >= aggressor.limitPrice;
          if (!crosses) break;
        }
        const fillQuantity = remaining < entry.quantity ? remaining : entry.quantity;
        fills.push({
          restingOrderId: entry.orderId,
          restingSide: entry.side,
          restingAccountId: entry.accountId,
          restingParticipantId: entry.participantId,
          price: entry.price,
          quantity: fillQuantity,
        });
        remaining -= fillQuantity;
      }
      return { fills, remainder: remaining };
    },
    applyFills(plan) {
      for (const fill of plan.fills) {
        const queue = levels.get(fill.price);
        if (queue === undefined) continue;
        const index = queue.findIndex((entry) => entry.orderId === fill.restingOrderId);
        if (index < 0) continue;
        const entry = queue[index]!;
        entry.quantity -= fill.quantity;
        if (entry.quantity <= 0n) {
          queue.splice(index, 1);
          if (queue.length === 0) {
            levels.delete(fill.price);
          }
        }
      }
    },
    depth(maxLevels) {
      const aggregate = (side: OrderSide): BookLevel[] => {
        const byPrice = new Map<Scaled, { quantity: Scaled; count: number }>();
        for (const entry of entries(side)) {
          const current = byPrice.get(entry.price) ?? { quantity: 0n, count: 0 };
          current.quantity += entry.quantity;
          current.count += 1;
          byPrice.set(entry.price, current);
        }
        // Exact bigint compare (never subtraction — bigint minus is not a number).
        const rows: BookLevel[] = [...byPrice.entries()]
          .sort((a, b) => {
            if (a[0] === b[0]) return 0;
            const bestFirst = side === "buy" ? a[0] > b[0] : a[0] < b[0];
            return bestFirst ? -1 : 1;
          })
          .map(([price, agg]) => ({
            price: formatPrice(price, instrument),
            quantity: formatQuantity(agg.quantity, instrument),
            orderCount: agg.count,
          }));
        return maxLevels === undefined ? rows : rows.slice(0, Math.max(0, maxLevels));
      };
      return { bids: aggregate("buy"), asks: aggregate("sell") };
    },
    bestBid() {
      return best("buy");
    },
    bestAsk() {
      return best("sell");
    },
    wouldCross(side, limitPrice) {
      if (side === "buy") {
        const ask = best("sell");
        return ask !== undefined && ask.price <= limitPrice;
      }
      const bid = best("buy");
      return bid !== undefined && bid.price >= limitPrice;
    },
    restingCount() {
      let count = 0;
      for (const queue of levels.values()) {
        count += queue.length;
      }
      return count;
    },
    restingOf(orderId) {
      for (const queue of levels.values()) {
        const found = queue.find((entry) => entry.orderId === orderId);
        if (found !== undefined) {
          return toResting(found);
        }
      }
      return undefined;
    },
  };
}

/** Build an empty (no-data-yet) book snapshot for an instrument (honest projection). */
export function emptyBookSnapshot(
  instrumentId: InstrumentId,
  asOf: TimestampMs,
  sequence: SequenceNumber,
): OrderBookSnapshot {
  return { instrumentId, asOf, sequence, bids: [], asks: [] };
}
