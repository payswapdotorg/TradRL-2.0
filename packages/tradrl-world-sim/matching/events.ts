/**
 * The matching-engine event taxonomy (W014 `matching` module) — the typed
 * payloads for the order-lifecycle facts this producer owns, plus the W004
 * market-event payloads the matcher emits into the shared stream
 * (`market.trade.printed`, `market.book.delta`).
 *
 * Spec: spec/SIMULATION.md "Matching" (order kinds, TIF, policies, partial
 * fills), spec/DOMAIN-MODEL.md (`Order`/`Execution`/`Fill` semantics),
 * spec/ACCEPTANCE-WORLD-ALPHA.md C (execution behaviors) and L (causal
 * journal events with provenance for every order lifecycle).
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — commands emit ordered domain events;
 * the W003 envelope `eventType` is opaque, typed taxonomies belong to their
 * producers (here: the matching engine).
 *
 * Causality law (W003 `execution.ts`): every fill references the market
 * trade that generated it — `marketRef.tradeId` plus the world `sequence` of
 * the `market.trade.printed` event of that trade. The matcher RESERVES the
 * journal sequences of its batch up front (dense from the journal cursor),
 * so a fill draft can cite the sequence of the trade draft emitted just
 * before it; the journal then seals exactly those positions.
 *
 * Closed set — additions go through a deliberate matching-engine change,
 * mirrored in tests.
 */

import type {
  AccountId,
  FillFee,
  FillId,
  InstrumentId,
  LiquidityRole,
  MarketStateReference,
  OrderCancelReason,
  OrderExecutionConstraints,
  OrderId,
  OrderKind,
  OrderRejectionReason,
  OrderSide,
  OrderStatus,
  ParticipantId,
  Price,
  ProducerId,
  Quantity,
  TimestampMs,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { BookDeltaPayload, TradePrintPayload } from "tradrl-world-contracts/time";

/** Schema version stamped on every matching-engine event. */
export const MATCHING_EVENT_SCHEMA_VERSION = "tradrl-world-sim.matching@1";

/** The producer identity for matching-engine events. */
export const MATCHING_PRODUCER = "matching-engine" as ProducerId;

/** Closed set of matching-engine order-lifecycle event types. */
export const MATCHING_ORDER_EVENT_TYPES = [
  "matching.order.accepted",
  "matching.order.filled",
  "matching.order.triggered",
  "matching.order.canceled",
  "matching.order.rejected",
  "matching.order.replaced",
] as const;

export type MatchingOrderEventType = (typeof MATCHING_ORDER_EVENT_TYPES)[number];

/** Type guard: does this event type belong to the order lifecycle? */
export function isMatchingOrderEventType(eventType: string): boolean {
  return (MATCHING_ORDER_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Every event type whose reduction belongs to the matching state reducer
 * (matching/state.ts): the order lifecycle above plus the market facts the
 * matcher produces or consumes (`market.halted`/`market.reopened` transition
 * the book; the market generator — W017, delivered — produces the regime
 * ones, so both producers are lawful there, see marketFacts.ts).
 */
export const MATCHING_STATE_EVENT_TYPES: readonly string[] = [
  ...MATCHING_ORDER_EVENT_TYPES,
  "market.trade.printed",
  "market.book.delta",
  "market.halted",
  "market.reopened",
];

/** Type guard: does this event type belong to the matching state reducer? */
export function isMatchingStateEventType(eventType: string): boolean {
  return MATCHING_STATE_EVENT_TYPES.includes(eventType);
}

/** A journal event whose payload belongs to this taxonomy. */
export type MatchingEventEnvelope = WorldEventEnvelope<MatchingEventPayload>;

// --- payloads -------------------------------------------------------------------

/** Base fields shared by every order-lifecycle payload. */
interface OrderEventBase {
  readonly orderId: OrderId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
}

/**
 * Payload of `matching.order.accepted` — the venue accepted a working order.
 * `restingQuantity` is the quantity that rests on the book NOW (the matcher
 * places the anticipated resting remainder up front, so an order that
 * partially crosses and then rests never appears as takeable liquidity);
 * "0" for armed stops and fully-crossing submissions.
 */
export interface OrderAcceptedPayload extends OrderEventBase {
  readonly type: "matching.order.accepted";
  readonly submittedBy: ParticipantId;
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: Quantity;
  readonly limitPrice?: Price;
  readonly stopPrice?: Price;
  readonly constraints: OrderExecutionConstraints;
  readonly restingQuantity: Quantity;
  readonly submittedAt: TimestampMs;
}

/** Payload of `matching.order.filled` — one fill and the order's new state. */
export interface OrderFilledPayload extends OrderEventBase {
  readonly type: "matching.order.filled";
  readonly fillId: FillId;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly fee: FillFee;
  readonly liquidity: LiquidityRole;
  /** The market trade that generated this fill (causality law). */
  readonly marketRef: MarketStateReference;
  /** Cumulative filled quantity after this fill (monotonic, ≤ quantity). */
  readonly cumulativeFilledQuantity: Quantity;
  readonly status: OrderStatus;
}

/**
 * Payload of `matching.order.triggered` — an armed stop armed by the stop
 * price being crossed by a printed trade. The stop now executes as
 * `executionKind` (market, or limit at `limitPrice` for stop-limits);
 * `restingQuantity` carries the anticipated resting remainder for
 * stop-limits that rest after triggering.
 */
export interface OrderTriggeredPayload extends OrderEventBase {
  readonly type: "matching.order.triggered";
  readonly kind: "stop" | "stop-limit";
  readonly side: OrderSide;
  readonly stopPrice: Price;
  /** The last printed trade price that satisfied the trigger. */
  readonly triggerPrice: Price;
  readonly executionKind: "market" | "limit";
  readonly limitPrice?: Price;
  readonly restingQuantity: Quantity;
}

/** Payload of `matching.order.canceled` — a working order stopped working. */
export interface OrderCanceledPayload extends OrderEventBase {
  readonly type: "matching.order.canceled";
  readonly cancelReason: OrderCancelReason;
  /** Unfilled remainder at cancellation (informational). */
  readonly remainingQuantity: Quantity;
}

/** Payload of `matching.order.rejected` — the venue rejected a working order. */
export interface OrderRejectedPayload extends OrderEventBase {
  readonly type: "matching.order.rejected";
  readonly rejectionReason: OrderRejectionReason;
  readonly message?: string;
}

/** Payload of `matching.order.replaced` — superseded by a successor order. */
export interface OrderReplacedPayload extends OrderEventBase {
  readonly type: "matching.order.replaced";
  readonly replacedByOrderId: OrderId;
  readonly remainingQuantity: Quantity;
}

export type MatchingOrderEventPayload =
  | OrderAcceptedPayload
  | OrderFilledPayload
  | OrderTriggeredPayload
  | OrderCanceledPayload
  | OrderRejectedPayload
  | OrderReplacedPayload;

export type MatchingEventPayload = MatchingOrderEventPayload | TradePrintPayload | BookDeltaPayload;

// --- structural payload guards (used by the reducer on replay) ------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isOrderAcceptedPayload(payload: unknown): payload is OrderAcceptedPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.accepted") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.submittedBy === "string" &&
    (payload.kind === "market" ||
      payload.kind === "limit" ||
      payload.kind === "stop" ||
      payload.kind === "stop-limit") &&
    (payload.side === "buy" || payload.side === "sell") &&
    typeof payload.quantity === "string" &&
    typeof payload.restingQuantity === "string" &&
    typeof payload.submittedAt === "number" &&
    isRecord(payload.constraints) &&
    typeof payload.constraints.timeInForce === "string"
  );
}

export function isOrderFilledPayload(payload: unknown): payload is OrderFilledPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.filled") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.fillId === "string" &&
    typeof payload.price === "string" &&
    typeof payload.quantity === "string" &&
    typeof payload.liquidity === "string" &&
    isRecord(payload.fee) &&
    typeof payload.fee.currency === "string" &&
    typeof payload.fee.amount === "string" &&
    typeof payload.fee.rateBps === "number" &&
    isRecord(payload.marketRef) &&
    typeof payload.marketRef.tradeId === "string" &&
    typeof payload.marketRef.sequence === "number" &&
    typeof payload.cumulativeFilledQuantity === "string" &&
    typeof payload.status === "string"
  );
}

export function isOrderTriggeredPayload(payload: unknown): payload is OrderTriggeredPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.triggered") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    (payload.kind === "stop" || payload.kind === "stop-limit") &&
    (payload.side === "buy" || payload.side === "sell") &&
    typeof payload.stopPrice === "string" &&
    typeof payload.triggerPrice === "string" &&
    (payload.executionKind === "market" || payload.executionKind === "limit") &&
    typeof payload.restingQuantity === "string" &&
    (payload.limitPrice === undefined || typeof payload.limitPrice === "string")
  );
}

export function isOrderCanceledPayload(payload: unknown): payload is OrderCanceledPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.canceled") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.cancelReason === "string" &&
    typeof payload.remainingQuantity === "string"
  );
}

export function isOrderRejectedPayload(payload: unknown): payload is OrderRejectedPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.rejected") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.rejectionReason === "string"
  );
}

export function isOrderReplacedPayload(payload: unknown): payload is OrderReplacedPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.replaced") return false;
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.replacedByOrderId === "string" &&
    typeof payload.remainingQuantity === "string"
  );
}
