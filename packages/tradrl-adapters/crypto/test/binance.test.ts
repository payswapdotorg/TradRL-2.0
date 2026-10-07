/**
 * Tests for the Binance Spot provider (W026): the provider descriptor's
 * honest declarations, the kline mapping (inclusive close time -> half-open
 * interval end, granularity cross-check, loud timestamp/decimal/OHLC
 * rejection), the aggTrade mapping (the buyer-maker -> aggressor
 * conversion), and the bookTicker unmappable-by-declaration rejection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binanceSpotProvider,
  mapBinanceAggTrade,
  mapBinanceBookTicker,
  mapBinanceKline,
} from "../binance.js";
import { feedOf, validateCryptoProvider } from "../providers.js";
import type { CryptoRecordContext } from "../providers.js";
import { resolveProviderSymbol } from "../symbols.js";
import {
  BINANCE_AGG_TRADES,
  BINANCE_BOOK_TICKER,
  BINANCE_KLINES,
  BINANCE_SYMBOLS,
  T0,
  assertOkMapping,
} from "./fixtures.js";

const provider = binanceSpotProvider(BINANCE_SYMBOLS);
const klineContext: CryptoRecordContext = {
  symbols: BINANCE_SYMBOLS,
  symbol: "BTCUSDT",
  granularityMs: 60_000,
};

test("provider descriptor: the three documented feeds, honest polling, valid structure", () => {
  assert.deepEqual(
    provider.feeds.map((feed) => feed.feedId),
    ["binance.klines", "binance.aggTrades", "binance.bookTicker"],
  );
  assert.equal(provider.polling.liveFetch, "not-implemented");
  assert.deepEqual(validateCryptoProvider(provider), []);
  assert.equal(feedOf(provider, "binance.klines")?.outputKind, "bar");
  assert.equal(feedOf(provider, "binance.aggTrades")?.outputKind, "trade");
  assert.equal(feedOf(provider, "binance.bookTicker")?.outputKind, "unmappable");
});

test("provider descriptor: the doc snapshot label is present (fixtures label the same source)", () => {
  assert.equal(provider.docs.shapeSnapshotDate, "2026-10-07");
  assert.match(provider.docs.source, /Binance Spot API reference/);
  assert.match(provider.docs.note, /not live captures/);
});

test("kline: OHLCV verbatim, close time + 1ms -> half-open interval end, no availableAt", () => {
  const result = mapBinanceKline(
    (BINANCE_KLINES.payload as unknown[][])[0],
    klineContext,
  );
  assertOkMapping(result);
  assert.deepEqual(result.record, {
    kind: "bar",
    symbol: "BTCUSDT",
    openTime: T0,
    closeTime: T0 + 60_000, // documented close time T0+59_999 + 1 (declared conversion)
    open: "4800.10",
    high: "4800.60",
    low: "4800.00",
    close: "4800.40",
    volume: "12.50000000",
    // availableAt: the documented row carries none — omitted, never invented
  });
});

test("kline: all fixture rows map, each with the exact 1m interval", () => {
  for (const row of BINANCE_KLINES.payload as unknown[][]) {
    const result = mapBinanceKline(row, klineContext);
    assertOkMapping(result);
    if (result.record.kind !== "bar") {
      assert.fail(`expected a bar record, got '${result.record.kind}'`);
    }
    assert.equal(result.record.closeTime - result.record.openTime, 60_000);
  }
});

test("kline: interval length contradicting the declared granularity is a typed mismatch", () => {
  const mismatch = mapBinanceKline((BINANCE_KLINES.payload as unknown[][])[0], {
    ...klineContext,
    granularityMs: 300_000,
  });
  assert.equal(mismatch.ok, false);
  assert.ok(!mismatch.ok);
  assert.equal(mismatch.violations[0]?.kind, "interval-length-mismatch");
});

test("kline: a SECONDS value in the epoch-ms open time is rejected loudly (the unit swap)", () => {
  const row = [...((BINANCE_KLINES.payload as unknown[][])[0] as unknown[])];
  row[0] = 1_700_448_000;
  const result = mapBinanceKline(row, klineContext);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "timestamp-out-of-range");
});

test("kline: malformed shapes are collected, never crashed on", () => {
  const short = mapBinanceKline([T0, "1", "2", "3", "4", "5"], klineContext);
  assert.ok(!short.ok);
  assert.equal(short.violations[0]?.kind, "malformed-record");
  const notArray = mapBinanceKline({ openTime: T0 }, klineContext);
  assert.ok(!notArray.ok);
  assert.equal(notArray.violations[0]?.kind, "malformed-record");
});

test("kline: non-canonical decimals and inconsistent OHLC are malformed", () => {
  const exponent = [...((BINANCE_KLINES.payload as unknown[][])[0] as unknown[])];
  exponent[1] = "4.8001e3";
  const badDecimal = mapBinanceKline(exponent, klineContext);
  assert.ok(!badDecimal.ok);
  assert.equal(badDecimal.violations[0]?.kind, "malformed-record");

  const inverted = [...((BINANCE_KLINES.payload as unknown[][])[0] as unknown[])];
  inverted[1] = "4801.00"; // open above high
  const badOhlc = mapBinanceKline(inverted, klineContext);
  assert.ok(!badOhlc.ok);
  assert.equal(badOhlc.violations[0]?.kind, "malformed-record");
  assert.match(badOhlc.violations[0]?.detail ?? "", /inconsistent OHLC/);
});

test("kline: close time preceding open time is malformed", () => {
  const row = [...((BINANCE_KLINES.payload as unknown[][])[0] as unknown[])];
  row[6] = T0 - 59_999;
  const result = mapBinanceKline(row, klineContext);
  assert.ok(!result.ok);
  assert.equal(
    result.violations.some((violation) => /precedes open time/.test(violation.detail)),
    true,
  );
});

test("kline: missing mapping-context symbol is a typed missing-field (rows carry none)", () => {
  const result = mapBinanceKline((BINANCE_KLINES.payload as unknown[][])[0], {
    symbols: BINANCE_SYMBOLS,
  });
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "missing-field");
  assert.match(result.violations[0]?.detail ?? "", /carry no symbol/);
});

test("kline: an unmapped request symbol is a typed unknown-symbol, never silently dropped", () => {
  const result = mapBinanceKline((BINANCE_KLINES.payload as unknown[][])[0], {
    ...klineContext,
    symbol: "DOGEUSDT",
  });
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unknown-symbol");
  assert.match(result.violations[0]?.detail ?? "", /DOGEUSDT/);
});

test("aggTrade: the buyer-maker flag converts to the aggressor side (declared conversion)", () => {
  const rows = BINANCE_AGG_TRADES.payload as Record<string, unknown>[];
  const buyerMaker = mapBinanceAggTrade(rows[0], { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" });
  assertOkMapping(buyerMaker);
  if (buyerMaker.record.kind !== "trade") {
    assert.fail(`expected a trade record, got '${buyerMaker.record.kind}'`);
  }
  assert.equal(buyerMaker.record.aggressorSide, "sell"); // buyer was the maker -> aggressor sold
  const buyerTaker = mapBinanceAggTrade(rows[1], { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" });
  assertOkMapping(buyerTaker);
  if (buyerTaker.record.kind !== "trade") {
    assert.fail(`expected a trade record, got '${buyerTaker.record.kind}'`);
  }
  assert.equal(buyerTaker.record.aggressorSide, "buy");
});

test("aggTrade: price/quantity/time verbatim, aggregate id becomes the tradeId", () => {
  const result = mapBinanceAggTrade(
    (BINANCE_AGG_TRADES.payload as Record<string, unknown>[])[0],
    { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" },
  );
  assertOkMapping(result);
  assert.deepEqual(result.record, {
    kind: "trade",
    symbol: "BTCUSDT",
    timestamp: T0 + 500,
    price: "4800.25",
    quantity: "0.50000000",
    aggressorSide: "sell",
    tradeId: "20930421",
  });
});

test("aggTrade: missing required fields are typed missing-field violations (collected)", () => {
  const result = mapBinanceAggTrade(
    { a: 1, q: "0.5" },
    { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" },
  );
  assert.ok(!result.ok);
  const kinds = result.violations.map((violation) => violation.kind);
  assert.deepEqual(kinds, ["missing-field", "missing-field", "missing-field"]);
});

test("aggTrade: a non-safe-integer id and a non-boolean flag are malformed", () => {
  const badId = mapBinanceAggTrade(
    { a: 1.5, p: "1", q: "1", T: T0, m: true },
    { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" },
  );
  assert.ok(!badId.ok);
  assert.equal(badId.violations[0]?.kind, "malformed-record");
  const badFlag = mapBinanceAggTrade(
    { a: 1, p: "1", q: "1", T: T0, m: "yes" },
    { symbols: BINANCE_SYMBOLS, symbol: "BTCUSDT" },
  );
  assert.ok(!badFlag.ok);
  assert.equal(badFlag.violations[0]?.kind, "malformed-record");
});

test("bookTicker: unmappable by declaration — the missing timestamp is never invented", () => {
  const result = mapBinanceBookTicker(BINANCE_SYMBOLS, BINANCE_BOOK_TICKER.payload);
  assert.ok(!result.ok);
  const missing = result.violations.find(
    (violation) => violation.kind === "missing-field" && /timestamp/.test(violation.detail),
  );
  assert.ok(missing !== undefined);
  assert.match(missing.detail, /never invented/);
});

test("bookTicker: the record-scoped symbol resolves (unknown symbols typed)", () => {
  const unknown = mapBinanceBookTicker(BINANCE_SYMBOLS, {
    ...(BINANCE_BOOK_TICKER.payload as Record<string, unknown>),
    symbol: "DOGEUSDT",
  });
  assert.ok(!unknown.ok);
  assert.equal(unknown.violations[0]?.kind, "unknown-symbol");
});

test("symbol table: unknown symbols never resolve — typed violations, never silent", () => {
  const unknown = resolveProviderSymbol(BINANCE_SYMBOLS, "DOGEUSDT");
  assert.ok(!unknown.ok);
  assert.equal(unknown.violation.kind, "unknown-symbol");
  const blank = resolveProviderSymbol({ BTCUSDT: "" as never }, "BTCUSDT");
  assert.ok(!blank.ok);
  const known = resolveProviderSymbol(BINANCE_SYMBOLS, "ETHUSDT");
  assert.ok(known.ok);
});
