/**
 * Trading World layout presets / workspace profiles — W029.
 *
 * Spec: spec/UX-DESIGN.md "Presets" — "Presets are declarative
 * configurations" (R043). The eight-entry catalogue (Day Trader / Execution /
 * Research / Portfolio / Risk / Quant / Market Maker / RL Training) is PURE
 * DATA: no React, no hooks, no side effects, no clocks, no randomness, no
 * environment reads — only the ../layout panel()/column() builders composed
 * into cockpit shapes.
 *
 * Every preset starts from W006's canonical default trader cockpit
 * (../layout/layoutProfiles.ts) and rearranges tool placement, tab order and
 * flex ratios for its persona. Panels are stable docking targets: only the
 * nine existing panel ids and three existing column ids appear, and the
 * simulation clock tool stays owned by the full-width clock strip
 * (layout.clockStrip), never docked in a column panel. Each preset docks
 * every core panel tool exactly once (the singleton law) — presets
 * re-WEIGHT surfaces, they never drop them.
 *
 * R044 is structural here: every preset keeps critical order/risk
 * visibility — the bookkeeping AND accounts panels carry tools in all eight
 * entries (validation enforces at-least-one; the catalogue ships both).
 *
 * The catalogue is validated fail-closed at module load (./validate.ts) and
 * then deep-frozen: a corrupt entry throws during import (never a silent
 * default), and no consumer can mutate the shared preset data, so twin
 * resolutions stay deep-equal forever (A9 determinism).
 */

import { column, panel } from "../layout/cockpitLayout.js";
import type { TradingWorldLayoutProfile } from "../layout/layoutProfiles.js";
import { assertValidTradingWorldPresetCatalogue } from "./validate.js";

/**
 * A W029 catalogue entry: a W006 layout profile plus the persona it serves
 * and the one-line design rationale for its arrangement (the composition is
 * W029's design judgment, documented per preset).
 */
export interface TradingWorldLayoutPreset extends TradingWorldLayoutProfile {
  /** The persona the arrangement serves (one line). */
  readonly persona: string;
  /** What the arrangement optimizes for (one line). */
  readonly rationale: string;
}

/** Day Trader — intraday momentum; order-flow dominance (tape/DOM/ticket). */
const dayTraderPreset: TradingWorldLayoutPreset = {
  id: "day-trader",
  label: "Day Trader",
  persona:
    "Intraday momentum trader working the open; lives in the tape and the DOM.",
  rationale:
    "Order-flow dominance: tall tape, DOM and ticket; compressed chart and narrow rail; fills-first blotter and risk-first accounts keep R044 visibility at speed.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 4), panel("research", [], 1)],
        1.4,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 2), panel("tape", ["time-and-sales"], 3)],
        4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 4),
          panel("ticket", ["order-ticket"], 4),
          panel("bookkeeping", ["fills", "positions", "working-orders"], 2),
          panel("accounts", ["risk", "portfolio"], 2),
        ],
        4.6,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** Execution — parent-order desk; ticket + blotter dominance. */
const executionPreset: TradingWorldLayoutPreset = {
  id: "execution",
  label: "Execution",
  persona:
    "Execution desk working large parent orders inside tight slippage budgets.",
  rationale:
    "Ticket and blotter dominance: working-orders-first bookkeeping at double weight and the tallest ticket; DOM kept for depth while chart and tape stay background context.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 2), panel("research", [], 1)],
        1.8,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 2), panel("tape", ["time-and-sales"], 2)],
        3.4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 3),
          panel("ticket", ["order-ticket"], 5),
          panel("bookkeeping", ["working-orders", "fills", "positions"], 4),
          panel("accounts", ["portfolio", "risk"], 3),
        ],
        4.8,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** Research — price-discovery focus: widest focus column, tall research dock. */
const researchPreset: TradingWorldLayoutPreset = {
  id: "research",
  label: "Research",
  persona: "Analyst studying structure and levels before committing capital.",
  rationale:
    "Maximum price-discovery focus: the widest focus column at a 5:1 chart-to-tape ratio plus a tall reserved research dock for future W027 surfaces; execution minimized but never hidden.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 2), panel("research", [], 3)],
        2.4,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 5), panel("tape", ["time-and-sales"], 1)],
        5.2,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 2),
          panel("ticket", ["order-ticket"], 1),
          panel("bookkeeping", ["positions", "working-orders", "fills"], 2),
          panel("accounts", ["portfolio", "risk"], 2),
        ],
        2.4,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** Portfolio — accounts-first: dominant portfolio/risk panel. */
const portfolioPreset: TradingWorldLayoutPreset = {
  id: "portfolio",
  label: "Portfolio",
  persona:
    "Portfolio manager tracking exposure, P&L and rebalancing across books.",
  rationale:
    "Accounts-first: the dominant surface is the portfolio/risk panel over a positions-heavy blotter; chart as context while DOM and ticket shrink to one weight each (still present).",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 2), panel("research", [], 1)],
        2.2,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 2), panel("tape", ["time-and-sales"], 1)],
        4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 1),
          panel("ticket", ["order-ticket"], 1),
          panel("bookkeeping", ["positions", "fills", "working-orders"], 3),
          panel("accounts", ["portfolio", "risk"], 4),
        ],
        3.8,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** Risk — risk state as the primary surface. */
const riskPreset: TradingWorldLayoutPreset = {
  id: "risk",
  label: "Risk",
  persona: "Risk manager monitoring limits, exposure and drawdown in real time.",
  rationale:
    "Risk state as the primary surface: the tallest panel in the catalogue is accounts with the risk tab first; working orders and positions stay one glance away in the blotter.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 2), panel("research", [], 1)],
        2,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 2), panel("tape", ["time-and-sales"], 2)],
        3.6,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 1),
          panel("ticket", ["order-ticket"], 1),
          panel("bookkeeping", ["working-orders", "positions", "fills"], 3),
          panel("accounts", ["risk", "portfolio"], 5),
        ],
        4.4,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** Quant — data density: balanced chart/tape, tall research dock, doubled strip. */
const quantPreset: TradingWorldLayoutPreset = {
  id: "quant",
  label: "Quant",
  persona: "Quantitative researcher validating signal behavior against live data.",
  rationale:
    "Data density: balanced chart and tape, a deep DOM, the tallest reserved research dock, and a doubled clock strip for the simulation timeline.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 2), panel("research", [], 4)],
        2.6,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 3), panel("tape", ["time-and-sales"], 3)],
        4.4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 3),
          panel("ticket", ["order-ticket"], 1),
          panel("bookkeeping", ["fills", "positions", "working-orders"], 2),
          panel("accounts", ["portfolio", "risk"], 2),
        ],
        3,
      ),
    ],
    clockStrip: { open: true, heightRatio: 2 },
  },
};

/** Market Maker — DOM and tape as the primary instruments. */
const marketMakerPreset: TradingWorldLayoutPreset = {
  id: "market-maker",
  label: "Market Maker",
  persona:
    "Market maker quoting two-sided markets; DOM depth is the workstation.",
  rationale:
    "DOM and tape as the primary instruments (5:4 weights) with the chart compressed; mid-size ticket for quoting, working-orders-first blotter for open quotes, risk-first accounts.",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 3), panel("research", [], 1)],
        1.6,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 1), panel("tape", ["time-and-sales"], 4)],
        4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 5),
          panel("ticket", ["order-ticket"], 3),
          panel("bookkeeping", ["working-orders", "positions", "fills"], 3),
          panel("accounts", ["risk", "portfolio"], 2),
        ],
        4.4,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  },
};

/** RL Training — the training loop as the workstation: tallest clock strip. */
const rlTrainingPreset: TradingWorldLayoutPreset = {
  id: "rl-training",
  label: "RL Training",
  persona: "RL training operator watching the simulation loop learn to trade.",
  rationale:
    "The training loop as the workstation: the tallest clock strip (the experiment heartbeat) over state surfaces (watchlist/chart/tape) balanced with action (ticket) and reward (fills/portfolio).",
  layout: {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 3), panel("research", [], 2)],
        2,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 3), panel("tape", ["time-and-sales"], 2)],
        4,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 2),
          panel("ticket", ["order-ticket"], 3),
          panel("bookkeeping", ["positions", "fills", "working-orders"], 2),
          panel("accounts", ["portfolio", "risk"], 2),
        ],
        4,
      ),
    ],
    clockStrip: { open: true, heightRatio: 3 },
  },
};

/** The eight-entry W029 catalogue (UX-DESIGN "Presets", order fixed). */
const PRESETS: readonly TradingWorldLayoutPreset[] = [
  dayTraderPreset,
  executionPreset,
  researchPreset,
  portfolioPreset,
  riskPreset,
  quantPreset,
  marketMakerPreset,
  rlTrainingPreset,
];

// Fail-closed at module load: a corrupt entry aborts this import with a
// loud typed error naming the preset and the law — never a silent default.
assertValidTradingWorldPresetCatalogue(PRESETS);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      deepFreeze(record[key]);
    }
  }
  return value;
}

/**
 * The validated, deep-frozen W029 preset catalogue. Entries are shared
 * immutable data: callers receive the same frozen objects from every
 * resolution, so the catalogue cannot be corrupted and twin resolutions
 * stay deep-equal (A9).
 */
export const TRADING_WORLD_LAYOUT_PRESETS: readonly TradingWorldLayoutPreset[] =
  deepFreeze(PRESETS);

/** The catalogue ids in catalogue order (none is "default" — that is W006's). */
export const TRADING_WORLD_PRESET_IDS: readonly string[] = Object.freeze(
  TRADING_WORLD_LAYOUT_PRESETS.map((preset) => preset.id),
);
