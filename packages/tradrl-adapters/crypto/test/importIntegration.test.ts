/**
 * End-to-end integration tests (W026): every mappable feed batch of both
 * baseline providers maps through `mapCryptoFeed` and imports through the
 * REAL W020 `loadHistoricalDataset` — journal-ready drafts, sealed records
 * and the determinism digest — proving the adapter feeds the W020 import
 * surface exactly. Also proves the deliberate boundary: residual ordering
 * garbage surfaces as the W020 typed `out-of-order-records` rejection (the
 * adapter normalizes only the DECLARED provider order and does not
 * duplicate the W020 stream laws).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorldId } from "tradrl-world-contracts";
import {
  DatasetImportError,
  loadHistoricalDataset,
  validateHistoricalImport,
} from "tradrl-data";
import { binanceSpotProvider } from "../binance.js";
import { coinbaseExchangeProvider } from "../coinbase.js";
import { mapCryptoFeed } from "../mapping.js";
import type { CryptoFeedMapping } from "../mapping.js";
import {
  BINANCE_AGG_TRADES,
  BINANCE_BOOK_TICKER,
  BINANCE_KLINES,
  BINANCE_SYMBOLS,
  COINBASE_CANDLES,
  COINBASE_CANDLES_WITH_HOLE,
  COINBASE_SYMBOLS,
  COINBASE_TICKER,
  COINBASE_TRADES,
  T0,
} from "./fixtures.js";

const WORLD = "world-w026-tests" as WorldId;
const binance = binanceSpotProvider(BINANCE_SYMBOLS);
const coinbase = coinbaseExchangeProvider(COINBASE_SYMBOLS);

function okMapping(mapping: CryptoFeedMapping): Exclude<CryptoFeedMapping, { ok: false }> {
  if (!mapping.ok) {
    assert.fail(`expected an ok mapping, got: ${mapping.violations.map((v) => v.detail).join("; ")}`);
  }
  return mapping;
}

test("binance.klines -> W020 import: bar events at the CLOSE-time basis, half-open intervals", () => {
  const mapping = okMapping(
    mapCryptoFeed(binance, "binance.klines", BINANCE_KLINES.payload, {
      symbol: "BTCUSDT",
      granularity: "1m",
      granularityMs: 60_000,
    }),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.records.length, 3);
  assert.equal(outcome.summary.barCount, 3);
  assert.deepEqual(outcome.summary.symbols, ["BTCUSDT"]);
  const first = outcome.records[0]!;
  assert.equal(first.envelope.eventType, "market.bar.closed");
  assert.equal(first.envelope.producer, "historical-data-import");
  // The event-time basis of a bar is its CLOSE time (A7 law, W020 surface).
  assert.equal(first.envelope.occurredAt, T0 + 60_000);
  assert.equal(first.recordedAt, T0 + 60_000);
  assert.equal((first.envelope.payload as { type: string }).type, "market.bar.closed");
  assert.deepEqual(
    (first.envelope.payload as { interval: { start: number; end: number } }).interval,
    { start: T0, end: T0 + 60_000 },
  );
  assert.equal(outcome.digest.eventCount, 3);
  assert.match(String(outcome.digest.eventChecksum), /^[0-9a-f]{8}$/);
});

test("binance.aggTrades -> W020 import: trade prints with aggressor sides and source ids", () => {
  const mapping = okMapping(
    mapCryptoFeed(binance, "binance.aggTrades", BINANCE_AGG_TRADES.payload, {
      symbol: "BTCUSDT",
    }),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.tradeCount, 3);
  const sides = outcome.records.map(
    (record) => (record.envelope.payload as { aggressorSide: string }).aggressorSide,
  );
  assert.deepEqual(sides, ["sell", "buy", "sell"]);
  const ids = outcome.records.map(
    (record) => (record.envelope.payload as { tradeId: string }).tradeId,
  );
  assert.deepEqual(ids, ["20930421", "20930422", "20930423"]);
});

test("a second symbol maps and imports through the same provider (multi-instrument worlds)", () => {
  // Hand-authored to the same documented kline shape (see BINANCE_KLINES provenance).
  const ethKlines = [
    [T0, "180.10", "180.60", "180.00", "180.40", "220.50000000", T0 + 59_999, "39720.00", 61, "120.00000000", "21640.00", "0"],
  ];
  const mapping = okMapping(
    mapCryptoFeed(binance, "binance.klines", ethKlines, {
      symbol: "ETHUSDT",
      granularity: "1m",
      granularityMs: 60_000,
    }),
  );
  assert.equal(mapping.records[0]?.symbol, "ETHUSDT");
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.deepEqual(outcome.summary.symbols, ["ETHUSDT"]);
  assert.equal(
    (outcome.records[0]!.envelope.payload as { instrumentId: string }).instrumentId,
    "instrument-ethusdt",
  );
});

test("coinbase.candles -> W020 import: seconds-converted bars with the detected hole declared", () => {
  const mapping = okMapping(
    mapCryptoFeed(coinbase, "coinbase.candles", COINBASE_CANDLES.payload, {
      symbol: "BTC-USD",
      granularity: "1m",
      granularityMs: 60_000,
    }),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.barCount, 3);
  assert.equal(outcome.records[0]!.envelope.occurredAt, T0 + 60_000);

  const withHole = okMapping(
    mapCryptoFeed(coinbase, "coinbase.candles", COINBASE_CANDLES_WITH_HOLE.payload, {
      symbol: "BTC-USD",
      granularity: "1m",
      granularityMs: 60_000,
    }),
  );
  const holeOutcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: withHole.datasetDescriptor,
    records: [...withHole.records],
    symbolMap: withHole.symbolMap,
  });
  assert.equal(holeOutcome.summary.barCount, 2);
  assert.equal(withHole.datasetDescriptor.knownGaps.length, 1);
});

test("coinbase.trades -> W020 import: ISO-parsed trades with maker->aggressor conversion", () => {
  const mapping = okMapping(
    mapCryptoFeed(coinbase, "coinbase.trades", COINBASE_TRADES.payload, {
      symbol: "BTC-USD",
    }),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.tradeCount, 3);
  const first = outcome.records[0]!.envelope.payload as {
    tradeId: string;
    aggressorSide: string;
  };
  assert.equal(first.tradeId, "5000001");
  assert.equal(first.aggressorSide, "sell"); // maker side "buy" -> the aggressor sold
});

test("coinbase.ticker -> W020 import: an honest size-less quote observation", () => {
  const mapping = okMapping(
    mapCryptoFeed(coinbase, "coinbase.ticker", COINBASE_TICKER.payload, {
      symbol: "BTC-USD",
    }),
  );
  assert.equal(mapping.datasetDescriptor.granularity, "tick");
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.quoteCount, 1);
  const payload = outcome.records[0]!.envelope.payload as Record<string, unknown>;
  assert.equal(payload.type, "market.quote.updated");
  assert.equal(payload.bid, "37000.10");
  assert.equal(payload.ask, "37000.30");
  assert.equal(payload.last, "37000.20");
  assert.equal("bidSize" in payload, false);
});

test("every happy batch also passes the W020 pre-import validator directly", () => {
  const batches = [
    mapCryptoFeed(binance, "binance.klines", BINANCE_KLINES.payload, {
      symbol: "BTCUSDT",
      granularity: "1m",
      granularityMs: 60_000,
    }),
    mapCryptoFeed(binance, "binance.aggTrades", BINANCE_AGG_TRADES.payload, {
      symbol: "BTCUSDT",
    }),
    mapCryptoFeed(coinbase, "coinbase.candles", COINBASE_CANDLES.payload, {
      symbol: "BTC-USD",
      granularity: "1m",
      granularityMs: 60_000,
    }),
    mapCryptoFeed(coinbase, "coinbase.trades", COINBASE_TRADES.payload, {
      symbol: "BTC-USD",
    }),
    mapCryptoFeed(coinbase, "coinbase.ticker", COINBASE_TICKER.payload, {
      symbol: "BTC-USD",
    }),
  ];
  for (const mapping of batches) {
    const ok = okMapping(mapping);
    const validation = validateHistoricalImport({
      worldId: WORLD,
      descriptor: ok.datasetDescriptor,
      records: [...ok.records],
      symbolMap: ok.symbolMap,
    });
    assert.deepEqual(
      validation,
      { ok: true },
      `feed ${ok.feed.feedId} must be W020-valid: ${String(mapping.ok ? "" : mapping.violations[0]?.detail)}`,
    );
  }
});

test("BOUNDARY: residual order garbage surfaces as the W020 typed rejection (not re-validated here)", () => {
  // Newest-first kline page passed to an ASCENDING-declared feed: the
  // adapter keeps the declared order (never reorders ascending feeds), and
  // the W020 import rejects it loudly — the deliberate boundary.
  const reversed = [...(BINANCE_KLINES.payload as unknown[][])].reverse();
  const mapping = okMapping(
    mapCryptoFeed(binance, "binance.klines", reversed, {
      symbol: "BTCUSDT",
      granularity: "1m",
      granularityMs: 60_000,
    }),
  );
  assert.equal(mapping.records.length, 3);
  assert.throws(
    () =>
      loadHistoricalDataset({
        worldId: WORLD,
        descriptor: mapping.datasetDescriptor,
        records: [...mapping.records],
        symbolMap: mapping.symbolMap,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DatasetImportError);
      assert.equal(error.violations[0]?.kind, "out-of-order-records");
      return true;
    },
  );
});

test("the unmappable feed never reaches an import: typed unmappable-feed rejection", () => {
  const mapping = mapCryptoFeed(binance, "binance.bookTicker", BINANCE_BOOK_TICKER.payload, {});
  assert.ok(!mapping.ok);
  assert.equal(mapping.violations[0]?.kind, "unmappable-feed");
  assert.match(mapping.violations[0]?.detail ?? "", /never invented|does not provide/);
});
