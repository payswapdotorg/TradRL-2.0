/**
 * Market projection contracts — the read models returned by QueryPort.
 *
 * These are the minimal market-state projection shapes the World Protocol
 * query methods need (quote, order book, trades, news). They are
 * projections, never authoritative state (A3/A6: UI polling is never
 * authoritative). Market EVENT taxonomy and the time system are owned by
 * W004 (`packages/tradrl-world-contracts/time/`).
 */

import type {
  InstrumentId,
  TradeId,
  WorldId,
} from "./ids.js";
import type {
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
} from "./primitives.js";
import type { OrderSide } from "./orders.js";
import type { InformationArtifact } from "./information.js";

/** Top-of-book quote (projection). */
export interface Quote {
  readonly instrumentId: InstrumentId;
  readonly bid?: Price;
  readonly bidSize?: Quantity;
  readonly ask?: Price;
  readonly askSize?: Quantity;
  readonly last?: Price;
  readonly asOf: TimestampMs;
}

/** One aggregated level of the order book. */
export interface BookLevel {
  readonly price: Price;
  readonly quantity: Quantity;
  readonly orderCount?: number;
}

/** Order-book projection (DOM). Bids descend, asks ascend by convention. */
export interface OrderBookSnapshot {
  readonly instrumentId: InstrumentId;
  readonly asOf: TimestampMs;
  readonly sequence: SequenceNumber;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
}

/** A public market trade (Time & Sales projection). */
export interface Trade {
  readonly tradeId: TradeId;
  readonly worldId: WorldId;
  readonly instrumentId: InstrumentId;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly aggressorSide: OrderSide;
  readonly occurredAt: TimestampMs;
  readonly sequence: SequenceNumber;
}

/** Query for `QueryPort.getTrades`. */
export interface TradeQuery {
  readonly from?: TimestampMs;
  readonly to?: TimestampMs;
  readonly limit?: number;
}

/** Payload of a news artifact. */
export interface NewsPayload {
  readonly headline: string;
  readonly summary?: string;
  readonly instruments?: readonly InstrumentId[];
}

/**
 * A news item is an information artifact with a news payload — the
 * information boundary (availableAt) applies to it like every artifact (A7).
 */
export type NewsItem = InformationArtifact<NewsPayload>;

/** Query for `QueryPort.getNews`. */
export interface NewsQuery {
  readonly instrumentId?: InstrumentId;
  readonly from?: TimestampMs;
  readonly to?: TimestampMs;
  readonly limit?: number;
}
