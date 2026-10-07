/**
 * Chart renderer seam tests (W007).
 *
 * Guards the thin renderer seam the chart surface renders through:
 * - the DEFAULT loader (the lightweight-charts adapter) honestly reports
 *   `chart-library-unavailable` while the register-verified package is not
 *   a dependency (the W007 TL action item) — no crash, no fake chart, no
 *   remote fetch;
 * - runtime structural validation: a module that does not expose the
 *   verified 5.x API surface is rejected with a typed reason;
 * - a VALID module maps onto the internal ChartRenderer contract exactly:
 *   candle/volume data mapping, fit-once semantics, crosshair inspection
 *   resolved from the projected data, idempotent destroy;
 * - the loader override seam (setChartRendererLoader) is the test/composition
 *   injection point and restores the default on undefined.
 *
 * The browser E2E harness additionally drives the REAL lightweight-charts
 * 5.2.1 dist through this same adapter mapping (see the W007 PR evidence);
 * these unit tests pin the contract with a controlled fake module.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldChartRenderer.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  getChartRendererLoader,
  setChartRendererLoader,
  type ChartCrosshairSnapshot,
  type ChartRenderer,
  type ChartRendererFactory,
} from "../src/trading-world/charts/chartRenderer.js";
import {
  createLightweightChartsRendererFromModule,
  LIGHTWEIGHT_CHARTS_REGISTERED_VERSION,
  loadLightweightChartsRenderer,
} from "../src/trading-world/charts/lightweightChartsAdapter.js";

test("the default adapter resolves the real library now that the TL wiring landed it", async () => {
  // TL wiring (W007 merge follow-up): lightweight-charts@5.2.1 is a real
  // dependency of @zcode/ui — the adapter must find it, validate its API
  // shape, and expose the disclosed library label.
  const result = await loadLightweightChartsRenderer();
  if (result.status !== "available") {
    assert.fail(`expected available, got ${result.status} (${(result as { reason?: string }).reason ?? "no reason"})`);
  }
  assert.match(result.libraryLabel, /Lightweight Charts/);
});

test("the register-pinned version constant is exposed for disclosure", () => {
  assert.equal(LIGHTWEIGHT_CHARTS_REGISTERED_VERSION, "5.2.1");
});

test("loader override seam injects and restores (no registry-file edits needed)", async () => {
  const custom = async () => ({
    status: "chart-library-unavailable" as const,
    reason: "injected-loader-reason",
  });
  assert.notEqual(getChartRendererLoader(), custom);
  setChartRendererLoader(custom);
  assert.equal(getChartRendererLoader(), custom);
  const injected = await getChartRendererLoader()();
  if (injected.status !== "chart-library-unavailable") {
    assert.fail(`expected the injected unavailable result, got ${injected.status}`);
  }
  assert.match(injected.reason, /injected-loader-reason/);
  setChartRendererLoader(undefined);
  assert.equal(getChartRendererLoader(), loadLightweightChartsRenderer);
});

test("structurally invalid modules are rejected with the typed API-shape reason", () => {
  for (const mod of [
    undefined,
    null,
    {},
    { createChart: () => undefined },
    { createChart: () => undefined, CandlestickSeries: {} },
    {
      createChart: () => undefined,
      CandlestickSeries: {},
      HistogramSeries: {},
      CrosshairMode: "not-an-enum",
    },
  ]) {
    const result = createLightweightChartsRendererFromModule(mod);
    assert.equal(
      result.status,
      "chart-library-unavailable",
      `module ${JSON.stringify(mod)} must be rejected`,
    );
    assert.match(result.reason, /did not expose the expected 5\.x API surface/);
  }
});

/**
 * Controlled fake of the exact Lightweight Charts 5.x module surface the
 * adapter consumes (verified against the 5.2.1 typings — see the adapter
 * header). Records every call for contract assertions.
 */
interface FakeChartCalls {
  containers: unknown[];
  chartOptions: unknown[];
  candleSeriesData: unknown[][];
  volumeSeriesData: unknown[][];
  volumeScaleOptions: unknown[];
  fitContentCount: number;
  removeCount: number;
  crosshairHandlers: Set<(param: unknown) => void>;
}

function createFakeLightweightChartsModule(version?: string): {
  mod: unknown;
  calls: FakeChartCalls;
} {
  const calls: FakeChartCalls = {
    containers: [],
    chartOptions: [],
    candleSeriesData: [],
    volumeSeriesData: [],
    volumeScaleOptions: [],
    fitContentCount: 0,
    removeCount: 0,
    crosshairHandlers: new Set(),
  };
  const candleSeries = {
    setData: (data: unknown[]) => calls.candleSeriesData.push(data),
  };
  const volumeSeries = {
    setData: (data: unknown[]) => calls.volumeSeriesData.push(data),
    priceScale: () => ({ applyOptions: (options: unknown) => calls.volumeScaleOptions.push(options) }),
  };
  const chart = {
    addSeries: (definition: { type?: string }) =>
      definition.type === "candlestick" ? candleSeries : volumeSeries,
    priceScale: () => ({ applyOptions: () => {} }),
    timeScale: () => ({ fitContent: () => (calls.fitContentCount += 1) }),
    subscribeCrosshairMove: (handler: (param: unknown) => void) =>
      calls.crosshairHandlers.add(handler),
    remove: () => (calls.removeCount += 1),
  };
  const CandlestickSeries = { type: "candlestick" };
  const HistogramSeries = { type: "histogram" };
  const mod = {
    createChart: (container: unknown, options?: unknown) => {
      calls.containers.push(container);
      calls.chartOptions.push(options);
      return chart;
    },
    CandlestickSeries,
    HistogramSeries,
    CrosshairMode: { Normal: 0 },
    ...(version === undefined ? {} : { version: () => version }),
  };
  return { mod, calls };
}

function fakeContainer(): HTMLElement {
  return { fake: "container" } as unknown as HTMLElement;
}

const SAMPLE_CANDLES = [
  { time: 60, open: 100.1, high: 101, low: 100, close: 100.5 },
  { time: 120, open: 100.5, high: 100.5, low: 99, close: 99.1 },
];
const SAMPLE_VOLUME = [
  { time: 60, value: 12.5, up: true },
  { time: 120, value: 3.25, up: false },
];

function createFakeRenderer(): { renderer: ChartRenderer; calls: FakeChartCalls } {
  const fake = createFakeLightweightChartsModule("5.2.1");
  const result = createLightweightChartsRendererFromModule(fake.mod);
  assert.equal(result.status, "available");
  if (result.status !== "available") {
    throw new Error("unreachable");
  }
  const factory: ChartRendererFactory = result.createRenderer;
  const renderer = factory(fakeContainer(), { pricePrecision: 2 });
  return { renderer, calls: fake.calls };
}

test("a valid module maps to an available renderer with a disclosed library label", () => {
  const { mod } = createFakeLightweightChartsModule("5.2.1");
  const result = createLightweightChartsRendererFromModule(mod);
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.libraryLabel, "Lightweight Charts 5.2.1");
    assert.equal(typeof result.createRenderer, "function");
  }
  // No version() export → label without the version suffix (still disclosed).
  const { mod: noVersion } = createFakeLightweightChartsModule();
  const bare = createLightweightChartsRendererFromModule(noVersion);
  if (bare.status === "available") {
    assert.equal(bare.libraryLabel, "Lightweight Charts");
  }
});

test("setData maps candles and volume exactly; fitContent fires once for non-empty data", () => {
  const { renderer, calls } = createFakeRenderer();
  assert.equal(calls.containers.length, 1, "chart mounted into the container");
  const chartOptions = calls.chartOptions[0] as { timeScale: { timeVisible: boolean } };
  assert.equal(chartOptions.timeScale.timeVisible, true, "simulation clock times on the axis");

  renderer.setData({ candles: SAMPLE_CANDLES, volume: SAMPLE_VOLUME });
  assert.deepEqual(calls.candleSeriesData[0], [
    { time: 60, open: 100.1, high: 101, low: 100, close: 100.5 },
    { time: 120, open: 100.5, high: 100.5, low: 99, close: 99.1 },
  ]);
  assert.deepEqual(calls.volumeSeriesData[0], [
    { time: 60, value: 12.5, color: "rgba(38, 166, 154, 0.5)" },
    { time: 120, value: 3.25, color: "rgba(239, 83, 80, 0.5)" },
  ]);
  assert.equal(calls.fitContentCount, 1, "first non-empty data fits the visible range");
  assert.deepEqual(
    calls.volumeScaleOptions[0],
    { scaleMargins: { top: 0.8, bottom: 0 } },
    "volume overlay margins",
  );

  renderer.setData({ candles: SAMPLE_CANDLES, volume: SAMPLE_VOLUME });
  assert.equal(calls.fitContentCount, 1, "subsequent pushes preserve the viewport");

  renderer.setData({ candles: [], volume: [] });
  assert.equal(calls.fitContentCount, 1, "empty data never (re)fits");
  assert.equal(calls.removeCount, 0, "still mounted");
});

test("crosshair inspection resolves the hovered bucket from the projected data", () => {
  const { renderer, calls } = createFakeRenderer();
  const seen: (ChartCrosshairSnapshot | null)[] = [];
  const unsubscribe = renderer.subscribeCrosshairMove((snapshot) => seen.push(snapshot));

  renderer.setData({ candles: SAMPLE_CANDLES, volume: SAMPLE_VOLUME });
  const fire = (param: unknown): void => {
    for (const handler of calls.crosshairHandlers) {
      handler(param);
    }
  };
  fire({ time: 60 });
  fire({ time: 120 });
  fire({ time: 999 });
  fire({});
  fire({ time: "not-a-number" });
  assert.deepEqual(seen, [
    {
      time: 60,
      candle: { time: 60, open: 100.1, high: 101, low: 100, close: 100.5 },
      volume: 12.5,
    },
    {
      time: 120,
      candle: { time: 120, open: 100.5, high: 100.5, low: 99, close: 99.1 },
      volume: 3.25,
    },
    null,
    null,
    null,
  ]);
  unsubscribe();
  const seenLength = seen.length;
  const afterUnsubscribe: (ChartCrosshairSnapshot | null)[] = [];
  const unsubscribeSecond = renderer.subscribeCrosshairMove((snapshot) =>
    afterUnsubscribe.push(snapshot),
  );
  fire({ time: 60 });
  assert.equal(seen.length, seenLength, "unsubscribed handler is gone");
  assert.equal(afterUnsubscribe.length, 1, "a later subscription still receives");
  unsubscribeSecond();
  fire({ time: 60 });
  assert.equal(afterUnsubscribe.length, 1, "no delivery after full unsubscribe");
});

test("destroy is idempotent and freezes the renderer", () => {
  const { renderer, calls } = createFakeRenderer();
  renderer.setData({ candles: SAMPLE_CANDLES, volume: SAMPLE_VOLUME });
  renderer.destroy();
  renderer.destroy();
  assert.equal(calls.removeCount, 1);
  const dataCount = calls.candleSeriesData.length;
  renderer.setData({ candles: SAMPLE_CANDLES, volume: SAMPLE_VOLUME });
  assert.equal(calls.candleSeriesData.length, dataCount, "setData after destroy is a no-op");
});
