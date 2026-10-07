/**
 * Trading World cockpit layout model — W006 world-side layout system.
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (the 3-column grid:
 * Watchlist | Main Chart | Order Book/DOM + Order Ticket, Time & Sales |
 * Positions/Orders + Portfolio/Risk, and the full-width simulation-clock
 * strip), "Tool identity" ("Layout placement is independent from domain
 * state") and "Docking" (Trading World is a normal side-pane surface — this
 * model owns the layout INSIDE the pane only; the outer shell's docking
 * stays untouched, ARCHITECTURE-LOCK A1/A2).
 *
 * Pure, serializable state machine in the v4 paneLayoutTree tradition:
 * the React shell (`../components/TradingWorldShell.tsx`) is a thin
 * projection over these functions; persistence lives in
 * `./cockpitLayoutPersistence.ts`.
 *
 * Model laws:
 * - A tool is a SINGLETON across the cockpit: at most one docked instance
 *   per tool id (open = docked; close = undocked).
 * - Panels are stable docking targets: they exist even when empty (drop
 *   targets / reserved regions), so persisted ratios never dangle.
 * - The simulation clock docks in the full-width clock strip; opening or
 *   closing it toggles the strip itself.
 * - Ratios are positive flex WEIGHTS, not normalized percentages — the
 *   renderer normalizes per group, so persistence never drifts.
 */

import type {
  TradingWorldToolId,
  TradingWorldToolRegistry,
} from "../registry/toolRegistry.js";

/** Stable docking-target ids (one per UX-DESIGN cockpit cell + the strip). */
export type TradingWorldPanelId =
  | "market" // left rail top: watchlist
  | "research" // left rail bottom: reserved (W008/W027)
  | "chart" // center top: main chart
  | "tape" // center bottom: time & sales
  | "book" // execution rail: DOM
  | "ticket" // execution rail: order ticket
  | "bookkeeping" // execution rail: positions/orders/fills tabs
  | "accounts" // execution rail: portfolio/risk tabs
  | "clock-strip"; // full-width simulation-clock strip

/** Cockpit columns (left → right), mirroring the UX-DESIGN default cockpit. */
export type TradingWorldColumnId = "market-rail" | "focus" | "execution";

/** Full-width bottom strip hosting the simulation clock. */
export const TRADING_WORLD_CLOCK_STRIP_TOOL: TradingWorldToolId = "simulation-clock";

/** Panel reserved for future research/calendar surfaces (W008/W027). */
export const TRADING_WORLD_EMPTY_PANEL_HINT =
  "Reserved dock — research/calendar surfaces register here in a later milestone.";

const RATIO_MIN = 0.05;
const RATIO_MAX = 20;
const RATIO_DEFAULT = 1;

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return RATIO_DEFAULT;
  }
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
}

/** One dock panel: an ordered tab stack of tools with one active tab. */
export interface TradingWorldPanelLayout {
  /** Stable docking target id (persistence key for stacks and ratios). */
  readonly id: TradingWorldPanelId;
  /** Flex weight within its column (renderer normalizes). */
  readonly heightRatio: number;
  /** Docked tool ids in tab order (singleton law across the cockpit). */
  readonly tools: readonly TradingWorldToolId[];
  /** Active tab of this panel; null when the panel holds no tools. */
  readonly activeToolId: TradingWorldToolId | null;
}

/** One cockpit column: a vertical stack of dock panels. */
export interface TradingWorldColumnLayout {
  readonly id: TradingWorldColumnId;
  /** Flex weight across the columns (renderer normalizes). */
  readonly widthRatio: number;
  /** Panels top → bottom. */
  readonly panels: readonly TradingWorldPanelLayout[];
}

/** The full-width simulation-clock strip (open/closed + height weight). */
export interface TradingWorldClockStripLayout {
  /** Open = simulation clock docked and visible. */
  readonly open: boolean;
  /** Flex weight of the strip against the columns area. */
  readonly heightRatio: number;
}

/** Persisted world-side cockpit layout (one per layout profile scope). */
export interface TradingWorldCockpitLayout {
  readonly schemaVersion: 1;
  readonly columns: readonly TradingWorldColumnLayout[];
  readonly clockStrip: TradingWorldClockStripLayout;
}

/** Build a panel (validation-light; profiles and normalizers use this). */
export function panel(
  id: TradingWorldPanelId,
  tools: readonly TradingWorldToolId[] = [],
  heightRatio = RATIO_DEFAULT,
): TradingWorldPanelLayout {
  return {
    id,
    heightRatio: clampRatio(heightRatio),
    tools: [...tools],
    activeToolId: tools.length > 0 ? tools[0]! : null,
  };
}

/** Build a column from panels. */
export function column(
  id: TradingWorldColumnId,
  panels: readonly TradingWorldPanelLayout[],
  widthRatio = RATIO_DEFAULT,
): TradingWorldColumnLayout {
  return { id, widthRatio: clampRatio(widthRatio), panels: [...panels] };
}

/** All tools currently docked anywhere (including the clock strip). */
export function listOpenToolIds(layout: TradingWorldCockpitLayout): TradingWorldToolId[] {
  const inPanels = layout.columns.flatMap((columnLayout) =>
    columnLayout.panels.flatMap((panelLayout) => panelLayout.tools),
  );
  return layout.clockStrip.open
    ? [...inPanels, TRADING_WORLD_CLOCK_STRIP_TOOL]
    : inPanels;
}

/** Panel id the tool is currently docked in; undefined when closed. */
export function findToolPanelId(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
): TradingWorldPanelId | undefined {
  if (toolId === TRADING_WORLD_CLOCK_STRIP_TOOL) {
    return layout.clockStrip.open ? "clock-strip" : undefined;
  }
  for (const columnLayout of layout.columns) {
    for (const panelLayout of columnLayout.panels) {
      if (panelLayout.tools.includes(toolId)) {
        return panelLayout.id;
      }
    }
  }
  return undefined;
}

/** True when the tool is docked (open) anywhere in the cockpit. */
export function isToolOpen(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
): boolean {
  return findToolPanelId(layout, toolId) !== undefined;
}

/**
 * Open (or focus) a tool. Already open → activates its tab in place. Closed
 * → docks into the panel the registry assigns (`descriptor.defaultPanel`),
 * appended last and activated. The clock tool toggles the strip open.
 */
export function openToolInCockpit(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
  registry: TradingWorldToolRegistry,
): TradingWorldCockpitLayout {
  if (toolId === TRADING_WORLD_CLOCK_STRIP_TOOL) {
    return layout.clockStrip.open
      ? layout
      : { ...layout, clockStrip: { ...layout.clockStrip, open: true } };
  }
  if (isToolOpen(layout, toolId)) {
    return activateToolInCockpit(layout, toolId);
  }
  const targetPanel = registry.getTool(toolId)?.defaultPanel;
  if (!targetPanel || targetPanel === "clock-strip" || !hasPanel(layout, targetPanel)) {
    // Defensive: registry default panel missing from this layout (stale
    // persisted layout) — keep the layout instead of silently dropping the
    // singleton invariant.
    return layout;
  }
  return mapPanel(layout, targetPanel, (panelLayout) => ({
    ...panelLayout,
    tools: [...panelLayout.tools, toolId],
    activeToolId: toolId,
  }));
}

/** Undock a tool. Neighbor tab takes over; panels survive as dock targets. */
export function closeToolInCockpit(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
): TradingWorldCockpitLayout {
  if (toolId === TRADING_WORLD_CLOCK_STRIP_TOOL) {
    return layout.clockStrip.open
      ? { ...layout, clockStrip: { ...layout.clockStrip, open: false } }
      : layout;
  }
  const panelId = findToolPanelId(layout, toolId);
  if (!panelId) {
    return layout;
  }
  return mapPanel(layout, panelId, (panelLayout) => {
    const tools = panelLayout.tools.filter((tool) => tool !== toolId);
    return {
      ...panelLayout,
      tools,
      activeToolId:
        panelLayout.activeToolId === toolId ? (tools[0] ?? null) : panelLayout.activeToolId,
    };
  });
}

/** Make a docked tool the active tab of its panel (no-op when closed). */
export function activateToolInCockpit(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
): TradingWorldCockpitLayout {
  const panelId = findToolPanelId(layout, toolId);
  if (!panelId || panelId === "clock-strip") {
    return layout;
  }
  return mapPanel(layout, panelId, (panelLayout) =>
    panelLayout.activeToolId === toolId
      ? panelLayout
      : { ...panelLayout, activeToolId: toolId },
  );
}

/**
 * Move a docked tool to another panel (in-pane re-docking; the model is
 * drag-ready, the shell may expose it via menu/drag in later work orders).
 * Unknown target panels are no-ops; the source panel's neighbor activates.
 */
export function moveToolInCockpit(
  layout: TradingWorldCockpitLayout,
  toolId: TradingWorldToolId,
  toPanelId: TradingWorldPanelId,
  toIndex?: number,
): TradingWorldCockpitLayout {
  if (toolId === TRADING_WORLD_CLOCK_STRIP_TOOL || toPanelId === "clock-strip") {
    return layout;
  }
  const fromPanelId = findToolPanelId(layout, toolId);
  if (!fromPanelId || !hasPanel(layout, toPanelId)) {
    return layout;
  }
  // 1) Undock from the source panel (neighbor tab takes over).
  const withoutTool = mapPanel(layout, fromPanelId, (panelLayout) => {
    const tools = panelLayout.tools.filter((tool) => tool !== toolId);
    return {
      ...panelLayout,
      tools,
      activeToolId:
        panelLayout.activeToolId === toolId ? (tools[0] ?? null) : panelLayout.activeToolId,
    };
  });
  // 2) Dock into the target panel at the requested index (last by default).
  return mapPanel(withoutTool, toPanelId, (panelLayout) => {
    const tools = [...panelLayout.tools];
    const insertAt =
      toIndex === undefined
        ? tools.length
        : Math.min(Math.max(0, toIndex), tools.length);
    tools.splice(insertAt, 0, toolId);
    return { ...panelLayout, tools, activeToolId: toolId };
  });
}

/** Set one column's width weight (clamped; renderer normalizes). */
export function setColumnWidthRatio(
  layout: TradingWorldCockpitLayout,
  columnId: TradingWorldColumnId,
  ratio: number,
): TradingWorldCockpitLayout {
  return mapColumn(layout, columnId, (columnLayout) => ({
    ...columnLayout,
    widthRatio: clampRatio(ratio),
  }));
}

/** Batch-set column weights from a resizable-group layout change. */
export function setColumnWidthRatios(
  layout: TradingWorldCockpitLayout,
  ratios: Readonly<Record<string, number>>,
): TradingWorldCockpitLayout {
  let next = layout;
  for (const [columnId, ratio] of Object.entries(ratios)) {
    if (isTradingWorldColumnId(columnId)) {
      next = setColumnWidthRatio(next, columnId, ratio);
    }
  }
  return next;
}

/** Set one panel's height weight inside its column (clamped). */
export function setPanelHeightRatio(
  layout: TradingWorldCockpitLayout,
  panelId: TradingWorldPanelId,
  ratio: number,
): TradingWorldCockpitLayout {
  return mapPanel(layout, panelId, (panelLayout) => ({
    ...panelLayout,
    heightRatio: clampRatio(ratio),
  }));
}

/** Batch-set the panel weights of one column from a group layout change. */
export function setPanelHeightRatios(
  layout: TradingWorldCockpitLayout,
  columnId: TradingWorldColumnId,
  ratios: Readonly<Record<string, number>>,
): TradingWorldCockpitLayout {
  return mapColumn(layout, columnId, (columnLayout) => ({
    ...columnLayout,
    panels: columnLayout.panels.map((panelLayout) =>
      ratios[panelLayout.id] === undefined
        ? panelLayout
        : { ...panelLayout, heightRatio: clampRatio(ratios[panelLayout.id]!) },
    ),
  }));
}

/** Open/close the clock strip (docks/undocks the simulation clock). */
export function setClockStripOpen(
  layout: TradingWorldCockpitLayout,
  open: boolean,
): TradingWorldCockpitLayout {
  return { ...layout, clockStrip: { ...layout.clockStrip, open } };
}

/** Set the clock strip's height weight (clamped). */
export function setClockStripHeightRatio(
  layout: TradingWorldCockpitLayout,
  ratio: number,
): TradingWorldCockpitLayout {
  return { ...layout, clockStrip: { ...layout.clockStrip, heightRatio: clampRatio(ratio) } };
}

/** Deep-fresh copy (reset point for "reset layout"). */
export function resetCockpitLayout(
  base: TradingWorldCockpitLayout,
): TradingWorldCockpitLayout {
  return {
    schemaVersion: 1,
    columns: base.columns.map((columnLayout) => ({
      ...columnLayout,
      panels: columnLayout.panels.map((panelLayout) => ({ ...panelLayout })),
    })),
    clockStrip: { ...base.clockStrip },
  };
}

function mapColumn(
  layout: TradingWorldCockpitLayout,
  columnId: TradingWorldColumnId,
  update: (columnLayout: TradingWorldColumnLayout) => TradingWorldColumnLayout,
): TradingWorldCockpitLayout {
  let changed = false;
  const columns = layout.columns.map((columnLayout) => {
    if (columnLayout.id !== columnId) {
      return columnLayout;
    }
    const next = update(columnLayout);
    changed = changed || next !== columnLayout;
    return next;
  });
  // No-op updates keep the SAME state object (stable snapshots for
  // useSyncExternalStore; no spurious notifications).
  return changed ? { ...layout, columns } : layout;
}

function mapPanel(
  layout: TradingWorldCockpitLayout,
  panelId: TradingWorldPanelId,
  update: (panelLayout: TradingWorldPanelLayout) => TradingWorldPanelLayout,
): TradingWorldCockpitLayout {
  let changed = false;
  const columns = layout.columns.map((columnLayout) => {
    let columnChanged = false;
    const panels = columnLayout.panels.map((panelLayout) => {
      if (panelLayout.id !== panelId) {
        return panelLayout;
      }
      const next = update(panelLayout);
      if (next !== panelLayout) {
        columnChanged = true;
        changed = true;
      }
      return next;
    });
    return columnChanged ? { ...columnLayout, panels } : columnLayout;
  });
  // No-op updates keep the SAME state object (stable snapshots for
  // useSyncExternalStore; no spurious notifications).
  return changed ? { ...layout, columns } : layout;
}

function isTradingWorldColumnId(value: string): value is TradingWorldColumnId {
  return value === "market-rail" || value === "focus" || value === "execution";
}

/** True when the cockpit has a panel with this id (docking target exists). */
function hasPanel(
  layout: TradingWorldCockpitLayout,
  panelId: TradingWorldPanelId,
): boolean {
  return layout.columns.some((columnLayout) =>
    columnLayout.panels.some((panelLayout) => panelLayout.id === panelId),
  );
}
