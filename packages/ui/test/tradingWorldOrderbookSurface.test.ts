/**
 * DOM ladder tool surface tests (W009) — registry integration + honest
 * static states.
 *
 * Guards the order-book half of `src/trading-world/orderbook/`: the W006
 * registry slot is swapped through `withOrderBookToolSurface` (the immutable
 * `withSurfaceOverride` seam applied from the orderbook module — no registry
 * file edits), the surface renders the persistent SIMULATED disclosure in
 * every state, and against BOTH world-client modes it never fabricates data
 * (ARCHITECTURE-LOCK A6): the unattached runtime (fail-closed noop) renders
 * the teaching state; an attached runtime renders the initial `loading`
 * projection (effects pending — no SSR data). The error body's honest Retry
 * copy is asserted through the shared status body.
 *
 * Static renders (renderToStaticMarkup) cover the synchronous states; the
 * effectful paths — live fetch + engine-channel updates + ladder rows as the
 * clock advances — are driven by the real-engine suite
 * (tradingWorldOrderbookLiveProjection.test.ts) and the compensating browser
 * E2E harness (see the W009 PR evidence).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldOrderbookSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  createOrderBookToolSurface,
  OrderBookToolSurface,
} from "../src/trading-world/orderbook/OrderBookToolSurface.js";
import {
  ORDER_BOOK_TOOL_ID,
  withOrderBookToolSurface,
  withOrderBookToolSurfaces,
} from "../src/trading-world/orderbook/index.js";
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
  OrderBookSurfaceStatusBody,
} from "../src/trading-world/orderbook/OrderBookSurfaceStates.js";
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
  toolId: "order-book",
  worldId: "world-alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof OrderBookToolSurface,
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

test("the order-book tool id matches the W006 registry slot", () => {
  assert.equal(ORDER_BOOK_TOOL_ID, "order-book");
});

test("withOrderBookToolSurface swaps the placeholder immutably from the orderbook module", () => {
  const base = createTradingWorldCoreToolRegistry();
  const withLadder = withOrderBookToolSurface(base);
  // Immutable swap: the original registry is untouched.
  assert.equal(base.getTool("order-book")!.status, "placeholder");
  assert.notEqual(base.getTool("order-book")!.surface, OrderBookToolSurface);
  // The new registry carries the real surface with the W006 slot contract.
  const swapped = withLadder.getTool(ORDER_BOOK_TOOL_ID)!;
  assert.equal(swapped.status, "implemented");
  assert.equal(swapped.surface, OrderBookToolSurface);
  assert.equal(swapped.id, "order-book");
  assert.equal(swapped.ownerWorkOrder, "W009");
  assert.equal(swapped.kind, "orderbook");
  assert.equal(swapped.defaultPanel, "book");
  // Everything else is still the placeholder set (one WO, its own tools).
  assert.equal(withLadder.getTool("watchlist")!.status, "placeholder");
  assert.equal(withLadder.getTool("time-and-sales")!.status, "placeholder");
  assert.equal(withLadder.getTool("chart")!.status, "placeholder");
  assert.equal(withLadder.listTools().length, 11);
  // A custom surface can be bound instead (composition flexibility).
  function CustomLadder(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-ladder": "" });
  }
  const withCustom = withOrderBookToolSurface(base, CustomLadder);
  assert.equal(withCustom.getTool("order-book")!.surface, CustomLadder);
});

test("withOrderBookToolSurfaces swaps BOTH W009 slots in one call", () => {
  const registry = withOrderBookToolSurfaces(createTradingWorldCoreToolRegistry());
  assert.equal(registry.getTool("order-book")!.status, "implemented");
  assert.equal(registry.getTool("time-and-sales")!.status, "implemented");
  assert.equal(registry.getTool("watchlist")!.status, "placeholder");
});

test("the surface renders the honest unattached teaching state (fail-closed noop client)", () => {
  const markup = renderSurface(OrderBookToolSurface);
  assert.ok(markup.includes('data-trading-world-tool-surface="order-book"'));
  assert.ok(markup.includes('data-trading-world-dom-surface=""'));
  assert.ok(markup.includes('data-trading-world-dom-data-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-dom-instrument="instrument-es-world-alpha"'));
  assert.ok(markup.includes('data-trading-world-dom-state="unattached"'));
  assert.ok(markup.includes("No world runtime attached"));
  assert.ok(markup.includes("W013"));
  assert.ok(markup.includes("W018"));
  // Persistent SIMULATED disclosure (ACCEPTANCE K: text, not color alone).
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  // No fabricated ladder facts anywhere.
  assert.ok(!markup.includes('data-trading-world-dom-row'), "no ladder rows without data");
  assert.ok(!markup.includes('data-trading-world-dom-spread='));
});

test("the surface renders the initial loading state against an attached client (no SSR data)", () => {
  const readyClient: TradingWorldClient = {
    ...createSimulatedNoopWorldClient("world-alpha"),
    status: "ready",
  };
  const markup = renderSurface(OrderBookToolSurface, surfaceProps, readyClient);
  assert.ok(markup.includes('data-trading-world-dom-data-status="loading"'));
  assert.ok(!markup.includes('data-trading-world-dom-row'), "no ladder rows before effects run");
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE), "disclosure in every state");
});

test("createOrderBookToolSurface binds the configured instrument id", () => {
  const surface = createOrderBookToolSurface({
    instrumentId: "instrument-nq-fut",
    depth: 5,
    pollMs: 0,
  });
  const markup = renderSurface(surface);
  assert.ok(markup.includes('data-trading-world-dom-instrument="instrument-nq-fut"'));
});

test("mounted-hidden phase keeps the ladder surface alive (J-WORLD-02)", () => {
  const markup = renderSurface(OrderBookToolSurface, {
    ...surfaceProps,
    active: false,
    phase: "mounted-hidden",
  });
  assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("the error status body is honest: typed remote name + Retry, never a substitution", () => {
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(OrderBookSurfaceStatusBody, {
      state: {
        status: "error",
        message: "unknown instrument: instrument-nope",
        remoteName: "UnknownWorldEntityError",
      },
      stateAttr: "data-trading-world-dom-state",
      emptyTitle: "unused",
      emptyBody: "unused",
      onRetry: () => {},
    }),
  );
  assert.ok(markup.includes('data-trading-world-dom-state="error"'));
  assert.ok(markup.includes("UnknownWorldEntityError"));
  assert.ok(markup.includes("Market data unavailable"));
  assert.ok(markup.includes("never substitutes, estimates or caches"));
  assert.ok(markup.includes("Retry"));
});

test("the cockpit shell mounts the real ladder surface in the Order Book dock via the seam", () => {
  clearSharedCockpitLayoutStores();
  const tab = buildTab("/ws/w009-ladder");
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w009-ladder", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  const registry = withOrderBookToolSurfaces(createTradingWorldCoreToolRegistry());
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  // The real W009 surfaces are mounted in their docks (default profile docks
  // order-book in `book` and time-and-sales in `tape`)…
  assert.ok(markup.includes('data-trading-world-panel="book"'));
  assert.ok(markup.includes('data-trading-world-panel="tape"'));
  assert.ok(markup.includes('data-trading-world-dom-surface=""'));
  assert.ok(markup.includes('data-trading-world-tape-surface=""'));
  assert.ok(markup.includes('data-trading-world-dom-data-status="unattached"'));
  // …both W009 placeholder bodies are gone…
  assert.ok(!markup.includes("Order Book / DOM surface placeholder"));
  assert.ok(!markup.includes("Time &amp; Sales surface placeholder"));
  // …while every other tool keeps its placeholder (one WO, its own tools).
  assert.ok(markup.includes("Watchlist surface placeholder"));
  assert.ok(markup.includes("Simulation Clock surface placeholder"));
});

test("the shell's default registry (W006 composition point) still ships the W009 placeholders (TL action item)", () => {
  clearSharedCockpitLayoutStores();
  const tab = buildTab("/ws/w009-default");
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w009-default", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  // surfaces.ts is W006's frozen file: the W009 swap is a TL action item in
  // the PR (the W007 precedent). Until the TL wires it, the default registry
  // still shows the placeholders — asserted here so the swap is auditable.
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
    }),
  );
  assert.ok(markup.includes("Order Book / DOM surface placeholder"));
  assert.ok(markup.includes("Time &amp; Sales surface placeholder"));
  assert.ok(!markup.includes('data-trading-world-dom-surface=""'));
});
