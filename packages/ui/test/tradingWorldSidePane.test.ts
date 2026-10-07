/**
 * Trading World side-pane lifecycle tests (W005).
 *
 * Guards the shell-side seam against the canonical contract in
 * contracts/ui/ (type-only): the registry must give the `trading-world`
 * panel type full lifecycle parity with Terminal/Browser panes —
 * open/focus/resize(container)/collapse(mounted-hidden)/reorder/restore/
 * close/persist — without the shell learning any trading-domain semantics.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldSidePane.test.ts
 * (from packages/ui; matches the existing test/nonCliAcpRetirement.test.ts
 * convention).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  buildTradingWorldSidePaneTabId,
  closeSidePaneTab,
  closeTradingWorldSidePane,
  getActiveSidePaneTab,
  getVisibleSidePaneTabs,
  isSidePaneTabVisibleForParent,
  normalizeWorkspaceSidePaneState,
  openTradingWorldSidePane,
  reorderSidePaneTab,
  restoreSidePaneTab,
  setActiveSidePaneTab,
  toggleTradingWorldSidePane,
  type TradingWorldSidePaneTab,
  type WorkspaceSidePaneState,
} from "../src/lib/workspaceSidePane.js";
import {
  readTaskSidePaneMemoryState,
  saveTaskSidePaneMemoryState,
} from "../src/lib/taskSidePaneMemory.js";
import {
  TRADING_WORLD_PANE_TITLE,
  TRADING_WORLD_SIMULATION_DISCLOSURE,
  TradingWorldSidePane,
} from "../src/app-shell/TradingWorldSidePane.js";
import { getSidePaneTabTitle } from "../src/app-shell/SidePaneTabTrigger.js";
import {
  getSidePaneTabSearchHint,
  getSidePaneTabTypeLabel,
} from "../src/app-shell/sidePaneTabPresentation.js";
import { resolveOpenTabLauncherItemIds } from "../src/app-shell/animatedSidePanePanelModel.js";
import type { TradingWorldSidePaneTabContract } from "../../../contracts/ui/src/trading-world-side-pane.js";

const WORKSPACE_A = "/home/trader/workspace-a";
const WORKSPACE_B = "/home/trader/workspace-b";
const WORLD_MAIN = "world-alpha";
const WORLD_SECOND = "world-beta";
const LAYOUT_DAY_TRADER = "day-trader";

const openRequest = {
  workspaceKey: WORKSPACE_A,
  worldId: WORLD_MAIN,
  layoutProfileId: LAYOUT_DAY_TRADER,
} as const;

function openTradingWorld(): WorkspaceSidePaneState {
  return openTradingWorldSidePane(null, { ...openRequest });
}

/**
 * Compile-time drift guard: the shell's persisted tab type satisfies the
 * canonical contract (checked whenever this file is type-checked; the
 * runtime minimum-identity assertions below enforce the same law now).
 */
const _contractDriftGuard: TradingWorldSidePaneTabContract =
  {} as TradingWorldSidePaneTab;

test("opening a trading-world tab registers the minimum contract identity", () => {
  const state = openTradingWorld();
  assert.equal(state.tabs.length, 1);
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  assert.equal(tab.type, "trading-world");
  assert.equal(tab.id, buildTradingWorldSidePaneTabId(openRequest));
  assert.equal(tab.workspaceKey, WORKSPACE_A);
  assert.equal(tab.worldId, WORLD_MAIN);
  assert.equal(tab.layoutProfileId, LAYOUT_DAY_TRADER);
  assert.equal(typeof tab.openedAt, "number");
  assert.equal(state.activeTabId, tab.id);
  // Minimum identity from ZCODE-INTEGRATION-MAP is present with the
  // contract's runtime shapes; worldId/layoutProfileId stay opaque strings.
  const identity: Record<string, unknown> = {
    id: tab.id,
    type: tab.type,
    workspaceKey: tab.workspaceKey,
    worldId: tab.worldId,
    layoutProfileId: tab.layoutProfileId,
  };
  for (const [key, value] of Object.entries(identity)) {
    assert.equal(typeof value, "string", `${key} must be a string`);
    assert.notEqual(String(value).length, 0, `${key} must not be empty`);
  }
});

test("re-opening the same world focuses the existing tab instead of duplicating it", () => {
  const first = openTradingWorld();
  const firstOpenedAt = (first.tabs[0] as TradingWorldSidePaneTab).openedAt;
  const second = openTradingWorldSidePane(first, {
    ...openRequest,
    layoutProfileId: "execution",
  });
  assert.equal(second.tabs.filter((tab) => tab.type === "trading-world").length, 1);
  const tab = second.tabs[0] as TradingWorldSidePaneTab;
  assert.equal(second.activeTabId, tab.id);
  assert.equal(tab.openedAt, firstOpenedAt, "identity (not openedAt) survives re-open");
  assert.equal(tab.layoutProfileId, "execution", "re-open refreshes the layout landing");
});

test("a different world in the same workspace opens a second tab; same world in another workspace never collides", () => {
  const state = openTradingWorldSidePane(
    openTradingWorldSidePane(null, { ...openRequest }),
    { ...openRequest, worldId: WORLD_SECOND },
  );
  assert.equal(state.tabs.filter((tab) => tab.type === "trading-world").length, 2);

  const otherWorkspace = openTradingWorldSidePane(null, {
    workspaceKey: WORKSPACE_B,
    worldId: WORLD_MAIN,
    layoutProfileId: LAYOUT_DAY_TRADER,
  });
  const otherTab = otherWorkspace.tabs[0] as TradingWorldSidePaneTab;
  assert.equal(otherTab.worldId, WORLD_MAIN);
  assert.notEqual(
    otherTab.id,
    buildTradingWorldSidePaneTabId(openRequest),
    "tab identity includes the workspace scope",
  );
});

test("toggle closes the active trading-world tab and re-opens it on demand", () => {
  const opened = openTradingWorld();
  const toggledClosed = toggleTradingWorldSidePane(opened, { ...openRequest });
  assert.equal(toggledClosed, null, "last tab closed collapses the side pane state");

  const toggledOpen = toggleTradingWorldSidePane(null, { ...openRequest });
  assert.ok(toggledOpen, "re-opening after close yields a fresh side pane state");
  assert.equal((toggledOpen.tabs[0] as TradingWorldSidePaneTab).type, "trading-world");

  // Active trading-world tab of a *different* world still opens/focuses the
  // requested world instead of closing the panel.
  const withBeta = openTradingWorldSidePane(toggledOpen, {
    ...openRequest,
    worldId: WORLD_SECOND,
  });
  const focusedMain = toggleTradingWorldSidePane(withBeta, { ...openRequest });
  assert.equal(
    (getActiveSidePaneTab(focusedMain) as TradingWorldSidePaneTab).worldId,
    WORLD_MAIN,
  );
});

test("close removes the tab and falls back to the remaining tab (generic close path)", () => {
  const state = openTradingWorldSidePane(openTradingWorld(), {
    ...openRequest,
    worldId: WORLD_SECOND,
  });
  const closed = closeTradingWorldSidePane(state, openRequest);
  assert.ok(closed);
  assert.equal(closed.tabs.length, 1);
  assert.equal((closed.tabs[0] as TradingWorldSidePaneTab).worldId, WORLD_SECOND);
  assert.equal(closed.activeTabId, closed.tabs[0]!.id);

  // Missing target is a no-op, like closeGitSidePane.
  assert.equal(closeTradingWorldSidePane(closed, openRequest), closed);
  assert.equal(
    closeSidePaneTab(closed, closed.tabs[0]!.id),
    null,
    "generic closeSidePaneTab also works on trading-world tabs",
  );
});

test("focus and reorder work through the generic side-pane paths", () => {
  const state = openTradingWorldSidePane(openTradingWorld(), {
    ...openRequest,
    worldId: WORLD_SECOND,
  });
  const [mainTab, secondTab] = state.tabs as [TradingWorldSidePaneTab, TradingWorldSidePaneTab];

  const focused = setActiveSidePaneTab(state, mainTab.id);
  assert.equal(getActiveSidePaneTab(focused)!.id, mainTab.id);

  const reordered = reorderSidePaneTab(state, secondTab.id, mainTab.id)!;
  assert.equal(reordered.tabs[0]!.id, secondTab.id);
  assert.deepEqual(
    reordered.tabs.map((tab) => tab.id),
    [secondTab.id, mainTab.id],
  );
});

test("restore (recently-closed reopen path) re-activates the preserved identity", () => {
  const state = openTradingWorld();
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  const closed = closeSidePaneTab(state, tab.id);
  assert.equal(closed, null);
  const restored = restoreSidePaneTab(null, tab);
  assert.equal(restored.tabs.length, 1);
  const restoredTab = restored.tabs[0] as TradingWorldSidePaneTab;
  assert.equal(restoredTab.id, tab.id);
  assert.equal(restoredTab.worldId, WORLD_MAIN);
  assert.equal(restored.activeTabId, tab.id);
});

test("the tab is workspace-scoped but conversation-independent (scope parity with git)", () => {
  const state = openTradingWorld();
  const scope = { workspaceKey: WORKSPACE_A, ownerTaskId: "task-1" };
  assert.equal(getVisibleSidePaneTabs(state.tabs, scope).length, 1);
  // Any conversation of the same workspace sees it.
  assert.equal(
    getVisibleSidePaneTabs(state.tabs, { workspaceKey: WORKSPACE_A, ownerTaskId: "task-2" })
      .length,
    1,
  );
  assert.equal(
    getVisibleSidePaneTabs(state.tabs, { workspaceKey: WORKSPACE_A, ownerTaskId: null }).length,
    1,
  );
  // Other workspaces never see it.
  assert.equal(
    getVisibleSidePaneTabs(state.tabs, { workspaceKey: WORKSPACE_B, ownerTaskId: "task-1" })
      .length,
    0,
  );
  // Parent-session visibility (used by task switches) keeps it visible.
  assert.equal(isSidePaneTabVisibleForParent(state.tabs[0]!, "any-session"), true);
});

test("outer state survives the existing side-pane persistence path unchanged", () => {
  const memoryKey = "w005-test://workspace-a";
  const state = openTradingWorldSidePane(openTradingWorld(), {
    ...openRequest,
    worldId: WORLD_SECOND,
  });
  // The exact mechanism Terminal/Browser tabs use: taskSidePaneMemory keyed
  // by workspace, normalized at the state boundary.
  saveTaskSidePaneMemoryState(memoryKey, { sidePaneState: state, isSidePaneCollapsed: false });
  const restored = readTaskSidePaneMemoryState(memoryKey);

  assert.ok(restored.sidePaneState);
  assert.equal(restored.sidePaneState.tabs.length, 2);
  assert.equal(
    restored.sidePaneState.tabs.filter((tab) => tab.type === "trading-world").length,
    2,
  );
  assert.equal(restored.sidePaneState.activeTabId, state.activeTabId);
  const restoredTab = restored.sidePaneState.tabs[0] as TradingWorldSidePaneTab;
  assert.equal(restoredTab.worldId, WORLD_MAIN);
  assert.equal(restoredTab.layoutProfileId, LAYOUT_DAY_TRADER);

  // The state boundary itself never drops trading-world tabs.
  const normalized = normalizeWorkspaceSidePaneState(state);
  assert.equal(normalized!.tabs.length, 2);
});

test("placeholder surface renders panel chrome with the persistent SIMULATED disclosure", () => {
  const state = openTradingWorld();
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldSidePane, {
      tab,
      visible: true,
      focused: true,
      onClose: () => {},
    }),
  );
  // ACCEPTANCE-WORLD-ALPHA K: persistent (mounted ⇒ rendered) SIMULATED
  // disclosure; UX-DESIGN wording `SIMULATED · HISTORICAL`; text, not color.
  assert.ok(
    markup.includes(TRADING_WORLD_SIMULATION_DISCLOSURE),
    "simulation disclosure badge is rendered",
  );
  assert.ok(
    markup.includes('data-trading-world-simulation-disclosure=""'),
    "disclosure is a stable test hook",
  );
  assert.ok(markup.includes(TRADING_WORLD_PANE_TITLE));
  assert.ok(markup.includes(tab.worldId), "opaque world id is surfaced for identification");
  assert.ok(markup.includes('data-trading-world-focused="true"'));
  assert.ok(markup.includes('aria-label="Close Trading World"'));

  // Hidden-mounted phase (collapsed pane / inactive tab) still renders the
  // disclosure — collapse is not destroy (J-WORLD-02).
  const hiddenMarkup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldSidePane, {
      tab,
      visible: false,
      focused: false,
      onClose: () => {},
    }),
  );
  assert.ok(hiddenMarkup.includes(TRADING_WORLD_SIMULATION_DISCLOSURE));
  assert.ok(hiddenMarkup.includes('data-trading-world-visible="false"'));
});

test("presentation seam: title, search hint, type label, and gated launcher entry", () => {
  const state = openTradingWorld();
  const tab = state.tabs[0] as TradingWorldSidePaneTab;

  // Fixed product title (no i18n id fallback leak).
  assert.equal(
    getSidePaneTabTitle(tab, (descriptor) => descriptor.id),
    TRADING_WORLD_PANE_TITLE,
  );
  // Opaque ids stay searchable for troubleshooting, mirroring workflow-run.
  const hint = getSidePaneTabSearchHint(tab);
  assert.ok(hint.includes(WORLD_MAIN));
  assert.ok(hint.includes(LAYOUT_DAY_TRADER));
  assert.ok(hint.includes("trading world"));
  const labels = {
    browserTitle: "Browser",
    reviewTitle: "Review",
    codeViewerTitle: "Preview",
    treemappingTitle: "Treemap",
    whiteboardTitle: "Whiteboard",
    modelTrajectoryTitle: "Trajectory",
    developerToolsTitle: "Developer tools",
    terminalTitle: "Terminal",
    subagentTypeLabel: "Subagent",
    subagentDirectoryTitle: "Subagents",
    selectionChatTitle: "Chat",
    planTitle: "Plan",
    workflowRunTitle: "Run",
    workflowDirectoryTitle: "Runs",
    workflowActorTitle: "Actor",
    workflowScriptTitle: "Script",
    workflowArtifactTitle: "Artifact",
  } as const;
  assert.equal(getSidePaneTabTypeLabel(tab, labels), TRADING_WORLD_PANE_TITLE);

  // Launcher: the "+" entry appears only when the host wired the open
  // callback and no trading-world tab is open yet.
  const baseLauncher = { developerToolsEnabled: true, hasReviewTab: false } as const;
  assert.ok(
    resolveOpenTabLauncherItemIds({
      ...baseLauncher,
      canOpenTradingWorld: true,
    }).includes("trading-world"),
  );
  assert.ok(
    !resolveOpenTabLauncherItemIds(baseLauncher).includes("trading-world"),
    "unwired host (TL one-line connection pending) keeps zero behavior change",
  );
  assert.ok(
    !resolveOpenTabLauncherItemIds({
      ...baseLauncher,
      canOpenTradingWorld: true,
      hasTradingWorldTab: true,
    }).includes("trading-world"),
  );
});
