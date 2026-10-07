/**
 * Trading World cockpit shell tests (W006).
 *
 * Renders the REAL W005 pane (packages/ui/src/app-shell/TradingWorldSidePane)
 * with the W006 shell mounted inside it and verifies the mount integration:
 * lifecycle contract preserved (pane chrome, persistent disclosure, hosting
 * phases), the default cockpit projection (registry-driven placeholders in
 * the UX-DESIGN grid), layout-state projection (open/closed tools through
 * the shared layout store) and the W007+ surface-override path.
 *
 * Static renders (renderToStaticMarkup) project the store's SERVER snapshot
 * (= the store's fallback base); interactive open/close + persistence are
 * covered by the browser E2E harness (see the W006 PR evidence).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldShell.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  TRADING_WORLD_PANE_TITLE,
  TRADING_WORLD_SIMULATION_DISCLOSURE,
  TradingWorldSidePane,
} from "../src/app-shell/TradingWorldSidePane.js";
import {
  closeToolInCockpit,
  openToolInCockpit,
} from "../src/trading-world/layout/cockpitLayout.js";
import {
  clearSharedCockpitLayoutStores,
  cockpitLayoutStorageKey,
  getSharedCockpitLayoutStore,
} from "../src/trading-world/layout/cockpitLayoutPersistence.js";
import { createDefaultTradingWorldCockpitLayout } from "../src/trading-world/layout/layoutProfiles.js";
import {
  createTradingWorldCoreToolRegistry,
  type TradingWorldToolSurfaceProps,
} from "../src/trading-world/registry/toolRegistry.js";
import { TradingWorldShell } from "../src/trading-world/components/TradingWorldShell.js";
import {
  openTradingWorldSidePane,
  type TradingWorldSidePaneTab,
} from "../src/lib/workspaceSidePane.js";

function buildTab(workspaceKey: string): TradingWorldSidePaneTab {
  const state = openTradingWorldSidePane(null, {
    workspaceKey,
    worldId: "alpha",
    layoutProfileId: "default",
  });
  return state.tabs[0] as TradingWorldSidePaneTab;
}

function renderPane(tab: TradingWorldSidePaneTab, visible: boolean, focused: boolean): string {
  return ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldSidePane, {
      tab,
      visible,
      focused,
      onClose: () => {},
    }),
  );
}

/** Fresh shared store for a unique scope whose base is `base`. */
function primeSharedStore(
  workspaceKey: string,
  base = createDefaultTradingWorldCockpitLayout(),
) {
  clearSharedCockpitLayoutStores();
  return getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey(workspaceKey, "default"),
    base,
  );
}

test("the pane hosts the cockpit shell with the W005 lifecycle chrome intact", () => {
  primeSharedStore("/ws/shell-chrome");
  const tab = buildTab("/ws/shell-chrome");
  const markup = renderPane(tab, true, true);
  // W005 pane contract (regression guard for the placeholder → shell swap).
  assert.ok(markup.includes(TRADING_WORLD_PANE_TITLE));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATION_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  assert.ok(markup.includes('data-trading-world-focused="true"'));
  assert.ok(markup.includes('data-trading-world-visible="true"'));
  assert.ok(markup.includes('aria-label="Close Trading World"'));
  assert.ok(markup.includes("alpha"), "opaque world id surfaced (W005 test law)");
  // W006 cockpit chrome.
  assert.ok(markup.includes('data-trading-world-cockpit=""'));
  assert.ok(markup.includes('data-trading-world-profile="default"'));
  assert.ok(markup.includes('data-trading-world-id=""'));
  assert.ok(markup.includes('data-trading-world-tools-menu=""'));
  assert.ok(markup.includes('data-trading-world-clock-toggle=""'));
  assert.ok(markup.includes('data-trading-world-reset-layout=""'));
  assert.ok(markup.includes('data-trading-world-runtime-status="unattached"'));
  assert.ok(markup.includes("Trader Cockpit"), "profile label rendered");
});

test("the default cockpit renders every registered tool as a labeled placeholder in its dock", () => {
  primeSharedStore("/ws/shell-default");
  const tab = buildTab("/ws/shell-default");
  const markup = renderPane(tab, true, true);
  // Every core tool surface mounts (tab strip + surface container).
  for (const toolId of [
    "watchlist",
    "chart",
    "order-book",
    "time-and-sales",
    "order-ticket",
    "working-orders",
    "fills",
    "positions",
    "portfolio",
    "risk",
    "simulation-clock",
  ]) {
    assert.ok(
      markup.includes(`data-trading-world-tool-surface="${toolId}"`),
      `${toolId} surface mounted`,
    );
    assert.ok(
      markup.includes(`data-trading-world-tool-tab="${toolId}"`) ||
        toolId === "simulation-clock",
      `${toolId} tab button rendered`,
    );
  }
  // The UX-DESIGN grid: three columns, docks, and the clock strip.
  for (const columnId of ["market-rail", "focus", "execution"]) {
    assert.ok(markup.includes(`id="${columnId}"`), `${columnId} column panel rendered`);
  }
  for (const panelId of [
    "market",
    "research",
    "chart",
    "tape",
    "book",
    "ticket",
    "bookkeeping",
    "accounts",
  ]) {
    assert.ok(
      markup.includes(`data-trading-world-panel="${panelId}"`),
      `${panelId} dock rendered`,
    );
  }
  assert.ok(markup.includes('data-trading-world-clock-strip=""'));
  assert.ok(
    markup.includes('data-trading-world-panel-empty="true"'),
    "reserved research dock is visibly empty, not fabricated",
  );
  // Only ONE tool is active per tabbed dock (default active tabs).
  assert.ok(markup.includes('data-trading-world-tool-tab="positions" data-active="true"'));
  assert.ok(markup.includes('data-trading-world-tool-tab="working-orders" data-active="false"'));
});

test("mounted-hidden phase keeps every surface and the disclosure alive (collapse ≠ destroy)", () => {
  primeSharedStore("/ws/shell-hidden");
  const tab = buildTab("/ws/shell-hidden");
  const markup = renderPane(tab, false, false);
  assert.ok(markup.includes(TRADING_WORLD_SIMULATION_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-visible="false"'));
  assert.ok(markup.includes('data-trading-world-focused="false"'));
  assert.ok(markup.includes('data-trading-world-tool-surface="chart"'));
  assert.ok(
    markup.includes('data-trading-world-surface-phase="mounted-hidden"'),
    "background surfaces declare their phase",
  );
});

test("the shell projects the layout store state: closed tools unmount, reopened tools re-dock", () => {
  const base = createDefaultTradingWorldCockpitLayout();
  const registry = createTradingWorldCoreToolRegistry();
  const withChartClosed = closeToolInCockpit(base, "chart");
  const withClockClosed = closeToolInCockpit(withChartClosed, "simulation-clock");
  primeSharedStore("/ws/shell-closed", withClockClosed);

  const tab = buildTab("/ws/shell-closed");
  const markup = renderPane(tab, true, true);
  assert.ok(!markup.includes('data-trading-world-tool-surface="chart"'), "closed tool unmounted");
  assert.ok(!markup.includes('data-trading-world-clock-strip=""'), "clock strip hidden when closed");
  assert.ok(markup.includes('aria-label="Show simulation clock strip"'));
  assert.ok(markup.includes('data-trading-world-tool-surface="watchlist"'), "open tools stay");

  // Re-opening through the SAME shared store flips the projection back
  // (the shell subscribes to the store; verified interactively in E2E).
  const store = getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/shell-closed", "default"),
    withClockClosed,
  );
  store.setState(openToolInCockpit(store.getState(), "chart", registry));
  assert.ok(store.getState().columns[1]!.panels[0]!.tools.includes("chart"));
});

test("the W007+ override path renders the real surface instead of the placeholder", () => {
  primeSharedStore("/ws/shell-override");
  const tab = buildTab("/ws/shell-override");
  function RealChartSurface(props: TradingWorldToolSurfaceProps) {
    return createElement(
      "div",
      { "data-real-chart-surface": props.toolId, "data-phase": props.phase },
      "candles volume markers",
    );
  }
  const registry = createTradingWorldCoreToolRegistry().withSurfaceOverride(
    "chart",
    RealChartSurface,
  );
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  assert.ok(markup.includes('data-real-chart-surface="chart"'));
  assert.ok(markup.includes('data-phase="mounted-focused"'));
  assert.ok(!markup.includes("Chart surface placeholder"), "placeholder body replaced");
  // Other tools keep their placeholders.
  assert.ok(markup.includes("Watchlist surface placeholder"));
});
