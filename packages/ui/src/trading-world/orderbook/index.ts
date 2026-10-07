/**
 * Trading World order-book surface package — W009 public entrypoint.
 *
 * The DOM ladder + Time & Sales of the trader cockpit (UX-DESIGN "Default
 * trader cockpit"): the execution rail's "Order Book / DOM" cell and the
 * focus column's "Time & Sales" cell, both projected from REAL engine
 * projections (`query.getOrderBook` / `query.getTrades`) through the W006
 * world-client seam — the W018 engine client behind it fills the books and
 * prints the tape as the world's clock advances. Everything the composition
 * point (`../surfaces.ts`), the cockpit shell and the tests need from W009
 * lives under `packages/ui/src/trading-world/orderbook/`.
 *
 * REGISTRY INTEGRATION (W006 seam): the shell hosts tools through the tool
 * registry; W009's two placeholders are swapped with the immutable
 * `withSurfaceOverride` seam. Because `../surfaces.ts` (the composition
 * point) is W006's file and outside W009's frozen write surface, the swap is
 * exported HERE as {@link withOrderBookToolSurfaces} — one call from the
 * composition point (or any registry consumer, e.g. a test harness):
 *
 * ```ts
 * import { withOrderBookToolSurfaces } from "./orderbook/index.js";
 * const registry = withOrderBookToolSurfaces(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the W009
 * PR (the W007 precedent).
 */

import type { ComponentType } from "react";

import type {
  TradingWorldToolRegistry,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { OrderBookToolSurface } from "./OrderBookToolSurface.js";
import { TimeAndSalesToolSurface } from "./TimeAndSalesToolSurface.js";

export {
  OrderBookToolSurface,
  createOrderBookToolSurface,
  DEFAULT_DOM_LADDER_DEPTH,
  DEFAULT_DOM_LADDER_MAX_LEVELS,
  DEFAULT_DOM_LADDER_POLL_MS,
} from "./OrderBookToolSurface.js";
export type { OrderBookToolSurfaceConfig } from "./OrderBookToolSurface.js";

export {
  TimeAndSalesToolSurface,
  createTimeAndSalesToolSurface,
  DEFAULT_TAPE_MAX_ROWS,
  DEFAULT_TAPE_POLL_MS,
} from "./TimeAndSalesToolSurface.js";
export type { TimeAndSalesToolSurfaceConfig } from "./TimeAndSalesToolSurface.js";

export {
  addDecimalText,
  compareDecimalParts,
  decimalPlacesOf,
  formatDecimalParts,
  halveDecimalText,
  OrderBookProjectionDataError,
  parseDecimalText,
  subtractDecimalText,
} from "./decimalText.js";
export type { DecimalParts } from "./decimalText.js";

export {
  alphaInstrumentIdForWorld,
  buildDomLadderProjection,
  windowDomLadderSide,
} from "./bookData.js";
export type {
  BookLevelProjection,
  DomLadderProjection,
  DomLadderRow,
  DomLadderSide,
  OrderBookInstrumentId,
  OrderBookSnapshotProjection,
} from "./bookData.js";

export {
  buildTimeAndSalesProjection,
  describeAggressorSide,
  formatTapeTimestampMs,
} from "./tapeData.js";
export type {
  TapeBuildOptions,
  TapeProjection,
  TapeRow,
  TapeTradePrint,
} from "./tapeData.js";

export {
  subscribeEngineProjectionSignals,
  createTradingWorldProjectionFeedController,
} from "./projectionFeed.js";
export type {
  EngineProjectionSignal,
  ProjectionFeedFetchResult,
  TradingWorldProjectionFeedController,
  TradingWorldProjectionFeedState,
} from "./projectionFeed.js";

export { useTradingWorldProjectionFeed } from "./useProjectionFeed.js";
export type {
  TradingWorldProjectionFeed,
  TradingWorldProjectionFeedInput,
} from "./useProjectionFeed.js";

export {
  formatSimulationClockLabel,
  OrderBookSurfaceStatusBody,
} from "./OrderBookSurfaceStates.js";
export type {
  OrderBookSurfaceDataState,
  OrderBookSurfaceStatusBodyProps,
} from "./OrderBookSurfaceStates.js";

/** The registered tool ids this package owns (W006 registry slots). */
export const ORDER_BOOK_TOOL_ID = "order-book";
export const TIME_AND_SALES_TOOL_ID = "time-and-sales";

/**
 * Swap the registry's order-book placeholder for the real W009 ladder — the
 * immutable `withSurfaceOverride` seam, applied from THIS module (W009 owns
 * the call; no registry file is edited). Unknown ids already throw inside
 * the registry (loud, never silent).
 */
export function withOrderBookToolSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = OrderBookToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(ORDER_BOOK_TOOL_ID, surface);
}

/** Swap the registry's time-and-sales placeholder for the real W009 tape. */
export function withTimeAndSalesToolSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = TimeAndSalesToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(TIME_AND_SALES_TOOL_ID, surface);
}

/**
 * Swap BOTH W009 surfaces in one call — the composition point's single line
 * (the TL action item in the W009 PR):
 *
 * ```ts
 * export const tradingWorldSurfaceRegistry = withOrderBookToolSurfaces(
 *   withChartToolSurface(createTradingWorldCoreToolRegistry(), ChartToolSurface),
 * );
 * ```
 */
export function withOrderBookToolSurfaces(
  registry: TradingWorldToolRegistry,
): TradingWorldToolRegistry {
  return withTimeAndSalesToolSurface(withOrderBookToolSurface(registry));
}
