/**
 * Trading World surface composition point — W006.
 *
 * THE single place where W007–W012 tool surfaces are registered over the
 * built-in placeholders. Each owning work order lands its surface package
 * (e.g. `./charts/`) and swaps its placeholder with ONE call here. The shell
 * (`components/TradingWorldShell.tsx`) consumes exactly this registry by
 * default, so surface swaps need no shell edits.
 */

import { createTradingWorldCoreToolRegistry } from "./registry/toolRegistry.js";
import { withChartToolSurface, ChartToolSurface } from "./charts/index.js";
import { withWatchlistToolSurface } from "./market/index.js";
import { withOrderBookToolSurfaces } from "./orderbook/index.js";
import { withOrdersToolSurfaces } from "./orders/index.js";
import { withPortfolioToolSurfaces } from "./portfolio/index.js";
import { withSimulationClockToolSurface } from "./simulation/index.js";

/**
 * TL wiring (W007/W008/W009/W010/W011/W012 merges): the chart, watchlist,
 * order-book + time-and-sales, order-ticket/working-orders/fills,
 * portfolio/positions/risk, and simulation-clock/timeline placeholders are all
 * now the real surfaces — every W006 tool slot is live. Each swap is the
 * owning package's documented one-liner; this file is the single composition
 * point (W006 law).
 */
export const tradingWorldSurfaceRegistry = withSimulationClockToolSurface(
  withPortfolioToolSurfaces(
    withOrdersToolSurfaces(
      withOrderBookToolSurfaces(
        withWatchlistToolSurface(
          withChartToolSurface(createTradingWorldCoreToolRegistry(), ChartToolSurface),
        ),
      ),
    ),
  ),
);
