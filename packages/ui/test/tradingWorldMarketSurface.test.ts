/**
 * Watchlist tool surface tests (W008).
 *
 * Guards the W008 registry integration and the surface's honest static
 * states (the W007 chart-surface test pattern): the watchlist slot is
 * swapped through `withWatchlistToolSurface` (the W006 `withSurfaceOverride`
 * seam applied from the market module — no registry file edits), the
 * surface renders the persistent SIMULATED disclosure in every state, and
 * against BOTH world-client modes it never fabricates data
 * (ARCHITECTURE-LOCK A6):
 * - unattached runtime (the fail-closed noop): the teaching state;
 * - attached runtime: the initial "loading" projection (effects pending).
 *
 * Static renders (renderToStaticMarkup) cover the synchronous states; the
 * effectful paths — the live fetch through the W018 push channels, quote
 * rows from real generated liquidity, regime context, per-row typed errors
 * and 0 console errors — are covered in plain Node by
 * tradingWorldMarketProjection.test.ts (the controller drives them against
 * the REAL engine) and by the W008 browser E2E evidence (see the PR).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldMarketSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  WatchlistToolSurface,
  createWatchlistToolSurface,
  DEFAULT_WATCHLIST_INSTRUMENT_IDS,
} from "../src/trading-world/market/WatchlistToolSurface.js";
import {
  WATCHLIST_TOOL_ID,
  withWatchlistToolSurface,
} from "../src/trading-world/market/index.js";
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
  toolId: "watchlist",
  worldId: "alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof WatchlistToolSurface,
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
    worldId: "alpha",
    layoutProfileId: "default",
  });
  return state.tabs[0] as TradingWorldSidePaneTab;
}

test("the watchlist tool id matches the W006 registry slot", () => {
  assert.equal(WATCHLIST_TOOL_ID, "watchlist");
  assert.deepEqual(DEFAULT_WATCHLIST_INSTRUMENT_IDS, ["instrument-es-alpha"]);
});

test("withWatchlistToolSurface swaps the placeholder immutably from the market module", () => {
  const base = createTradingWorldCoreToolRegistry();
  const withWatchlist = withWatchlistToolSurface(base);
  // Immutable swap: the original registry is untouched.
  assert.equal(base.getTool("watchlist")!.status, "placeholder");
  assert.notEqual(base.getTool("watchlist")!.surface, WatchlistToolSurface);
  // The new registry carries the real surface.
  const swapped = withWatchlist.getTool(WATCHLIST_TOOL_ID)!;
  assert.equal(swapped.status, "implemented");
  assert.equal(swapped.surface, WatchlistToolSurface);
  assert.equal(swapped.id, "watchlist");
  assert.equal(swapped.ownerWorkOrder, "W008");
  assert.equal(swapped.kind, "market");
  assert.equal(swapped.defaultPanel, "market");
  assert.equal(swapped.consumes, base.getTool("watchlist")!.consumes);
  // Everything else is still the placeholder set (one WO, one tool).
  assert.equal(withWatchlist.getTool("chart")!.status, "placeholder");
  assert.equal(withWatchlist.getTool("simulation-clock")!.status, "placeholder");
  assert.equal(withWatchlist.listTools().length, 11);
  // A custom surface can be bound instead (composition flexibility).
  function CustomWatchlist(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-watchlist": "" });
  }
  const withCustom = withWatchlistToolSurface(base, CustomWatchlist);
  assert.equal(withCustom.getTool("watchlist")!.surface, CustomWatchlist);
});

test("the surface renders the honest unattached teaching state (fail-closed noop client)", () => {
  const markup = renderSurface(WatchlistToolSurface);
  assert.ok(markup.includes('data-trading-world-tool-surface="watchlist"'));
  assert.ok(markup.includes('data-trading-world-watchlist-surface=""'));
  assert.ok(markup.includes('data-trading-world-watchlist-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-watchlist-rows="0"'));
  assert.ok(markup.includes('data-trading-world-watchlist-live="none"'));
  assert.ok(markup.includes('data-trading-world-watchlist-state="unattached"'));
  assert.ok(markup.includes("No world runtime attached"));
  assert.ok(markup.includes("never sample or placeholder prices"));
  // Persistent SIMULATED disclosure (ACCEPTANCE K: text, not color alone).
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  // No fabricated market facts anywhere.
  assert.ok(!markup.includes('data-trading-world-watchlist-row='), "no rows without data");
  assert.ok(!markup.includes('data-trading-world-watchlist-quote'), "no quote cells");
  assert.ok(!markup.includes('data-trading-world-watchlist-regime=""'));
});

test("the surface renders the initial loading state against an attached client (no SSR data)", () => {
  const readyClient: TradingWorldClient = {
    ...createSimulatedNoopWorldClient("alpha"),
    status: "ready",
  };
  const markup = renderSurface(WatchlistToolSurface, surfaceProps, readyClient);
  assert.ok(markup.includes('data-trading-world-watchlist-status="loading"'));
  assert.ok(markup.includes('data-trading-world-watchlist-live="poll"'));
  assert.ok(!markup.includes('data-trading-world-watchlist-row='), "no data before effects run");
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE), "disclosure in every state");
});

test("createWatchlistToolSurface binds the configured instruments and cadence", () => {
  const surface = createWatchlistToolSurface({
    instrumentIds: ["instrument-es-fut", "instrument-nq-fut"],
    pollMs: 0,
    discoveryEnabled: false,
  });
  const markup = renderSurface(surface);
  assert.ok(markup.includes('data-trading-world-watchlist-discovery="false"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  // The default surface projects the REAL World Alpha instrument.
  assert.deepEqual(DEFAULT_WATCHLIST_INSTRUMENT_IDS, ["instrument-es-alpha"]);
});

test("mounted-hidden phase keeps the watchlist surface alive (J-WORLD-02)", () => {
  const markup = renderSurface(WatchlistToolSurface, {
    ...surfaceProps,
    active: false,
    phase: "mounted-hidden",
  });
  assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("the cockpit shell mounts the real watchlist surface in the market panel via the seam", () => {
  clearSharedCockpitLayoutStores();
  const tab = buildTab("/ws/w008-market");
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w008-market", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  const registry = withWatchlistToolSurface(createTradingWorldCoreToolRegistry());
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  // The real W008 surface is mounted in the market (watchlist) dock…
  assert.ok(markup.includes('data-trading-world-watchlist-surface=""'));
  assert.ok(markup.includes('data-trading-world-watchlist-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-watchlist-state="unattached"'));
  // …the placeholder body is gone…
  assert.ok(!markup.includes("Watchlist surface placeholder"));
  // …while every other tool keeps its placeholder (one WO, one tool).
  assert.ok(markup.includes("Chart surface placeholder"));
  assert.ok(markup.includes("Order Book / DOM surface placeholder"));
  assert.ok(markup.includes("Simulation Clock surface placeholder"));
});
