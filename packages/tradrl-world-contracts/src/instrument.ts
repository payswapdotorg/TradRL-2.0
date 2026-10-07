/**
 * Instrument and venue identity contracts.
 *
 * Spec: spec/ARCHITECTURE.md §5 "State":
 * Instrument — id/symbol, venue, asset class, quote currency, tick size,
 * lot size, precision, trading state.
 * Venue — matching rules, order types, fee schedule, latency, calendar,
 * halt/auction policy.
 * Spec: spec/DOMAIN-MODEL.md "Identity laws": ids are opaque; the human-readable
 * symbol is a display attribute, never the identity.
 */

import type { OrderKind } from "./orders.js";
import type { InstrumentId, VenueId, WorldId } from "./ids.js";
import type {
  BasisPoints,
  CurrencyCode,
  DecimalString,
  Price,
  Quantity,
  TimestampMs,
} from "./primitives.js";

/**
 * Asset classes recognized by World Alpha contracts.
 * Minimal additive closed set; extend through a contract change.
 */
export type AssetClass =
  | "equity"
  | "crypto"
  | "future"
  | "option"
  | "forex"
  | "commodity";

/**
 * Instrument trading state. `auction` covers halt/reopen auction phases
 * (SIMULATION.md "Synthetic regimes" includes halt/reopen).
 */
export type InstrumentTradingState =
  | "pre-open"
  | "open"
  | "halted"
  | "auction"
  | "closed";

/** A tradable instrument inside one world. */
export interface Instrument {
  readonly instrumentId: InstrumentId;
  readonly worldId: WorldId;
  readonly venueId: VenueId;
  /** Human-readable symbol. Display attribute only — never the identity. */
  readonly symbol: string;
  readonly displayName?: string;
  readonly assetClass: AssetClass;
  readonly quoteCurrency: CurrencyCode;
  /** Minimum price increment. */
  readonly tickSize: Price;
  /** Minimum tradable quantity increment. */
  readonly lotSize: Quantity;
  /** Decimal places used by the canonical decimal text for prices. */
  readonly pricePrecision: number;
  /** Decimal places used by the canonical decimal text for quantities. */
  readonly quantityPrecision: number;
  readonly tradingState: InstrumentTradingState;
  readonly tradable: boolean;
}

/** Deterministic matching model. World Alpha uses price-time priority. */
export type MatchingModel = "price-time-priority";

/** Fee schedule in basis points, plus an optional fixed per-order fee. */
export interface FeeSchedule {
  readonly makerRateBps: BasisPoints;
  readonly takerRateBps: BasisPoints;
  readonly fixedFee?: DecimalString;
}

/**
 * Deterministic latency hooks (R022: explicit latency policy).
 * Milliseconds of simulated delay between command acknowledgement and fill
 * propagation.
 */
export interface VenueLatency {
  readonly acknowledgementMs: number;
  readonly fillPropagationMs: number;
}

/** A trading session on the venue calendar. */
export interface TradingSession {
  readonly opensAt: TimestampMs;
  readonly closesAt: TimestampMs;
}

/** Venue calendar (minimal: ordered sessions). */
export interface TradingCalendar {
  readonly sessions: readonly TradingSession[];
}

/** Halt/auction policy (ARCHITECTURE.md §5 Venue "halt/auction policy"). */
export interface HaltPolicy {
  readonly haltOnShock: boolean;
  /** Reopen delay after a halt, in simulated milliseconds. */
  readonly reopenAfterMs?: number;
}

/** A trading venue. */
export interface Venue {
  readonly venueId: VenueId;
  readonly worldId: WorldId;
  readonly name: string;
  readonly matchingModel: MatchingModel;
  /** Order kinds this venue accepts; subset of `OrderKind`. */
  readonly allowedOrderKinds: readonly OrderKind[];
  readonly feeSchedule: FeeSchedule;
  readonly latency: VenueLatency;
  readonly calendar: TradingCalendar;
  readonly haltPolicy: HaltPolicy;
}
