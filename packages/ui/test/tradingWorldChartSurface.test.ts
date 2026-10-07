/**
 * Chart tool surface tests (W007).
 *
 * Guards the W007 registry integration and the surface's honest static
 * states: the chart slot is swapped through `withChartToolSurface` (the
 * W006 `withSurfaceOverride` seam applied from the charts module — no
 * registry file edits), the surface renders the persistent SIMULATED
 * disclosure in every state, and against BOTH world-client modes it never
 * fabricates data (ARCHITECTURE-LOCK A6):
 * - unattached runtime (today's fail-closed noop): the teaching state;
 * - attached runtime: the initial "loading" projection (effects pending).
 *
 * Static renders (renderToStaticMarkup) cover the synchronous states; the
 * effectful paths — live fetch + candle rendering + crosshair + the typed
 * chart-library-unavailable fallback + 0 console errors — are driven in a
 * real browser by the compensating E2E harness (see the W007 PR evidence).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldChartSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  ChartToolSurface,
  createChartToolSurface,
  DEFAULT_CHART_INSTRUMENT_ID,
} from "../src/trading-world/charts/ChartToolSurface.js";
import {
  CHART_TOOL_ID,
  withChartToolSurface,
} from "../src/trading-world/charts/index.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
  type TradingWorldClient,
} from "../src/trading-world/runtime/worldClient.js";
import {
  createTradingWorldCoreToolRegistry,
  type TradingWorldToolSurfaceProps,
} from "../src/trading-world/registry/toolRegistry.js";
import { TradingWorldShell } from "../src/trading-world/components/TradingWorldShell.js";
import {
  clearSharedCockpitLayoutStores,
  cockpitLayoutStorageKey,
  getSharedCockpitLayoutStore,
} from "../src/trading-world/layout/cockpitLayoutPersistence.js";
import { createDefaultTradingWorldCockpitLayout } from "../src/trading-world/layout/layoutProfiles.js";
import {
  openTradingWorldSidePane,
  type TradingWorldSidePaneTab,
} from "../src/lib/workspaceSidePane.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../src/trading-world/components/PlaceholderToolSurface.js";

const surfaceProps: TradingWorldToolSurfaceProps = {
  toolId: "chart",
  worldId: "world-alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof ChartToolSurface,
  props: TradingWorldToolSurfaceProps = surfaceProps,
  client?: TradingWorldClient,
): string {
  const element = client
    ? createElement(
        TradingWorldClientContext.Provider,
        { value: client },
        createElement(surface, props),
      )
    : createElement(surface, props);
  return ReactDOMServer.renderToStaticMarkup(element);
}

function buildTab(workspaceKey: string): TradingWorldSidePaneTab {
  const state = openTradingWorldSidePane(null, {
    workspaceKey,
    worldId: "world-alpha",
    layoutProfileId: "default",
  });
  return state.tabs[0] as TradingWorldSidePaneTab;
}

test("the chart tool id matches the W006 registry slot", () => {
  assert.equal(CHART_TOOL_ID, "chart");
});

test("withChartToolSurface swaps the placeholder immutably from the charts module", () => {
  const base = createTradingWorldCoreToolRegistry();
  const withChart = withChartToolSurface(base);
  // Immutable swap: the original registry is untouched.
  assert.equal(base.getTool("chart")!.status, "placeholder");
  assert.notEqual(base.getTool("chart")!.surface, ChartToolSurface);
  // The new registry carries the real surface.
  const swapped = withChart.getTool(CHART_TOOL_ID)!;
  assert.equal(swapped.status, "implemented");
  assert.equal(swapped.surface, ChartToolSurface);
  assert.equal(swapped.id, "chart");
  assert.equal(swapped.ownerWorkOrder, "W007");
  assert.equal(swapped.kind, "charts");
  assert.equal(swapped.defaultPanel, "chart");
  // Everything else is still the placeholder set (one WO, one tool).
  assert.equal(withChart.getTool("watchlist")!.status, "placeholder");
  assert.equal(withChart.getTool("simulation-clock")!.status, "placeholder");
  assert.equal(withChart.listTools().length, 11);
  // A custom surface can be bound instead (composition flexibility).
  function CustomChart(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-chart": "" });
  }
  const withCustom = withChartToolSurface(base, CustomChart);
  assert.equal(withCustom.getTool("chart")!.surface, CustomChart);
});

test("the surface renders the honest unattached teaching state (fail-closed noop client)", () => {
  const markup = renderSurface(ChartToolSurface);
  assert.ok(markup.includes('data-trading-world-tool-surface="chart"'));
  assert.ok(markup.includes('data-trading-world-chart-surface=""'));
  assert.ok(markup.includes('data-trading-world-chart-data-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-chart-renderer-status="loading"'));
  assert.ok(markup.includes(`data-trading-world-chart-instrument="${DEFAULT_CHART_INSTRUMENT_ID}"`));
  assert.ok(markup.includes('data-trading-world-chart-state="unattached"'));
  assert.ok(markup.includes("No world runtime attached"));
  assert.ok(markup.includes("W013"));
  assert.ok(markup.includes("W018"));
  // Persistent SIMULATED disclosure (ACCEPTANCE K: text, not color alone).
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  // No fabricated market facts anywhere.
  assert.ok(!markup.includes('data-trading-world-chart-legend'), "no legend without data");
  assert.ok(!markup.includes("data-trading-world-chart-quote"));
});

test("the surface renders the initial loading state against an attached client (no SSR data)", () => {
  const readyClient: TradingWorldClient = {
    ...createSimulatedNoopWorldClient("world-alpha"),
    status: "ready",
  };
  const markup = renderSurface(ChartToolSurface, surfaceProps, readyClient);
  assert.ok(markup.includes('data-trading-world-chart-data-status="loading"'));
  assert.ok(!markup.includes('data-trading-world-chart-legend'), "no data before effects run");
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE), "disclosure in every state");
});

test("createChartToolSurface binds the configured instrument id", () => {
  const surface = createChartToolSurface({
    instrumentId: "instrument-es-fut",
    candleBucketMs: 300_000,
    pollMs: 0,
  });
  const markup = renderSurface(surface);
  assert.ok(markup.includes('data-trading-world-chart-instrument="instrument-es-fut"'));
  // Defaults flow through the factory for the standard composition.
  assert.equal(DEFAULT_CHART_INSTRUMENT_ID, "instrument-alpha");
});

test("mounted-hidden phase keeps the chart surface alive (J-WORLD-02)", () => {
  const markup = renderSurface(ChartToolSurface, {
    ...surfaceProps,
    active: false,
    phase: "mounted-hidden",
  });
  assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("the cockpit shell mounts the real chart surface in the Main Chart slot via the seam", () => {
  clearSharedCockpitLayoutStores();
  const tab = buildTab("/ws/w007-chart");
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w007-chart", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  const registry = withChartToolSurface(createTradingWorldCoreToolRegistry());
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  // The real W007 surface is mounted in the chart dock…
  assert.ok(markup.includes('data-trading-world-chart-surface=""'));
  assert.ok(markup.includes('data-trading-world-chart-data-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-chart-state="unattached"'));
  // …the placeholder body is gone…
  assert.ok(!markup.includes("Chart surface placeholder"));
  // …while every other tool keeps its placeholder.
  assert.ok(markup.includes("Watchlist surface placeholder"));
  assert.ok(markup.includes("Order Book / DOM surface placeholder"));
  assert.ok(markup.includes("Simulation Clock surface placeholder"));
});

test("the shell's default registry (W006 composition point) mounts the real chart surface", () => {
  clearSharedCockpitLayoutStores();
  const tab = buildTab("/ws/w007-default");
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w007-default", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  // TL wiring (W007 merge follow-up): surfaces.ts now applies
  // withChartToolSurface — the Main Chart slot renders the real surface,
  // not the placeholder.
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
    }),
  );
  assert.ok(markup.includes('data-trading-world-chart-surface=""'));
  assert.ok(!markup.includes("Chart surface placeholder"));
});
