/**
 * W029 fail-closed catalogue validation tests (RED-first).
 *
 * Every law in ../validate.ts is exercised with a deliberately corrupt
 * fixture and must throw the loud typed error naming the preset and the
 * violated law — never a silent default. The valid fixture and the
 * inclusive ratio bounds prove the validator is not over-restrictive.
 *
 * Run (from packages/ui):
 *   npx tsx --test src/trading-world/presets/test/validate.test.ts
 */
import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TradingWorldPresetValidationError,
  TRADING_WORLD_RATIO_MAX,
  TRADING_WORLD_RATIO_MIN,
  assertValidTradingWorldPresetCatalogue,
  validateTradingWorldCockpitLayout,
  validateTradingWorldLayoutPreset,
  validateTradingWorldLayoutProfile,
} from "../validate.js";
import type { TradingWorldLayoutPreset } from "../catalogue.js";
import { column, panel } from "../../layout/cockpitLayout.js";

function validPreset(): TradingWorldLayoutPreset {
  return {
    id: "fixture",
    label: "Fixture",
    persona: "A fixture persona for the validation battery.",
    rationale: "A fixture rationale for the validation battery.",
    layout: {
      schemaVersion: 1,
      columns: [
        column(
          "market-rail",
          [panel("market", ["watchlist"], 2), panel("research", [], 1)],
          1.5,
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
            panel("ticket", ["order-ticket"], 2),
            panel("bookkeeping", ["positions", "working-orders", "fills"], 2),
            panel("accounts", ["portfolio", "risk"], 2),
          ],
          4.5,
        ),
      ],
      clockStrip: { open: true, heightRatio: 1 },
    },
  };
}

type Corrupt = (preset: TradingWorldLayoutPreset) => void;

function brokenPreset(corrupt: Corrupt): TradingWorldLayoutPreset {
  const preset = validPreset();
  corrupt(preset);
  return preset;
}

/**
 * Run `run` and return the loud typed violation it must throw (node's
 * assert.throws returns undefined, so the error is captured by hand).
 */
function expectViolation(
  law: string,
  run: () => void,
): TradingWorldPresetValidationError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof TradingWorldPresetValidationError)) {
    throw new Error(
      `expected a TradingWorldPresetValidationError for the ${law} law, got ${String(caught)}`,
    );
  }
  return caught;
}

function panelEntry(
  preset: TradingWorldLayoutPreset,
  panelId: string,
): Record<string, unknown> {
  const found = preset.layout.columns
    .flatMap((entry) => [...entry.panels])
    .find((candidate) => candidate.id === panelId);
  ok(found, `fixture must dock the "${panelId}" panel`);
  return found as unknown as Record<string, unknown>;
}

function columnEntry(
  preset: TradingWorldLayoutPreset,
  columnId: string,
): Record<string, unknown> {
  const found = preset.layout.columns.find(
    (candidate) => candidate.id === columnId,
  );
  ok(found, `fixture must carry the "${columnId}" column`);
  return found as unknown as Record<string, unknown>;
}

const REJECTED: ReadonlyArray<readonly [string, Corrupt]> = [
  [
    "known-panel-ids",
    (preset) => {
      panelEntry(preset, "market").id = "energy";
    },
  ],
  [
    "known-column-ids",
    (preset) => {
      columnEntry(preset, "focus").id = "middle";
    },
  ],
  [
    "ratio-bounds",
    (preset) => {
      panelEntry(preset, "chart").heightRatio = 0;
    },
  ],
  [
    "ratio-bounds",
    (preset) => {
      columnEntry(preset, "market-rail").widthRatio = 21;
    },
  ],
  [
    "ratio-bounds",
    (preset) => {
      panelEntry(preset, "tape").heightRatio = Number.NaN;
    },
  ],
  [
    "ratio-bounds",
    (preset) => {
      columnEntry(preset, "execution").widthRatio = Number.POSITIVE_INFINITY;
    },
  ],
  [
    "clock-strip",
    (preset) => {
      delete (preset.layout as unknown as { clockStrip?: unknown }).clockStrip;
    },
  ],
  [
    "clock-strip",
    (preset) => {
      (preset.layout as unknown as { clockStrip: { open: unknown } }).clockStrip.open = "yes";
    },
  ],
  [
    "clock-strip-tool-ownership",
    (preset) => {
      (panelEntry(preset, "chart").tools as string[]).push("simulation-clock");
    },
  ],
  [
    "registered-tools",
    (preset) => {
      (panelEntry(preset, "market").tools as string[]).push("magic-indicator");
    },
  ],
  [
    "singleton-tools",
    (preset) => {
      (panelEntry(preset, "research").tools as string[]).push("watchlist");
    },
  ],
  [
    "unique-panel-ids",
    (preset) => {
      panelEntry(preset, "tape").id = "chart";
    },
  ],
  [
    "unique-column-ids",
    (preset) => {
      columnEntry(preset, "execution").id = "focus";
    },
  ],
  [
    "active-tool-first-tab",
    (preset) => {
      panelEntry(preset, "accounts").activeToolId = "risk";
    },
  ],
  [
    "schema-version",
    (preset) => {
      (preset.layout as unknown as { schemaVersion: number }).schemaVersion = 2;
    },
  ],
  [
    "columns-present",
    (preset) => {
      (preset.layout as unknown as { columns: unknown[] }).columns = [];
    },
  ],
  [
    "risk-visibility (R044)",
    (preset) => {
      for (const panelId of ["bookkeeping", "accounts"]) {
        const entry = panelEntry(preset, panelId);
        entry.tools = [];
        entry.activeToolId = null;
      }
    },
  ],
  [
    "risk-visibility (R044)",
    (preset) => {
      columnEntry(preset, "execution").panels = [
        panelEntry(preset, "book"),
        panelEntry(preset, "ticket"),
      ];
    },
  ],
  [
    "profile-id",
    (preset) => {
      (preset as unknown as { id: string }).id = "";
    },
  ],
  [
    "profile-label",
    (preset) => {
      (preset as unknown as { label: string }).label = "";
    },
  ],
  [
    "preset-persona",
    (preset) => {
      (preset as unknown as { persona: string }).persona = "";
    },
  ],
  [
    "preset-rationale",
    (preset) => {
      (preset as unknown as { rationale: string }).rationale = "";
    },
  ],
];

describe("W029 fail-closed catalogue validation", () => {
  it("accepts the valid fixture without throwing", () => {
    validateTradingWorldLayoutPreset(validPreset());
    assertValidTradingWorldPresetCatalogue([validPreset()]);
  });

  it("accepts the ratio bounds inclusively (0.05 and 20 are legal)", () => {
    const preset = validPreset();
    panelEntry(preset, "research").heightRatio = TRADING_WORLD_RATIO_MIN;
    columnEntry(preset, "market-rail").widthRatio = TRADING_WORLD_RATIO_MAX;
    (preset.layout as unknown as { clockStrip: { heightRatio: number } }).clockStrip.heightRatio =
      TRADING_WORLD_RATIO_MAX;
    validateTradingWorldLayoutPreset(preset);
  });

  for (const [law, corrupt] of REJECTED) {
    it(`rejects a preset that violates the ${law} law`, () => {
      const error = expectViolation(law, () =>
        validateTradingWorldLayoutPreset(brokenPreset(corrupt)),
      );
      equal(error.law, law);
      ok(error instanceof Error);
      ok(error.message.includes(error.presetId));
      ok(error.message.includes(law));
    });
  }

  it("rejects a layout with a missing clock strip via the layout validator", () => {
    const preset = validPreset();
    delete (preset.layout as unknown as { clockStrip?: unknown }).clockStrip;
    const error = expectViolation("clock-strip", () =>
      validateTradingWorldCockpitLayout("fixture", preset.layout),
    );
    equal(error.law, "clock-strip");
    equal(error.presetId, "fixture");
  });

  it("names an unnamed preset when the profile id is missing", () => {
    const preset = brokenPreset((candidate) => {
      (candidate as unknown as { id: string }).id = "";
    });
    const error = expectViolation("profile-id", () =>
      validateTradingWorldLayoutProfile(preset),
    );
    equal(error.law, "profile-id");
    equal(error.presetId, "<unnamed>");
  });

  it("rejects a catalogue with duplicate preset ids", () => {
    const error = expectViolation("unique-preset-ids", () =>
      assertValidTradingWorldPresetCatalogue([validPreset(), validPreset()]),
    );
    equal(error.law, "unique-preset-ids");
  });

  it('rejects a catalogue entry that shadows W006\'s reserved "default" id', () => {
    const preset = brokenPreset((candidate) => {
      (candidate as unknown as { id: string }).id = "default";
    });
    const error = expectViolation("reserved-default-id", () =>
      assertValidTradingWorldPresetCatalogue([preset]),
    );
    equal(error.law, "reserved-default-id");
    equal(error.presetId, "default");
  });

  it("rejects an empty catalogue (a silent-degradation guard)", () => {
    const error = expectViolation("catalogue-nonempty", () =>
      assertValidTradingWorldPresetCatalogue([]),
    );
    equal(error.law, "catalogue-nonempty");
  });

  it("rejects a non-array catalogue", () => {
    const error = expectViolation("catalogue-shape", () =>
      assertValidTradingWorldPresetCatalogue(
        "nope" as unknown as readonly TradingWorldLayoutPreset[],
      ),
    );
    equal(error.law, "catalogue-shape");
  });

  it("carries the loud typed error shape", () => {
    const error = new TradingWorldPresetValidationError(
      "fixture",
      "ratio-bounds",
      "detail",
    );
    ok(error instanceof Error);
    equal(error.name, "TradingWorldPresetValidationError");
    equal(error.presetId, "fixture");
    equal(error.law, "ratio-bounds");
    equal(error.detail, "detail");
    ok(error.message.includes("fixture"));
    ok(error.message.includes("ratio-bounds"));
    ok(error.message.includes("detail"));
  });
});
