/**
 * Trading World chart surface package — W007 public entrypoint.
 *
 * The Main Chart of the trader cockpit (UX-DESIGN "Default trader cockpit"):
 * candlesticks + volume projected from world-client Trade/Quote projections
 * onto SIMULATION time, with crosshair price inspection, honest
 * empty/teaching states and a typed chart-library fallback. Everything the
 * composition point (`../surfaces.ts`), the cockpit shell and the tests
 * need from W007 lives under `packages/ui/src/trading-world/charts/`.
 *
 * REGISTRY INTEGRATION (W006 seam): the shell hosts tools through the tool
 * registry; the chart placeholder is swapped with the immutable
 * `withSurfaceOverride` seam. Because `../surfaces.ts` (the composition
 * point) is W006's file and outside W007's frozen write surface, the swap is
 * exported HERE as {@link withChartToolSurface} — one call from the
 * composition point (or any registry consumer, e.g. a test harness):
 *
 * ```ts
 * import { withChartToolSurface } from "./charts/index.js";
 * const registry = withChartToolSurface(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the W007
 * PR (together with the `lightweight-charts` dependency addition).
 */

import type { ComponentType } from "react";

import type { TradingWorldToolRegistry, TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { ChartToolSurface } from "./ChartToolSurface.js";

export {
  ChartToolSurface,
  createChartToolSurface,
  DEFAULT_CHART_INSTRUMENT_ID,
  DEFAULT_CHART_POLL_MS,
  DEFAULT_CHART_TRADE_QUERY_LIMIT,
} from "./ChartToolSurface.js";
export type {
  ChartDataState,
  ChartRendererState,
} from "./ChartSurfaceStates.js";
export type { ChartToolSurfaceConfig } from "./ChartToolSurface.js";

export {
  buildChartSeriesProjection,
  ChartProjectionDataError,
  decimalPlaces,
  decimalTextToNumber,
  DEFAULT_CHART_CANDLE_BUCKET_MS,
  formatChartVolume,
  formatSimulationTimestampMs,
  simulationMsBucketStart,
  simulationMsToChartSeconds,
} from "./chartData.js";
export type {
  ChartQuoteProjection,
  ChartSeriesBuildOptions,
  ChartSeriesProjection,
  ChartTradeProjection,
  CandleProjection,
  VolumeProjection,
} from "./chartData.js";

export {
  getChartRendererLoader,
  setChartRendererLoader,
} from "./chartRenderer.js";
export type {
  ChartCandlePoint,
  ChartCrosshairSnapshot,
  ChartRenderer,
  ChartRendererAvailable,
  ChartRendererFactory,
  ChartRendererLoadResult,
  ChartRendererLoader,
  ChartRendererOptions,
  ChartRendererUnavailable,
  ChartSeriesData,
  ChartVolumePoint,
} from "./chartRenderer.js";

export {
  createLightweightChartsRendererFromModule,
  LIGHTWEIGHT_CHARTS_REGISTERED_VERSION,
  loadLightweightChartsRenderer,
} from "./lightweightChartsAdapter.js";

/** The registered tool id this package owns (W006 registry slot). */
export const CHART_TOOL_ID = "chart";

/**
 * Swap the registry's chart placeholder for the real W007 surface — the
 * immutable `withSurfaceOverride` seam, applied from THIS module (W007 owns
 * the call; no registry file is edited). Unknown ids already throw inside
 * the registry (loud, never silent).
 */
export function withChartToolSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = ChartToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(CHART_TOOL_ID, surface);
}
