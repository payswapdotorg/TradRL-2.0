/**
 * Tests for the Coinbase Exchange provider (W026): the candle mapping
 * (SECONDS -> ms explicit conversion, the [time, low, high, open, close,
 * volume] column order, the declared-granularity interval end, newest-first
 * reversal, hole detection), the trade mapping (strict ISO parse, the
 * maker-side -> aggressor conversion) and the ticker mapping (bid/ask/last,
 * sizes honestly absent).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coinbaseExchangeProvider,
  mapCoinbaseCandle,
  mapCoinbaseTicker,
  mapCoinbaseTrade,
} from "../coinbase.js";
import { mapCryptoFeed } from "../mapping.js";
import { feedOf, validateCryptoProvider } from "../providers.js";
import {
  COINBASE_CANDLES,
  COINBASE_CANDLES_WITH_HOLE,
  COINBASE_SYMBOLS,
  COINBASE_TICKER,
  COINBASE_TRADES,
  T0,
  T0_SECONDS,
  assertOkMapping,
} from "./fixtures.js";

const provider = coinbaseExchangeProvider(COINBASE_SYMBOLS);
const candleContext = {
  symbols: COINBASE_SYMBOLS,
  symbol: "BTC-USD",
  granularityMs: 60_000,
};

test("provider descriptor: the three documented feeds, honest polling, valid structure", () => {
  assert.deepEqual(
    provider.feeds.map((feed) => feed.feedId),
    ["coinbase.candles", "coinbase.trades", "coinbase.ticker"],
  );
  assert.equal(provider.polling.liveFetch, "not-implemented");
  assert.deepEqual(validateCryptoProvider(provider), []);
  assert.equal(feedOf(provider, "coinbase.candles")?.requiresGranularityMs, true);
  assert.equal(feedOf(provider, "coinbase.candles")?.recordOrder, "descending");
  assert.equal(feedOf(provider, "coinbase.trades")?.timestampUnit, "iso-8601");
  assert.equal(feedOf(provider, "coinbase.ticker")?.recordOrder, "single");
});

test("candle: the seconds bucket start converts explicitly and the column order is honored", () => {
  // Fixture row 2 is the OLDEST candle (rows are newest-first): [t, low, high, open, close, volume]
  const oldest = (COINBASE_CANDLES.payload as unknown[][])[2]!;
  const result = mapCoinbaseCandle(oldest, candleContext);
  assertOkMapping(result);
  assert.deepEqual(result.record, {
    kind: "bar",
    symbol: "BTC-USD",
    openTime: T0, // 1700448000 seconds -> 1700448000000 ms (explicit ×1000)
    closeTime: T0 + 60_000, // start + declared granularity (the row carries no end)
    open: "37000.10", // column 3 — NOT the Binance column order
    high: "37000.60", // column 2
    low: "37000.00", // column 1
    close: "37000.40", // column 4
    volume: "12.50", // column 5
  });
});

test("candle: without a declared granularity the interval end would be invented — typed rejection", () => {
  const result = mapCoinbaseCandle((COINBASE_CANDLES.payload as unknown[][])[0]!, {
    symbols: COINBASE_SYMBOLS,
    symbol: "BTC-USD",
  });
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "missing-field");
  assert.match(result.violations[0]?.detail ?? "", /granularityMs/);
});

test("candle: a MILLISECONDS value in the seconds field is the classic trap and is rejected", () => {
  const row = [...((COINBASE_CANDLES.payload as unknown[][])[0] as unknown[])];
  row[0] = T0; // ms value where the documented convention is seconds
  const result = mapCoinbaseCandle(row, candleContext);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "timestamp-out-of-range");
  assert.match(result.violations[0]?.detail ?? "", /milliseconds value/);
});

test("candle: malformed shapes, bad decimals and inconsistent OHLC are collected", () => {
  const short = mapCoinbaseCandle([T0_SECONDS, "1", "2", "3", "4"], candleContext);
  assert.ok(!short.ok);
  assert.equal(short.violations[0]?.kind, "malformed-record");

  const badDecimal = mapCoinbaseCandle(
    [T0_SECONDS, "37000.00", "37000.60", "0x10", "37000.40", "12.50"],
    candleContext,
  );
  assert.ok(!badDecimal.ok);
  assert.equal(badDecimal.violations[0]?.kind, "malformed-record");

  const inverted = mapCoinbaseCandle(
    [T0_SECONDS, "37000.60", "37000.00", "37000.10", "37000.40", "12.50"], // low > high
    candleContext,
  );
  assert.ok(!inverted.ok);
  assert.equal(inverted.violations[0]?.kind, "malformed-record");
});

test("candles batch: the newest-first page is reversed to event-time order", () => {
  const mapping = mapCryptoFeed(provider, "coinbase.candles", COINBASE_CANDLES.payload, {
    symbol: "BTC-USD",
    granularity: "1m",
    granularityMs: 60_000,
  });
  assertOkMapping(mapping);
  const times = mapping.records.map((record) => (record.kind === "bar" ? record.openTime : -1));
  assert.deepEqual(times, [T0, T0 + 60_000, T0 + 120_000]);
});

test("candles batch: a sequence hole is DETECTED and declared as a known gap", () => {
  const mapping = mapCryptoFeed(
    provider,
    "coinbase.candles",
    COINBASE_CANDLES_WITH_HOLE.payload,
    { symbol: "BTC-USD", granularity: "1m", granularityMs: 60_000 },
  );
  assert.ok(mapping.ok);
  assert.deepEqual(mapping.datasetDescriptor.knownGaps, [
    {
      from: T0 + 60_000,
      to: T0 + 120_000,
      reason:
        "no bar covers this interval in the provider batch (adapter-detected sequence hole — declared, not invented)",
    },
  ]);
});

test("trade: ISO time parses exactly (microseconds truncated) and side converts maker -> aggressor", () => {
  const newest = (COINBASE_TRADES.payload as Record<string, unknown>[])[0]!;
  const result = mapCoinbaseTrade(newest, { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" });
  assertOkMapping(result);
  assert.deepEqual(result.record, {
    kind: "trade",
    symbol: "BTC-USD",
    timestamp: 1_700_448_020_500, // "2023-11-20T00:00:20.500000Z"
    price: "37000.20",
    quantity: "1.00000000",
    aggressorSide: "buy", // side "sell" = the MAKER sold -> the aggressor bought
    tradeId: "5000003",
  });
});

test("trade: microsecond timestamps truncate deterministically to the ms contract", () => {
  const oldest = (COINBASE_TRADES.payload as Record<string, unknown>[])[2]!;
  const result = mapCoinbaseTrade(oldest, { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" });
  assertOkMapping(result);
  if (result.record.kind !== "trade") {
    assert.fail(`expected a trade record, got '${result.record.kind}'`);
  }
  assert.equal(result.record.timestamp, 1_700_448_001_123); // .123456 -> 123ms
});

test("trade: malformed ISO time, missing side and bad decimals are typed and collected", () => {
  const badTime = mapCoinbaseTrade(
    { time: "2023-11-20 00:00:01", trade_id: 1, price: "1", size: "1", side: "buy" },
    { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" },
  );
  assert.ok(!badTime.ok);
  assert.equal(badTime.violations[0]?.kind, "malformed-record");

  const noSide = mapCoinbaseTrade(
    { time: "2023-11-20T00:00:01Z", trade_id: 1, price: "1", size: "1" },
    { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" },
  );
  assert.ok(!noSide.ok);
  assert.equal(noSide.violations[0]?.kind, "missing-field");

  const badSide = mapCoinbaseTrade(
    { time: "2023-11-20T00:00:01Z", trade_id: 1, price: "1", size: "1", side: "taker" },
    { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" },
  );
  assert.ok(!badSide.ok);
  assert.equal(badSide.violations[0]?.kind, "malformed-record");
});

test("trades batch: newest-first rows are reversed; ids keep their source identity", () => {
  const mapping = mapCryptoFeed(provider, "coinbase.trades", COINBASE_TRADES.payload, {
    symbol: "BTC-USD",
  });
  assertOkMapping(mapping);
  assert.deepEqual(
    mapping.records.map((record) => (record.kind === "trade" ? record.tradeId : "?")),
    ["5000001", "5000002", "5000003"],
  );
  const times = mapping.records.map((record) => (record.kind === "trade" ? record.timestamp : -1));
  assert.deepEqual(times.sort((a, b) => a - b), times);
});

test("ticker: bid/ask/last mapped, bid/ask sizes honestly absent, ISO time exact", () => {
  const result = mapCoinbaseTicker(COINBASE_TICKER.payload, {
    symbols: COINBASE_SYMBOLS,
    symbol: "BTC-USD",
  });
  assertOkMapping(result);
  assert.deepEqual(result.record, {
    kind: "quote",
    symbol: "BTC-USD",
    timestamp: 1_700_448_025_750, // "2023-11-20T00:00:25.750000Z"
    bid: "37000.10",
    ask: "37000.30",
    last: "37000.20",
    // bidSize/askSize: the documented endpoint carries none — never fabricated
  });
  assert.equal("bidSize" in result.record, false);
  assert.equal("askSize" in result.record, false);
});

test("ticker: a record with none of bid/ask/price is refused as malformed", () => {
  const result = mapCoinbaseTicker(
    { trade_id: 1, time: "2023-11-20T00:00:25Z", size: "1", volume: "2" },
    { symbols: COINBASE_SYMBOLS, symbol: "BTC-USD" },
  );
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "malformed-record");
});

test("ticker feed: the documented single-object response rejects an array payload", () => {
  const mapping = mapCryptoFeed(provider, "coinbase.ticker", [COINBASE_TICKER.payload], {
    symbol: "BTC-USD",
  });
  assert.ok(!mapping.ok);
  assert.equal(mapping.violations[0]?.kind, "malformed-record");
  assert.match(mapping.violations[0]?.detail ?? "", /SINGLE record object/);
});

test("unmapped product id: typed unknown-symbol, never silently dropped", () => {
  const mapping = mapCryptoFeed(provider, "coinbase.trades", COINBASE_TRADES.payload, {
    symbol: "SOL-USD",
  });
  assert.ok(!mapping.ok);
  assert.equal(mapping.violations.every((violation) => violation.kind === "unknown-symbol"), true);
  assert.equal(mapping.violations.length, 3); // every row reported — collect-everything
});
