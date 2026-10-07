/**
 * Order contracts: kinds, time-in-force/execution constraints, identity,
 * states and the lifecycle transition law.
 *
 * Spec: spec/ARCHITECTURE.md §6 "Execution" — World Alpha supports
 * market / limit / stop / stop-limit, IOC, FOK, post-only, reduce-only and
 * cancel/replace.
 * Spec: spec/SIMULATION.md "Matching" — deterministic price-time priority with
 * mandatory partial fills.
 * Spec: spec/REQUIREMENTS.md R020 (market/limit/stop families).
 */

import type {
  AccountId,
  InstrumentId,
  OrderId,
  ParticipantId,
  WorldId,
} from "./ids.js";
import type { Price, Quantity, TimestampMs } from "./primitives.js";

/** Order families supported by World Alpha (ARCHITECTURE.md §6). */
export type OrderKind = "market" | "limit" | "stop" | "stop-limit";

/** Direction of the order. */
export type OrderSide = "buy" | "sell";

/**
 * Time-in-force. `GTC` is the default; `IOC` cancels any unfilled remainder
 * immediately; `FOK` rejects unless the whole quantity fills immediately.
 */
export type TimeInForce = "GTC" | "IOC" | "FOK";

/**
 * Execution constraints that modify how an order may execute
 * (ARCHITECTURE.md §6: IOC, FOK, post-only, reduce-only).
 */
export interface OrderExecutionConstraints {
  readonly timeInForce: TimeInForce;
  /** Reject if the order would take (cross) liquidity. */
  readonly postOnly?: boolean;
  /** Reject if executing would increase the position's absolute size. */
  readonly reduceOnly?: boolean;
}

/**
 * Order lifecycle states.
 *
 * - `pending`: submitted, awaiting venue acceptance.
 * - `accepted`: resting/working on the book (or armed, for stops).
 * - `partially-filled`: at least one fill, remainder still working.
 * - `filled` / `canceled` / `rejected` / `expired` / `replaced`: terminal.
 */
export type OrderStatus =
  | "pending"
  | "accepted"
  | "partially-filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired"
  | "replaced";

/** The state every order starts in. */
export const ORDER_INITIAL_STATUS: OrderStatus = "pending";

/** Terminal states: no outgoing lifecycle transitions. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "filled",
  "canceled",
  "rejected",
  "expired",
  "replaced",
];

/**
 * The order lifecycle transition law.
 *
 * Invariants (enforced by tests):
 * - every transition target is a valid `OrderStatus`;
 * - terminal states have no outgoing transitions;
 * - every non-terminal state can reach a terminal state (no zombie orders);
 * - `replaced` is only reachable from working states (cancel/replace never
 *   applies to terminal orders — that is `unknown-order`/`order-not-modifiable`
 *   rejection instead).
 */
export const ORDER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  pending: ["accepted", "rejected", "canceled", "expired", "partially-filled", "filled"],
  accepted: [
    "partially-filled",
    "filled",
    "canceled",
    "expired",
    "replaced",
    "rejected",
  ],
  "partially-filled": ["partially-filled", "filled", "canceled", "expired", "replaced"],
  filled: [],
  canceled: [],
  rejected: [],
  expired: [],
  replaced: [],
};

/** True when the status admits no further lifecycle transitions. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * Order rejection reasons (R022/R024: explicit policies; risk and authority
 * gates are runtime controls, not prompt text — ARCHITECTURE-LOCK A13).
 *
 * Minimal additive closed set for World Alpha; extensions go through a
 * contract change.
 */
export type OrderRejectionReason =
  | "invalid-price" // not a multiple of the instrument tick size
  | "invalid-quantity" // not a multiple of lot size, or non-positive
  | "insufficient-buying-power"
  | "risk-limit"
  | "market-closed"
  | "market-halted"
  | "instrument-not-tradable"
  | "order-kind-not-supported"
  | "post-only-would-take"
  | "reduce-only-would-increase-position"
  | "fok-unfillable"
  | "unknown-order" // cancel/replace target does not exist
  | "order-not-modifiable" // cancel/replace target is terminal
  | "duplicate-command"
  | "unauthorized"
  | "live-execution-not-permitted";

/** Reasons an order can stop working without being rejected. */
export type OrderCancelReason =
  | "user-request"
  | "ioc-remainder" // IOC unfilled remainder canceled by the venue
  | "session-end"
  | "replaced" // superseded by a cancel/replace
  | "risk-intervention";

/**
 * An order as held by the authoritative world state.
 * `filledQuantity` is cumulative; partial fills update it monotonically.
 */
export interface Order {
  readonly orderId: OrderId;
  readonly worldId: WorldId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly submittedBy: ParticipantId;
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: Quantity;
  readonly filledQuantity: Quantity;
  /** Required for `limit` and `stop-limit`. */
  readonly limitPrice?: Price;
  /** Required for `stop` and `stop-limit`. */
  readonly stopPrice?: Price;
  readonly constraints: OrderExecutionConstraints;
  readonly status: OrderStatus;
  readonly submittedAt: TimestampMs;
  readonly updatedAt?: TimestampMs;
  readonly rejectionReason?: OrderRejectionReason;
  readonly cancelReason?: OrderCancelReason;
  /** Set when this order was replaced; points at the successor order. */
  readonly replacedByOrderId?: OrderId;
}

/** Query filter for `QueryPort.getOrders`. */
export interface OrderQuery {
  readonly accountId?: AccountId;
  readonly instrumentId?: InstrumentId;
  readonly statuses?: readonly OrderStatus[];
}
