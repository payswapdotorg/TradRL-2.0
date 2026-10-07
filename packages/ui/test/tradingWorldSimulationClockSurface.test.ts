/**
 * Simulation-clock tool surface tests (W012).
 *
 * Guards the W012 registry integration and the surface's honest static
 * states (the W007/W008 surface-test pattern): the simulation-clock slot
 * is swapped through `withSimulationClockToolSurface` (the W006
 * `withSurfaceOverride` seam applied from the simulation module — no
 * registry file edits), the strip renders the persistent SIMULATED
 * disclosure in every state, and against BOTH world-client modes it never
 * fabricates data (ARCHITECTURE-LOCK A6):
 * - unattached runtime (the fail-closed noop): the teaching state;
 * - attached runtime: the initial "loading" projection (effects pending);
 * - the announced-regime timeline list: journal-announced entries only,
 *   with jump actions and honest empty/error bodies;
 * - the cockpit shell mounts the swapped surface in the clock strip.
 *
 * Static renders (renderToStaticMarkup) cover the synchronous states; the
 * effectful paths — the live clock through the W018 push channels, the
 * typed seek/jump outcomes against the REAL generated alpha engine — are
 * covered in plain Node by tradingWorldSimulationClockProjection.test.ts.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldSimulationClockSurface.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  ClockTimelineList,
  SIMULATION_CLOCK_TOOL_ID,
  SimulationClockToolSurface,
  withSimulationClockToolSurface,
} from "../src/trading-world/simulation/index.js";
import type { TimelineRegimeEntry } from "../src/trading-world/simulation/index.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
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

/** The alpha world's simulation origin (runtime/engineAttachment.ts). */
const SIM_START = 1_700_000_000_000;

const surfaceProps: TradingWorldToolSurfaceProps = {
  toolId: "simulation-clock",
  worldId: "alpha",
  layoutProfileId: "default-trader",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => undefined,
};

function render(element: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}

test("the registry slot: placeholder until swapped, implemented after the W012 one-liner", () => {
  const registry = createTradingWorldCoreToolRegistry();
  const before = registry.getTool("simulation-clock");
  assert.equal(before?.status, "placeholder");
  assert.equal(before?.ownerWorkOrder, "W012");
  assert.equal(before?.kind, "simulation");
  assert.equal(before?.defaultPanel, "clock-strip");
  assert.deepEqual(
    before?.consumes,
    [
      "clock.play",
      "clock.pause",
      "clock.step",
      "clock.seek",
      "clock.jumpToEvent",
      "clock.setSpeed",
      "clock.getClock",
    ],
    "the registry descriptor's documented consumes (drift guard)",
  );
  const swapped = withSimulationClockToolSurface(registry);
  const after = swapped.getTool("simulation-clock");
  assert.equal(after?.status, "implemented");
  assert.equal(after?.surface, SimulationClockToolSurface);
  // Immutable swap: the original registry is untouched.
  assert.equal(registry.getTool("simulation-clock")?.status, "placeholder");
  // The exported tool id is the registry's stable slot identity.
  assert.equal(SIMULATION_CLOCK_TOOL_ID, "simulation-clock");
});

test("unattached runtime: the teaching state — no clock, no fabricated time, persistent disclosure", () => {
  const markup = render(
    createElement(
      TradingWorldClientContext.Provider,
      { value: createSimulatedNoopWorldClient("alpha") },
      createElement(SimulationClockToolSurface, surfaceProps),
    ),
  );
  assert.match(markup, /data-trading-world-clock-state="unattached"/);
  assert.match(markup, new RegExp(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.match(markup, /No world runtime attached/);
  assert.match(markup, /never a local timer/);
  // No clock readout in the teaching state (nothing fabricated).
  assert.doesNotMatch(markup, /data-trading-world-clock-sim-time/);
  assert.doesNotMatch(markup, /data-trading-world-clock-controls/);
});

test("attached runtime: the honest loading projection before effects run (SSR snapshot parity)", () => {
  const readyNoop = {
    ...createSimulatedNoopWorldClient("alpha"),
    status: "ready",
  } as ReturnType<typeof createSimulatedNoopWorldClient>;
  const markup = render(
    createElement(
      TradingWorldClientContext.Provider,
      { value: readyNoop },
      createElement(SimulationClockToolSurface, surfaceProps),
    ),
  );
  assert.match(markup, /data-trading-world-clock-state="loading"/);
  assert.match(markup, /Loading the world/);
  assert.match(markup, new RegExp(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.doesNotMatch(markup, /data-trading-world-clock-sim-time/);
});

test("mounted-hidden: J-WORLD-02 state-kept-alive disclosure", () => {
  const markup = render(
    createElement(
      TradingWorldClientContext.Provider,
      { value: createSimulatedNoopWorldClient("alpha") },
      createElement(
        SimulationClockToolSurface,
        { ...surfaceProps, phase: "mounted-hidden", active: false },
      ),
    ),
  );
  assert.match(markup, /data-trading-world-surface-phase="mounted-hidden"/);
  assert.match(markup, /state kept alive while hidden/);
});

function regimeEntry(overrides: Partial<TimelineRegimeEntry> = {}): TimelineRegimeEntry {
  return {
    announcement: {
      at: SIM_START,
      to: "mean-reversion",
      parameters: { anchorPrice: 4800, direction: 1 },
    },
    sequence: 8,
    eventId: "evt-regime-1",
    ...overrides,
  };
}

test("the timeline list: announced regimes only — times, transitions, latest marker, jump actions", () => {
  const markup = render(
    createElement(ClockTimelineList, {
      entries: [
        regimeEntry(),
        regimeEntry({
          announcement: { at: SIM_START + 30 * 60_000, from: "mean-reversion", to: "trend" },
          sequence: 21,
          eventId: "evt-regime-2",
        }),
      ],
      timelineError: undefined,
      pending: false,
      onJump: () => undefined,
    }),
  );
  assert.match(markup, /data-trading-world-clock-timeline-entries="2"/);
  // Times are the journal's own simulation times (UTC, deterministic).
  assert.match(markup, /22:13:20/);
  assert.match(markup, /22:43:20/);
  assert.match(markup, /origin → mean-reversion/);
  assert.match(markup, /mean-reversion → trend/);
  // The latest announcement is marked (the journal's regime truth).
  assert.match(markup, /data-trading-world-clock-regime-latest="true"/);
  assert.match(markup, /· latest/);
  // Jump actions carry the journal sequence (clock.jumpToEvent targets).
  assert.match(markup, /data-trading-world-clock-regime-jump="8"/);
  assert.match(markup, /data-trading-world-clock-regime-jump="21"/);
});

test("the timeline list: honest empty state (the ORIGIN RULE teaching) and typed-error notice", () => {
  const empty = render(
    createElement(ClockTimelineList, {
      entries: [],
      timelineError: undefined,
      pending: false,
      onJump: () => undefined,
    }),
  );
  assert.match(empty, /data-trading-world-clock-timeline-empty/);
  assert.match(empty, /No regime announced yet/);
  assert.match(empty, /journal announces on the first clock advance/);

  const errored = render(
    createElement(ClockTimelineList, {
      entries: [],
      timelineError: "TradingWorldTransportClosedError: the world transport is closed",
      pending: false,
      onJump: () => undefined,
    }),
  );
  assert.match(errored, /data-trading-world-clock-timeline-error/);
  assert.match(errored, /the world transport is closed/);
});

function buildTab(workspaceKey: string): TradingWorldSidePaneTab {
  const state = openTradingWorldSidePane(null, {
    workspaceKey,
    worldId: "alpha",
    layoutProfileId: "default-trader",
  });
  return state.tabs[0] as TradingWorldSidePaneTab;
}

test("cockpit shell integration: the swapped surface mounts in the clock strip (default layout)", () => {
  const registry = withSimulationClockToolSurface(createTradingWorldCoreToolRegistry());
  const tab = buildTab("ws-w012-surface");
  // A fresh persistence scope: the default profile opens the clock strip.
  const store = getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey(tab.workspaceKey, tab.layoutProfileId),
    createDefaultTradingWorldCockpitLayout(),
    new Set<string>(["simulation-clock"]),
  );
  const layout = store.getState();
  assert.equal(layout.clockStrip.open, true);
  const markup = render(
    createElement(TradingWorldShell, { tab, visible: true, focused: true, registry }),
  );
  // The strip hosts the REAL W012 surface (static render: effects pending —
  // the engine client is the honest loading/unattached projection).
  assert.match(markup, /data-trading-world-clock-strip=""/);
  assert.match(markup, /data-trading-world-tool-surface="simulation-clock"/);
  assert.match(markup, /data-trading-world-clock-surface=""/);
  assert.match(markup, new RegExp(TRADING_WORLD_SIMULATED_DISCLOSURE));
  // The placeholder is gone.
  assert.doesNotMatch(markup, /W012/);
  clearSharedCockpitLayoutStores();
});
