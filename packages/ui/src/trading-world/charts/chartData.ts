/**
 * World-driven chart data transforms — W007.
 *
 * Deterministic projection of world-client Trade/Quote projections into the
 * chart's series data (the "world-driven data shape"). PURE functions — the
 * React surface (`./ChartToolSurface.tsx`) only calls them; nothing here
 * touches React, the DOM or the chart library.
 *
 * Laws (ARCHITECTURE-LOCK A6 + WORLD-PROTOCOL "UI projection law"):
 * - NEVER INVENT FACTS: every OHLC value and volume figure is a real traded
 *   price/quantity from the Trade projections. Buckets with no trades are
 *   absent (gaps stay gaps) — no interpolation, no carried-forward candles.
 * - DISPLAY BATCHING ONLY: grouping trades into time buckets is the allowed
 *   display batching; nothing else is aggregated.
 * - DETERMINISM: same trades in, same series out. Ordering is by
 *   (occurredAt, sequence); price/quantity decimal text is converted to
 *   chart numbers with the platform-independent ECMAScript string→number
 *   conversion (IEEE-754, exact for the same input text on every platform).
 * - SIMULATION TIME: bucket keys live on the simulation axis (W004): the
 *   chart x-axis is world time (`occurredAt`), never host/wall time.
 */

/**
 * Structural mirror of the W003 `InstrumentId` opaque brand
 * (`string & { readonly __brand: "InstrumentId" }` — packages/tradrl-world-
 * contracts/src/ids.ts). The chart treats instrument identity as an opaque
 * query key; the mirror keeps the port call sites type-checked against the
 * real branded signature (a contracts brand change breaks this file at
 * compile time) without packages/ui importing the contracts package
 * (W006 `.d.ts` shim rationale).
 */
export type ChartInstrumentId = string & { readonly __brand: "InstrumentId" };

/** Typed error for projection input that violates the canonical contracts. */
export class ChartProjectionDataError extends Error {
  constructor(detail: string) {
    super(`[trading-world/chart] refusing to project malformed market data: ${detail}`);
    this.name = "ChartProjectionDataError";
  }
}

/**
 * Minimal structural slice of the W003 `Trade` contract the chart projects.
 * Structural (not imported): the W003 branded types (Price/Quantity are
 * canonical decimal text, TimestampMs/SequenceNumber numbers) are assignable
 * to it, so contracts drift breaks the surface's call site at compile time
 * without packages/ui importing the contracts package (W006 shim rationale).
 */
export interface ChartTradeProjection {
  /** Canonical decimal text (W003 Price). */
  readonly price: string;
  /** Canonical decimal text (W003 Quantity). */
  readonly quantity: string;
  /** Simulation-time milliseconds when the trade occurred (W003 Trade). */
  readonly occurredAt: number;
  /** Monotonic per-world sequence (tiebreak for equal timestamps). */
  readonly sequence: number;
}

/** Minimal structural slice of the W003 `Quote` contract. */
export interface ChartQuoteProjection {
  readonly bid?: string;
  readonly ask?: string;
  readonly last?: string;
  readonly asOf: number;
}

/** Options for building the chart series from trades. */
export interface ChartSeriesBuildOptions {
  /**
   * Candle bucket size in simulation milliseconds. Must be >= 1000: the
   * chart axis granularity is whole seconds, so finer buckets could map two
   * buckets onto the same axis second. Loud error, not silent clamping
   * (composition mistakes must be visible).
   */
  readonly bucketMs: number;
}

/** Default candle size: 1 minute of simulation time. */
export const DEFAULT_CHART_CANDLE_BUCKET_MS = 60_000;

/** Cap on derived price display precision (defensive display bound). */
const MAX_PRICE_DISPLAY_PRECISION = 8;

export interface ChartSeriesProjection {
  /** Candles, ascending unique simulation-time buckets. */
  readonly candles: readonly CandleProjection[];
  /** Volume columns aligned 1:1 with candles. */
  readonly volume: readonly VolumeProjection[];
  /** Decimal places derived from the observed canonical price text. */
  readonly priceDisplayPrecision: number;
  /** Number of source trades consumed (all of them — nothing is dropped). */
  readonly tradeCount: number;
  /** First/last source trade simulation time (undefined when no trades). */
  readonly fromSimulationMs?: number;
  readonly toSimulationMs?: number;
}

/** One candle — the seam's `ChartCandlePoint` plus the raw bucket identity. */
export interface CandleProjection {
  /** Simulation-time bucket start, whole seconds since epoch. */
  readonly time: number;
  /** Simulation-time bucket start, milliseconds. */
  readonly bucketStartMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** One volume column — the seam's `ChartVolumePoint` fields. */
export interface VolumeProjection {
  readonly time: number;
  readonly value: number;
  readonly up: boolean;
}

/**
 * Deterministically convert canonical decimal text to a chart number
 * (display projection). ECMAScript StringToNumber is fully specified, so the
 * same text always yields the same IEEE-754 value on every platform.
 * Malformed/non-finite input is a typed error — the chart never guesses.
 */
export function decimalTextToNumber(value: string, field: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ChartProjectionDataError(`${field} must be canonical decimal text, got ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ChartProjectionDataError(
      `${field} ${JSON.stringify(value)} is not a finite decimal number`,
    );
  }
  return parsed;
}

/** Simulation-time ms → whole chart-axis seconds (floor, deterministic). */
export function simulationMsToChartSeconds(simulationMs: number): number {
  if (!Number.isFinite(simulationMs)) {
    throw new ChartProjectionDataError(`occurredAt ${simulationMs} is not finite`);
  }
  return Math.floor(simulationMs / 1000);
}

/** Simulation-time bucket start on the ms axis (floor division, negative-safe). */
export function simulationMsBucketStart(simulationMs: number, bucketMs: number): number {
  return Math.floor(simulationMs / bucketMs) * bucketMs;
}

/**
 * Build the full chart series projection from Trade projections.
 *
 * Deterministic algorithm:
 * 1. validate every trade (price/quantity decimal text, finite timestamps);
 * 2. sort by (occurredAt asc, sequence asc) — the per-world journal order;
 * 3. bucket by `floor(occurredAt / bucketMs) * bucketMs` on the simulation
 *    axis; within a bucket open = first trade, close = last trade, high/low =
 *    max/min prices, volume = sum of quantities (all in sorted order);
 * 4. emit buckets ascending; absent buckets are ABSENT (no fabrication).
 */
export function buildChartSeriesProjection(
  trades: readonly ChartTradeProjection[],
  options: ChartSeriesBuildOptions,
): ChartSeriesProjection {
  const bucketMs = options.bucketMs;
  if (!Number.isInteger(bucketMs) || bucketMs < 1000) {
    throw new ChartProjectionDataError(
      `bucketMs must be an integer >= 1000 (chart axis granularity is whole seconds), got ${bucketMs}`,
    );
  }

  // Validate + parse first (loud, before any partial output).
  const parsed = trades.map((trade) => ({
    occurredAt: assertFiniteMs(trade.occurredAt),
    sequence: trade.sequence,
    price: decimalTextToNumber(trade.price, "Trade.price"),
    quantity: decimalTextToNumber(trade.quantity, "Trade.quantity"),
    priceText: trade.price,
  }));

  // Deterministic order: (occurredAt, sequence); Array#sort is stable, so
  // equal keys keep input order (contracts make sequence monotonic per
  // world, so full ties should not occur).
  const ordered = [...parsed].sort((left, right) =>
    left.occurredAt !== right.occurredAt
      ? left.occurredAt - right.occurredAt
      : left.sequence - right.sequence,
  );

  interface Bucket {
    bucketStartMs: number;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    precision: number;
  }
  const buckets: Bucket[] = [];
  let current: Bucket | undefined;
  for (const trade of ordered) {
    const bucketStartMs = simulationMsBucketStart(trade.occurredAt, bucketMs);
    if (current === undefined || current.bucketStartMs !== bucketStartMs) {
      current = {
        bucketStartMs,
        time: simulationMsToChartSeconds(bucketStartMs),
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity,
        precision: decimalPlaces(trade.priceText),
      };
      buckets.push(current);
      continue;
    }
    current.high = Math.max(current.high, trade.price);
    current.low = Math.min(current.low, trade.price);
    current.close = trade.price;
    current.volume += trade.quantity;
    current.precision = Math.max(current.precision, decimalPlaces(trade.priceText));
  }

  const priceDisplayPrecision = buckets.reduce(
    (max, bucket) => Math.max(max, bucket.precision),
    0,
  );
  return {
    candles: buckets.map((bucket) => ({
      time: bucket.time,
      bucketStartMs: bucket.bucketStartMs,
      open: bucket.open,
      high: bucket.high,
      low: bucket.low,
      close: bucket.close,
    })),
    volume: buckets.map((bucket) => ({
      time: bucket.time,
      value: bucket.volume,
      up: bucket.close >= bucket.open,
    })),
    priceDisplayPrecision: Math.min(priceDisplayPrecision, MAX_PRICE_DISPLAY_PRECISION),
    tradeCount: trades.length,
    fromSimulationMs: ordered.length > 0 ? ordered[0]!.occurredAt : undefined,
    toSimulationMs: ordered.length > 0 ? ordered[ordered.length - 1]!.occurredAt : undefined,
  };
}

/** Decimal places of canonical decimal text (0 for integer text). */
export function decimalPlaces(value: string): number {
  const dotIndex = value.indexOf(".");
  return dotIndex === -1 ? 0 : value.length - dotIndex - 1;
}

/**
 * Deterministic simulation-time label: UTC date-time, zero-padded, no
 * locale dependencies (the same simulation instant always formats
 * identically on every platform).
 */
export function formatSimulationTimestampMs(simulationMs: number): string {
  const date = new Date(simulationMs);
  if (Number.isNaN(date.getTime())) {
    throw new ChartProjectionDataError(`timestamp ${simulationMs} is not a valid instant`);
  }
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

/** Compact volume label for the legend (deterministic, no locale). */
export function formatChartVolume(volume: number): string {
  if (!Number.isFinite(volume)) {
    return "—";
  }
  const abs = Math.abs(volume);
  if (abs >= 1_000_000_000) return `${trimTrailingZeros(volume / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trimTrailingZeros(volume / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimTrailingZeros(volume / 1_000)}K`;
  return trimTrailingZeros(volume);
}

function trimTrailingZeros(value: number): string {
  const text = value.toFixed(2);
  return text.replace(/\.?0+$/u, "");
}

function assertFiniteMs(value: number): number {
  if (!Number.isFinite(value)) {
    throw new ChartProjectionDataError(`occurredAt ${value} is not a finite simulation timestamp`);
  }
  return value;
}
