/**
 * Trading World cockpit layout tests (W006).
 *
 * Guards the world-side layout system: the default trader cockpit profile
 * (UX-DESIGN default layout), the pure per-tool open/close/activate/move
 * state machine with the singleton invariant, ratio clamping, the
 * persistence boundary (sanitize → wholesale discard on corruption) and the
 * observable store the shell binds via useSyncExternalStore.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldCockpitLayout.test.ts
 * (from packages/ui; the W005-established local convention).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  activateToolInCockpit,
  closeToolInCockpit,
  findToolPanelId,
  isToolOpen,
  listOpenToolIds,
  moveToolInCockpit,
  openToolInCockpit,
  resetCockpitLayout,
  setClockStripHeightRatio,
  setClockStripOpen,
  setColumnWidthRatio,
  setColumnWidthRatios,
  setPanelHeightRatio,
  setPanelHeightRatios,
  type TradingWorldCockpitLayout,
} from "../src/trading-world/layout/cockpitLayout.js";
import {
  clearSharedCockpitLayoutStores,
  cockpitLayoutStorageKey,
  createCockpitLayoutStore,
  createInMemoryCockpitLayoutStorage,
  getSharedCockpitLayoutStore,
  normalizeCockpitLayout,
} from "../src/trading-world/layout/cockpitLayoutPersistence.js";
import {
  createDefaultTradingWorldCockpitLayout,
  createDefaultTradingWorldLayoutProfile,
  DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
  resolveTradingWorldLayoutProfile,
} from "../src/trading-world/layout/layoutProfiles.js";
import { createTradingWorldCoreToolRegistry } from "../src/trading-world/registry/toolRegistry.js";

const registry = createTradingWorldCoreToolRegistry();

function freshLayout(): TradingWorldCockpitLayout {
  return resetCockpitLayout(createDefaultTradingWorldCockpitLayout());
}

function assertSingletonInvariant(layout: TradingWorldCockpitLayout): void {
  const ids = listOpenToolIds(layout);
  assert.equal(new Set(ids).size, ids.length, `tool singleton violated: ${ids.join(",")}`);
}

test("the default profile mirrors the UX-DESIGN default trader cockpit", () => {
  const layout = freshLayout();
  assert.deepEqual(
    layout.columns.map((columnLayout) => columnLayout.id),
    ["market-rail", "focus", "execution"],
  );
  const panelsByColumn = Object.fromEntries(
    layout.columns.map((columnLayout) => [
      columnLayout.id,
      columnLayout.panels.map((panelLayout) => panelLayout.id),
    ]),
  );
  assert.deepEqual(panelsByColumn["market-rail"], ["market", "research"]);
  assert.deepEqual(panelsByColumn["focus"], ["chart", "tape"]);
  assert.deepEqual(panelsByColumn["execution"], [
    "book",
    "ticket",
    "bookkeeping",
    "accounts",
  ]);
  // Tool placement mirrors the ASCII cockpit.
  assert.deepEqual(findPanelTools(layout, "market"), ["watchlist"]);
  assert.deepEqual(findPanelTools(layout, "research"), []);
  assert.deepEqual(findPanelTools(layout, "chart"), ["chart"]);
  assert.deepEqual(findPanelTools(layout, "tape"), ["time-and-sales"]);
  assert.deepEqual(findPanelTools(layout, "book"), ["order-book"]);
  assert.deepEqual(findPanelTools(layout, "ticket"), ["order-ticket"]);
  assert.deepEqual(findPanelTools(layout, "bookkeeping"), [
    "positions",
    "working-orders",
    "fills",
  ]);
  assert.deepEqual(findPanelTools(layout, "accounts"), ["portfolio", "risk"]);
  assert.equal(layout.clockStrip.open, true, "clock strip open by default");
  assert.ok(isToolOpen(layout, "simulation-clock"));
  // All eleven UX-DESIGN core tools are docked by default.
  assert.equal(listOpenToolIds(layout).length, 11);
});

function findPanelTools(layout: TradingWorldCockpitLayout, panelId: string): string[] {
  for (const columnLayout of layout.columns) {
    for (const panelLayout of columnLayout.panels) {
      if (panelLayout.id === panelId) {
        return [...panelLayout.tools];
      }
    }
  }
  return [];
}

test("opening a closed tool docks it into its registry default panel and activates it", () => {
  let layout = closeToolInCockpit(freshLayout(), "risk");
  assert.equal(isToolOpen(layout, "risk"), false);
  layout = openToolInCockpit(layout, "risk", registry);
  assert.equal(findToolPanelId(layout, "risk"), "accounts");
  assert.deepEqual(findPanelTools(layout, "accounts"), ["portfolio", "risk"]);
  assert.equal(
    findPanel(layout, "accounts")!.activeToolId,
    "risk",
    "newly opened tool becomes the active tab",
  );
  assertSingletonInvariant(layout);
});

test("opening an already-open tool focuses it in place instead of duplicating", () => {
  const layout = freshLayout();
  const focused = openToolInCockpit(layout, "portfolio", registry);
  assert.equal(findPanel(layout, "accounts")!.activeToolId, "portfolio");
  assert.deepEqual(findPanelTools(focused, "accounts"), ["portfolio", "risk"]);
  assertSingletonInvariant(focused);
  // Unknown tools cannot open (registry lookup fails) — no silent junk.
  const unchanged = openToolInCockpit(layout, "no-such-tool" as never, registry);
  assert.deepEqual(listOpenToolIds(unchanged), listOpenToolIds(layout));
});

test("closing a tool removes it, activates the neighbor and keeps the panel as a dock target", () => {
  let layout = freshLayout();
  assert.equal(findPanel(layout, "bookkeeping")!.activeToolId, "positions");
  layout = closeToolInCockpit(layout, "positions");
  assert.deepEqual(findPanelTools(layout, "bookkeeping"), ["working-orders", "fills"]);
  assert.equal(
    findPanel(layout, "bookkeeping")!.activeToolId,
    "working-orders",
    "neighbor tab takes over",
  );
  // Closing the active tab of a single-tool panel empties it but keeps it.
  layout = closeToolInCockpit(layout, "watchlist");
  assert.deepEqual(findPanelTools(layout, "market"), []);
  assert.equal(findPanel(layout, "market")!.activeToolId, null);
  // Closing a closed tool is a no-op.
  const again = closeToolInCockpit(layout, "watchlist");
  assert.deepEqual(listOpenToolIds(again), listOpenToolIds(layout));
});

test("the simulation clock docks in the full-width strip; open/close toggles the strip", () => {
  let layout = freshLayout();
  assert.equal(findToolPanelId(layout, "simulation-clock"), "clock-strip");
  layout = openToolInCockpit(layout, "simulation-clock", registry);
  assert.equal(layout.clockStrip.open, true, "already open → no-op");
  layout = closeToolInCockpit(layout, "simulation-clock");
  assert.equal(layout.clockStrip.open, false);
  assert.equal(findToolPanelId(layout, "simulation-clock"), undefined);
  assert.equal(isToolOpen(layout, "simulation-clock"), false);
  layout = openToolInCockpit(layout, "simulation-clock", registry);
  assert.equal(layout.clockStrip.open, true, "re-open restores the strip");
  assert.equal(setClockStripOpen(layout, false).clockStrip.open, false);
});

test("activateTool switches the active tab of the owning panel only", () => {
  let layout = freshLayout();
  layout = activateToolInCockpit(layout, "fills");
  assert.equal(findPanel(layout, "bookkeeping")!.activeToolId, "fills");
  assert.equal(findPanel(layout, "accounts")!.activeToolId, "portfolio");
  assert.equal(activateToolInCockpit(layout, "watchlist"), layout, "same tab → same state");
  const withoutRisk = closeToolInCockpit(layout, "risk");
  assert.equal(
    activateToolInCockpit(withoutRisk, "risk"),
    withoutRisk,
    "closed tool → no-op (same state object)",
  );
});

test("moveTool re-docks tools between panels and reorders within a panel (singleton kept)", () => {
  let layout = freshLayout();
  // Cross-panel move: risk joins the bookkeeping stack.
  layout = moveToolInCockpit(layout, "risk", "bookkeeping");
  assert.deepEqual(findPanelTools(layout, "bookkeeping"), [
    "positions",
    "working-orders",
    "fills",
    "risk",
  ]);
  assert.deepEqual(findPanelTools(layout, "accounts"), ["portfolio"]);
  assert.equal(findPanel(layout, "bookkeeping")!.activeToolId, "risk");
  // Within-panel reorder to the front.
  layout = moveToolInCockpit(layout, "risk", "bookkeeping", 0);
  assert.deepEqual(findPanelTools(layout, "bookkeeping"), [
    "risk",
    "positions",
    "working-orders",
    "fills",
  ]);
  // Unknown target panel → no-op, tool stays docked (never dropped).
  const unchanged = moveToolInCockpit(layout, "risk", "no-such-panel" as never);
  assert.equal(isToolOpen(unchanged, "risk"), true);
  assert.deepEqual(findPanelTools(unchanged, "bookkeeping"), findPanelTools(layout, "bookkeeping"));
  // The clock tool never leaves the strip.
  const stripLayout = moveToolInCockpit(layout, "simulation-clock", "tape");
  assert.equal(stripLayout, layout);
  assertSingletonInvariant(layout);
});

test("ratio setters clamp weights and batch-apply resizable-group changes", () => {
  const layout = freshLayout();
  assert.equal(setColumnWidthRatio(layout, "focus", -5).columns[1]!.widthRatio, 1);
  assert.equal(setColumnWidthRatio(layout, "focus", 0).columns[1]!.widthRatio, 1);
  assert.equal(setColumnWidthRatio(layout, "focus", 99_999).columns[1]!.widthRatio, 20);
  assert.equal(setColumnWidthRatio(layout, "focus", 2.5).columns[1]!.widthRatio, 2.5);
  assert.equal(setPanelHeightRatio(layout, "tape", -1).columns[1]!.panels[1]!.heightRatio, 1);
  assert.equal(setClockStripHeightRatio(layout, 0).clockStrip.heightRatio, 1);
  // Batch ops mirror react-resizable-panels Layout maps (id → flexGrow).
  const batched = setColumnWidthRatios(layout, { focus: 3, "market-rail": 1, execution: 2 });
  assert.equal(batched.columns[0]!.widthRatio, 1);
  assert.equal(batched.columns[1]!.widthRatio, 3);
  assert.equal(batched.columns[2]!.widthRatio, 2);
  const heights = setPanelHeightRatios(batched, "execution", { book: 5, ticket: 5 });
  assert.equal(heights.columns[2]!.panels[0]!.heightRatio, 5);
  assert.equal(heights.columns[2]!.panels[1]!.heightRatio, 5);
  assert.equal(heights.columns[2]!.panels[2]!.heightRatio, 2, "untouched panels keep weights");
});

test("normalizeCockpitLayout keeps valid layouts and discards corrupt ones wholesale", () => {
  const layout = freshLayout();
  const roundTripped = normalizeCockpitLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(roundTripped, layout);
  for (const corrupt of [
    null,
    undefined,
    "nope",
    42,
    {},
    { schemaVersion: 2, columns: [] },
    { schemaVersion: 1 },
    { schemaVersion: 1, columns: "x" },
    { schemaVersion: 1, columns: layout.columns, clockStrip: { open: "yes" } },
    {
      schemaVersion: 1,
      columns: [{ id: "focus", widthRatio: 1, panels: [] }],
      clockStrip: { open: true, heightRatio: 1 },
    },
  ]) {
    assert.equal(normalizeCockpitLayout(corrupt), null, `corrupt: ${JSON.stringify(corrupt)}`);
  }
  // Bad ratios invalidate the whole layout (wholesale discipline, no partial rescue).
  const badRatio = structuredClone(layout) as unknown as {
    columns: { widthRatio: number }[];
  };
  badRatio.columns[1]!.widthRatio = Number.NaN;
  assert.equal(normalizeCockpitLayout(badRatio), null);
});

test("normalizeCockpitLayout filters unknown tools and duplicate dockings", () => {
  const layout = freshLayout();
  const raw = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;
  const marketPanel = (
    (raw.columns as Record<string, unknown>[])[0] as {
      panels: Record<string, unknown>[];
    }
  ).panels[0]!;
  marketPanel.tools = ["watchlist", "watchlist", "future-tool"];
  const normalized = normalizeCockpitLayout(raw, {
    knownToolIds: new Set(["watchlist", "chart"]),
  });
  assert.ok(normalized);
  assert.deepEqual(findPanelTools(normalized, "market"), ["watchlist"]);
  assertSingletonInvariant(normalized);
  // Without the registry filter the future tool survives (forward-compat read).
  const lenient = normalizeCockpitLayout(raw);
  assert.deepEqual(findPanelTools(lenient!, "market"), ["watchlist", "future-tool"]);
});

test("the layout store persists per (workspaceKey, layoutProfileId) scope and notifies subscribers", () => {
  const storage = createInMemoryCockpitLayoutStorage();
  const key = cockpitLayoutStorageKey("/ws/one", "default");
  const otherKey = cockpitLayoutStorageKey("/ws/two", "default");
  assert.notEqual(key, otherKey, "workspace scopes the persistence key");
  const fallback = freshLayout();
  const store = createCockpitLayoutStore({ storage, storageKey: key, fallback });

  assert.deepEqual(store.getState(), fallback, "no persisted state → profile base");
  assert.deepEqual(store.getServerState(), fallback, "server snapshot never hydrates storage");
  const notifications: number[] = [];
  const unsubscribe = store.subscribe(() => notifications.push(1));

  const closed = closeToolInCockpit(fallback, "chart");
  store.setState(closed);
  assert.equal(notifications.length, 1, "subscribers notified");
  assert.equal(store.getState(), closed, "snapshot identity is the set state");
  assert.deepEqual(
    JSON.parse(storage.getItem(key!) as string),
    closed,
    "state persisted through the storage adapter",
  );

  // A second store on the same key/storage hydrates the persisted layout.
  const hydrated = createCockpitLayoutStore({
    storage,
    storageKey: key,
    fallback: freshLayout(),
  });
  assert.equal(isToolOpen(hydrated.getState(), "chart"), false, "persisted close survives");
  // A different scope starts from its own base.
  const otherScope = createCockpitLayoutStore({
    storage,
    storageKey: otherKey,
    fallback: freshLayout(),
  });
  assert.ok(isToolOpen(otherScope.getState(), "chart"));
  unsubscribe();
  store.setState(freshLayout());
  assert.equal(notifications.length, 1, "unsubscribed listeners are not notified");
});

test("the layout store degrades silently on corrupt storage and failing writes", () => {
  const storage = createInMemoryCockpitLayoutStorage();
  const key = cockpitLayoutStorageKey("/ws/one", "default");
  storage.setItem(key, "{not json");
  const store = createCockpitLayoutStore({
    storage,
    storageKey: key,
    fallback: freshLayout(),
  });
  assert.deepEqual(store.getState(), freshLayout(), "corrupt storage → profile base");
  const failingStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
  const failingStore = createCockpitLayoutStore({
    storage: failingStorage,
    storageKey: key,
    fallback: freshLayout(),
  });
  const closed = closeToolInCockpit(freshLayout(), "chart");
  failingStore.setState(closed);
  assert.equal(failingStore.getState(), closed, "in-memory state survives storage failure");
});

test("the shared store registry returns one live instance per scope", () => {
  clearSharedCockpitLayoutStores();
  const fallback = createDefaultTradingWorldLayoutProfile().layout;
  const key = cockpitLayoutStorageKey("/ws/shared", "default");
  const first = getSharedCockpitLayoutStore(key, fallback);
  const second = getSharedCockpitLayoutStore(key, fallback);
  assert.equal(first, second, "same scope → same store (live sync across panes)");
  first.setState(closeToolInCockpit(first.getState(), "chart"));
  assert.equal(isToolOpen(second.getState(), "chart"), false);
  clearSharedCockpitLayoutStores();
  assert.notEqual(
    getSharedCockpitLayoutStore(key, fallback),
    first,
    "cleared registry mints a fresh store",
  );
});

test("profile resolution: 'default' is canonical; unknown ids degrade to the default cockpit", () => {
  const canonical = resolveTradingWorldLayoutProfile(DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID);
  assert.equal(canonical.id, DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID);
  assert.equal(canonical.label, "Trader Cockpit");
  assert.deepEqual(
    canonical.layout,
    createDefaultTradingWorldCockpitLayout(),
    "profile layout is a fresh copy each resolve",
  );
  const unknown = resolveTradingWorldLayoutProfile("not-yet-a-preset");
  assert.equal(unknown.id, "not-yet-a-preset", "id preserved for display");
  assert.equal(unknown.label, "Profile: not-yet-a-preset");
  assert.deepEqual(unknown.layout, canonical.layout, "unknown → default cockpit layout");
  // Fresh-copy law: two resolves never share mutable internals.
  const a = createDefaultTradingWorldCockpitLayout();
  const b = createDefaultTradingWorldCockpitLayout();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

function findPanel(layout: TradingWorldCockpitLayout, panelId: string) {
  for (const columnLayout of layout.columns) {
    for (const panelLayout of columnLayout.panels) {
      if (panelLayout.id === panelId) {
        return panelLayout;
      }
    }
  }
  return undefined;
}
