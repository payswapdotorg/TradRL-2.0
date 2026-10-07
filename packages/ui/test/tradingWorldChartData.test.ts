/**
 * Chart data transform tests (W007).
 *
 * Guards the deterministic world-driven data shape: Trade projections →
 * candle + volume series on the SIMULATION time axis. Core laws under test
 * (ARCHITECTURE-LOCK A6, WORLD-PROTOCOL "UI projection law"):
 * - never fabricate: OHLC/volume come only from real trades; buckets
 *   without trades do not exist (no interpolation, no carry-forward);
 * - display batching only: bucketing by simulation time is deterministic
 *   regardless of input order (sort by occurredAt, sequence);
 * - loud failures: malformed decimal text / non-finite timestamps / illegal
 *   bucket sizes throw the typed ChartProjectionDataError — never a guess.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldChartData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartSeriesProjection,
  ChartProjectionDataError,
  decimalPlaces,
  decimalTextToNumber,
  DEFAULT_CHART_CANDLE_BUCKET_MS,
  formatChartVolume,
  formatSimulationTimestampMs,
  simulationMsBucketStart,
  simulationMsToChartSeconds,
  type ChartTradeProjection,
} from "../src/trading-world/charts/chartData.js";

function trade(
  occurredAt: number,
  sequence: number,
  price: string,
  quantity: string,
): ChartTradeProjection {
  return { price, quantity, occurredAt, sequence };
}

test("decimal text converts deterministically; malformed text fails loud", () => {
  assert.equal(decimalTextToNumber("101.25", "Trade.price"), 101.25);
  assert.equal(decimalTextToNumber("0.1", "Trade.price"), 0.1);
  assert.equal(decimalTextToNumber("42", "Trade.quantity"), 42);
  assert.equal(decimalTextToNumber("-3.5", "Trade.price"), -3.5);
  for (const malformed of ["", "   ", "abc", "1.2.3", "12,5", "NaN"]) {
    assert.throws(
      () => decimalTextToNumber(malformed, "Trade.price"),
      (error: unknown) =>
        error instanceof ChartProjectionDataError && /Trade\.price/.test(error.message),
      `malformed ${JSON.stringify(malformed)} must throw the typed error`,
    );
  }
});

test("trades batch into deterministic OHLC + volume buckets on simulation time", () => {
  const projection = buildChartSeriesProjection(
    [
      trade(61_000, 1, "100.10", "1.5"),
      trade(90_000, 2, "101.00", "2"),
      trade(120_500, 3, "99.50", "0.5"),
    ],
    { bucketMs: 60_000 },
  );
  assert.equal(projection.tradeCount, 3);
  assert.deepEqual(
    projection.candles.map((candle) => candle.time),
    [60, 120],
    "bucket starts as simulation seconds, ascending",
  );
  const first = projection.candles[0]!;
  assert.equal(first.bucketStartMs, 60_000);
  assert.equal(first.open, 100.1); // first trade in bucket order
  assert.equal(first.close, 101.0); // last trade in bucket order
  assert.equal(first.high, 101.0);
  assert.equal(first.low, 100.1);
  assert.deepEqual(
    projection.volume,
    [
      { time: 60, value: 3.5, up: true },
      { time: 120, value: 0.5, up: true },
    ],
    "volume sums per bucket; up = close >= open",
  );
  assert.equal(projection.fromSimulationMs, 61_000);
  assert.equal(projection.toSimulationMs, 120_500);
});

test("down candles derive from real close < open (color is never the only signal)", () => {
  const projection = buildChartSeriesProjection(
    [trade(0, 1, "100.00", "1"), trade(30_000, 2, "99.00", "1")],
    { bucketMs: 60_000 },
  );
  assert.equal(projection.candles[0]!.close, 99);
  assert.equal(projection.volume[0]!.up, false);
});

test("input order never matters: sorting is (occurredAt, sequence)", () => {
  const ordered = [
    trade(61_000, 1, "100.10", "1"),
    trade(61_500, 2, "100.20", "1"),
    trade(130_000, 3, "100.30", "1"),
  ];
  const projectionA = buildChartSeriesProjection(ordered, { bucketMs: 60_000 });
  const projectionB = buildChartSeriesProjection(
    [ordered[2]!, ordered[0]!, ordered[1]!],
    { bucketMs: 60_000 },
  );
  assert.deepEqual(projectionA, projectionB);
  assert.equal(projectionA.candles[0]!.open, 100.1);
  assert.equal(projectionA.candles[0]!.close, 100.2);
});

test("equal timestamps tie-break by monotonic sequence (journal order)", () => {
  const projection = buildChartSeriesProjection(
    [trade(50_000, 7, "102.00", "1"), trade(50_000, 3, "101.00", "1")],
    { bucketMs: 60_000 },
  );
  assert.equal(projection.candles[0]!.open, 101, "lower sequence is earlier");
  assert.equal(projection.candles[0]!.close, 102);
  assert.equal(projection.volume[0]!.value, 2);
});

test("buckets without trades are absent — gaps are never fabricated", () => {
  const projection = buildChartSeriesProjection(
    [trade(0, 1, "10.00", "1"), trade(600_000, 2, "11.00", "1")],
    { bucketMs: 60_000 },
  );
  assert.equal(projection.candles.length, 2);
  assert.deepEqual(
    projection.candles.map((candle) => candle.time),
    [0, 600],
  );
});

test("no trades project to no candles, no volume, no fabricated range", () => {
  const projection = buildChartSeriesProjection([], { bucketMs: DEFAULT_CHART_CANDLE_BUCKET_MS });
  assert.deepEqual(projection.candles, []);
  assert.deepEqual(projection.volume, []);
  assert.equal(projection.tradeCount, 0);
  assert.equal(projection.fromSimulationMs, undefined);
  assert.equal(projection.toSimulationMs, undefined);
  assert.equal(projection.priceDisplayPrecision, 0);
});

test("malformed trades throw the typed error before any output is produced", () => {
  assert.throws(
    () =>
      buildChartSeriesProjection([trade(0, 1, "not-a-price", "1")], { bucketMs: 60_000 }),
    ChartProjectionDataError,
  );
  assert.throws(
    () => buildChartSeriesProjection([trade(Number.NaN, 1, "10.00", "1")], { bucketMs: 60_000 }),
    ChartProjectionDataError,
  );
  assert.throws(
    () => buildChartSeriesProjection([trade(0, 1, "10.00", "bad-qty")], { bucketMs: 60_000 }),
    ChartProjectionDataError,
  );
});

test("illegal bucket sizes fail loud (axis granularity is whole seconds)", () => {
  for (const bucketMs of [0, -60_000, 500, 999, 1_000.5]) {
    assert.throws(
      () => buildChartSeriesProjection([], { bucketMs }),
      (error: unknown) =>
        error instanceof ChartProjectionDataError && /bucketMs/.test(error.message),
      `bucketMs ${bucketMs} must be rejected`,
    );
  }
  // 1000 is the legal minimum: consecutive buckets still map to distinct seconds.
  const projection = buildChartSeriesProjection(
    [trade(0, 1, "1.00", "1"), trade(1_000, 2, "1.10", "1"), trade(2_000, 3, "1.20", "1")],
    { bucketMs: 1_000 },
  );
  assert.deepEqual(
    projection.candles.map((candle) => candle.time),
    [0, 1, 2],
  );
});

test("pre-epoch simulation times floor correctly (negative-safe bucketing)", () => {
  assert.equal(simulationMsBucketStart(-90_000, 60_000), -120_000);
  assert.equal(simulationMsToChartSeconds(-120_000), -120);
  assert.equal(simulationMsToChartSeconds(-1), -1);
  assert.equal(simulationMsToChartSeconds(1_999), 1);
  const projection = buildChartSeriesProjection(
    [trade(-90_000, 1, "5.00", "1"), trade(30_000, 2, "5.50", "1")],
    { bucketMs: 60_000 },
  );
  assert.deepEqual(
    projection.candles.map((candle) => candle.time),
    [-120, 0],
  );
});

test("price display precision derives from the canonical decimal text", () => {
  assert.equal(
    buildChartSeriesProjection([trade(0, 1, "100", "1")], { bucketMs: 60_000 })
      .priceDisplayPrecision,
    0,
  );
  assert.equal(
    buildChartSeriesProjection(
      [trade(0, 1, "100.5", "1"), trade(30_000, 2, "100.25", "1")],
      { bucketMs: 60_000 },
    ).priceDisplayPrecision,
    2,
  );
  // Defensive cap at 8 display decimals.
  assert.equal(
    buildChartSeriesProjection([trade(0, 1, "0.123456789", "1")], { bucketMs: 60_000 })
      .priceDisplayPrecision,
    8,
  );
  assert.equal(decimalPlaces("12.345"), 3);
  assert.equal(decimalPlaces("12"), 0);
});

test("large trade sets are deterministic (fixed input ⇒ fixed output)", () => {
  const trades: ChartTradeProjection[] = [];
  for (let index = 0; index < 500; index += 1) {
    const wave = Math.sin(index / 7);
    trades.push(
      trade(
        index * 13_000,
        index,
        (100 + wave * 10).toFixed(2),
        ((index % 5) + 1).toFixed(1),
      ),
    );
  }
  const first = buildChartSeriesProjection(trades, { bucketMs: 60_000 });
  const second = buildChartSeriesProjection([...trades].reverse(), { bucketMs: 60_000 });
  assert.deepEqual(first, second);
  assert.ok(first.candles.length > 100);
});

test("simulation-time formatting is fixed UTC text (no locale drift)", () => {
  assert.equal(formatSimulationTimestampMs(0), "1970-01-01 00:00:00 UTC");
  assert.equal(formatSimulationTimestampMs(1_772_870_400_000), "2026-03-07 08:00:00 UTC");
  assert.equal(formatSimulationTimestampMs(1_772_874_240_500), "2026-03-07 09:04:00 UTC");
  assert.throws(
    () => formatSimulationTimestampMs(Number.NaN),
    ChartProjectionDataError,
  );
});

test("volume labels are deterministic abbreviations", () => {
  assert.equal(formatChartVolume(0), "0");
  assert.equal(formatChartVolume(999), "999");
  assert.equal(formatChartVolume(1_500), "1.5K");
  assert.equal(formatChartVolume(2_000_000), "2M");
  assert.equal(formatChartVolume(1_250_000_000), "1.25B");
  assert.equal(formatChartVolume(Number.NaN), "—");
});
