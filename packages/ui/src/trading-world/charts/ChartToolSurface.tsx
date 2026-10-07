/**
 * Chart tool surface — W007 (the Main Chart of the trader cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Main Chart cell:
 * candles / volume, crosshair price inspection) and "Simulation disclosure"
 * (persistent, text — never color alone); spec/ARCHITECTURE-LOCK.md A6 (a
 * projection of world truth through the world-client seam — never
 * authoritative); spec/WORLD-PROTOCOL.md "UI projection law" (may batch,
 * conflate, virtualize; may never fabricate financial facts); W004 time
 * semantics (the x-axis is SIMULATION time; pause/seek surface through the
 * clock state, never wall time).
 *
 * Data flow: the W006 world-client seam (`useTradingWorldClient`) provides
 * the four-port protocol. The surface projects `query.getTrades` into
 * candles + volume (`./chartData.ts`, deterministic display batching),
 * `query.getQuote` into a bid/ask/last chip and `clock.getClock` into a
 * simulation-time chip. EVERY state is honest:
 * - runtime `unattached` (today's noop provider) → teaching state, no data;
 * - no trades yet → teaching state (advance the clock to make a market);
 * - query rejection → the typed error, visibly;
 * - chart library absent → the typed `chart-library-unavailable` fallback
 *   (`./chartRenderer.ts` seam + `./lightweightChartsAdapter.ts`), with the
 *   real projected data summarized in text — nothing faked, ever.
 *
 * Mounted through the W006 tool registry: this component replaces the chart
 * placeholder via `withSurfaceOverride("chart", …)` — see `./index.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { ClockView } from "../runtime/worldContracts.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import {
  buildChartSeriesProjection,
  DEFAULT_CHART_CANDLE_BUCKET_MS,
  formatChartVolume,
  formatSimulationTimestampMs,
  type ChartQuoteProjection,
  type ChartSeriesProjection,
  type ChartTradeProjection,
} from "./chartData.js";
import {
  getChartRendererLoader,
  type ChartCrosshairSnapshot,
  type ChartRenderer,
  type ChartRendererFactory,
} from "./chartRenderer.js";

/**
 * Default instrument the chart projects. World Alpha worlds are
 * single-instrument; the id is an opaque query key (DOMAIN-MODEL "identity
 * laws"), overridable at composition (`createChartToolSurface`). W008
 * (watchlist) owns real instrument selection; until it lands, an unknown id
 * surfaces the world's own typed error — honest, no guessing.
 */
export const DEFAULT_CHART_INSTRUMENT_ID = "instrument-alpha";

/** Default projection refresh cadence (ms). 0 disables polling. */
export const DEFAULT_CHART_POLL_MS = 2000;

/** Max trades fetched per refresh (display batching bound). */
export const DEFAULT_CHART_TRADE_QUERY_LIMIT = 2000;

/** Configuration for the chart surface component. */
export interface ChartToolSurfaceConfig {
  /** Opaque instrument identity to project (query key, not a symbol). */
  readonly instrumentId: string;
  /** Candle bucket size in simulation ms (default 1 minute). */
  readonly candleBucketMs?: number;
  /** Projection refresh cadence in ms; 0 disables polling (default 2000). */
  readonly pollMs?: number;
  /** Max trades requested per refresh (default 2000). */
  readonly tradeQueryLimit?: number;
}

/** World-data projection state of the chart surface. */
export type ChartDataState =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | {
      readonly status: "ready";
      readonly projection: ChartSeriesProjection;
      readonly quote?: ChartQuoteProjection;
      readonly clock?: ClockView;
    }
  | { readonly status: "error"; readonly message: string };

/** Renderer-seam state of the chart surface. */
export type ChartRendererState =
  | { readonly status: "loading" }
  | { readonly status: "available"; readonly libraryLabel: string; readonly factory: ChartRendererFactory }
  | { readonly status: "chart-library-unavailable"; readonly reason: string };

export function createChartToolSurface(
  config: ChartToolSurfaceConfig,
): ComponentType<TradingWorldToolSurfaceProps> {
  const instrumentId = config.instrumentId;
  const candleBucketMs = config.candleBucketMs ?? DEFAULT_CHART_CANDLE_BUCKET_MS;
  const pollMs = config.pollMs ?? DEFAULT_CHART_POLL_MS;
  const tradeQueryLimit = config.tradeQueryLimit ?? DEFAULT_CHART_TRADE_QUERY_LIMIT;

  function ChartToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const [dataState, setDataState] = useState<ChartDataState>(() =>
      client.status === "unattached" ? { status: "unattached" } : { status: "loading" },
    );
    const [rendererState, setRendererState] = useState<ChartRendererState>({
      status: "loading",
    });
    const [crosshair, setCrosshair] = useState<ChartCrosshairSnapshot | null>(null);

    // --- world data fetch (only when a runtime is attached) ------------------
    const fetchProjection = useCallback(
      async (signal: { cancelled: boolean }): Promise<void> => {
        try {
          // Fatal read: without trades there is no chart. The projection
          // transform may throw ChartProjectionDataError — malformed data is
          // a visible error, never a guessed candle.
          const trades: readonly ChartTradeProjection[] = await client.query.getTrades(
            instrumentId,
            { limit: tradeQueryLimit },
          );
          const projection = buildChartSeriesProjection(trades, { bucketMs: candleBucketMs });
          // Non-fatal reads: quote/clock enrich the chrome; their failure is
          // an honest absence (no chip), never a fabricated value.
          const quote = await client.query.getQuote(instrumentId).catch(() => undefined);
          const clock = await client.clock.getClock().catch(() => undefined);
          if (signal.cancelled) {
            return;
          }
          if (projection.candles.length === 0) {
            setDataState({ status: "empty" });
            return;
          }
          setDataState({
            status: "ready",
            projection,
            ...(quote === undefined ? {} : { quote: quote as ChartQuoteProjection }),
            ...(clock === undefined ? {} : { clock }),
          });
        } catch (error) {
          if (signal.cancelled) {
            return;
          }
          setDataState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      [client, instrumentId, tradeQueryLimit, candleBucketMs],
    );

    useEffect(() => {
      if (client.status !== "ready") {
        return;
      }
      const signal = { cancelled: false };
      let inFlight = false;
      const run = (): void => {
        if (inFlight) {
          return;
        }
        inFlight = true;
        void fetchProjection(signal).finally(() => {
          inFlight = false;
        });
      };
      run();
      if (pollMs <= 0) {
        return () => {
          signal.cancelled = true;
        };
      }
      const timer = setInterval(run, pollMs);
      return () => {
        signal.cancelled = true;
        clearInterval(timer);
      };
    }, [client, pollMs, fetchProjection]);

    // --- renderer resolution (the seam) ---------------------------------------
    useEffect(() => {
      const signal = { cancelled: false };
      void (async () => {
        const result = await getChartRendererLoader()();
        if (signal.cancelled) {
          return;
        }
        if (result.status === "available") {
          setRendererState({
            status: "available",
            libraryLabel: result.libraryLabel,
            factory: result.createRenderer,
          });
        } else {
          setRendererState({ status: "chart-library-unavailable", reason: result.reason });
        }
      })();
      return () => {
        signal.cancelled = true;
      };
    }, []);

    // --- renderer mount + data push -------------------------------------------
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<ChartRenderer | null>(null);
    const chartMounted =
      rendererState.status === "available" && dataState.status === "ready";
    const pricePrecision =
      dataState.status === "ready" ? dataState.projection.priceDisplayPrecision : 0;

    useEffect(() => {
      if (
        !chartMounted ||
        rendererState.status !== "available" ||
        containerRef.current === null
      ) {
        return;
      }
      let renderer: ChartRenderer;
      try {
        renderer = rendererState.factory(containerRef.current, { pricePrecision });
      } catch (error) {
        setRendererState({
          status: "chart-library-unavailable",
          reason: `renderer construction failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return;
      }
      rendererRef.current = renderer;
      const unsubscribeCrosshair = renderer.subscribeCrosshairMove(setCrosshair);
      return () => {
        unsubscribeCrosshair();
        rendererRef.current = null;
        renderer.destroy();
      };
    }, [chartMounted, rendererState, pricePrecision]);

    const seriesData = useMemo(
      () =>
        dataState.status !== "ready"
          ? undefined
          : { candles: dataState.projection.candles, volume: dataState.projection.volume },
      [dataState],
    );

    useEffect(() => {
      const renderer = rendererRef.current;
      if (renderer === null || seriesData === undefined) {
        return;
      }
      renderer.setData(seriesData);
    }, [seriesData, rendererState]);

    // --- legend (crosshair inspection; latest candle when not hovering) -------
    const latest =
      dataState.status === "ready" && dataState.projection.candles.length > 0
        ? {
            candle: dataState.projection.candles[dataState.projection.candles.length - 1]!,
            volume:
              dataState.projection.volume[dataState.projection.volume.length - 1]?.value ?? 0,
          }
        : undefined;
    const inspected = crosshair ?? latest;

    const quoteChip =
      dataState.status === "ready" && dataState.quote !== undefined
        ? describeQuote(dataState.quote)
        : undefined;
    const clockChip =
      dataState.status === "ready" && dataState.clock !== undefined
        ? describeClock(dataState.clock)
        : undefined;

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-chart-surface=""
        data-trading-world-chart-instrument={instrumentId}
        data-trading-world-chart-data-status={dataState.status}
        data-trading-world-chart-renderer-status={rendererState.status}
        data-trading-world-chart-candles={
          dataState.status === "ready" ? dataState.projection.candles.length : 0
        }
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
          <span className="truncate font-mono text-ui-xs text-foreground-subtle">
            {instrumentId}
          </span>
          <span
            data-trading-world-simulation-disclosure=""
            title="Simulation disclosure — this world has no live execution authority (World Alpha)"
            className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
          >
            {TRADING_WORLD_SIMULATED_DISCLOSURE}
          </span>
          {clockChip ? (
            <span
              data-trading-world-chart-clock=""
              data-trading-world-chart-clock-status={clockChip.status}
              title="Simulation clock (W004): the chart x-axis is simulation time"
              className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
            >
              {clockChip.label}
            </span>
          ) : null}
          {quoteChip ? (
            <span
              data-trading-world-chart-quote=""
              title="Top-of-book quote projection (query.getQuote)"
              className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
            >
              {quoteChip}
            </span>
          ) : null}
          <span
            data-trading-world-chart-renderer=""
            title={
              rendererState.status === "available"
                ? `Renderer: ${rendererState.libraryLabel}`
                : rendererState.reason
            }
            className={cn(
              "ml-auto shrink-0 font-mono text-ui-xs",
              rendererState.status === "available"
                ? "text-foreground-subtlest"
                : "text-foreground-subtle",
            )}
          >
            {rendererState.status === "available"
              ? rendererState.libraryLabel
              : "renderer: unavailable"}
          </span>
        </header>

        {inspected ? (
          <div
            data-trading-world-chart-legend=""
            data-trading-world-chart-legend-hover={crosshair ? "true" : "false"}
            className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/50 px-2 py-1 font-mono text-ui-xs text-foreground-subtle"
          >
            <span title="Simulation time of the inspected bucket (x-axis = world time)">
              {formatSimulationTimestampMs(inspected.candle.time * 1000)}
            </span>
            <span>
              O {formatPrice(inspected.candle.open, pricePrecision)} H{" "}
              {formatPrice(inspected.candle.high, pricePrecision)} L{" "}
              {formatPrice(inspected.candle.low, pricePrecision)} C{" "}
              <span data-trading-world-chart-legend-close="">
                {formatPrice(inspected.candle.close, pricePrecision)}
              </span>
            </span>
            {/* Direction is stated as text — never color alone (UX-DESIGN). */}
            <span data-trading-world-chart-legend-direction="">
              {inspected.candle.close >= inspected.candle.open ? "▲ up" : "▼ down"}
            </span>
            <span>Vol {formatChartVolume(inspected.volume)}</span>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {chartMounted ? (
            <div
              ref={containerRef}
              data-trading-world-chart-container=""
              className="h-full w-full"
            />
          ) : null}
          {!chartMounted ? (
            <ChartSurfaceStatusBody
              dataState={dataState}
              rendererState={rendererState}
              onRetry={() => {
                setDataState({ status: "loading" });
                void fetchProjection({ cancelled: false });
              }}
            />
          ) : null}
        </div>

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Chart surface mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return ChartToolSurface;
}

/** The default chart surface (single-instrument World Alpha projection). */
export const ChartToolSurface = createChartToolSurface({
  instrumentId: DEFAULT_CHART_INSTRUMENT_ID,
});

function ChartSurfaceStatusBody({
  dataState,
  rendererState,
  onRetry,
}: {
  readonly dataState: ChartDataState;
  readonly rendererState: ChartRendererState;
  readonly onRetry: () => void;
}) {
  if (dataState.status === "unattached") {
    return (
      <ChartNotice
        stateId="unattached"
        title="No world runtime attached"
        body="The chart renders real market data only. The deterministic world engine (W013) and its UI transport (W018) are not attached yet — no candles, quotes or volumes are shown."
      />
    );
  }
  if (dataState.status === "loading") {
    return <ChartNotice stateId="loading" title="Loading world market data…" body="" />;
  }
  if (dataState.status === "error") {
    return (
      <div
        data-trading-world-chart-state="error"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
      >
        <p className="text-ui-sm font-medium text-foreground">Market data unavailable</p>
        <p className="max-w-[24rem] break-words font-mono text-ui-xs text-foreground-subtle">
          {dataState.message}
        </p>
        <p className="max-w-[24rem] text-ui-xs text-foreground-subtlest">
          The chart never substitutes, estimates or caches market facts — a failed read stays
          an honest failure.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (dataState.status === "empty") {
    return (
      <ChartNotice
        stateId="empty"
        title="No trades in this world yet"
        body="Play or step the simulation clock (the strip below the cockpit) — candles and volume appear as the world's market trades occur. Nothing is drawn without real trades."
      />
    );
  }
  // ready, but the chart library is not available: the honest fallback, with
  // a textual summary of the REAL projected data (never a fake chart).
  const projection = dataState.projection;
  const lastCandle = projection.candles[projection.candles.length - 1];
  return (
    <div
      data-trading-world-chart-state="chart-library-unavailable"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">Chart library unavailable</p>
      <p className="max-w-[28rem] text-ui-xs text-foreground-subtle">
        Candlestick rendering is disabled:{" "}
        {rendererState.status === "chart-library-unavailable"
          ? rendererState.reason
          : "the renderer did not load."}
      </p>
      <p
        data-trading-world-chart-data-summary=""
        className="font-mono text-ui-xs text-foreground-subtlest"
      >
        {projection.tradeCount} trades projected · {projection.candles.length} candles ·{" "}
        {formatSimulationTimestampMs(projection.fromSimulationMs ?? 0)} →{" "}
        {formatSimulationTimestampMs(projection.toSimulationMs ?? 0)}
        {lastCandle === undefined ? "" : ` · last close ${lastCandle.close}`}
      </p>
      <p className="max-w-[28rem] text-ui-xs text-foreground-subtlest">
        Data above is the real world projection, shown as text until the charting dependency
        lands (see the W007 PR TL action item).
      </p>
    </div>
  );
}

function ChartNotice({
  stateId,
  title,
  body,
}: {
  readonly stateId: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      data-trading-world-chart-state={stateId}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      {body.length > 0 ? (
        <p className="max-w-[24rem] text-ui-xs text-foreground-subtle">{body}</p>
      ) : null}
    </div>
  );
}

function describeQuote(quote: ChartQuoteProjection): string {
  const parts: string[] = [];
  if (quote.bid !== undefined) {
    parts.push(`bid ${quote.bid}`);
  }
  if (quote.ask !== undefined) {
    parts.push(`ask ${quote.ask}`);
  }
  if (quote.last !== undefined) {
    parts.push(`last ${quote.last}`);
  }
  return parts.join(" ");
}

function describeClock(clock: ClockView): { label: string; status: string } {
  const status =
    clock.status === "playing"
      ? `playing ${formatSpeed(clock.speed)}${clock.followingRealtime ? " · following realtime" : ""}`
      : "paused";
  return { label: `${formatSimulationTimestampMs(clock.simulationTime)} · ${status}`, status };
}

function formatSpeed(speed: number): string {
  return `${Number.isFinite(speed) ? speed : 1}×`;
}

function formatPrice(value: number, precision: number): string {
  return value.toFixed(Math.max(0, Math.min(8, Math.floor(precision))));
}
