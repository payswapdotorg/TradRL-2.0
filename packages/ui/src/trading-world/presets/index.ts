/**
 * Trading World layout presets / workspace profiles — W029 public surface.
 *
 * Spec: spec/UX-DESIGN.md "Presets" ("Presets are declarative
 * configurations", R043) and spec/REQUIREMENTS.md R044 (narrow layouts
 * preserve critical order/risk visibility). This module is PURE DATA plus
 * pure functions: the eight-entry catalogue (Day Trader / Execution /
 * Research / Portfolio / Risk / Quant / Market Maker / RL Training), the
 * fail-closed catalogue validator, and the combined resolver that composes
 * the catalogue with W006's default trader cockpit under the never-brick
 * law (unknown ids fall back to the default, observably, never an error).
 *
 * Deliberately NOT here (scope honesty): no React, no shell wiring, no
 * persistence changes, no new panel/column/tool ids — the shell/registry
 * binding is the TL's registration job at merge time. See ./README.md.
 */

export {
  TRADING_WORLD_LAYOUT_PRESETS,
  TRADING_WORLD_PRESET_IDS,
  type TradingWorldLayoutPreset,
} from "./catalogue.js";

export {
  TradingWorldPresetValidationError,
  TRADING_WORLD_COLUMN_IDS,
  TRADING_WORLD_PANEL_IDS,
  TRADING_WORLD_RATIO_MAX,
  TRADING_WORLD_RATIO_MIN,
  assertValidTradingWorldPresetCatalogue,
  validateTradingWorldCockpitLayout,
  validateTradingWorldLayoutPreset,
  validateTradingWorldLayoutProfile,
} from "./validate.js";

export {
  isTradingWorldLayoutPresetId,
  listTradingWorldLayoutProfileIds,
  resolveTradingWorldLayoutPreset,
  type TradingWorldLayoutPresetResolution,
  type TradingWorldLayoutProfileSource,
} from "./resolve.js";
