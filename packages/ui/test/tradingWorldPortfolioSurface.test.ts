/**
 * Portfolio/positions/risk surface tests (W011) — registry swaps, SSR
 * honest states, the persistent SIMULATED disclosure, and the cockpit-shell
 * composition through the W006 seam.
 *
 * Static SSR renders only (the W007/W008/W009/W010 pattern): effects never
 * run during server render, so an attached client shows `loading` — the
 * LIVE states (fills, marks moving, flat books, breaches) are proven
 * against the REAL engine in tradingWorldPortfolioLive.test.ts.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldPortfolioSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  PORTFOLIO_TOOL_ID,
  POSITIONS_TOOL_ID,
  RISK_TOOL_ID,
  withPortfolioSurface,
  withPortfolioToolSurfaces,
  withPositionsSurface,
  withRiskSurface,
} from "../src/trading-world/portfolio/index.js";
import {
  PortfolioToolSurface,
  PositionsToolSurface,
  RiskToolSurface,
} from "../src/trading-world/portfolio/index.js";
import type { TradingWorldToolSurfaceProps } from "../src/trading-world/registry/toolRegistry.js";
import {
  createTradingWorldCoreToolRegistry,
  type TradingWorldToolRegistry,
} from "../src/trading-world/registry/toolRegistry.js";
import { TradingWorldShell } from "../src/trading-world/components/TradingWorldShell.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../src/trading-world/components/PlaceholderToolSurface.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
  type TradingWorldClient,
} from "../src/trading-world/runtime/worldClient.js";
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

const surfaceProps: TradingWorldToolSurfaceProps = {
  toolId: POSITIONS_TOOL_ID,
  worldId: "world-alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof PositionsToolSurface,
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

function readyClient(worldId: string): TradingWorldClient {
  return { ...createSimulatedNoopWorldClient(worldId), status: "ready" };
}

test("the three tool ids match the W006 registry slots", () => {
  assert.equal(POSITIONS_TOOL_ID, "positions");
  assert.equal(PORTFOLIO_TOOL_ID, "portfolio");
  assert.equal(RISK_TOOL_ID, "risk");
});

test("withPortfolioToolSurfaces swaps all three W011 slots immutably", () => {
  const base = createTradingWorldCoreToolRegistry();
  const swapped = withPortfolioToolSurfaces(base);
  // Immutable: the original registry is untouched.
  assert.equal(base.getTool(POSITIONS_TOOL_ID)!.status, "placeholder");
  assert.equal(base.getTool(PORTFOLIO_TOOL_ID)!.status, "placeholder");
  assert.equal(base.getTool(RISK_TOOL_ID)!.status, "placeholder");
  for (const [toolId, surface] of [
    [POSITIONS_TOOL_ID, PositionsToolSurface],
    [PORTFOLIO_TOOL_ID, PortfolioToolSurface],
    [RISK_TOOL_ID, RiskToolSurface],
  ] as const) {
    const descriptor = swapped.getTool(toolId)!;
    assert.equal(descriptor.status, "implemented");
    assert.equal(descriptor.surface, surface);
    assert.equal(descriptor.ownerWorkOrder, "W011");
    assert.equal(descriptor.kind, "portfolio");
  }
  assert.equal(swapped.getTool(POSITIONS_TOOL_ID)!.defaultPanel, "bookkeeping");
  assert.equal(swapped.getTool(PORTFOLIO_TOOL_ID)!.defaultPanel, "accounts");
  assert.equal(swapped.getTool(RISK_TOOL_ID)!.defaultPanel, "accounts");
  // Everything else keeps its state (one WO, one tool set).
  assert.equal(swapped.getTool("simulation-clock")!.status, "placeholder");
  assert.equal(swapped.listTools().length, 11);
  // Individual swaps accept custom surfaces (composition flexibility).
  function Custom(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-portfolio-surface": "" });
  }
  const custom = withRiskSurface(
    withPortfolioSurface(withPositionsSurface(base, Custom), Custom),
    Custom,
  );
  assert.equal(custom.getTool(POSITIONS_TOOL_ID)!.surface, Custom);
  assert.equal(custom.getTool(PORTFOLIO_TOOL_ID)!.surface, Custom);
  assert.equal(custom.getTool(RISK_TOOL_ID)!.surface, Custom);
  // Unknown ids throw loudly inside the registry seam.
  assert.throws(() =>
    withPositionsSurface({} as TradingWorldToolRegistry, Custom),
  );
});

test("the positions surface renders its honest unattached teaching state with the persistent disclosure", () => {
  const markup = renderSurface(PositionsToolSurface);
  assert.ok(markup.includes('data-trading-world-positions=""'));
  assert.ok(markup.includes('data-trading-world-positions-data-status="unattached"'));
  assert.ok(markup.includes('data-trading-world-positions-account="account-trader-world-alpha"'));
  assert.ok(markup.includes("No world runtime attached"));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
});

test("the portfolio and risk surfaces render honest unattached states", () => {
  const portfolio = renderSurface(PortfolioToolSurface, {
    ...surfaceProps,
    toolId: PORTFOLIO_TOOL_ID,
  });
  assert.ok(portfolio.includes('data-trading-world-portfolio=""'));
  assert.ok(portfolio.includes('data-trading-world-portfolio-data-status="unattached"'));
  assert.ok(portfolio.includes("No world runtime attached"));
  assert.ok(portfolio.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));

  const risk = renderSurface(RiskToolSurface, { ...surfaceProps, toolId: RISK_TOOL_ID });
  assert.ok(risk.includes('data-trading-world-risk=""'));
  assert.ok(risk.includes('data-trading-world-risk-data-status="unattached"'));
  assert.ok(risk.includes("No world runtime attached"));
  assert.ok(risk.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("all three surfaces render the loading state against an attached client (no SSR data)", () => {
  for (const [surface, marker] of [
    [PositionsToolSurface, 'data-trading-world-positions-data-status="loading"'],
    [PortfolioToolSurface, 'data-trading-world-portfolio-data-status="loading"'],
    [RiskToolSurface, 'data-trading-world-risk-data-status="loading"'],
  ] as const) {
    const markup = renderSurface(
      surface,
      { ...surfaceProps, toolId: surface === PositionsToolSurface ? POSITIONS_TOOL_ID : surface === PortfolioToolSurface ? PORTFOLIO_TOOL_ID : RISK_TOOL_ID },
      readyClient("world-alpha"),
    );
    assert.ok(markup.includes(marker));
    // Effects have not run in SSR: no fabricated figures anywhere.
    assert.ok(!markup.includes('data-trading-world-portfolio-cash='));
    assert.ok(!markup.includes('data-trading-world-risk-card='));
    assert.ok(!markup.includes('data-trading-world-position-row='));
    assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  }
});

test("mounted-hidden phases keep the financial surfaces alive (J-WORLD-02)", () => {
  for (const [surface, marker] of [
    [PositionsToolSurface, "data-trading-world-positions"],
    [PortfolioToolSurface, "data-trading-world-portfolio"],
    [RiskToolSurface, "data-trading-world-risk"],
  ] as const) {
    const markup = renderSurface(surface, {
      ...surfaceProps,
      active: false,
      phase: "mounted-hidden",
    });
    assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
    assert.ok(markup.includes(marker));
    assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  }
});

test("the cockpit shell mounts the three real W011 surfaces through the registry seam", () => {
  clearSharedCockpitLayoutStores();
  const state = openTradingWorldSidePane(null, {
    workspaceKey: "/ws/w011-shell",
    worldId: "world-alpha",
    layoutProfileId: "default",
  });
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w011-shell", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  const registry = withPortfolioToolSurfaces(createTradingWorldCoreToolRegistry());
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  // The three real W011 surfaces are mounted (unattached in SSR — the shell
  // attaches the engine in effects)…
  assert.ok(markup.includes('data-trading-world-positions=""'));
  assert.ok(markup.includes('data-trading-world-portfolio=""'));
  assert.ok(markup.includes('data-trading-world-risk=""'));
  assert.ok(markup.includes('data-trading-world-positions-data-status="unattached"'));
  // …their placeholders are gone…
  assert.ok(!markup.includes("Positions surface placeholder"));
  assert.ok(!markup.includes("Portfolio surface placeholder"));
  assert.ok(!markup.includes("Risk surface placeholder"));
  // …while the not-yet-owned tool keeps its placeholder (one WO, one set).
  assert.ok(markup.includes("Simulation Clock surface placeholder"));
});
