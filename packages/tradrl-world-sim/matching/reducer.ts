/**
 * The matching state reducer (W014 `matching` module) — the single-path law.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — state mutates ONLY by reducing
 * journaled events — and A9 — the live matcher and journal replay advance
 * state through the EXACT same function, which is what makes replay
 * bit-identical. The matcher applies every draft it emits to its working
 * copy through this reducer before the journal seals it (single path); the
 * world core and journal replay then advance the authoritative state
 * through the same function (world/state.ts delegates here).
 *
 * Order-lifecycle reductions live here; market-fact reductions (trade
 * prints, book-delta verification, halt/reopen) live in marketFacts.ts.
 * Malformed payloads or violated laws are engine invariant errors (a
 * journal this engine version cannot reduce).
 */

import type {
  Fill,
  Order,
  OrderId,
  Quantity,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { BookDeltaPayload, TradePrintPayload } from "tradrl-world-contracts/time";
import { parseScaled, placeOrder, reduceOrder, removeOrder } from "../orderbook/index.js";
import { EngineInvariantError } from "../world/errors.js";
import {
  isMatchingOrderEventType,
  isOrderAcceptedPayload,
  isOrderCanceledPayload,
  isOrderFilledPayload,
  isOrderRejectedPayload,
  isOrderReplacedPayload,
  isOrderTriggeredPayload,
  MATCHING_PRODUCER,
} from "./events.js";
import type {
  OrderAcceptedPayload,
  OrderFilledPayload,
  OrderTriggeredPayload,
} from "./events.js";
import {
  assertTransition,
  bookOf,
  disarm,
  orderOf,
  withBook,
  type MatchingState,
} from "./state.js";
import { reduceHaltOrReopen, reduceTradePrint, verifyBookDelta } from "./marketFacts.js";

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

/**
 * Reduce one journaled event into the matching state. Pure; the single way
 * this state ever advances — live (right after append) and replay alike.
 *
 * PRODUCER LAW (the W014 deferral, delivered with W017): the order lifecycle
 * is the matching engine's alone — no other producer (the market generator
 * included) may journal order facts. Verified up front, before any payload
 * inspection, live and on replay alike.
 */
export function reduceMatchingEvent(
  state: MatchingState,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (isMatchingOrderEventType(envelope.eventType) && envelope.producer !== MATCHING_PRODUCER) {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: producer '${String(envelope.producer)}' may not produce ` +
        `order lifecycle events (only '${String(MATCHING_PRODUCER)}' can)`,
    );
  }
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
      return reduceHaltOrReopen(state, envelope, true);
    case "market.reopened":
      return reduceHaltOrReopen(state, envelope, false);
    default:
      throw new EngineInvariantError(
        `matching reducer cannot reduce event type '${envelope.eventType}'`,
      );
  }
}
