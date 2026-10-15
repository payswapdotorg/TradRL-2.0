/**
 * W029 combined layout profile resolver tests.
 *
 * Covers: the catalogue hits, the explicit "default" match (NOT a
 * fallback), the never-brick law for unknown ids with the fallback made
 * observable in the resolution shape, the delegation law (identical
 * behavior to W006's resolver outside the catalogue), twin determinism
 * (A9), and the frozen-data handout guarantee.
 *
 * Run (from packages/ui):
 *   npx tsx --test src/trading-world/presets/test/resolve.test.ts
 */
import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { TRADING_WORLD_LAYOUT_PRESETS } from "../catalogue.js";
import {
  isTradingWorldLayoutPresetId,
  listTradingWorldLayoutProfileIds,
  resolveTradingWorldLayoutPreset,
} from "../resolve.js";
import {
  createDefaultTradingWorldLayoutProfile,
  resolveTradingWorldLayoutProfile,
} from "../../layout/layoutProfiles.js";

const UNKNOWN_IDS = ["", "stale-preset", "day-trader ", "DEFAULT", "profile-999", "🦊"];

describe("W029 combined layout profile resolver", () => {
  for (const preset of TRADING_WORLD_LAYOUT_PRESETS) {
    it(`resolves "${preset.id}" from the W029 catalogue`, () => {
      const resolution = resolveTradingWorldLayoutPreset(preset.id);
      equal(resolution.source, "preset");
      equal(resolution.fellBackToDefault, false);
      equal(resolution.requestedId, preset.id);
      equal(resolution.preset, preset);
      deepStrictEqual(resolution.profile, preset);
      equal(resolution.profile.label, preset.label);
    });

    it(`twin determinism for "${preset.id}" (A9)`, () => {
      deepStrictEqual(
        resolveTradingWorldLayoutPreset(preset.id),
        resolveTradingWorldLayoutPreset(preset.id),
      );
    });
  }

  it('resolves "default" as an explicit default match, NOT a fallback', () => {
    const resolution = resolveTradingWorldLayoutPreset("default");
    equal(resolution.source, "default");
    equal(resolution.fellBackToDefault, false);
    equal(resolution.preset, null);
    equal(resolution.requestedId, "default");
    deepStrictEqual(
      resolution.profile,
      createDefaultTradingWorldLayoutProfile(),
    );
  });

  for (const unknownId of UNKNOWN_IDS) {
    it(`never bricks on unknown id ${JSON.stringify(unknownId)} — observable fallback`, () => {
      const resolution = resolveTradingWorldLayoutPreset(unknownId);
      equal(resolution.source, "default");
      equal(resolution.fellBackToDefault, true);
      equal(resolution.preset, null);
      equal(resolution.requestedId, unknownId);
      deepStrictEqual(
        resolution.profile.layout,
        createDefaultTradingWorldLayoutProfile().layout,
      );
      // W006 precedent preserved: the degraded profile keeps the requested id.
      equal(resolution.profile.id, unknownId);
    });
  }

  it("twin determinism for unknown ids (A9)", () => {
    deepStrictEqual(
      resolveTradingWorldLayoutPreset("ghost"),
      resolveTradingWorldLayoutPreset("ghost"),
    );
  });

  it("matches W006's resolver exactly outside the catalogue (delegation law)", () => {
    for (const id of ["default", ...UNKNOWN_IDS]) {
      deepStrictEqual(
        resolveTradingWorldLayoutPreset(id).profile,
        resolveTradingWorldLayoutProfile(id),
      );
    }
  });

  it("resolves every advertised profile id without throwing", () => {
    for (const id of listTradingWorldLayoutProfileIds()) {
      const resolution = resolveTradingWorldLayoutPreset(id);
      equal(resolution.profile.layout.columns.length, 3);
      ok(resolution.source === "preset" || resolution.source === "default");
      equal(
        resolution.fellBackToDefault,
        resolution.source === "default" && id !== "default",
      );
    }
  });

  it("lists default plus the eight preset ids", () => {
    deepStrictEqual(listTradingWorldLayoutProfileIds(), [
      "default",
      ...TRADING_WORLD_LAYOUT_PRESETS.map((preset) => preset.id),
    ]);
  });

  it("recognizes preset ids and nothing else", () => {
    for (const preset of TRADING_WORLD_LAYOUT_PRESETS) {
      equal(isTradingWorldLayoutPresetId(preset.id), true);
    }
    equal(isTradingWorldLayoutPresetId("default"), false);
    equal(isTradingWorldLayoutPresetId("ghost"), false);
    equal(isTradingWorldLayoutPresetId(""), false);
  });

  it("hands out the frozen catalogue data (callers cannot corrupt it)", () => {
    const { profile } = resolveTradingWorldLayoutPreset("quant");
    throws(() => {
      (profile as unknown as { label: string }).label = "hacked";
    }, TypeError);
  });
});
