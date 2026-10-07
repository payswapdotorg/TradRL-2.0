/**
 * The verification harness's OWN adversarial fixtures (W022).
 *
 * Independence law: the harness does NOT import the W021 package's test
 * fixtures — it authors its own rows to the documented NautilusTrader dtype
 * shapes (independently transcribed; the W021 package's declarations name
 * the conventions these rows exercise). A verification harness that reuses
 * the subject's own fixtures verifies nothing about the fixture AUTHORSHIP;
 * these are the harness's independent adversarial inputs, hand-authored and
 * deterministic (same rows every run — A9).
 *
 * INT64 PRECISION DISCIPLINE (mirrors the adapter's disclosed law): numeric
 * ns fixture values are exactly representable doubles (ms values scaled by
 * 10^6); sub-millisecond and full-fidelity cases use STRING ns digits.
 *
 * Fixed base time: 2023-11-20T02:40:00Z (epoch ms 1_700_448_000_000 — the
 * family's fixture base).
 */

import type { InstrumentId } from "tradrl-world-contracts";
import type { NautilusInstrumentTable } from "tradrl-adapters-nautilus/instruments";

/** Fixture base time (2023-11-20T02:40:00Z). */
export const T0_MS = 1_700_448_000_000;
export const T0_NS = 1_700_448_000_000_000_000;
export const MINUTE_MS = 60_000;
export const MINUTE_NS = 60_000_000_000;
export const DAY_MS = 86_400_000;

/**
 * Exact ns digit string of an epoch-ms value (BigInt — double multiplication
 * loses precision above 2^53, so the digit strings are computed exactly by
 * construction; the harness never hand-types an ns literal it can compute).
 */
export function nsOf(ms: number): string {
  return (BigInt(ms) * 1_000_000n).toString();
}

/** The harness's declared instrument table (three instruments incl. a dashed PERP symbol). */
export const HARNESS_INSTRUMENTS: NautilusInstrumentTable = {
  "BTCUSDT-BINANCE": "instrument-btcusdt" as InstrumentId,
  "ETHUSD-BINANCE": "instrument-ethusd" as InstrumentId,
  "BTCUSDT-PERP-BINANCE": "instrument-btcusdt-perp" as InstrumentId,
};

/** A documented-shape Bar row with overridable fields (adversarial by construction). */
export function barRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
    open: 48000.1,
    high: 48000.6,
    low: 48000,
    close: 48000.4,
    volume: 12.5,
    ts_event: T0_NS,
    ts_init: T0_NS + MINUTE_NS,
    ...overrides,
  };
}

/** Three contiguous one-minute bars (the clean batch). */
export const CLEAN_BARS: readonly Record<string, unknown>[] = [
  barRow(),
  barRow({
    open: 48000.4,
    high: 48001,
    low: 48000.2,
    close: 48000.9,
    volume: 9.75,
    ts_event: T0_NS + MINUTE_NS,
    ts_init: T0_NS + 2 * MINUTE_NS,
  }),
  barRow({
    open: 48000.9,
    high: 48001.2,
    low: 48000.7,
    close: 48001.1,
    volume: 15.25,
    ts_event: T0_NS + 2 * MINUTE_NS,
    ts_init: T0_NS + 3 * MINUTE_NS,
  }),
];

/** The first and third bar only — the sequence-hole batch (the middle bar is missing). */
export const HOLE_BARS: readonly Record<string, unknown>[] = [CLEAN_BARS[0]!, CLEAN_BARS[2]!];

/** A documented-shape TradeTick row with overridable fields. */
export function tradeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument_id: "BTCUSDT-BINANCE",
    price: 48000.25,
    size: 0.5,
    aggressor_side: "BUY",
    trade_id: 20_930_421,
    ts_event: "1700448000000500000",
    ts_init: "1700448000000750000",
    ...overrides,
  };
}

/** Three ascending trade prints (BUY/SELL mix, int64 ids, string ns with sub-ms remainders). */
export const CLEAN_TRADES: readonly Record<string, unknown>[] = [
  tradeRow(),
  tradeRow({
    price: 48000.3,
    size: 0.25,
    aggressor_side: "SELL",
    trade_id: 20_930_422,
    ts_event: "1700448010000123456",
    ts_init: "1700448010000373456",
  }),
  tradeRow({
    price: 48000.2,
    size: 1,
    aggressor_side: "BUY",
    trade_id: 20_930_423,
    ts_event: "1700448020000987654",
    ts_init: "1700448020001237654",
  }),
];

/** A documented-shape QuoteTick row with overridable fields. */
export function quoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument_id: "BTCUSDT-BINANCE",
    bid_price: 48000.1,
    ask_price: 48000.3,
    bid_size: 3,
    ask_size: 5,
    ts_event: "1700448000000123456",
    ts_init: "1700448000000123456",
    ...overrides,
  };
}

/** Three ascending top-of-book quote observations (no `last` anywhere — the documented dtype). */
export const CLEAN_QUOTES: readonly Record<string, unknown>[] = [
  quoteRow(),
  quoteRow({
    bid_price: 48000.15,
    ask_price: 48000.35,
    bid_size: 2.5,
    ask_size: 4.75,
    ts_event: "1700448005000123456",
    ts_init: "1700448005000373456",
  }),
  quoteRow({
    bid_price: 48000.05,
    ask_price: 48000.25,
    bid_size: 1.25,
    ask_size: 6.5,
    ts_event: "1700448015000987654",
    ts_init: "1700448015000987654",
  }),
];

/** A well-formed OrderBookDelta row (the honest UNMAPPABLE dtype — shape valid, mapping refused). */
export const ORDER_BOOK_DELTA_ROW: Record<string, unknown> = {
  instrument_id: "BTCUSDT-BINANCE",
  action: "DELTA",
  order_book_action: "UPDATE",
  order: { order_id: 1, price: 48000.1, size: 1, side: "SELL", seq: 1 },
  flags: 0,
  sequence: 1,
  ts_event: T0_NS,
  ts_init: T0_NS + 250_000,
};

/**
 * The ns sanity-window boundaries (1990-01-01T00:00:00Z .. 2100-01-01T00:00:00Z)
 * as ns digit strings — the inclusive window edges a legitimate catalog export
 * may carry. Computed by BigInt (ns = ms × 10^6) so the digit strings are
 * exact by construction, never hand-typed.
 */
export const WINDOW_FLOOR_NS = "631152000000000000";
export const WINDOW_CEILING_NS = "4102444800000000000";
/** floor + one minute (a valid ts_init for a bar opening exactly at the floor). */
export const FLOOR_PLUS_MINUTE_NS = "631152060000000000";
/** ceiling − one minute (a bar whose close lands exactly at the ceiling). */
export const CEILING_MINUS_MINUTE_NS = "4102444740000000000";

/** The classic unit-swap corruptions (a smaller unit in the ns field) as raw numbers. */
export const MS_IN_NS_FIELD = 1_700_448_000_000; // 2023 epoch-ms mistaken for ns -> 1970-01
export const US_IN_NS_FIELD = 1_700_448_000_000_000; // epoch-us mistaken for ns -> 1970-01
export const S_IN_NS_FIELD = 1_700_448_000; // epoch-s mistaken for ns -> 1970-01

/**
 * Exact ns digit string of (epoch-ms + a sub-millisecond ns remainder) — the
 * full-fidelity carrier form with a genuinely fractional millisecond.
 */
export function nsOfPlusRemainder(ms: number, remainderNs: number): string {
  return (BigInt(ms) * 1_000_000n + BigInt(remainderNs)).toString();
}

/** A full-fidelity sub-millisecond ns string (truncation, never rounding). */
export const SUB_MS_NS = nsOfPlusRemainder(T0_MS + 123, 456_789);

/** A ns string whose remainder is maximal (…999999 — must truncate DOWN, not carry). */
export const MAX_REMAINDER_NS = nsOfPlusRemainder(T0_MS + 999, 999_999);

/** ts_init of a 1-minute bar opening at SUB_MS_NS: closes at +60000ms, remainder maximal. */
export const SUB_MS_BAR_INIT_NS = nsOfPlusRemainder(T0_MS + 60_123, 999_999);

/** ts_init of a 1-minute bar opening at MAX_REMAINDER_NS. */
export const MAX_REMAINDER_BAR_INIT_NS = nsOfPlusRemainder(T0_MS + 60_999, 999_999);
