/**
 * W029 preset catalogue tests.
 *
 * Covers: the eight-entry catalogue as pure declarative data (R043), the
 * per-preset structural laws (singleton tools, clock-strip ownership, R044
 * risk visibility, ratio bounds, first-tab resets, stable docking targets),
 * the deep-freeze immutability guarantee (A9 determinism), and one
 * arrangement pin per preset so the eight personas stay distinct and
 * defensible.
 *
 * Run (from packages/ui):
 *   npx tsx --test src/trading-world/presets/test/catalogue.test.ts
 */
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRADING_WORLD_LAYOUT_PRESETS,
  TRADING_WORLD_PRESET_IDS,
  type TradingWorldLayoutPreset,
} from "../catalogue.js";
import {
  TRADING_WORLD_RATIO_MAX,
  TRADING_WORLD_RATIO_MIN,
  validateTradingWorldLayoutPreset,
} from "../validate.js";
import { TRADING_WORLD_CORE_TOOL_IDS } from "../../registry/toolRegistry.js";
import type {
  TradingWorldColumnLayout,
  TradingWorldPanelLayout,
} from "../../layout/cockpitLayout.js";

function panelsOf(preset: TradingWorldLayoutPreset): TradingWorldPanelLayout[] {
  return preset.layout.columns.flatMap((entry) => [...entry.panels]);
}

function panelOf(
  preset: TradingWorldLayoutPreset,
  panelId: string,
): TradingWorldPanelLayout {
  const found = panelsOf(preset).find((candidate) => candidate.id === panelId);
  ok(found, `preset "${preset.id}" must dock the "${panelId}" panel`);
  return found;
}

function columnOf(
  preset: TradingWorldLayoutPreset,
  columnId: string,
): TradingWorldColumnLayout {
  const found = preset.layout.columns.find(
    (candidate) => candidate.id === columnId,
  );
  ok(found, `preset "${preset.id}" must carry the "${columnId}" column`);
  return found;
}

function presetById(presetId: string): TradingWorldLayoutPreset {
  const found = TRADING_WORLD_LAYOUT_PRESETS.find(
    (candidate) => candidate.id === presetId,
  );
  ok(found, `the catalogue must carry the "${presetId}" preset`);
  return found;
}

describe("W029 preset catalogue", () => {
  it("ships the eight UX-DESIGN presets in catalogue order", () => {
    equal(TRADING_WORLD_LAYOUT_PRESETS.length, 8);
    deepStrictEqual(TRADING_WORLD_PRESET_IDS, [
      "day-trader",
      "execution",
      "research",
      "portfolio",
      "risk",
      "quant",
      "market-maker",
      "rl-training",
    ]);
  });

  it("carries the UX-DESIGN display labels", () => {
    deepStrictEqual(
      TRADING_WORLD_LAYOUT_PRESETS.map((preset) => preset.label),
      [
        "Day Trader",
        "Execution",
        "Research",
        "Portfolio",
        "Risk",
        "Quant",
        "Market Maker",
        "RL Training",
      ],
    );
  });

  it("documents persona and design rationale per preset (R043 data)", () => {
    for (const preset of TRADING_WORLD_LAYOUT_PRESETS) {
      ok(preset.persona.trim().length > 0, `preset "${preset.id}" persona`);
      ok(preset.rationale.trim().length > 0, `preset "${preset.id}" rationale`);
    }
  });

  it('never shadows W006\'s reserved "default" profile id', () => {
    ok(!TRADING_WORLD_PRESET_IDS.includes("default"));
  });

  it("validates fail-closed: every entry passes the full law battery", () => {
    for (const preset of TRADING_WORLD_LAYOUT_PRESETS) {
      validateTradingWorldLayoutPreset(preset);
    }
  });

  for (const preset of TRADING_WORLD_LAYOUT_PRESETS) {
    it(`"${preset.id}" keeps R044 order/risk visibility (bookkeeping/accounts carry tools)`, () => {
      const fed = panelsOf(preset).filter(
        (candidate) =>
          (candidate.id === "bookkeeping" || candidate.id === "accounts") &&
          candidate.tools.length > 0,
      );
      ok(fed.length > 0, "at least one bookkeeping/accounts panel must carry tools");
    });

    it(`"${preset.id}" docks every core panel tool exactly once (singleton law)`, () => {
      const docked = panelsOf(preset).flatMap((candidate) => [
        ...candidate.tools,
      ]);
      const expected = TRADING_WORLD_CORE_TOOL_IDS.filter(
        (tool) => tool !== "simulation-clock",
      );
      deepStrictEqual([...docked].sort(), [...expected].sort());
      equal(new Set(docked).size, docked.length);
    });

    it(`"${preset.id}" keeps the simulation clock in the strip, never a panel`, () => {
      for (const candidate of panelsOf(preset)) {
        ok(!candidate.tools.includes("simulation-clock"));
      }
    });

    it(`"${preset.id}" keeps the clock strip present and open`, () => {
      equal(preset.layout.clockStrip.open, true);
      ok(
        preset.layout.clockStrip.heightRatio >= TRADING_WORLD_RATIO_MIN &&
          preset.layout.clockStrip.heightRatio <= TRADING_WORLD_RATIO_MAX,
      );
    });

    it(`"${preset.id}" authors every ratio in bounds (no silent clamping)`, () => {
      for (const candidate of preset.layout.columns) {
        ok(
          candidate.widthRatio >= TRADING_WORLD_RATIO_MIN &&
            candidate.widthRatio <= TRADING_WORLD_RATIO_MAX,
          `column "${candidate.id}" width`,
        );
      }
      for (const candidate of panelsOf(preset)) {
        ok(
          candidate.heightRatio >= TRADING_WORLD_RATIO_MIN &&
            candidate.heightRatio <= TRADING_WORLD_RATIO_MAX,
          `panel "${candidate.id}" height`,
        );
      }
    });

    it(`"${preset.id}" resets every panel to its first tab`, () => {
      for (const candidate of panelsOf(preset)) {
        equal(
          candidate.activeToolId,
          candidate.tools.length > 0 ? candidate.tools[0] ?? null : null,
        );
      }
    });

    it(`"${preset.id}" uses only the stable W006 docking targets`, () => {
      deepStrictEqual(
        preset.layout.columns.map((candidate) => candidate.id),
        ["market-rail", "focus", "execution"],
      );
      equal(panelsOf(preset).length, 8);
      equal(panelOf(preset, "research").tools.length, 0);
    });
  }

  it("day-trader: order-flow dominance (tape outranks chart, fills first, risk first)", () => {
    const preset = presetById("day-trader");
    ok(
      panelOf(preset, "tape").heightRatio > panelOf(preset, "chart").heightRatio,
    );
    equal(panelOf(preset, "bookkeeping").tools[0], "fills");
    equal(panelOf(preset, "accounts").tools[0], "risk");
    ok(
      columnOf(preset, "execution").widthRatio >
        columnOf(preset, "market-rail").widthRatio,
    );
  });

  it("execution: ticket and blotter dominance (tallest ticket, working orders first)", () => {
    const preset = presetById("execution");
    equal(panelOf(preset, "ticket").heightRatio, 5);
    equal(panelOf(preset, "bookkeeping").tools[0], "working-orders");
    ok(
      panelOf(preset, "bookkeeping").heightRatio >
        panelOf(preset, "book").heightRatio,
    );
  });

  it("research: price-discovery focus (widest focus column, 5:1 chart-to-tape, tall research dock)", () => {
    const preset = presetById("research");
    equal(columnOf(preset, "focus").widthRatio, 5.2);
    equal(panelOf(preset, "chart").heightRatio, 5);
    equal(panelOf(preset, "tape").heightRatio, 1);
    equal(panelOf(preset, "research").heightRatio, 3);
  });

  it("portfolio: accounts-first (dominant accounts panel over a positions-heavy blotter)", () => {
    const preset = presetById("portfolio");
    ok(
      panelOf(preset, "accounts").heightRatio >
        panelOf(preset, "bookkeeping").heightRatio,
    );
    equal(panelOf(preset, "accounts").tools[0], "portfolio");
    equal(panelOf(preset, "book").heightRatio, 1);
    equal(panelOf(preset, "ticket").heightRatio, 1);
  });

  it("risk: risk state as the primary surface (tallest panel, risk tab first)", () => {
    const preset = presetById("risk");
    equal(panelOf(preset, "accounts").heightRatio, 5);
    equal(panelOf(preset, "accounts").tools[0], "risk");
    equal(panelOf(preset, "bookkeeping").tools[0], "working-orders");
  });

  it("quant: data density (balanced chart and tape, tall research dock, doubled clock strip)", () => {
    const preset = presetById("quant");
    equal(panelOf(preset, "research").heightRatio, 4);
    equal(preset.layout.clockStrip.heightRatio, 2);
    equal(
      panelOf(preset, "chart").heightRatio,
      panelOf(preset, "tape").heightRatio,
    );
  });

  it("market-maker: DOM and tape as primary instruments (5:4, chart compressed)", () => {
    const preset = presetById("market-maker");
    equal(panelOf(preset, "book").heightRatio, 5);
    equal(panelOf(preset, "tape").heightRatio, 4);
    equal(panelOf(preset, "chart").heightRatio, 1);
    equal(panelOf(preset, "bookkeeping").tools[0], "working-orders");
    equal(panelOf(preset, "accounts").tools[0], "risk");
  });

  it("rl-training: the training loop as the workstation (tallest clock strip)", () => {
    const preset = presetById("rl-training");
    equal(preset.layout.clockStrip.heightRatio, 3);
    equal(preset.layout.clockStrip.open, true);
    ok(
      panelOf(preset, "ticket").heightRatio > panelOf(preset, "book").heightRatio,
    );
    equal(panelOf(preset, "accounts").tools[0], "portfolio");
  });

  it("deep-freezes the catalogue — shared preset data cannot be mutated (A9)", () => {
    const preset = presetById("risk");
    throws(() => {
      (preset as unknown as { label: string }).label = "hacked";
    }, TypeError);
    throws(() => {
      (preset.layout as unknown as { columns: unknown[] }).columns.push({});
    }, TypeError);
    throws(() => {
      (panelOf(preset, "accounts") as unknown as { tools: string[] }).tools.push(
        "watchlist",
      );
    }, TypeError);
    throws(() => {
      (TRADING_WORLD_PRESET_IDS as unknown as string[]).push("extra");
    }, TypeError);
  });
});
