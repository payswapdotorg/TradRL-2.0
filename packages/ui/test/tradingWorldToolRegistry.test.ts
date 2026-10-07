/**
 * Trading World tool registry tests (W006).
 *
 * Guards the registry contract that W007–W012 build against: the complete
 * UX-DESIGN "Core World Alpha tools" set registered as first-class tools
 * (stable id, owning kind/work order, default layout slot, mountable surface
 * component, W003 port-method consumption declarations), the immutable
 * override seam that swaps placeholders for real surfaces, and the drift law
 * that `consumes` entries must be REAL W003 port methods.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldToolRegistry.test.ts
 * (from packages/ui; the W005-established local convention).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  createTradingWorldCoreToolDescriptors,
  createTradingWorldCoreToolRegistry,
  createTradingWorldToolRegistry,
  TRADING_WORLD_CORE_TOOL_IDS,
  type TradingWorldToolDescriptor,
  type TradingWorldToolSurfaceProps,
} from "../src/trading-world/registry/toolRegistry.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../src/trading-world/components/PlaceholderToolSurface.js";
import { createDefaultTradingWorldCockpitLayout } from "../src/trading-world/layout/layoutProfiles.js";
import type { QueryPort, WorldProtocol } from "../../tradrl-world-contracts/src/ports.js";

/**
 * Compile-time drift guards (type-level, never executed): the real W003
 * port types must stay importable and the `TradingWorldPortMethod` template
 * type must keep resolving against them — checked whenever this file is
 * type-checked; the runtime method-name parity below enforces the same law.
 */
type ExpectTrue<T extends true> = T;
type _QueryPortStillResolves = ExpectTrue<QueryPort["getQuote"] extends (...args: never[]) => Promise<unknown> ? true : false>;
type _WorldProtocolStillResolves = ExpectTrue<WorldProtocol["query"] extends QueryPort ? true : false>;

const CORE_TOOL_COUNT = 11;

/** Every W003 port method name — the drift guard for `consumes` metadata. */
const REAL_PORT_METHODS: Readonly<Record<string, readonly string[]>> = {
  query: [
    "getWorldMeta",
    "getSnapshot",
    "getInstrument",
    "getQuote",
    "getOrderBook",
    "getTrades",
    "getOrders",
    "getPositions",
    "getPortfolio",
    "getRisk",
    "getNews",
    "getTimeline",
  ],
  command: [
    "submitOrder",
    "cancelOrder",
    "replaceOrder",
    "closePosition",
    "addAnnotation",
    "createSnapshot",
    "branchWorld",
    "setScenario",
  ],
  clock: [
    "play",
    "pause",
    "step",
    "seek",
    "jumpToEvent",
    "setSpeed",
    "followRealtime",
    "getClock",
  ],
  evidence: [
    "getEvent",
    "getEvents",
    "getProvenance",
    "getSnapshot",
    "getBranchLineage",
    "getInformationBoundary",
    "getDeterminismManifest",
  ],
};

/** Compile-time drift guard helpers live at the top of this file (type-level). */

test("the core registry registers the full UX-DESIGN World Alpha tool set in order", () => {
  const registry = createTradingWorldCoreToolRegistry();
  const tools = registry.listTools();
  assert.equal(tools.length, CORE_TOOL_COUNT);
  assert.deepEqual(
    tools.map((descriptor) => descriptor.id),
    [...TRADING_WORLD_CORE_TOOL_IDS],
  );
  for (const toolId of TRADING_WORLD_CORE_TOOL_IDS) {
    assert.ok(registry.getTool(toolId), `${toolId} must be registered`);
  }
  assert.equal(registry.getTool("chart")!.title, "Chart");
});

test("every W007–W012 work order owns exactly its declared tools and kind", () => {
  const expectedOwners: Record<string, { owner: string; kind: string }> = {
    watchlist: { owner: "W008", kind: "market" },
    chart: { owner: "W007", kind: "charts" },
    "order-book": { owner: "W009", kind: "orderbook" },
    "time-and-sales": { owner: "W009", kind: "orderbook" },
    "order-ticket": { owner: "W010", kind: "orders" },
    "working-orders": { owner: "W010", kind: "orders" },
    fills: { owner: "W010", kind: "orders" },
    positions: { owner: "W011", kind: "portfolio" },
    portfolio: { owner: "W011", kind: "portfolio" },
    risk: { owner: "W011", kind: "portfolio" },
    "simulation-clock": { owner: "W012", kind: "simulation" },
  };
  for (const descriptor of createTradingWorldCoreToolRegistry().listTools()) {
    const expected = expectedOwners[descriptor.id]!;
    assert.equal(descriptor.ownerWorkOrder, expected.owner, descriptor.id);
    assert.equal(descriptor.kind, expected.kind, descriptor.id);
    assert.equal(descriptor.status, "placeholder", `${descriptor.id} starts as placeholder`);
    assert.ok(descriptor.title.length > 0, `${descriptor.id} has a title`);
    assert.ok(descriptor.description.length > 0, `${descriptor.id} has a description`);
    assert.ok(descriptor.consumes.length > 0, `${descriptor.id} declares consumed ports`);
  }
});

test("default panels exist in the default cockpit layout (registry ↔ layout coherence)", () => {
  const layout = createDefaultTradingWorldCockpitLayout();
  const panelIds = new Set(
    layout.columns.flatMap((columnLayout) =>
      columnLayout.panels.map((panelLayout) => panelLayout.id),
    ),
  );
  panelIds.add("clock-strip");
  for (const descriptor of createTradingWorldCoreToolRegistry().listTools()) {
    assert.ok(
      panelIds.has(descriptor.defaultPanel),
      `${descriptor.id} defaultPanel ${descriptor.defaultPanel} must exist`,
    );
  }
});

test("consumes metadata only names REAL W003 port methods (drift guard)", () => {
  for (const descriptor of createTradingWorldCoreToolDescriptors()) {
    for (const entry of descriptor.consumes) {
      const separatorIndex = entry.indexOf(".");
      const port = entry.slice(0, separatorIndex);
      const method = entry.slice(separatorIndex + 1);
      const methods = REAL_PORT_METHODS[port];
      assert.ok(methods !== undefined, `${entry}: unknown port`);
      assert.ok(
        methods.includes(method),
        `${entry}: unknown method on ${port} (contracts drift?)`,
      );
    }
  }
});

test("withSurfaceOverride swaps the placeholder immutably and marks it implemented", () => {
  const registry = createTradingWorldCoreToolRegistry();
  const before = registry.getTool("chart")!;
  function TestChartSurface(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-test-chart-surface": "" }, "real chart");
  }
  const next = registry.withSurfaceOverride("chart", TestChartSurface);

  // Original registry is untouched (immutable swap — W007 does not mutate global state).
  assert.equal(registry.getTool("chart")!.status, "placeholder");
  assert.equal(registry.getTool("chart")!.surface, before.surface);
  // New registry carries the real surface and the implemented status.
  const swapped = next.getTool("chart")!;
  assert.equal(swapped.status, "implemented");
  assert.equal(swapped.surface, TestChartSurface);
  assert.equal(swapped.id, before.id);
  assert.equal(swapped.ownerWorkOrder, before.ownerWorkOrder);
  assert.equal(swapped.defaultPanel, before.defaultPanel);
  assert.equal(next.listTools().length, CORE_TOOL_COUNT);
  // Everything else is still the placeholder set.
  assert.equal(next.getTool("watchlist")!.status, "placeholder");
});

test("registry mistakes are loud: unknown override and duplicate registration throw", () => {
  const registry = createTradingWorldCoreToolRegistry();
  assert.throws(() => registry.withSurfaceOverride("no-such-tool" as never, () => null), /unknown tool/);
  const descriptor = createTradingWorldCoreToolDescriptors()[0]!;
  assert.throws(
    () => createTradingWorldToolRegistry([descriptor, descriptor]),
    /already registered/,
  );
  assert.throws(() => registry.withTool(descriptor), /already registered/);
});

test("withTool registers an additional tool for future work orders (e.g. W027)", () => {
  const registry = createTradingWorldCoreToolRegistry();
  const researchTool: TradingWorldToolDescriptor = {
    ...registry.getTool("watchlist")!,
    id: "research",
    title: "Research",
    ownerWorkOrder: "W008",
    defaultPanel: "research",
  };
  const next = registry.withTool(researchTool);
  assert.equal(next.listTools().length, CORE_TOOL_COUNT + 1);
  assert.equal(next.getTool("research")!.title, "Research");
  assert.equal(registry.listTools().length, CORE_TOOL_COUNT, "immutable add");
});

test("placeholder surfaces render the tool label, owner work order and the persistent SIMULATED disclosure", () => {
  const registry = createTradingWorldCoreToolRegistry();
  // Static markup escapes entities ("Time & Sales" → "Time &amp; Sales").
  const escaped = (text: string) => text.replace(/&/g, "&amp;");
  for (const descriptor of registry.listTools()) {
    const Surface = descriptor.surface;
    const markup = ReactDOMServer.renderToStaticMarkup(
      createElement(Surface, {
        toolId: descriptor.id,
        worldId: "world-alpha",
        layoutProfileId: "default",
        active: true,
        phase: "mounted-focused",
        onRequestClose: () => {},
      }),
    );
    assert.ok(markup.includes(escaped(descriptor.title)), `${descriptor.id} title rendered`);
    assert.ok(
      markup.includes(descriptor.ownerWorkOrder),
      `${descriptor.id} owner work order rendered`,
    );
    assert.ok(
      markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE),
      `${descriptor.id} renders the persistent simulation disclosure`,
    );
    assert.ok(
      markup.includes('data-trading-world-tool-surface="' + descriptor.id + '"'),
      `${descriptor.id} surface test hook`,
    );
    assert.ok(
      markup.includes('data-trading-world-runtime-status="unattached"'),
      `${descriptor.id} shows the fail-closed runtime status`,
    );
    assert.ok(
      markup.includes("no market data"),
      `${descriptor.id} placeholder states it fabricates nothing`,
    );
  }
});

test("placeholder surfaces render in the mounted-hidden phase without losing the disclosure", () => {
  const registry = createTradingWorldCoreToolRegistry();
  const Surface = registry.getTool("order-book")!.surface;
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(Surface, {
      toolId: "order-book",
      worldId: "world-alpha",
      layoutProfileId: "default",
      active: false,
      phase: "mounted-hidden",
      onRequestClose: () => {},
    }),
  );
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
});
