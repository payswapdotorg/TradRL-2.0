/**
 * Tests for the W020 dataset-descriptor building (W026): derived ranges and
 * dataset ids (deterministic, batch-distinguishing), honest limitations
 * (the provider's declared gaps + the baseline disclosure), determinism
 * declarations, and the strongest law of all — every generated descriptor
 * passes the W020 `validateDatasetDescriptor` gates unchanged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatasetDescriptor, HistoricalBarRecord } from "tradrl-world-contracts/data";
import { validateDatasetDescriptor } from "tradrl-data";
import { buildCryptoDatasetDescriptor, deriveCryptoDatasetId, detectBarHoles } from "../dataset.js";
import { binanceSpotProvider } from "../binance.js";
import { coinbaseExchangeProvider } from "../coinbase.js";
import { mapCryptoFeed } from "../mapping.js";
import type { CryptoFeedMapping } from "../mapping.js";
import {
  BINANCE_KLINES,
  BINANCE_SYMBOLS,
  COINBASE_CANDLES,
  COINBASE_SYMBOLS,
  T0,
  assertOkMapping,
  at,
  datasetIdOf,
  price,
  qty,
} from "./fixtures.js";

const binance = binanceSpotProvider(BINANCE_SYMBOLS);
const coinbase = coinbaseExchangeProvider(COINBASE_SYMBOLS);
const klinesFeed = binance.feeds[0]!;

function mappedKlines() {
  const mapping = mapCryptoFeed(binance, "binance.klines", BINANCE_KLINES.payload, {
    symbol: "BTCUSDT",
    granularity: "1m",
    granularityMs: 60_000,
  });
  assert.ok(mapping.ok);
  return mapping;
}

test("the range is DERIVED from the records (min/max extent) — computed, never claimed", () => {
  const mapping = mappedKlines();
  assert.deepEqual(mapping.datasetDescriptor.range, {
    from: T0,
    to: T0 + 3 * 60_000,
  });
});

test("the derived dataset id is deterministic and batch-distinguishing", () => {
  const first = mappedKlines();
  const second = mappedKlines();
  assert.equal(
    first.datasetDescriptor.datasetId,
    second.datasetDescriptor.datasetId,
  );
  assert.equal(
    first.datasetDescriptor.datasetId,
    "crypto:binance-spot:binance.klines:1700448060000-1700448180000",
  );
  const shorter = mapCryptoFeed(
    binance,
    "binance.klines",
    (BINANCE_KLINES.payload as unknown[][]).slice(0, 2),
    { symbol: "BTCUSDT", granularity: "1m", granularityMs: 60_000 },
  );
  assert.ok(shorter.ok);
  assert.notEqual(shorter.datasetDescriptor.datasetId, first.datasetDescriptor.datasetId);
});

test("an explicit datasetId override wins over the derived id", () => {
  const mapping = mapCryptoFeed(binance, "binance.klines", BINANCE_KLINES.payload, {
    symbol: "BTCUSDT",
    granularity: "1m",
    datasetId: datasetIdOf("ds-manual-1"),
  });
  assertOkMapping(mapping);
  assert.equal(mapping.datasetDescriptor.datasetId, "ds-manual-1");
});

test("an empty batch yields an open range and the ':empty' dataset id", () => {
  const mapping = mapCryptoFeed(binance, "binance.klines", [], {
    symbol: "BTCUSDT",
    granularity: "1m",
  });
  assert.ok(mapping.ok);
  assert.deepEqual(mapping.datasetDescriptor.range, {});
  assert.equal(mapping.datasetDescriptor.datasetId, "crypto:binance-spot:binance.klines:empty");
});

test("limitations carry the provider's declared gaps plus the baseline disclosure", () => {
  const mapping = mappedKlines();
  const limitations = mapping.datasetDescriptor.limitations;
  assert.equal(
    limitations.some((entry) => /bookTicker carries no timestamp/.test(entry)),
    true,
    "provider knownGaps must be carried verbatim",
  );
  assert.equal(
    limitations.some((entry) => /no live network IO/.test(entry)),
    true,
    "the baseline disclosure must be present",
  );
});

test("the source declaration names the provider, feed and endpoint honestly", () => {
  const mapping = mappedKlines();
  const source = mapping.datasetDescriptor.source;
  assert.equal(source.provider, "binance-spot");
  assert.match(source.name, /Binance \(Spot API\) — binance\.klines/);
  assert.match(source.name, /api\/v3\/klines/);
  assert.equal(source.format, "ohlcv-bars");
  assert.match(source.obtained ?? "", /doc snapshot 2026-10-07/);
});

test("determinism defaults to deterministic (fixture batches) and can be overridden", () => {
  assert.deepEqual(mappedKlines().datasetDescriptor.determinism, { kind: "deterministic" });
  const overridden = mapCryptoFeed(binance, "binance.klines", BINANCE_KLINES.payload, {
    symbol: "BTCUSDT",
    granularity: "1m",
    determinism: { kind: "nondeterministic", sources: ["live exchange availability"] },
  });
  assertOkMapping(overridden);
  assert.deepEqual(overridden.datasetDescriptor.determinism, {
    kind: "nondeterministic",
    sources: ["live exchange availability"],
  });
});

test("bar-sequence holes: single-symbol detection, multi-symbol skip with a limitation", () => {
  const bar = (symbol: string, openTime: number): HistoricalBarRecord => ({
    kind: "bar",
    symbol,
    openTime: at(openTime),
    closeTime: at(openTime + 60_000),
    open: price("1"),
    high: price("1"),
    low: price("1"),
    close: price("1"),
    volume: qty("1"),
  });
  const holes = detectBarHoles([bar("BTC-USD", T0), bar("BTC-USD", T0 + 180_000)]);
  assert.equal(holes.length, 1);
  assert.deepEqual(
    { from: holes[0]?.from, to: holes[0]?.to },
    { from: T0 + 60_000, to: T0 + 180_000 },
  );
  // Contiguous bars produce no holes.
  assert.equal(
    detectBarHoles([bar("BTC-USD", T0), bar("BTC-USD", T0 + 60_000)]).length,
    0,
  );
  // Multi-symbol batches skip detection (declare per-symbol gaps yourself).
  assert.equal(
    detectBarHoles([bar("BTC-USD", T0), bar("ETH-USD", T0 + 180_000)]).length,
    0,
  );
  const multi = buildCryptoDatasetDescriptor({
    provider: coinbase,
    feed: coinbase.feeds[0]!,
    records: [bar("BTC-USD", T0), bar("ETH-USD", T0 + 180_000)],
    granularity: "1m",
  });
  assert.equal(
    multi.limitations.some((entry) => /multi-symbol batch/.test(entry)),
    true,
  );
});

test("deriveCryptoDatasetId uses the event-time basis (a bar's basis is its close)", () => {
  const bar = (openTime: number): HistoricalBarRecord => ({
    kind: "bar",
    symbol: "BTC-USD",
    openTime: at(openTime),
    closeTime: at(openTime + 60_000),
    open: price("1"),
    high: price("1"),
    low: price("1"),
    close: price("1"),
    volume: qty("1"),
  });
  const id = deriveCryptoDatasetId(coinbase, coinbase.feeds[0]!, [bar(T0), bar(T0 + 60_000)]);
  assert.equal(
    id,
    `crypto:coinbase-exchange:coinbase.candles:${String(T0 + 60_000)}-${String(T0 + 120_000)}`,
  );
});

test("STRONGEST: every generated descriptor passes the W020 descriptor validation unchanged", () => {
  function descriptorOf(mapping: CryptoFeedMapping): DatasetDescriptor {
    if (!mapping.ok) {
      assert.fail(`expected an ok mapping, got ${String(mapping.violations[0]?.detail)}`);
    }
    return mapping.datasetDescriptor;
  }
  const batches = [
    descriptorOf(mappedKlines()),
    descriptorOf(
      mapCryptoFeed(binance, "binance.klines", [], {
        symbol: "BTCUSDT",
        granularity: "1m",
      }),
    ),
    descriptorOf(
      mapCryptoFeed(coinbase, "coinbase.candles", COINBASE_CANDLES.payload, {
        symbol: "BTC-USD",
        granularity: "1m",
        granularityMs: 60_000,
      }),
    ),
  ];
  assert.equal(batches.length, 3);
  for (const descriptor of batches) {
    assert.deepEqual(
      validateDatasetDescriptor(descriptor),
      [],
      `descriptor ${String(descriptor.datasetId)} must pass the W020 gates`,
    );
  }
});
