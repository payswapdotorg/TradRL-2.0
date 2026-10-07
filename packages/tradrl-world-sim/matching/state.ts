/**
 * The matching state slice and its event reducer (W014 `matching` module).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — state mutates ONLY by reducing
 * journaled events — and A9 — the live matcher and journal replay advance
 * this state through the EXACT same function, which is what makes replay
 * bit-identical. The matcher applies every draft it emits to its working
 * copy through this reducer before the journal seals it (single path).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — World Engine → authoritative
 * live state; `Order`/`Fill`/`Trade` are the W003 contract projections of
 * that state.
 *
 * Book-delta law: `market.book.delta` events produced by THIS engine
 * (producer `matching-engine`) are projections of facts already reduced —
 * the reducer verifies them against the queue-derived book and throws on
 * mismatch (journal corruption). Foreign delta/snapshot events belong to
 * the market generator (W017) and fail closed here.
 */

import type {
  Fill,
  Order,
  OrderId,
  OrderSide,
  Price,
  Quantity,
  TimestampMs,
  Trade,
  TradeId,
  WorldId,
} from "tradrl-world-contracts";
import { ORDER_LIFECYCLE_TRANSITIONS } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { BookDeltaPayload, TradePrintPayload } from "tradrl-world-contracts/time";
import {
  haltBook,
  initialBookState,
  parseScaled,
  placeOrder,
  reduceOrder,
  removeOrder,
  reopenBook,
  withLastTradePrice,
  type BookState,
} from "../orderbook/index.js";
import { EngineInvariantError } from "../world/errors.js";
import type { WorldDefinition } from "../world/definition.js";
import {
  MATCHING_PRODUCER,
  isOrderAcceptedPayload,
  isOrderCanceledPayload,
  isOrderFilledPayload,
  isOrderRejectedPayload,
  isOrderReplacedPayload,
  isOrderTriggeredPayload,
} from "./events.js";
import type {
  OrderAcceptedPayload,
  OrderCanceledPayload,
  OrderFilledPayload,
  OrderRejectedPayload,
  OrderReplacedPayload,
  OrderTriggeredPayload,
} from "./events.js";

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

function bookOf(state: MatchingState, instrumentId: Trade["instrumentId"]): BookState {
  const book = state.books[String(instrumentId)];
  if (book === undefined) {
    throw new EngineInvariantError(`no book for instrument ${String(instrumentId)}`);
  }
  return book;
}

function withBook(
  state: MatchingState,
  instrumentId: Trade["instrumentId"],
  book: BookState,
): MatchingState {
  return { ...state, books: { ...state.books, [String(instrumentId)]: book } };
}

function orderOf(state: MatchingState, orderId: OrderId): Order {
  const order = state.orders.find((candidate) => candidate.orderId === orderId);
  if (order === undefined) {
    throw new EngineInvariantError(`event references unknown order ${String(orderId)}`);
  }
  return order;
}

function disarm(state: MatchingState, orderId: OrderId): MatchingState {
  const armedStops = state.armedStops.filter((stop) => stop.orderId !== orderId);
  return armedStops.length === state.armedStops.length ? state : { ...state, armedStops };
}

function assertTransition(order: Order, to: Order["status"], eventId: string): void {
  if (!(ORDER_LIFECYCLE_TRANSITIONS[order.status] ?? []).includes(to)) {
    throw new EngineInvariantError(
      `event ${eventId}: illegal order transition ${order.status} → ${to} for ${String(order.orderId)}`,
    );
  }
}

function reduceAccepted(
  state: MatchingState,
  payload: OrderAcceptedPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (state.orders.some((order) => order.orderId === payload.orderId)) {
    throw new EngineInvariantError(`duplicate order id ${String(payload.orderId)}`);
  }
  if (payload.submittedAt !== envelope.occurredAt) {
    throw new EngineInvariantError(
      `order ${String(payload.orderId)}: submittedAt must equal the acceptance event time`,
    );
  }
  const order: Order = {
    orderId: payload.orderId,
    worldId: envelope.worldId,
    instrumentId: payload.instrumentId,
    accountId: payload.accountId,
    submittedBy: payload.submittedBy,
    kind: payload.kind,
    side: payload.side,
    quantity: payload.quantity,
    filledQuantity: "0" as Quantity,
    ...(payload.limitPrice === undefined ? {} : { limitPrice: payload.limitPrice }),
    ...(payload.stopPrice === undefined ? {} : { stopPrice: payload.stopPrice }),
    constraints: payload.constraints,
    status: "accepted",
    submittedAt: payload.submittedAt,
  };
  let next: MatchingState = { ...state, orders: [...state.orders, order] };
  const resting = parseScaled(payload.restingQuantity);
  if (resting > 0n) {
    if (payload.limitPrice === undefined) {
      throw new EngineInvariantError(`order ${String(payload.orderId)} rests without a limit price`);
    }
    next = withBook(
      next,
      payload.instrumentId,
      placeOrder(bookOf(next, payload.instrumentId), {
        orderId: payload.orderId,
        side: payload.side,
        price: payload.limitPrice,
        remaining: resting,
        arrivalSequence: envelope.sequence,
      }),
    );
  }
  if (payload.kind === "stop" || payload.kind === "stop-limit") {
    if (payload.stopPrice === undefined) {
      throw new EngineInvariantError(`order ${String(payload.orderId)} arms without a stop price`);
    }
    next = {
      ...next,
      armedStops: [
        ...next.armedStops,
        {
          orderId: payload.orderId,
          instrumentId: payload.instrumentId,
          side: payload.side,
          stopPrice: payload.stopPrice,
          kind: payload.kind,
        },
      ],
    };
  }
  return next;
}

function reduceFilled(
  state: MatchingState,
  payload: OrderFilledPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  const order = orderOf(state, payload.orderId);
  assertTransition(order, payload.status, String(envelope.eventId));
  if (payload.fee.liquidity !== payload.liquidity) {
    throw new EngineInvariantError(
      `fill ${String(payload.fillId)}: fee liquidity disagrees with the fill`,
    );
  }
  const cumulative = parseScaled(payload.cumulativeFilledQuantity);
  const quantity = parseScaled(order.quantity);
  const filled = parseScaled(order.filledQuantity);
  if (cumulative <= filled || cumulative > quantity) {
    throw new EngineInvariantError(
      `fill ${String(payload.fillId)}: cumulative quantity not within (${String(filled)}, ${String(quantity)}]`,
    );
  }
  const expectStatus = cumulative === quantity ? "filled" : "partially-filled";
  if (payload.status !== expectStatus) {
    throw new EngineInvariantError(
      `fill ${String(payload.fillId)}: status disagrees with the cumulative quantity`,
    );
  }
  const updated: Order = {
    ...order,
    filledQuantity: payload.cumulativeFilledQuantity,
    status: payload.status,
    updatedAt: envelope.occurredAt,
  };
  const fill: Fill = {
    fillId: payload.fillId,
    worldId: envelope.worldId,
    orderId: payload.orderId,
    instrumentId: payload.instrumentId,
    accountId: payload.accountId,
    side: order.side,
    price: payload.price,
    quantity: payload.quantity,
    fee: payload.fee,
    liquidity: payload.liquidity,
    occurredAt: envelope.occurredAt,
    ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
    marketRef: payload.marketRef,
    sequence: payload.marketRef.sequence,
    eventId: envelope.eventId,
  };
  let next: MatchingState = {
    ...state,
    orders: state.orders.map((candidate) =>
      candidate.orderId === payload.orderId ? updated : candidate,
    ),
    fills: [...state.fills, fill],
  };
  if (payload.liquidity === "maker") {
    next = withBook(
      next,
      payload.instrumentId,
      reduceOrder(
        bookOf(next, payload.instrumentId),
        payload.orderId,
        parseScaled(payload.quantity),
      ),
    );
  }
  return next;
}

function reduceTriggered(
  state: MatchingState,
  payload: OrderTriggeredPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  const order = orderOf(state, payload.orderId);
  if (order.status !== "accepted") {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: trigger for non-working order ${String(payload.orderId)}`,
    );
  }
  let next = disarm(state, payload.orderId);
  const resting = parseScaled(payload.restingQuantity);
  if (resting > 0n) {
    if (payload.limitPrice === undefined) {
      throw new EngineInvariantError(
        `triggered order ${String(payload.orderId)} rests without a limit price`,
      );
    }
    next = withBook(
      next,
      payload.instrumentId,
      placeOrder(bookOf(next, payload.instrumentId), {
        orderId: payload.orderId,
        side: payload.side,
        price: payload.limitPrice,
        remaining: resting,
        arrivalSequence: envelope.sequence,
      }),
    );
  }
  return {
    ...next,
    orders: next.orders.map((candidate) =>
      candidate.orderId === payload.orderId
        ? { ...candidate, updatedAt: envelope.occurredAt }
        : candidate,
    ),
  };
}

function stopWorking(
  state: MatchingState,
  orderId: OrderId,
  status: "canceled" | "rejected" | "replaced",
  patch: Partial<Order>,
  envelope: WorldEventEnvelope,
): MatchingState {
  const order = orderOf(state, orderId);
  assertTransition(order, status, String(envelope.eventId));
  const next = disarm(
    withBook(state, order.instrumentId, removeOrder(bookOf(state, order.instrumentId), orderId)),
    orderId,
  );
  return {
    ...next,
    orders: next.orders.map((candidate) =>
      candidate.orderId === orderId
        ? { ...candidate, ...patch, status, updatedAt: envelope.occurredAt }
        : candidate,
    ),
  };
}

function reduceTradePrint(
  state: MatchingState,
  payload: TradePrintPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (
    typeof payload?.tradeId !== "string" ||
    typeof payload.instrumentId !== "string" ||
    typeof payload.price !== "string" ||
    typeof payload.quantity !== "string" ||
    (payload.aggressorSide !== "buy" && payload.aggressorSide !== "sell")
  ) {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: malformed market.trade.printed`,
    );
  }
  const trade: TradeRecord = {
    tradeId: payload.tradeId,
    worldId: envelope.worldId,
    instrumentId: payload.instrumentId,
    price: payload.price,
    quantity: payload.quantity,
    aggressorSide: payload.aggressorSide,
    occurredAt: envelope.occurredAt,
    sequence: envelope.sequence,
    ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
  };
  return withBook(
    { ...state, trades: [...state.trades, trade] },
    payload.instrumentId,
    withLastTradePrice(bookOf(state, payload.instrumentId), payload.price),
  );
}

function verifyBookDelta(
  state: MatchingState,
  payload: BookDeltaPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (envelope.producer !== MATCHING_PRODUCER) {
    throw new EngineInvariantError(
      "foreign market.book.delta events are the market generator's surface (W017), not reducible here",
    );
  }
  if (!Array.isArray(payload?.operations) || typeof payload.instrumentId !== "string") {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: malformed market.book.delta`,
    );
  }
  const book = bookOf(state, payload.instrumentId);
  for (const operation of payload.operations) {
    const levels = operation.side === "bid" ? book.bids : book.asks;
    const priceKey = parseScaled(operation.price);
    const level = levels.find((candidate) => candidate.priceScaled === priceKey);
    if (operation.op === "remove") {
      if (level !== undefined) {
        throw new EngineInvariantError(
          `book delta removes live level ${operation.price} (${String(envelope.eventId)})`,
        );
      }
      continue;
    }
    if (level === undefined) {
      throw new EngineInvariantError(
        `book delta sets missing level ${operation.price} (${String(envelope.eventId)})`,
      );
    }
    let total = 0n;
    for (const entry of level.entries) total += entry.remaining;
    if (total !== parseScaled(operation.quantity) || level.entries.length !== operation.orderCount) {
      throw new EngineInvariantError(
        `book delta disagrees with the book at ${operation.price} (${String(envelope.eventId)})`,
      );
    }
  }
  return state;
}

function reduceHaltOrReopen(state: MatchingState, scope: unknown, halted: boolean): MatchingState {
  const target = scope as { kind?: string; instrumentId?: unknown; venueId?: unknown };
  const books: Record<string, BookState> = { ...state.books };
  for (const [key, book] of Object.entries(books)) {
    const matches =
      target?.kind === "instrument"
        ? String(book.instrumentId) === String(target.instrumentId)
        : String(book.venueId) === String(target.venueId);
    if (matches) {
      books[key] = halted ? haltBook(book) : reopenBook(book);
    }
  }
  return { ...state, books };
}

/**
 * Reduce one journaled event into the matching state. Pure; the single way
 * this state ever advances — live (right after append) and replay alike.
 * Malformed payloads or violated laws are engine invariant errors (a journal
 * this engine version cannot reduce).
 */
export function reduceMatchingEvent(
  state: MatchingState,
  envelope: WorldEventEnvelope,
): MatchingState {
  switch (envelope.eventType) {
    case "matching.order.accepted":
      if (!isOrderAcceptedPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.accepted`,
        );
      }
      return reduceAccepted(state, envelope.payload, envelope);
    case "matching.order.filled":
      if (!isOrderFilledPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.filled`,
        );
      }
      return reduceFilled(state, envelope.payload, envelope);
    case "matching.order.triggered":
      if (!isOrderTriggeredPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.triggered`,
        );
      }
      return reduceTriggered(state, envelope.payload, envelope);
    case "matching.order.canceled":
      if (!isOrderCanceledPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.canceled`,
        );
      }
      return stopWorking(
        state,
        envelope.payload.orderId,
        "canceled",
        { cancelReason: envelope.payload.cancelReason },
        envelope,
      );
    case "matching.order.rejected":
      if (!isOrderRejectedPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.rejected`,
        );
      }
      return stopWorking(
        state,
        envelope.payload.orderId,
        "rejected",
        { rejectionReason: envelope.payload.rejectionReason },
        envelope,
      );
    case "matching.order.replaced":
      if (!isOrderReplacedPayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed matching.order.replaced`,
        );
      }
      return stopWorking(
        state,
        envelope.payload.orderId,
        "replaced",
        { replacedByOrderId: envelope.payload.replacedByOrderId },
        envelope,
      );
    case "market.trade.printed":
      return reduceTradePrint(state, envelope.payload as TradePrintPayload, envelope);
    case "market.book.delta":
      return verifyBookDelta(state, envelope.payload as BookDeltaPayload, envelope);
    case "market.halted":
      return reduceHaltOrReopen(state, (envelope.payload as { scope: unknown }).scope, true);
    case "market.reopened":
      return reduceHaltOrReopen(state, (envelope.payload as { scope: unknown }).scope, false);
    default:
      throw new EngineInvariantError(
        `matching reducer cannot reduce event type '${envelope.eventType}'`,
      );
  }
}
