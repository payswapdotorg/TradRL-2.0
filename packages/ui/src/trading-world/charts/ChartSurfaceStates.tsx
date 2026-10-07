/**
 * Chart surface state shapes + honest status bodies — W007.
 *
 * Split out of `./ChartToolSurface.tsx` (repo lint law: ≤400 code lines per
 * file) with zero behavior change: the discriminated state unions the
 * surface renders over, and the non-chart bodies it renders INSTEAD of a
 * chart when the world data or the renderer is not available. Every body is
 * an honest disclosure (ACCEPTANCE-WORLD-ALPHA K, ARCHITECTURE-LOCK A6) —
 * no state ever draws or implies market facts it does not have.
 */

import { Button } from "@/components/ui/button.js";
import type { ClockView } from "../runtime/worldContracts.js";
import {
  formatSimulationTimestampMs,
  type ChartQuoteProjection,
  type ChartSeriesProjection,
} from "./chartData.js";
import type { ChartRendererFactory } from "./chartRenderer.js";

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
  | {
      readonly status: "available";
      readonly libraryLabel: string;
      readonly factory: ChartRendererFactory;
    }
  | { readonly status: "chart-library-unavailable"; readonly reason: string };

/**
 * The body rendered instead of the chart canvas for every non-ready state.
 * (`ready` + `available` renders the canvas itself in ChartToolSurface.)
 */
export function ChartSurfaceStatusBody({
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

/** Quote chip text: canonical decimal text as-is (no re-formatting truth). */
export function describeQuote(quote: ChartQuoteProjection): string {
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

/** Simulation-clock chip (W004: the x-axis is simulation time). */
export function describeClock(clock: ClockView): { label: string; status: string } {
  const status =
    clock.status === "playing"
      ? `playing ${formatSpeed(clock.speed)}${clock.followingRealtime ? " · following realtime" : ""}`
      : "paused";
  return { label: `${formatSimulationTimestampMs(clock.simulationTime)} · ${status}`, status };
}

/** Legend price text at the projection's derived display precision. */
export function formatPrice(value: number, precision: number): string {
  return value.toFixed(Math.max(0, Math.min(8, Math.floor(precision))));
}

function formatSpeed(speed: number): string {
  return `${Number.isFinite(speed) ? speed : 1}×`;
}
