/**
 * Shared deterministic fixtures for the W026 `tradrl-adapters-crypto`
 * tests — recorded-shape stand-ins for the documented public REST record
 * shapes of the two baseline exchanges.
 *
 * HONESTY LABELING (work-order law): every fixture carries a
 * `FixtureProvenance` naming the endpoint, the documentation source and the
 * shape-snapshot date. The payloads are HAND-AUTHORED to the documented
 * response shapes (value realism, structural fidelity) — they are NOT live
 * captures; the W026 baseline performs no network IO by design. A
 * meta-test asserts every fixture stays labeled.
 *
 * Fixed base time: 2023-11-20T00:00:00Z (epoch 1700448000000) — the same
 * era the W020 fixtures use.
 */

import type { InstrumentId, Price, Quantity, TimestampMs } from "tradrl-world-contracts";
import type { DatasetId } from "tradrl-world-contracts/data";
import type { CryptoSymbolTable } from "../symbols.js";
import assert from "node:assert/strict";

/** W020-fixture-style typed literal helpers (brands are casts, never lies). */
export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export function price(text: string): Price {
  return text as Price;
}

export function qty(text: string): Quantity {
  return text as Quantity;
}

export function datasetIdOf(text: string): DatasetId {
  return text as DatasetId;
}

/**
 * Narrow a `{ ok: true | false }` union to its ok branch (node:test style —
 * `assert.ok(x.ok)` narrows the property, not the parent).
 */
export function assertOkMapping<T extends { readonly ok: boolean }>(
  result: T,
): asserts result is Exclude<T, { readonly ok: false }> {
  if (!result.ok) {
    assert.fail(`expected an ok result, got: ${JSON.stringify(result)}`);
  }
}

/** The labeling record every fixture must carry (never blank — meta-tested). */
export interface FixtureProvenance {
  readonly feedId: string;
  readonly endpoint: string;
  readonly docSource: string;
  readonly shapeSnapshotDate: string;
  readonly note: string;
}

/** One labeled fixture: provenance + hand-authored documented-shape payload. */
export interface LabeledFixture {
  readonly provenance: FixtureProvenance;
  readonly payload: unknown;
}

export const BINANCE_SYMBOLS: CryptoSymbolTable = {
  BTCUSDT: "instrument-btcusdt" as InstrumentId,
  ETHUSDT: "instrument-ethusdt" as InstrumentId,
};

export const COINBASE_SYMBOLS: CryptoSymbolTable = {
  "BTC-USD": "instrument-btcusd" as InstrumentId,
  "ETH-USD": "instrument-ethusd" as InstrumentId,
};

/** Fixed fixture base time (2023-11-20T02:40:00Z, epoch ms) — the same base value the W020 fixtures use. */
export const T0 = 1_700_448_000_000;
/** The same instant in epoch seconds (the Coinbase candle convention). */
export const T0_SECONDS = 1_700_448_000;
export const MINUTE = 60_000;

const BINANCE_DOCS =
  "Binance Spot API reference (developers.binance.com, binance-spot-api-docs)";
const COINBASE_DOCS = "Coinbase Exchange API reference (api.exchange.coinbase.com)";
const HAND_AUTHORED =
  "hand-authored to the documented response shape on the snapshot date — not a live capture (the W026 baseline performs no network IO)";
const SNAPSHOT_DATE = "2026-10-07";

/**
 * Binance klines (BTCUSDT, 1m): three contiguous 1-minute bars. Column
 * order per the docs: openTime, open, high, low, close, volume, closeTime
 * (INCLUSIVE last millisecond), quoteVolume, trades, takerBuyBase,
 * takerBuyQuote, unused.
 */
export const BINANCE_KLINES: LabeledFixture = {
  provenance: {
    feedId: "binance.klines",
    endpoint: "GET /api/v3/klines?symbol=BTCUSDT&interval=1m",
    docSource: BINANCE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    [
      T0,
      "4800.10",
      "4800.60",
      "4800.00",
      "4800.40",
      "12.50000000",
      T0 + 59_999,
      "60030.00",
      37,
      "7.00000000",
      "33610.00",
      "0",
    ],
    [
      T0 + MINUTE,
      "4800.40",
      "4801.00",
      "4800.20",
      "4800.90",
      "9.75000000",
      T0 + MINUTE + 59_999,
      "46809.00",
      29,
      "4.75000000",
      "22804.00",
      "0",
    ],
    [
      T0 + 2 * MINUTE,
      "4800.90",
      "4801.20",
      "4800.70",
      "4801.10",
      "15.25000000",
      T0 + 2 * MINUTE + 59_999,
      "73219.00",
      41,
      "9.25000000",
      "44411.00",
      "0",
    ],
  ],
};

/**
 * Binance aggTrades (BTCUSDT): three aggregate trades in ascending time
 * order; `m` = "was the buyer the maker" (true -> the aggressor sold).
 */
export const BINANCE_AGG_TRADES: LabeledFixture = {
  provenance: {
    feedId: "binance.aggTrades",
    endpoint: "GET /api/v3/aggTrades?symbol=BTCUSDT",
    docSource: BINANCE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    { a: 20_930_421, p: "4800.25", q: "0.50000000", T: T0 + 500, m: true, M: true },
    { a: 20_930_422, p: "4800.30", q: "0.25000000", T: T0 + 10_000, m: false, M: true },
    { a: 20_930_423, p: "4800.20", q: "1.00000000", T: T0 + 20_000, m: true, M: false },
  ],
};

/** Binance bookTicker (BTCUSDT): best bid/ask — carries NO timestamp. */
export const BINANCE_BOOK_TICKER: LabeledFixture = {
  provenance: {
    feedId: "binance.bookTicker",
    endpoint: "GET /api/v3/ticker/bookTicker?symbol=BTCUSDT",
    docSource: BINANCE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: {
    symbol: "BTCUSDT",
    bidPrice: "4800.25",
    bidQty: "3.00000000",
    askPrice: "4800.50",
    askQty: "5.00000000",
  },
};

/**
 * Coinbase candles (BTC-USD, 60s granularity): rows are
 * [time(s), low, high, open, close, volume] in DESCENDING (newest-first)
 * order — the documented Exchange API shape. Three contiguous one-minute
 * candles ending at T0 + 3m.
 */
export const COINBASE_CANDLES: LabeledFixture = {
  provenance: {
    feedId: "coinbase.candles",
    endpoint: "GET /products/BTC-USD/candles?granularity=60",
    docSource: COINBASE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    [T0_SECONDS + 120, "37000.70", "37001.20", "37000.90", "37001.10", "15.25"],
    [T0_SECONDS + 60, "37000.20", "37001.00", "37000.40", "37000.90", "9.75"],
    [T0_SECONDS, "37000.00", "37000.60", "37000.10", "37000.40", "12.50"],
  ],
};

/**
 * Coinbase candles WITH A SEQUENCE HOLE (the middle candle missing): the
 * adapter must DETECT the hole and declare it as a known gap
 * [T0+60s, T0+120s).
 */
export const COINBASE_CANDLES_WITH_HOLE: LabeledFixture = {
  provenance: {
    feedId: "coinbase.candles",
    endpoint: "GET /products/BTC-USD/candles?granularity=60",
    docSource: COINBASE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    [T0_SECONDS + 120, "37000.70", "37001.20", "37000.90", "37001.10", "15.25"],
    [T0_SECONDS, "37000.00", "37000.60", "37000.10", "37000.40", "12.50"],
  ],
};

/**
 * Coinbase trades (BTC-USD): rows in DESCENDING (newest-first) trade-id
 * order; `time` is ISO-8601 UTC with microsecond precision (same T0 era as the candle fixtures); `side` is the
 * declared MAKER side.
 */
export const COINBASE_TRADES: LabeledFixture = {
  provenance: {
    feedId: "coinbase.trades",
    endpoint: "GET /products/BTC-USD/trades",
    docSource: COINBASE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      time: "2023-11-20T02:40:20.500000Z",
      trade_id: 5_000_003,
      price: "37000.20",
      size: "1.00000000",
      side: "sell",
    },
    {
      time: "2023-11-20T02:40:10.250000Z",
      trade_id: 5_000_002,
      price: "37000.30",
      size: "0.25000000",
      side: "buy",
    },
    {
      time: "2023-11-20T02:40:01.123456Z",
      trade_id: 5_000_001,
      price: "37000.25",
      size: "0.50000000",
      side: "buy",
    },
  ],
};

/**
 * Coinbase ticker (BTC-USD): best bid/ask + last trade price with an
 * ISO-8601 time — carries NO bid/ask sizes (the documented shape).
 */
export const COINBASE_TICKER: LabeledFixture = {
  provenance: {
    feedId: "coinbase.ticker",
    endpoint: "GET /products/BTC-USD/ticker",
    docSource: COINBASE_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: {
    trade_id: 5_000_003,
    price: "37000.20",
    bid: "37000.10",
    ask: "37000.30",
    size: "1.00000000",
    time: "2023-11-20T02:40:25.750000Z",
    volume: "12345.67000000",
  },
};

/** Every labeled fixture (the meta-test's inventory — keep it complete). */
export const ALL_FIXTURES: readonly LabeledFixture[] = [
  BINANCE_KLINES,
  BINANCE_AGG_TRADES,
  BINANCE_BOOK_TICKER,
  COINBASE_CANDLES,
  COINBASE_CANDLES_WITH_HOLE,
  COINBASE_TRADES,
  COINBASE_TICKER,
];
