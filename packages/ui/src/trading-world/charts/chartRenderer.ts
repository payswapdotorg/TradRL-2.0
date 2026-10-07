/**
 * Chart renderer seam — W007.
 *
 * The MINIMAL internal chart-rendering interface the chart tool surface is
 * built against: a candlestick series with a shared simulation-time axis, a
 * volume histogram overlay, a crosshair and a price scale. Deliberately tiny
 * — it describes what a trader-cockpit main chart needs, not what any
 * specific charting library offers.
 *
 * WHY A SEAM (dependency rule, spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md):
 * the register-verified pick is TradingView Lightweight Charts 5.2.1
 * (Apache-2.0, "Direct dependency (npm)") — but `packages/ui/package.json`
 * and `pnpm-lock.yaml` are TL-owned manifests outside W007's frozen write
 * surface (`packages/ui/src/trading-world/charts/`). So the surface renders
 * through THIS interface, the concrete renderer is loaded through the
 * swappable loader below, and `./lightweightChartsAdapter.ts` is the
 * register-verified implementation that dynamic-imports `lightweight-charts`
 * IF the package is present and falls back to a typed, honestly-disclosed
 * `chart-library-unavailable` state when it is not. CDN imports are
 * forbidden (offline/provenance law) — the fallback is disclosure, never a
 * remote fetch. The TL action item (dependency + lockfile line) is recorded
 * in the W007 PR.
 *
 * All series data crossing this seam is world-projected data (A6: the chart
 * is a projection): simulation-time-keyed candles built deterministically
 * from Trade projections by `./chartData.ts` — never invented facts.
 */

import { loadLightweightChartsRenderer } from "./lightweightChartsAdapter.js";

/**
 * A candle on the chart's x-axis. `time` is SIMULATION time expressed as
 * whole seconds since the Unix epoch (W004 time semantics: the chart axis is
 * the simulation axis, never wall time; the adapter feeds it to the library
 * as a UTC timestamp — a display convention only).
 */
export interface ChartCandlePoint {
  /** Simulation-time bucket start, whole seconds since epoch. Ascending, unique. */
  readonly time: number;
  /** First traded price in the bucket (display projection of a decimal string). */
  readonly open: number;
  readonly high: number;
  readonly low: number;
  /** Last traded price in the bucket. */
  readonly close: number;
}

/** One volume histogram column, aligned with a candle bucket. */
export interface ChartVolumePoint {
  /** Same bucket time as the candle (simulation seconds). */
  readonly time: number;
  /** Sum of traded quantity in the bucket. */
  readonly value: number;
  /** `close >= open` of the same candle — derived, not configured. */
  readonly up: boolean;
}

/** The full series payload the renderer projects. */
export interface ChartSeriesData {
  readonly candles: readonly ChartCandlePoint[];
  readonly volume: readonly ChartVolumePoint[];
}

/**
 * Crosshair inspection snapshot (UX-DESIGN price inspection): the hovered
 * bucket's real candle + volume, or null when the crosshair left the data.
 */
export interface ChartCrosshairSnapshot {
  readonly time: number;
  readonly candle: ChartCandlePoint;
  readonly volume: number;
}

/** Options for creating a renderer. */
export interface ChartRendererOptions {
  /**
   * Decimal places for the price scale/legend (derived from the canonical
   * decimal price text of the loaded trades — display formatting only, never
   * financial truth).
   */
  readonly pricePrecision: number;
}

/**
 * A mounted chart renderer. Lifecycle: create via the factory, push data as
 * often as the projection refreshes, subscribe to crosshair moves for price
 * inspection, destroy on unmount.
 */
export interface ChartRenderer {
  /** Human-readable renderer identity (disclosed in the surface chrome). */
  readonly libraryLabel: string;
  /**
   * Replace the full series data (display batching; gaps stay gaps). The
   * implementation fits the visible range the first time NON-EMPTY data
   * arrives; subsequent calls preserve the user's viewport.
   */
  setData(data: ChartSeriesData): void;
  /**
   * Subscribe to crosshair inspection. The handler receives the snapshot for
   * the hovered bucket or null when the pointer leaves the data. Returns an
   * unsubscribe function.
   */
  subscribeCrosshairMove(
    handler: (snapshot: ChartCrosshairSnapshot | null) => void,
  ): () => void;
  /** Tear the renderer down (idempotent). */
  destroy(): void;
}

/** Factory: mount a renderer into a container element. */
export type ChartRendererFactory = (
  container: HTMLElement,
  options: ChartRendererOptions,
) => ChartRenderer;

/** Successful loader result: a renderer factory + disclosed library label. */
export interface ChartRendererAvailable {
  readonly status: "available";
  readonly libraryLabel: string;
  readonly createRenderer: ChartRendererFactory;
}

/**
 * Honest fallback (typed, disclosed): no usable charting library behind the
 * seam. The surface renders this state visibly — it never silently draws
 * fake candles and never fetches anything remote.
 */
export interface ChartRendererUnavailable {
  readonly status: "chart-library-unavailable";
  readonly reason: string;
}

export type ChartRendererLoadResult = ChartRendererAvailable | ChartRendererUnavailable;

/** A loader resolves the concrete renderer behind the seam (async on purpose). */
export type ChartRendererLoader = () => Promise<ChartRendererLoadResult>;

/**
 * Loader override seam. The default is the lightweight-charts adapter; tests
 * (and future composition points) may inject a loader. Injectable rather
 * than prop-drilled because the loader is a process-level concern (module
 * resolution), not per-mount state.
 */
let chartRendererLoaderOverride: ChartRendererLoader | undefined;

/**
 * Override the renderer loader (test/composition seam). Passing undefined
 * restores the default lightweight-charts adapter.
 */
export function setChartRendererLoader(loader: ChartRendererLoader | undefined): void {
  chartRendererLoaderOverride = loader;
}

/** The active renderer loader (default: the lightweight-charts adapter). */
export function getChartRendererLoader(): ChartRendererLoader {
  return chartRendererLoaderOverride ?? loadLightweightChartsRenderer;
}
