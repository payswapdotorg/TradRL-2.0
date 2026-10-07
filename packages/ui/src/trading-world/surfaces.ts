/**
 * Trading World surface composition point — W006.
 *
 * THE single place where W007–W012 tool surfaces are registered over the
 * built-in placeholders. Each owning work order lands its surface package
 * (e.g. `./charts/`) and swaps its placeholder with ONE call here:
 *
 * ```ts
 * import { ChartToolSurface } from "./charts/index.js";
 *
 * export const tradingWorldSurfaceRegistry = createTradingWorldCoreToolRegistry()
 *   .withSurfaceOverride("chart", ChartToolSurface);
 * ```
 *
 * Until then this is the core registry with every W007–W012 tool registered
 * as a clearly-labeled placeholder (`registry/toolRegistry.ts`). The shell
 * (`components/TradingWorldShell.tsx`) consumes exactly this registry by
 * default, so surface swaps need no shell edits.
 */

import { createTradingWorldCoreToolRegistry } from "./registry/toolRegistry.js";
import { withChartToolSurface, ChartToolSurface } from "./charts/index.js";

/** TL wiring (W007 merge): the chart placeholder is now the real surface. */
export const tradingWorldSurfaceRegistry = withChartToolSurface(
  createTradingWorldCoreToolRegistry(),
  ChartToolSurface,
);
