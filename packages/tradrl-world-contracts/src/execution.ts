/**
 * Execution and fill contracts.
 *
 * Spec: spec/DOMAIN-MODEL.md entities `Execution` and `Fill`.
 * Spec: spec/ARCHITECTURE.md §6 — "It models partial fills, fees, latency
 * hooks, deterministic matching and rejection reasons."
 * Spec: spec/SIMULATION.md — "Partial fills are mandatory."
 * Spec: spec/REQUIREMENTS.md R021 (partial fills), R022 (explicit fees).
 *
 * Causality law: every fill causally connects to
 *  (a) its originating order (`orderId`), and
 *  (b) the market state it executed against (`marketRef`: the market trade id
 *      produced by matching plus the world sequence).
 */

import type {
  AccountId,
  EventId,
  ExecutionId,
  FillId,
  InstrumentId,
  OrderId,
  TradeId,
  WorldId,
} from "./ids.js";
import type {
  BasisPoints,
  CurrencyCode,
  DecimalString,
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
} from "./primitives.js";
import type { OrderSide } from "./orders.js";

/** Which side of the trade provided liquidity for a fill. */
export type LiquidityRole = "maker" | "taker";

/**
 * The market state a fill executed against. A fill is never free-floating:
 * it references the market trade created by the matching engine and the
 * world sequence at which that trade occurred.
 */
export interface MarketStateReference {
  readonly tradeId: TradeId;
  readonly sequence: SequenceNumber;
}

/** Fee charged for one fill, priced in the instrument's quote currency. */
export interface FillFee {
  readonly currency: CurrencyCode;
  readonly amount: DecimalString;
  readonly liquidity: LiquidityRole;
  /** Rate actually applied for auditability (from the venue fee schedule). */
  readonly rateBps: BasisPoints;
}

/**
 * A single (possibly partial) fill of an order.
 *
 * Invariants (enforced by tests):
 * - `quantity` is positive and, summed with the order's other fills, never
 *   exceeds the order quantity;
 * - `price`/`quantity` are canonical decimal strings;
 * - `occurredAt` is not earlier than the order's `submittedAt`;
 * - `orderId` + `marketRef` + `sequence` provide the causal chain.
 */
export interface Fill {
  readonly fillId: FillId;
  readonly worldId: WorldId;
  readonly orderId: OrderId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly side: OrderSide;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly fee: FillFee;
  readonly liquidity: LiquidityRole;
  readonly occurredAt: TimestampMs;
  /** Earliest legal observation time; omitted when it equals `occurredAt`. */
  readonly availableAt?: TimestampMs;
  readonly marketRef: MarketStateReference;
  /** World event sequence of the market trade this fill belongs to. */
  readonly sequence: SequenceNumber;
  /** Event that emitted this fill (journal/evidence linkage, acceptance L). */
  readonly eventId?: EventId;
}

/** Terminal outcome of an order's execution aggregate. */
export type ExecutionStatus = "open" | "complete" | "canceled" | "rejected";

/**
 * Aggregate execution record for one order: the fill set plus cumulative
 * economics (DOMAIN-MODEL.md `Execution`).
 */
export interface Execution {
  readonly executionId: ExecutionId;
  readonly worldId: WorldId;
  readonly orderId: OrderId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly fillIds: readonly FillId[];
  /** Cumulative filled quantity; never exceeds the order quantity. */
  readonly filledQuantity: Quantity;
  /** Cumulative fees across all fills, in quote currency. */
  readonly totalFee: DecimalString;
  readonly feeCurrency: CurrencyCode;
  readonly startedAt: TimestampMs;
  readonly completedAt?: TimestampMs;
  readonly status: ExecutionStatus;
}
