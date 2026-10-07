/**
 * The authoritative limit-order book per instrument (W014 `orderbook`
 * module) — price levels with FIFO queues (price-time priority, SIMULATION.md
 * "Matching"), halt/reopen state transitions, and the W004 market-event
 * book-delta projection.
 *
 * Spec: spec/SIMULATION.md "Matching" — "Use price-time priority", partial
 * fills mandatory, halt/reopen regimes.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — deterministic ordering: the book is a
 * pure data structure; the same input stream ⇒ the same book state.
 * Spec: W004 contracts (`tradrl-world-contracts/time` marketEvents) —
 * `BookDeltaOperation`/`BookLevel` shapes and the law that delta operations
 * apply in array order.
 *
 * The book is IMMUTABLE (every operation returns a new state) so the world
 * reducer (matching/state.ts) can rebuild it during replay through the exact
 * same code path the live matcher uses — bit-identical replay (A6/A9).
 * Prices are keyed by numeric value (internal 12-decimal scale) so
 * "4800.25" and "4800.250" land on one level; the level's display price is
 * the canonical minimal text.
 */

import type {
  InstrumentId,
  OrderId,
  OrderSide,
  Price,
  Quantity,
  VenueId,
} from "tradrl-world-contracts";
import type { BookLevel, OrderBookSnapshot } from "tradrl-world-contracts";
import type { BookDeltaOperation } from "tradrl-world-contracts/time";
import type { Instrument, InstrumentTradingState } from "tradrl-world-contracts";
import type { SequenceNumber, TimestampMs } from "tradrl-world-contracts";
import { formatScaled, parseScaled, type Scaled } from "./decimal.js";

/** One resting order inside a level's FIFO queue (queue position = index). */
export interface BookEntry {
  readonly orderId: OrderId;
  /** Remaining resting quantity, on the internal decimal scale. */
  readonly remaining: Scaled;
  /** Journal sequence of the order's acceptance — the time-priority key. */
  readonly arrivalSequence: SequenceNumber;
}

/** One price level: all resting orders at one price, in arrival (FIFO) order. */
export interface BookLevelState {
  /** Canonical minimal decimal text of the level price. */
  readonly price: Price;
  /** The level price on the internal decimal scale (the numeric key). */
  readonly priceScaled: Scaled;
  readonly entries: readonly BookEntry[];
}

/**
 * The per-instrument book state. `tradingState` seeds from the instrument
 * definition and is transitioned by `market.halted`/`market.reopened`
 * events (W017's generator owns producing them; W014 owns the transitions).
 */
export interface BookState {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly tradingState: InstrumentTradingState;
  /** Last printed trade price (stop-trigger reference), when any trade ran. */
  readonly lastTradePrice?: Price;
  /** Bid levels, best (highest) first. */
  readonly bids: readonly BookLevelState[];
  /** Ask levels, best (lowest) first. */
  readonly asks: readonly BookLevelState[];
}

/** Where an order sits in the book (a located view of one resting order). */
export interface LocatedBookOrder {
  readonly side: OrderSide;
  readonly level: BookLevelState;
  readonly entry: BookEntry;
}

/** Seed the initial book for one instrument from its static declaration. */
export function initialBookState(instrument: Instrument): BookState {
  return {
    instrumentId: instrument.instrumentId,
    venueId: instrument.venueId,
    tradingState: instrument.tradingState,
    bids: [],
    asks: [],
  };
}

function sideLevels(book: BookState, side: OrderSide): readonly BookLevelState[] {
  return side === "buy" ? book.bids : book.asks;
}

/**
 * Binary-search a level by price. Returns the index of the level if present,
 * otherwise the insertion index (levels stay sorted: bids descending, asks
 * ascending — `descending` picks the direction).
 */
function levelIndex(
  levels: readonly BookLevelState[],
  priceScaled: Scaled,
  descending: boolean,
): { index: number; found: boolean } {
  let low = 0;
  let high = levels.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const level = levels[mid]!;
    const comparison = descending
      ? compareDesc(level.priceScaled, priceScaled)
      : compareAsc(level.priceScaled, priceScaled);
    if (comparison === 0) return { index: mid, found: true };
    if (comparison < 0) low = mid + 1;
    else high = mid;
  }
  return { index: low, found: false };
}

function compareAsc(a: Scaled, b: Scaled): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDesc(a: Scaled, b: Scaled): number {
  return a > b ? -1 : a < b ? 1 : 0;
}

/** Locate a resting order anywhere in the book (both sides are scanned). */
export function findBookOrder(book: BookState, orderId: OrderId): LocatedBookOrder | undefined {
  for (const side of ["buy", "sell"] as const) {
    for (const level of sideLevels(book, side)) {
      const entry = level.entries.find((candidate) => candidate.orderId === orderId);
      if (entry !== undefined) {
        return { side, level, entry };
      }
    }
  }
  return undefined;
}

/**
 * Place a resting order: appends to the FIFO queue of its price level,
 * creating the level in sorted position when needed. The caller owns the
 * quantity semantics (the matcher places the anticipated resting remainder).
 */
export function placeOrder(
  book: BookState,
  placement: {
    readonly orderId: OrderId;
    readonly side: OrderSide;
    readonly price: Price;
    readonly remaining: Scaled;
    readonly arrivalSequence: SequenceNumber;
  },
): BookState {
  const priceScaled = parseScaled(placement.price);
  const descending = placement.side === "buy";
  const levels = [...sideLevels(book, placement.side)];
  const { index, found } = levelIndex(levels, priceScaled, descending);
  const entry: BookEntry = {
    orderId: placement.orderId,
    remaining: placement.remaining,
    arrivalSequence: placement.arrivalSequence,
  };
  let updated: BookLevelState[];
  if (found) {
    const existing = levels[index]!;
    updated = [
      ...levels.slice(0, index),
      { ...existing, entries: [...existing.entries, entry] },
      ...levels.slice(index + 1),
    ];
  } else {
    const level: BookLevelState = {
      price: canonicalPrice(placement.price),
      priceScaled,
      entries: [entry],
    };
    updated = [...levels.slice(0, index), level, ...levels.slice(index)];
  }
  return withSide(book, placement.side, updated);
}

/**
 * Reduce a resting order's remaining quantity by `quantity` (a partial or
 * complete maker fill). The entry and level disappear at zero. Returns the
 * input book unchanged when the order is not resting.
 */
export function reduceOrder(
  book: BookState,
  orderId: OrderId,
  quantity: Scaled,
): BookState {
  const located = findBookOrder(book, orderId);
  if (located === undefined) {
    return book;
  }
  if (quantity > located.entry.remaining) {
    throw new Error(
      `book law violation: fill of ${String(quantity)} exceeds resting ${String(located.entry.remaining)} for ${String(orderId)}`,
    );
  }
  const remaining = located.entry.remaining - quantity;
  return remaining === 0n
    ? removeEntry(book, located.side, located.level.priceScaled, located.entry.orderId)
    : replaceEntry(book, located.side, located.level.priceScaled, located.entry.orderId, remaining);
}

/** Remove a resting order from the book (cancel/replace/defensive cleanup). */
export function removeOrder(book: BookState, orderId: OrderId): BookState {
  const located = findBookOrder(book, orderId);
  if (located === undefined) {
    return book;
  }
  return removeEntry(book, located.side, located.level.priceScaled, orderId);
}

function replaceEntry(
  book: BookState,
  side: OrderSide,
  priceScaled: Scaled,
  orderId: OrderId,
  remaining: Scaled,
): BookState {
  const levels = mutateLevel(book, side, priceScaled, (level) => ({
    ...level,
    entries: level.entries.map((entry) =>
      entry.orderId === orderId ? { ...entry, remaining } : entry,
    ),
  }));
  return withSide(book, side, levels);
}

function removeEntry(
  book: BookState,
  side: OrderSide,
  priceScaled: Scaled,
  orderId: OrderId,
): BookState {
  const levels = mutateLevel(book, side, priceScaled, (level) => {
    const entries = level.entries.filter((entry) => entry.orderId !== orderId);
    return entries.length === 0 ? undefined : { ...level, entries };
  });
  return withSide(book, side, levels);
}

/** Apply a mutation to one level; returning undefined removes the level. */
function mutateLevel(
  book: BookState,
  side: OrderSide,
  priceScaled: Scaled,
  mutate: (level: BookLevelState) => BookLevelState | undefined,
): readonly BookLevelState[] {
  const descending = side === "buy";
  const levels = [...sideLevels(book, side)];
  const { index, found } = levelIndex(levels, priceScaled, descending);
  if (!found) {
    return levels;
  }
  const mutated = mutate(levels[index]!);
  return mutated === undefined
    ? [...levels.slice(0, index), ...levels.slice(index + 1)]
    : [...levels.slice(0, index), mutated, ...levels.slice(index + 1)];
}

function withSide(book: BookState, side: OrderSide, levels: readonly BookLevelState[]): BookState {
  return side === "buy" ? { ...book, bids: levels } : { ...book, asks: levels };
}

/** Best (top-of-book) level of one side, when the side has liquidity. */
export function bestLevel(book: BookState, side: OrderSide): BookLevelState | undefined {
  const levels = sideLevels(book, side);
  return levels[0];
}

/**
 * The price levels an aggressive `takerSide` order may execute against, in
 * price-time priority order (buy sweeps asks ascending, sell sweeps bids
 * descending). `limitScaled` (when present) stops the walk at the taker's
 * limit price — levels beyond the limit are untouchable.
 */
export function aggressiveLevels(
  book: BookState,
  takerSide: OrderSide,
  limitScaled?: Scaled,
): readonly BookLevelState[] {
  const opposite = takerSide === "buy" ? book.asks : book.bids;
  if (limitScaled === undefined) {
    return opposite;
  }
  return opposite.filter((level) =>
    takerSide === "buy" ? level.priceScaled <= limitScaled : level.priceScaled >= limitScaled,
  );
}

/** Record the last printed trade price (the stop-trigger reference). */
export function withLastTradePrice(book: BookState, price: Price): BookState {
  return { ...book, lastTradePrice: canonicalPrice(price) };
}

/** Transition the book into the halted state (W004 `market.halted`). */
export function haltBook(book: BookState): BookState {
  return { ...book, tradingState: "halted" };
}

/** Transition the book back to open (W004 `market.reopened`). */
export function reopenBook(book: BookState): BookState {
  return { ...book, tradingState: "open" };
}

/** Aggregate the book into the W003 `OrderBookSnapshot` projection. */
export function bookSnapshot(
  book: BookState,
  input: { readonly asOf: TimestampMs; readonly sequence: SequenceNumber; readonly depth?: number },
): OrderBookSnapshot {
  const depth = input.depth;
  const bids = book.bids.slice(0, depth).map(projectLevel);
  const asks = book.asks.slice(0, depth).map(projectLevel);
  return {
    instrumentId: book.instrumentId,
    asOf: input.asOf,
    sequence: input.sequence,
    bids,
    asks,
  };
}

function projectLevel(level: BookLevelState): BookLevel {
  let total = 0n;
  for (const entry of level.entries) total += entry.remaining;
  return {
    price: level.price,
    quantity: formatScaled(total, 12) as Quantity,
    orderCount: level.entries.length,
  };
}

/**
 * Diff two book states into W004 `BookDeltaOperation[]`s: one `set` per
 * level whose quantity or order count changed, one `remove` per level that
 * disappeared. Operations are ordered bids (best first) then asks (best
 * first) — a deterministic order that is part of the delta contract.
 */
export function diffBookStates(before: BookState, after: BookState): BookDeltaOperation[] {
  const operations: BookDeltaOperation[] = [];
  for (const side of ["bid", "ask"] as const) {
    const bookSide: OrderSide = side === "bid" ? "buy" : "sell";
    const beforeLevels = sideLevels(before, bookSide);
    const afterLevels = sideLevels(after, bookSide);
    const afterByPrice = new Map(afterLevels.map((level) => [level.priceScaled, level]));
    const seen = new Set<Scaled>();
    for (const level of beforeLevels) {
      seen.add(level.priceScaled);
      const afterLevel = afterByPrice.get(level.priceScaled);
      if (afterLevel === undefined) {
        operations.push({ op: "remove", side, price: level.price });
      } else if (!sameLevel(level, afterLevel)) {
        operations.push({ op: "set", side, ...projectLevel(afterLevel) });
      }
    }
    for (const level of afterLevels) {
      if (!seen.has(level.priceScaled)) {
        operations.push({ op: "set", side, ...projectLevel(level) });
      }
    }
  }
  return operations;
}

function sameLevel(a: BookLevelState, b: BookLevelState): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i += 1) {
    const left = a.entries[i]!;
    const right = b.entries[i]!;
    if (left.orderId !== right.orderId || left.remaining !== right.remaining) return false;
  }
  return true;
}

/** Canonical minimal decimal text for a price ("4800.250" → "4800.25"). */
export function canonicalPrice(price: Price): Price {
  return formatScaled(parseScaled(price), 12) as Price;
}

/** Parse a price onto the internal scale (thin alias for readability). */
export function priceScaled(price: Price): Scaled {
  return parseScaled(price);
}

/** Parse a quantity onto the internal scale (thin alias for readability). */
export function quantityScaled(quantity: Quantity): Scaled {
  return parseScaled(quantity);
}

/** Format an internal-scale quantity back to canonical decimal text. */
export function formatQuantity(value: Scaled): Quantity {
  return formatScaled(value, 12) as Quantity;
}
