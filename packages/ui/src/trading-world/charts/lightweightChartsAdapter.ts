/**
 * Lightweight Charts adapter — W007.
 *
 * The register-verified chart renderer behind the `./chartRenderer.ts` seam:
 * TradingView Lightweight Charts, npm `lightweight-charts`, pinned 5.2.1,
 * Apache-2.0 (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md — decision "Direct
 * dependency (npm)"; constraints: record package + exact version in
 * THIRD-PARTY-NOTICES at distribution, re-verify license on major version
 * bumps — current major 5.x).
 *
 * DEPENDENCY RULE / HONEST AVAILABILITY: `lightweight-charts` is NOT yet a
 * dependency of `@zcode/ui` (packages/ui/package.json + pnpm-lock.yaml are
 * TL-owned manifests outside W007's frozen write surface; adding it is the
 * W007 PR's TL action item). This adapter therefore:
 *
 * 1. dynamic-imports the package IF it is resolvable (no CDN, no remote
 *    fetch — offline/provenance law);
 * 2. structurally validates the module against the exact Lightweight Charts
 *    5.x surface it uses (verified against the 5.2.1 typings:
 *    `createChart`, series definitions `CandlestickSeries`/`HistogramSeries`
 *    passed to `chart.addSeries(definition, options)`, `CrosshairMode`,
 *    `version()`) — an absent, unresolvable or differently-shaped module
 *    yields the typed `chart-library-unavailable` result, never a crash and
 *    never a guessed chart;
 * 3. maps the validated module onto the internal `ChartRenderer` interface:
 *    candlestick series + volume histogram overlay sharing the simulation
 *    time axis, crosshair subscription for price inspection, price scale
 *    with derived precision.
 *
 * When the TL lands the dependency, the `@ts-expect-error` +
 * `@vite-ignore` directives below become unused and MUST be removed (the
 * compiler enforces the first: a resolving import makes the suppression a
 * hard error) so the bundler statically wires the package.
 */

import type {
  ChartCandlePoint,
  ChartCrosshairSnapshot,
  ChartRenderer,
  ChartRendererFactory,
  ChartRendererLoadResult,
  ChartRendererOptions,
  ChartSeriesData,
} from "./chartRenderer.js";

/** Register-pinned version (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md row). */
export const LIGHTWEIGHT_CHARTS_REGISTERED_VERSION = "5.2.1";

/** Palette for the candle/volume projection (structural, not semantic —
 * up/down is ALSO stated as text in the legend, never color alone). */
const UP_COLOR = "#26a69a";
const DOWN_COLOR = "#ef5350";
const VOLUME_UP_COLOR = "rgba(38, 166, 154, 0.5)";
const VOLUME_DOWN_COLOR = "rgba(239, 83, 80, 0.5)";
const AXIS_TEXT_COLOR = "#9aa4b2";
const AXIS_LINE_COLOR = "rgba(154, 164, 178, 0.3)";

/**
 * The exact Lightweight Charts 5.x module surface this adapter consumes.
 * Written against the 5.2.1 typings; kept local (not `declare module`) so
 * adding the real package dependency cannot silently conflict with an
 * ambient declaration. All access is runtime-validated by
 * {@link isLightweightChartsModule}.
 */
interface LightweightChartsModuleLike {
  createChart: (
    container: HTMLElement,
    options?: Record<string, unknown>,
  ) => LightweightChartApiLike;
  CandlestickSeries: SeriesDefinitionLike;
  HistogramSeries: SeriesDefinitionLike;
  CrosshairMode: { readonly Normal: number };
  version?: () => string;
}

/** Series definition passed to `chart.addSeries` (Lightweight Charts 5.x). */
interface SeriesDefinitionLike {
  readonly type?: string;
}

/** The chart api pieces the adapter touches. */
interface LightweightChartApiLike {
  addSeries: (
    definition: SeriesDefinitionLike,
    options?: Record<string, unknown>,
  ) => SeriesApiLike;
  priceScale: (priceScaleId: string) => { applyOptions: (options: Record<string, unknown>) => void };
  timeScale: () => { fitContent: () => void };
  subscribeCrosshairMove: (handler: (param: unknown) => void) => void;
  remove: () => void;
}

/** The series api pieces the adapter touches. */
interface SeriesApiLike {
  setData: (data: readonly Record<string, unknown>[]) => void;
}

/** Structural validation of the dynamically imported module. */
function isLightweightChartsModule(mod: unknown): mod is LightweightChartsModuleLike {
  if (typeof mod !== "object" || mod === null) {
    return false;
  }
  const candidate = mod as Partial<LightweightChartsModuleLike> & Record<string, unknown>;
  return (
    typeof candidate.createChart === "function" &&
    typeof candidate.CandlestickSeries === "object" &&
    candidate.CandlestickSeries !== null &&
    typeof candidate.HistogramSeries === "object" &&
    candidate.HistogramSeries !== null &&
    typeof candidate.CrosshairMode === "object" &&
    candidate.CrosshairMode !== null &&
    typeof candidate.CrosshairMode.Normal === "number"
  );
}

/**
 * The default renderer loader: resolve `lightweight-charts` if present,
 * honestly report unavailability otherwise. Exported for the seam default
 * (chartRenderer.ts) and for harnesses that obtain the module through a
 * different resolution path (e.g. a vendored URL) and then reuse this exact
 * mapping + validation.
 */
export async function loadLightweightChartsRenderer(): Promise<ChartRendererLoadResult> {
  let mod: unknown;
  try {
    // Literal specifier + @vite-ignore: keeps the bundler from resolving the
    // not-yet-declared dependency today (raw dynamic import → rejection in
    // browsers/Node → honest fallback) while making the future dependency
    // switch a one-directive change. @ts-expect-error: the package is not a
    // dependency yet — when the TL adds it this suppression becomes an
    // unused-directive compile error and must be deleted.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see block comment
    mod = await import(/* @vite-ignore */ "lightweight-charts");
  } catch (error) {
    return {
      status: "chart-library-unavailable",
      reason: `lightweight-charts is not installed in this build (import rejected: ${
        error instanceof Error ? error.message : String(error)
      }). Adding the register-verified dependency (npm lightweight-charts ${LIGHTWEIGHT_CHARTS_REGISTERED_VERSION}, Apache-2.0) to @zcode/ui is the W007 TL action item.`,
    };
  }
  return createLightweightChartsRendererFromModule(mod);
}

/**
 * Validate a candidate module and produce the renderer factory. Split from
 * {@link loadLightweightChartsRenderer} so alternate resolution paths
 * (package dependency, test harness) go through the SAME validation and
 * mapping — one law, no shadow implementations.
 */
export function createLightweightChartsRendererFromModule(
  mod: unknown,
): ChartRendererLoadResult {
  if (!isLightweightChartsModule(mod)) {
    return {
      status: "chart-library-unavailable",
      reason:
        "the resolved lightweight-charts module did not expose the expected 5.x API surface " +
        "(createChart + CandlestickSeries/HistogramSeries series definitions + CrosshairMode) — " +
        `the register pins npm lightweight-charts ${LIGHTWEIGHT_CHARTS_REGISTERED_VERSION}; refusing to guess a chart.`,
    };
  }
  const version = typeof mod.version === "function" ? mod.version() : undefined;
  const libraryLabel = `Lightweight Charts${version ? ` ${version}` : ""}`;
  return {
    status: "available",
    libraryLabel,
    createRenderer: createRendererFactory(mod, libraryLabel),
  };
}

function createRendererFactory(
  mod: LightweightChartsModuleLike,
  libraryLabel: string,
): ChartRendererFactory {
  return (container: HTMLElement, options: ChartRendererOptions): ChartRenderer => {
    const pricePrecision = clampPrecision(options.pricePrecision);
    const minMove = Math.pow(10, -pricePrecision);
    const chart = mod.createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: AXIS_TEXT_COLOR,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: AXIS_LINE_COLOR },
        horzLines: { color: AXIS_LINE_COLOR },
      },
      rightPriceScale: { borderColor: AXIS_LINE_COLOR },
      // The x-axis is SIMULATION time: show clock times on the ticks. The
      // values themselves are the world's simulation timestamps (W004).
      timeScale: {
        borderColor: AXIS_LINE_COLOR,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: mod.CrosshairMode.Normal },
    });
    const candleSeries = chart.addSeries(mod.CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: false,
      priceFormat: { type: "price", precision: pricePrecision, minMove },
    });
    const volumeSeries = chart.addSeries(mod.HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Crosshair inspection: resolve the hovered bucket from the last-pushed
    // data (real projected facts), not from library-computed values.
    let buckets = new Map<number, { candle: ChartCandlePoint; volume: number }>();
    const crosshairHandlers = new Set<(snapshot: ChartCrosshairSnapshot | null) => void>();
    chart.subscribeCrosshairMove((param) => {
      const time = readCrosshairTime(param);
      const bucket = time === null ? undefined : buckets.get(time);
      for (const handler of crosshairHandlers) {
        handler(
          bucket && time !== null
            ? { time, candle: bucket.candle, volume: bucket.volume }
            : null,
        );
      }
    });

    let destroyed = false;
    let hasFittedContent = false;
    return {
      libraryLabel,
      setData(data: ChartSeriesData): void {
        if (destroyed) {
          return;
        }
        buckets = new Map(
          data.candles.map((candle) => {
            const volumePoint = data.volume.find(
              (point) => point.time === candle.time,
            );
            return [candle.time, { candle, volume: volumePoint?.value ?? 0 }];
          }),
        );
        candleSeries.setData(
          data.candles.map((candle) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
        );
        volumeSeries.setData(
          data.volume.map((point) => ({
            time: point.time,
            value: point.value,
            color: point.up ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
          })),
        );
        // Seam contract: fit the visible range the first time non-empty data
        // arrives; afterwards preserve the user's viewport.
        if (!hasFittedContent && data.candles.length > 0) {
          hasFittedContent = true;
          chart.timeScale().fitContent();
        }
      },
      subscribeCrosshairMove(
        handler: (snapshot: ChartCrosshairSnapshot | null) => void,
      ): () => void {
        crosshairHandlers.add(handler);
        return () => {
          crosshairHandlers.delete(handler);
        };
      },
      destroy(): void {
        if (destroyed) {
          return;
        }
        destroyed = true;
        crosshairHandlers.clear();
        buckets.clear();
        chart.remove();
      },
    };
  };
}

/** `MouseEventParams.time` is the hovered time (UTC seconds) or undefined. */
function readCrosshairTime(param: unknown): number | null {
  if (typeof param !== "object" || param === null) {
    return null;
  }
  const time = (param as { time?: unknown }).time;
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return null;
  }
  return time;
}

function clampPrecision(precision: number): number {
  if (!Number.isFinite(precision) || precision < 0) {
    return 2;
  }
  return Math.min(8, Math.floor(precision));
}
