/**
 * Primitive value contracts shared by all trading/world domain contracts.
 *
 * Spec: spec/DOMAIN-MODEL.md — "Financial precision":
 * "Money, price and quantity use explicit decimal/precision policies.
 *  Display formatting is never financial truth."
 *
 * Policy chosen here (minimal additive; the specs mandate explicitness but do
 * not fix a representation): money, price and quantity are carried as
 * canonical decimal strings (e.g. "101.25"), never as binary floats.
 * Engines may use any decimal implementation internally, but the contract
 * boundary is decimal text so values round-trip losslessly.
 *
 * Time (spec/WORLD-PROTOCOL.md "Time") distinguishes wallTime,
 * simulationTime, eventTime and availableAt. Full time contracts are owned by
 * W004 (`packages/tradrl-world-contracts/time/`); this module defines only the
 * minimal `TimestampMs` alias these contracts need.
 */

/** Milliseconds since Unix epoch. Minimal alias; W004 owns the time system. */
export type TimestampMs = number & { readonly __brand: "TimestampMs" };

/**
 * Monotonic per-world sequence number (WORLD-PROTOCOL.md: "Sequence is
 * monotonic within a world").
 */
export type SequenceNumber = number & { readonly __brand: "SequenceNumber" };

/** Canonical decimal text (no exponent form, e.g. "1234.56"). */
export type DecimalString = string & { readonly __brand: "DecimalString" };

/** ISO 4217-style currency code (or venue-defined crypto asset symbol). */
export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

/** A price value in the instrument's quote currency. */
export type Price = DecimalString & { readonly __brand: "Price" };

/**
 * A quantity value. Always non-negative on orders/fills; position quantities
 * are signed (positive long, negative short).
 */
export type Quantity = DecimalString & { readonly __brand: "Quantity" };

/** An amount of money in an explicit currency. */
export interface Money {
  readonly amount: DecimalString;
  readonly currency: CurrencyCode;
}

/**
 * Plain numeric ratio (leverage, speed multiplier, rate in basis points).
 * Ratios are not money and may use plain numbers.
 */
export type Ratio = number;

/** Rate in basis points (1 bps = 0.01%). */
export type BasisPoints = number;
