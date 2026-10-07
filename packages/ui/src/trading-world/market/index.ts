/**
 * Trading World watchlist surface package — W008 public entrypoint.
 *
 * The trader's market overview of the cockpit (UX-DESIGN "Default trader
 * cockpit", Watchlist cell of the left column): per-instrument quote rows
 * (symbol, bid/ask/last with sizes, regime context, trading state, as-of)
 * projected from REAL world projections through the W006 world-client seam
 * — `query.getWorldMeta` (world identity + declared regime schedule),
 * `query.getTimeline` (announced `market.regime.changed` transitions +
 * journal-driven instrument discovery), `query.getInstrument` +
 * `query.getQuote` (quote rows), `clock.getClock` (the as-of axis) — kept
 * live through the W018 push channels (published + clock) with a polling
 * fallback. Everything the composition point (`../surfaces.ts`), the
 * cockpit shell and the tests need from W008 lives under
 * `packages/ui/src/trading-world/market/`.
 *
 * REGISTRY INTEGRATION (W006 seam): the shell hosts tools through the tool
 * registry; the watchlist placeholder is swapped with the immutable
 * `withSurfaceOverride` seam. Because `../surfaces.ts` (the composition
 * point) is W006's file and outside W008's frozen write surface, the swap
 * is exported HERE as {@link withWatchlistToolSurface} — one call from the
 * composition point (or any registry consumer, e.g. a test harness):
 *
 * ```ts
 * import { withWatchlistToolSurface } from "./market/index.js";
 * const registry = withWatchlistToolSurface(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the
 * W008 PR (the W007 precedent).
 */

import type { ComponentType } from "react";

import type {
  TradingWorldToolRegistry,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { WatchlistToolSurface } from "./WatchlistToolSurface.js";

export {
  WatchlistToolSurface,
  createWatchlistToolSurface,
  DEFAULT_WATCHLIST_INSTRUMENT_IDS,
  DEFAULT_WATCHLIST_POLL_MS,
} from "./WatchlistToolSurface.js";
export type { WatchlistToolSurfaceConfig } from "./WatchlistToolSurface.js";

export {
  createWatchlistProjectionController,
  seamClientHasPushChannels,
} from "./watchlistProjection.js";
export type {
  WatchlistProjectionController,
  WatchlistProjectionControllerInput,
  WatchlistProjectionSnapshot,
  WatchlistWorldMeta,
} from "./watchlistProjection.js";

export {
  buildWatchlistRows,
  discoverInstrumentIds,
  formatSimulationTimestampMs,
  MarketProjectionDataError,
  nextScheduledRegimeChange,
  parseRegimeAnnouncements,
  REGIME_CHANGED_EVENT_TYPE,
  regimeInForceFor,
  scheduledRegimeAt,
  describeSimulationClock,
  WATCHLIST_TIMELINE_EVENT_TYPES,
  worldRegimeInForce,
} from "./marketData.js";
export type {
  MarketInstrumentId,
  MarketInstrumentProjection,
  MarketQuoteProjection,
  MarketRegimeAnnouncement,
  MarketRegimeInForce,
  MarketRegimeScheduleEntry,
  MarketTimelineEvent,
  WatchlistRow,
  WatchlistRowFetch,
} from "./marketData.js";

export { WatchlistSurfaceStatusBody } from "./WatchlistSurfaceStates.js";

/** The registered tool id this package owns (W006 registry slot). */
export const WATCHLIST_TOOL_ID = "watchlist";

/**
 * Swap the registry's watchlist placeholder for the real W008 surface — the
 * immutable `withSurfaceOverride` seam, applied from THIS module (W008 owns
 * the call; no registry file is edited). Unknown ids already throw inside
 * the registry (loud, never silent).
 */
export function withWatchlistToolSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = WatchlistToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(WATCHLIST_TOOL_ID, surface);
}
