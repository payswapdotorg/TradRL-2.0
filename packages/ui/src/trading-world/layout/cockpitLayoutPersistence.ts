/**
 * Trading World cockpit layout persistence — W006.
 *
 * Persistence path for the world-side (in-pane) layout: the outer shell
 * persists the TAB (including the opaque `layoutProfileId`, W005); Trading
 * World itself persists the user's layout ADJUSTMENTS per
 * (workspaceKey, layoutProfileId) scope — which tools are docked where,
 * active tabs, and column/panel weights.
 *
 * Laws (following the existing v4 paneLayoutPersistence discipline):
 * - localStorage with silent try/catch degradation and an in-memory fallback
 *   (SSR, tests, blocked storage never crash the pane).
 * - Corrupted or foreign data is discarded WHOLESALE and the declarative
 *   profile base (`./layoutProfiles.ts`) takes over — no partial rescue.
 * - Layout placement is UI preference, never domain state (UX-DESIGN "Tool
 *   identity"); world truth lives in the engine, not in this store.
 */

import {
  resetCockpitLayout,
  type TradingWorldCockpitLayout,
  type TradingWorldColumnId,
  type TradingWorldColumnLayout,
  type TradingWorldPanelId,
  type TradingWorldPanelLayout,
} from "./cockpitLayout.js";
import type { TradingWorldToolId } from "../registry/toolRegistry.js";

const STORAGE_KEY_PREFIX = "tradrl-cockpit-layout:v1";
const PANEL_IDS: readonly TradingWorldPanelId[] = [
  "market",
  "research",
  "chart",
  "tape",
  "book",
  "ticket",
  "bookkeeping",
  "accounts",
];
const COLUMN_IDS: readonly TradingWorldColumnId[] = ["market-rail", "focus", "execution"];

/** Minimal storage surface (localStorage-shaped; injectable for tests). */
export interface CockpitLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory storage fallback (also the test double). */
export function createInMemoryCockpitLayoutStorage(): CockpitLayoutStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** Browser storage: localStorage when available, memory otherwise. */
export function createBrowserCockpitLayoutStorage(): CockpitLayoutStorage {
  try {
    if (typeof localStorage === "undefined") {
      return createInMemoryCockpitLayoutStorage();
    }
    const probeKey = `${STORAGE_KEY_PREFIX}:probe`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    return localStorage;
  } catch {
    return createInMemoryCockpitLayoutStorage();
  }
}

/** Storage scope: the pane tab's (workspaceKey, layoutProfileId) pair. */
export function cockpitLayoutStorageKey(
  workspaceKey: string,
  layoutProfileId: string,
): string {
  return [
    STORAGE_KEY_PREFIX,
    encodeURIComponent(workspaceKey),
    encodeURIComponent(layoutProfileId),
  ].join(":");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeRatio(value: unknown): number | null {
  return isNumber(value) && value > 0 ? value : null;
}

function normalizePanel(
  raw: unknown,
  seenTools: Set<string>,
  knownToolIds: ReadonlySet<string> | undefined,
): TradingWorldPanelLayout | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !PANEL_IDS.includes(record.id as TradingWorldPanelId)) {
    return null;
  }
  const heightRatio = normalizeRatio(record.heightRatio);
  if (heightRatio === null) {
    return null;
  }
  if (!Array.isArray(record.tools)) {
    return null;
  }
  const tools: TradingWorldToolId[] = [];
  for (const tool of record.tools) {
    if (
      typeof tool === "string" &&
      !seenTools.has(tool) &&
      (knownToolIds === undefined || knownToolIds.has(tool))
    ) {
      seenTools.add(tool);
      tools.push(tool as TradingWorldToolId);
    }
  }
  const activeToolId =
    typeof record.activeToolId === "string" && tools.includes(record.activeToolId as TradingWorldToolId)
      ? (record.activeToolId as TradingWorldToolId)
      : (tools[0] ?? null);
  return { id: record.id as TradingWorldPanelId, heightRatio, tools, activeToolId };
}

function normalizeColumn(
  raw: unknown,
  seenTools: Set<string>,
  knownToolIds: ReadonlySet<string> | undefined,
): TradingWorldColumnLayout | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !COLUMN_IDS.includes(record.id as TradingWorldColumnId)) {
    return null;
  }
  const widthRatio = normalizeRatio(record.widthRatio);
  if (widthRatio === null || !Array.isArray(record.panels)) {
    return null;
  }
  const panels: TradingWorldPanelLayout[] = [];
  for (const rawPanel of record.panels) {
    const normalizedPanel = normalizePanel(rawPanel, seenTools, knownToolIds);
    if (normalizedPanel) {
      panels.push(normalizedPanel);
    }
  }
  if (panels.length === 0) {
    return null;
  }
  return { id: record.id as TradingWorldColumnId, widthRatio, panels };
}

/**
 * Sanitize a persisted (or foreign) layout. Returns null when the shape is
 * not a valid v1 cockpit layout (callers fall back to the profile base);
 * unknown tools and duplicate dockings are filtered (registry evolution),
 * but STRUCTURAL corruption — unknown column/panel ids, non-positive
 * ratios — discards the layout wholesale (the paneLayoutPersistence law:
 * no partial rescue).
 */
export function normalizeCockpitLayout(
  raw: unknown,
  options?: { readonly knownToolIds?: ReadonlySet<string> },
): TradingWorldCockpitLayout | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.columns)) {
    return null;
  }
  const clockStripRaw = record.clockStrip;
  if (
    typeof clockStripRaw !== "object" ||
    clockStripRaw === null ||
    typeof (clockStripRaw as Record<string, unknown>).open !== "boolean"
  ) {
    return null;
  }
  const clockHeight = normalizeRatio((clockStripRaw as Record<string, unknown>).heightRatio);
  if (clockHeight === null) {
    return null;
  }
  const seenTools = new Set<string>();
  const columns: TradingWorldColumnLayout[] = [];
  for (const rawColumn of record.columns) {
    const normalizedColumn = normalizeColumn(rawColumn, seenTools, options?.knownToolIds);
    if (!normalizedColumn) {
      return null;
    }
    columns.push(normalizedColumn);
  }
  if (columns.length === 0) {
    return null;
  }
  return {
    schemaVersion: 1,
    columns,
    clockStrip: {
      open: (clockStripRaw as Record<string, unknown>).open as boolean,
      heightRatio: clockHeight,
    },
  };
}

/** Observable store bound to one storage scope (useSyncExternalStore-ready). */
export interface TradingWorldCockpitLayoutStore {
  /** Current snapshot (referentially stable between setState calls). */
  getState(): TradingWorldCockpitLayout;
  /** Server-render snapshot (never hydrates storage). */
  getServerState(): TradingWorldCockpitLayout;
  /** Persist + notify (storage failures degrade silently to memory). */
  setState(next: TradingWorldCockpitLayout): void;
  subscribe(listener: () => void): () => void;
}

export interface CockpitLayoutStoreOptions {
  readonly storage: CockpitLayoutStorage;
  readonly storageKey: string;
  /** Profile base used when nothing (valid) is persisted yet. */
  readonly fallback: TradingWorldCockpitLayout;
  /** Registry-known tool ids; persisted unknown tools are dropped. */
  readonly knownToolIds?: ReadonlySet<string>;
}

/** Create an isolated store (tests embed their own storage). */
export function createCockpitLayoutStore(
  options: CockpitLayoutStoreOptions,
): TradingWorldCockpitLayoutStore {
  const serverState = resetCockpitLayout(options.fallback);
  let state: TradingWorldCockpitLayout = serverState;
  let hydrated = false;
  const listeners = new Set<() => void>();
  const hydrate = () => {
    if (hydrated) {
      return;
    }
    hydrated = true;
    try {
      const raw = options.storage.getItem(options.storageKey);
      if (raw === null) {
        return;
      }
      const normalized = normalizeCockpitLayout(safeParse(raw), {
        knownToolIds: options.knownToolIds,
      });
      if (normalized) {
        state = normalized;
      }
    } catch {
      // Corrupt storage degrades to the profile base.
    }
  };
  return {
    getState: () => {
      hydrate();
      return state;
    },
    getServerState: () => serverState,
    setState: (next) => {
      state = next;
      try {
        options.storage.setItem(options.storageKey, JSON.stringify(next));
      } catch {
        // Storage full/blocked: keep the in-memory state usable.
      }
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function safeParse(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

const sharedStores = new Map<string, TradingWorldCockpitLayoutStore>();
let sharedStorage: CockpitLayoutStorage | undefined;

/**
 * Shared store per storage scope: every mounted Trading World shell with the
 * same (workspaceKey, layoutProfileId) observes the same layout live (same
 * window), and all shells persist through the browser storage.
 */
export function getSharedCockpitLayoutStore(
  storageKey: string,
  fallback: TradingWorldCockpitLayout,
  knownToolIds?: ReadonlySet<string>,
): TradingWorldCockpitLayoutStore {
  const existing = sharedStores.get(storageKey);
  if (existing) {
    return existing;
  }
  sharedStorage ??= createBrowserCockpitLayoutStorage();
  const store = createCockpitLayoutStore({
    storage: sharedStorage,
    storageKey,
    fallback,
    knownToolIds,
  });
  sharedStores.set(storageKey, store);
  return store;
}

/** Test/teardown helper: forget shared stores (never used by the shell). */
export function clearSharedCockpitLayoutStores(): void {
  sharedStores.clear();
}
