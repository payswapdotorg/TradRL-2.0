/**
 * Trading World preset catalogue validation — W029.
 *
 * The catalogue (./catalogue.ts) is fail-closed: every entry is validated
 * when that module loads, and a violation throws a LOUD typed error naming
 * the preset and the violated law — never a silent default, never a bricked
 * layout. (The other half of the law — unknown ids never brick the pane —
 * lives in ./resolve.ts; this file guards the curated data itself.)
 *
 * Laws (each name is the thrown error's `law` field): known-panel-ids,
 * known-column-ids, unique-panel-ids, unique-column-ids (W006's stable
 * docking targets, each at most once); ratio-bounds (finite, inside
 * [TRADING_WORLD_RATIO_MIN, TRADING_WORLD_RATIO_MAX] — the ../layout
 * builders clamp runtime input silently, but curated data must already be
 * in bounds); clock-strip (present, boolean open, in-bounds height) and
 * clock-strip-tool-ownership (the simulation clock tool belongs to the
 * strip, never a column panel); singleton-tools (one dock per tool);
 * registered-tools (only core registry ids — the shell silently filters
 * unknowns on hydrate, so a typo would silently drop a tool);
 * active-tool-first-tab; risk-visibility (R044: a bookkeeping/accounts
 * panel carries tools); schema-version; columns-present; shape laws;
 * profile/preset field laws; unique-preset-ids; reserved-default-id
 * ("default" is W006's); catalogue-nonempty.
 *
 * Pure functions only (R043): no side effects, no clocks, no randomness,
 * no environment reads.
 */

import {
  TRADING_WORLD_CLOCK_STRIP_TOOL,
  type TradingWorldCockpitLayout,
  type TradingWorldColumnId,
  type TradingWorldPanelId,
} from "../layout/cockpitLayout.js";
import {
  DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
  type TradingWorldLayoutProfile,
} from "../layout/layoutProfiles.js";
import { TRADING_WORLD_CORE_TOOL_IDS } from "../registry/toolRegistry.js";
import type { TradingWorldLayoutPreset } from "./catalogue.js";

/** The nine stable W006 panel ids (docking targets are never invented). */
export const TRADING_WORLD_PANEL_IDS: readonly TradingWorldPanelId[] = [
  "market",
  "research",
  "chart",
  "tape",
  "book",
  "ticket",
  "bookkeeping",
  "accounts",
  "clock-strip",
] as const;

/** The three stable W006 column ids. */
export const TRADING_WORLD_COLUMN_IDS: readonly TradingWorldColumnId[] = [
  "market-rail",
  "focus",
  "execution",
] as const;

/**
 * Flex-ratio bounds for catalogue data. These mirror the (module-private)
 * clamp bounds inside ../layout/cockpitLayout.ts: runtime user input is
 * clamped silently, but curated preset ratios must already be in bounds so
 * the clamp never has to fire on catalogue data.
 */
export const TRADING_WORLD_RATIO_MIN = 0.05;
export const TRADING_WORLD_RATIO_MAX = 20;

/** LOUD, typed construction-time violation: names the preset + the law. */
export class TradingWorldPresetValidationError extends Error {
  constructor(
    readonly presetId: string,
    readonly law: string,
    readonly detail: string,
  ) {
    super(
      `W029 preset catalogue violation — preset "${presetId}" breaks the ${law} law: ${detail}`,
    );
    this.name = "TradingWorldPresetValidationError";
  }
}

const KNOWN_PANEL_IDS: readonly string[] = TRADING_WORLD_PANEL_IDS;
const KNOWN_COLUMN_IDS: readonly string[] = TRADING_WORLD_COLUMN_IDS;
const CORE_TOOL_ID_SET: ReadonlySet<string> = new Set<string>(
  TRADING_WORLD_CORE_TOOL_IDS,
);

function fail(presetId: string, law: string, detail: string): never {
  throw new TradingWorldPresetValidationError(presetId, law, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function assertRatioInBounds(
  presetId: string,
  what: string,
  value: unknown,
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < TRADING_WORLD_RATIO_MIN ||
    value > TRADING_WORLD_RATIO_MAX
  ) {
    fail(
      presetId,
      "ratio-bounds",
      `${what} ratio ${describeValue(value)} is out of bounds [${TRADING_WORLD_RATIO_MIN}, ${TRADING_WORLD_RATIO_MAX}]`,
    );
  }
}

interface PanelScan {
  readonly seenPanelIds: Set<string>;
  readonly toolOwners: Map<string, string>;
  readonly fedRiskPanels: string[];
}

function validatePanelEntry(
  presetId: string,
  entry: unknown,
  scan: PanelScan,
): void {
  if (!isObject(entry)) {
    fail(presetId, "panel-shape", "a panel entry is not an object");
  }
  const panelId = entry.id;
  if (typeof panelId !== "string" || !KNOWN_PANEL_IDS.includes(panelId)) {
    fail(
      presetId,
      "known-panel-ids",
      `unknown panel id ${describeValue(panelId)} — panels are the nine stable W006 docking targets`,
    );
  }
  if (scan.seenPanelIds.has(panelId)) {
    fail(
      presetId,
      "unique-panel-ids",
      `panel "${panelId}" is docked in two columns — each docking target appears once`,
    );
  }
  scan.seenPanelIds.add(panelId);
  assertRatioInBounds(presetId, `panel "${panelId}" height`, entry.heightRatio);

  const tools: unknown = entry.tools;
  if (!Array.isArray(tools)) {
    fail(presetId, "panel-shape", `panel "${panelId}" tools is not an array`);
  }
  let firstTool: string | null = null;
  let index = 0;
  for (const tool of tools) {
    if (typeof tool !== "string" || tool.length === 0) {
      fail(
        presetId,
        "panel-shape",
        `panel "${panelId}" carries a non-string tool entry`,
      );
    }
    if (tool === TRADING_WORLD_CLOCK_STRIP_TOOL) {
      fail(
        presetId,
        "clock-strip-tool-ownership",
        `the simulation clock tool is owned by the full-width clock strip, never the "${panelId}" panel`,
      );
    }
    if (!CORE_TOOL_ID_SET.has(tool)) {
      fail(
        presetId,
        "registered-tools",
        `tool "${tool}" is not a registered core tool id — the shell silently filters unknown tool ids, so the catalogue must not author them`,
      );
    }
    const firstOwner = scan.toolOwners.get(tool);
    if (firstOwner !== undefined) {
      fail(
        presetId,
        "singleton-tools",
        `tool "${tool}" is docked twice (panels "${firstOwner}" and "${panelId}") — one dock per tool`,
      );
    }
    scan.toolOwners.set(tool, panelId);
    if (index === 0) {
      firstTool = tool;
    }
    index += 1;
  }
  if (entry.activeToolId !== firstTool) {
    fail(
      presetId,
      "active-tool-first-tab",
      `panel "${panelId}" activeToolId ${describeValue(entry.activeToolId)} must be its first tab ${describeValue(firstTool)} — catalogue panels reset to the first tab`,
    );
  }
  if (
    (panelId === "bookkeeping" || panelId === "accounts") &&
    tools.length > 0
  ) {
    scan.fedRiskPanels.push(panelId);
  }
}

/**
 * Validate a cockpit layout's structure against the catalogue laws. Throws
 * {@link TradingWorldPresetValidationError} naming `presetId` on any
 * violation; runtime-shape checks are defensive so tests (and future
 * tooling) can feed malformed objects directly.
 */
export function validateTradingWorldCockpitLayout(
  presetId: string,
  layout: TradingWorldCockpitLayout,
): void {
  const root: unknown = layout;
  if (!isObject(root)) {
    fail(presetId, "layout-shape", "cockpit layout is missing or not an object");
  }
  if (root.schemaVersion !== 1) {
    fail(
      presetId,
      "schema-version",
      `expected schemaVersion 1, got ${describeValue(root.schemaVersion)}`,
    );
  }
  const columns: unknown = root.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    fail(presetId, "columns-present", "the layout must carry at least one column");
  }

  const scan: PanelScan = {
    seenPanelIds: new Set<string>(),
    toolOwners: new Map<string, string>(),
    fedRiskPanels: [],
  };
  const seenColumnIds = new Set<string>();
  for (const columnEntry of columns) {
    if (!isObject(columnEntry)) {
      fail(presetId, "column-shape", "a column entry is not an object");
    }
    const columnId = columnEntry.id;
    if (typeof columnId !== "string" || !KNOWN_COLUMN_IDS.includes(columnId)) {
      fail(
        presetId,
        "known-column-ids",
        `unknown column id ${describeValue(columnId)} — columns are the three stable W006 docking targets`,
      );
    }
    if (seenColumnIds.has(columnId)) {
      fail(
        presetId,
        "unique-column-ids",
        `column "${columnId}" appears twice — each docking target appears once`,
      );
    }
    seenColumnIds.add(columnId);
    assertRatioInBounds(
      presetId,
      `column "${columnId}" width`,
      columnEntry.widthRatio,
    );
    const panels: unknown = columnEntry.panels;
    if (!Array.isArray(panels)) {
      fail(presetId, "column-shape", `column "${columnId}" panels is not an array`);
    }
    for (const panelEntry of panels) {
      validatePanelEntry(presetId, panelEntry, scan);
    }
  }

  const strip: unknown = root.clockStrip;
  if (!isObject(strip)) {
    fail(presetId, "clock-strip", "the clock strip is missing from the layout");
  }
  if (typeof strip.open !== "boolean") {
    fail(
      presetId,
      "clock-strip",
      `clockStrip.open must be a boolean, got ${describeValue(strip.open)}`,
    );
  }
  assertRatioInBounds(presetId, "clock strip height", strip.heightRatio);

  if (scan.fedRiskPanels.length === 0) {
    fail(
      presetId,
      "risk-visibility (R044)",
      "neither the bookkeeping nor the accounts panel carries tools — critical order/risk visibility would be hidden",
    );
  }
}

/** Validate the W006 profile fields (id, label) plus the layout laws. */
export function validateTradingWorldLayoutProfile(
  profile: TradingWorldLayoutProfile,
): void {
  const candidate: unknown = profile;
  if (!isObject(candidate)) {
    fail("<unnamed>", "profile-shape", "profile is not an object");
  }
  const presetId =
    typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : "<unnamed>";
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    fail(presetId, "profile-id", "profile id must be a non-empty string");
  }
  if (typeof candidate.label !== "string" || candidate.label.length === 0) {
    fail(presetId, "profile-label", "profile label must be a non-empty string");
  }
  validateTradingWorldCockpitLayout(
    presetId,
    candidate.layout as TradingWorldCockpitLayout,
  );
}

/** Validate a catalogue preset: profile laws + persona/rationale presence. */
export function validateTradingWorldLayoutPreset(
  preset: TradingWorldLayoutPreset,
): void {
  const candidate: unknown = preset;
  if (!isObject(candidate)) {
    fail("<unnamed>", "preset-shape", "preset entry is not an object");
  }
  const presetId =
    typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : "<unnamed>";
  validateTradingWorldLayoutProfile(preset);
  if (typeof candidate.persona !== "string" || candidate.persona.length === 0) {
    fail(
      presetId,
      "preset-persona",
      "preset persona must be a non-empty string (the persona the arrangement serves)",
    );
  }
  if (
    typeof candidate.rationale !== "string" ||
    candidate.rationale.length === 0
  ) {
    fail(
      presetId,
      "preset-rationale",
      "preset rationale must be a non-empty string (design judgment is documented per preset)",
    );
  }
}

/**
 * Validate a whole preset catalogue: every entry passes the preset laws,
 * ids are unique, "default" is never shadowed, and the catalogue is not
 * empty (an empty catalogue would silently degrade every preset id to the
 * default profile — a silent default, not a law).
 */
export function assertValidTradingWorldPresetCatalogue(
  presets: readonly TradingWorldLayoutPreset[],
): void {
  const entries: unknown = presets;
  if (!Array.isArray(entries)) {
    fail("<catalogue>", "catalogue-shape", "preset catalogue is not an array");
  }
  if (entries.length === 0) {
    fail(
      "<catalogue>",
      "catalogue-nonempty",
      "the preset catalogue must carry at least one entry",
    );
  }
  const seenIds = new Set<string>();
  for (const entry of entries) {
    const candidate: unknown = entry;
    if (!isObject(candidate)) {
      fail("<catalogue>", "catalogue-shape", "a catalogue entry is not an object");
    }
    const id =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : "<unnamed>";
    validateTradingWorldLayoutPreset(entry);
    if (seenIds.has(id)) {
      fail(id, "unique-preset-ids", `preset id "${id}" appears twice in the catalogue`);
    }
    seenIds.add(id);
    if (id === DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID) {
      fail(
        id,
        "reserved-default-id",
        `"default" is W006's canonical profile id and may not be shadowed by a catalogue preset`,
      );
    }
  }
}
