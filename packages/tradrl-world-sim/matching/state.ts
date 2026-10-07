/**
 * The matching state slice (W014 `matching` module).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — state mutates ONLY by reducing
 * journaled events — and A9 — the live matcher and journal replay advance
 * this state through the EXACT same reducer (reducer.ts), which is what
 * makes replay bit-identical. The matcher applies every draft it emits to
 * its working copy through that reducer before the journal seals it
 * (single path).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — World Engine → authoritative
 * live state; `Order`/`Fill`/`Trade` are the W003 contract projections of
 * that state.
 *
 * This module owns the state SHAPE, its derivation from the world
 * definition, the deterministic id allocation and the internal lookup
 * helpers the reducer builds on.
 */

import type {
  Fill,
  Order,
  OrderId,
  OrderSide,
  Price,
  TimestampMs,
  Trade,
  TradeId,
  WorldId,
} from "tradrl-world-contracts";
import { ORDER_LIFECYCLE_TRANSITIONS } from "tradrl-world-contracts";
import { initialBookState, type BookState } from "../orderbook/index.js";
import { EngineInvariantError } from "../world/errors.js";
import type { WorldDefinition } from "../world/definition.js";

/** A trade record with its observability gate (the envelope's availableAt). */
export type TradeRecord = Trade & { readonly availableAt?: TimestampMs };

/** An armed stop order awaiting its stop price to be crossed by a trade. */
export interface ArmedStop {
  readonly orderId: OrderId;
  readonly instrumentId: Trade["instrumentId"];
  readonly side: OrderSide;
  readonly stopPrice: Price;
  readonly kind: "stop" | "stop-limit";
}

/**
 * The authoritative matching state: the order registry, the fill set, the
 * public trade tape and the per-instrument books. Everything here is
 * derived from journaled events only.
 */
export interface MatchingState {
  readonly orders: readonly Order[];
  readonly fills: readonly Fill[];
  readonly trades: readonly TradeRecord[];
  /** Keyed by instrument id (opaque ids are Record keys, never parsed). */
  readonly books: Readonly<Record<string, BookState>>;
  /** Armed stops in arming order (the deterministic trigger order). */
  readonly armedStops: readonly ArmedStop[];
}

/** Build the initial matching state from the static world definition. */
export function initialMatchingState(definition: WorldDefinition): MatchingState {
  const books: Record<string, BookState> = {};
  for (const instrument of definition.instruments) {
    books[String(instrument.instrumentId)] = initialBookState(instrument);
  }
  return { orders: [], fills: [], trades: [], books, armedStops: [] };
}

/** Deterministic order id for the next accepted order (state position + 1). */
export function nextOrderId(worldId: WorldId, state: MatchingState): OrderId {
  return `ord:${String(worldId)}:${String(state.orders.length + 1)}` as OrderId;
}

/** Deterministic fill id for the next fill. */
export function nextFillId(worldId: WorldId, state: MatchingState): string {
  return `fil:${String(worldId)}:${String(state.fills.length + 1)}`;
}

/** Deterministic trade id for the next printed trade. */
export function nextTradeId(worldId: WorldId, state: MatchingState): TradeId {
  return `trd:${String(worldId)}:${String(state.trades.length + 1)}` as TradeId;
}

/** The book of one instrument (every reduction path goes through here). */
export function bookOf(state: MatchingState, instrumentId: Trade["instrumentId"]): BookState {
  const book = state.books[String(instrumentId)];
  if (book === undefined) {
    throw new EngineInvariantError(`no book for instrument ${String(instrumentId)}`);
  }
  return book;
}

/** Return the state with one instrument's book replaced. */
export function withBook(
  state: MatchingState,
  instrumentId: Trade["instrumentId"],
  book: BookState,
): MatchingState {
  return { ...state, books: { ...state.books, [String(instrumentId)]: book } };
}

/** The registry record of one order (reductions reference existing orders). */
export function orderOf(state: MatchingState, orderId: OrderId): Order {
  const order = state.orders.find((candidate) => candidate.orderId === orderId);
  if (order === undefined) {
    throw new EngineInvariantError(`event references unknown order ${String(orderId)}`);
  }
  return order;
}

/** Remove one order from the armed-stop list (trigger/cancel/replace/reject). */
export function disarm(state: MatchingState, orderId: OrderId): MatchingState {
  const armedStops = state.armedStops.filter((stop) => stop.orderId !== orderId);
  return armedStops.length === state.armedStops.length ? state : { ...state, armedStops };
}

/** Enforce the W003 order-lifecycle transition law (corrupt journals fail). */
export function assertTransition(order: Order, to: Order["status"], eventId: string): void {
  if (!(ORDER_LIFECYCLE_TRANSITIONS[order.status] ?? []).includes(to)) {
    throw new EngineInvariantError(
      `event ${eventId}: illegal order transition ${order.status} → ${to} for ${String(order.orderId)}`,
    );
  }
}
