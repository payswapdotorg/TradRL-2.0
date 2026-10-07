/**
 * Time & Sales tool surface tests (W009) — registry slot + honest static
 * states.
 *
 * Guards the tape half of `src/trading-world/orderbook/`: the W006 registry
 * slot contract (`time-and-sales`, orderbook kind, tape panel), the honest
 * teaching/loading states against both world-client modes (fail-closed noop /
 * attached runtime — effects never run during SSR, so no data is shown), the
 * persistent SIMULATED disclosure, and the alpha-world instrument convention.
 *
 * The effectful paths — the live tape refetching through the engine channels
 * as the clock advances — are driven by the real-engine suite
 * (tradingWorldOrderbookLiveProjection.test.ts) and the browser E2E harness.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldTimeAndSalesSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  createTimeAndSalesToolSurface,
  TimeAndSalesToolSurface,
} from "../src/trading-world/orderbook/TimeAndSalesToolSurface.js";
import {
  TIME_AND_SALES_TOOL_ID,
  withTimeAndSalesToolSurface,
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
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../src/trading-world/components/PlaceholderToolSurface.js";

const surfaceProps: TradingWorldToolSurfaceProps = {
  toolId: "time-and-sales",
  worldId: "world-alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof TimeAndSalesToolSurface,
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

test("the time-and-sales tool id matches the W006 registry slot", () => {
  assert.equal(TIME_AND_SALES_TOOL_ID, "time-and-sales");
});

test("withTimeAndSalesToolSurface swaps the placeholder immutably (the W006 slot contract)", () => {
  const base = createTradingWorldCoreToolRegistry();
  const withTape = withTimeAndSalesToolSurface(base);
  assert.equal(base.getTool("time-and-sales")!.status, "placeholder");
  const swapped = withTape.getTool(TIME_AND_SALES_TOOL_ID)!;
  assert.equal(swapped.status, "implemented");
  assert.equal(swapped.surface, TimeAndSalesToolSurface);
  assert.equal(swapped.id, "time-and-sales");
  assert.equal(swapped.ownerWorkOrder, "W009");
  assert.equal(swapped.kind, "orderbook");
  assert.equal(swapped.defaultPanel, "tape");
  // The W006 descriptor's declared ports stay untouched (consumes is the
  // registry's own documentation — the seam surface never edits it).
  assert.equal(swapped.consumes.length > 0, true);
  // Everything else is still the placeholder set.
  assert.equal(withTape.getTool("order-book")!.status, "placeholder");
  assert.equal(withTape.getTool("chart")!.status, "placeholder");
  assert.equal(withTape.listTools().length, 11);
  function CustomTape(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-tape": "" });
  }
  assert.equal(
    withTimeAndSalesToolSurface(base, CustomTape).getTool("time-and-sales")!.surface,
    CustomTape,
  );
});

test("the surface renders the honest unattached teaching state (fail-closed noop client)", () => {
  const markup = renderSurface(TimeAndSalesToolSurface);
  assert.ok(markup.includes('data-trading-world-tool-surface="time-and-sales"'));
  assert.ok(markup.includes('data-trading-world-tape-surface=""'));
  assert.ok(markup.includes('data-trading-world-tape-data-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-tape-instrument="instrument-es-world-alpha"'));
  assert.ok(markup.includes('data-trading-world-tape-state="unattached"'));
  assert.ok(markup.includes("No world runtime attached"));
  // Persistent SIMULATED disclosure (ACCEPTANCE K: text, not color alone).
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  // No fabricated prints anywhere.
  assert.ok(!markup.includes('data-trading-world-tape-row=""'), "no tape rows without data");
});

test("the surface renders the initial loading state against an attached client (no SSR data)", () => {
  const readyClient: TradingWorldClient = {
    ...createSimulatedNoopWorldClient("world-alpha"),
    status: "ready",
  };
  const markup = renderSurface(TimeAndSalesToolSurface, surfaceProps, readyClient);
  assert.ok(markup.includes('data-trading-world-tape-data-status="loading"'));
  assert.ok(!markup.includes('data-trading-world-tape-row=""'), "no tape rows before effects run");
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE), "disclosure in every state");
});

test("createTimeAndSalesToolSurface binds the configured instrument and window", () => {
  const surface = createTimeAndSalesToolSurface({
    instrumentId: "instrument-cl-fut",
    maxRows: 25,
    pollMs: 0,
  });
  const markup = renderSurface(surface);
  assert.ok(markup.includes('data-trading-world-tape-instrument="instrument-cl-fut"'));
});

test("mounted-hidden phase keeps the tape surface alive (J-WORLD-02)", () => {
  const markup = renderSurface(TimeAndSalesToolSurface, {
    ...surfaceProps,
    active: false,
    phase: "mounted-hidden",
  });
  assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});
