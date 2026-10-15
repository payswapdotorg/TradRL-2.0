/**
 * Trading World combined layout profile resolver — W029.
 *
 * Composes the W029 preset catalogue (./catalogue.ts) with W006's default
 * trader cockpit (../layout/layoutProfiles.ts) into one resolver, preserving
 * W006's never-brick law verbatim: an unknown id (a stale preset, a
 * not-yet-landed catalogue entry) resolves to the default trader cockpit —
 * NEVER an error — because the shell treats layoutProfileId as an opaque
 * string and must never crash on it.
 *
 * The fallback is OBSERVABLE in the return shape: a resolution carries the
 * resolved profile, the requested id, which layer answered ("preset" |
 * "default"), whether the call fell back to the default, and the matched
 * catalogue entry when one answered. Tests assert the law explicitly on
 * this shape instead of sniffing labels.
 *
 * Outside the catalogue this resolver DELEGATES to W006's
 * resolveTradingWorldLayoutProfile, so "default" and unknown ids behave
 * exactly as W006 shipped them (unknown ids keep the requested id and get
 * the "Profile: <id>" label) — zero drift between the two resolvers.
 *
 * Determinism (A9): pure function, no clocks, no randomness, no environment
 * reads; catalogue hits return the same deep-frozen data every call, and
 * fallback hits rebuild W006's default cockpit deterministically.
 */

import {
  DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
  resolveTradingWorldLayoutProfile,
  type TradingWorldLayoutProfile,
} from "../layout/layoutProfiles.js";
import {
  TRADING_WORLD_LAYOUT_PRESETS,
  type TradingWorldLayoutPreset,
} from "./catalogue.js";

/** Which layer answered a resolution: the W029 catalogue or W006's default. */
export type TradingWorldLayoutProfileSource = "preset" | "default";

/**
 * The observable resolution of a layoutProfileId. `fellBackToDefault` is
 * true exactly when the requested id matched neither the catalogue nor the
 * canonical "default" id — the never-brick fallback, made assertable.
 */
export interface TradingWorldLayoutPresetResolution {
  /** The resolved profile (preset data, or W006's default/degraded shape). */
  readonly profile: TradingWorldLayoutProfile;
  /** Exactly the id that was requested (provenance, unmodified). */
  readonly requestedId: string;
  /** The layer that answered. */
  readonly source: TradingWorldLayoutProfileSource;
  /** True iff the id was unknown and the default cockpit answered instead. */
  readonly fellBackToDefault: boolean;
  /** The matched catalogue entry (with persona + rationale), else null. */
  readonly preset: TradingWorldLayoutPreset | null;
}

const PRESET_BY_ID: ReadonlyMap<string, TradingWorldLayoutPreset> = new Map<
  string,
  TradingWorldLayoutPreset
>(
  TRADING_WORLD_LAYOUT_PRESETS.map(
    (preset): [string, TradingWorldLayoutPreset] => [preset.id, preset],
  ),
);

/** True iff the id names a W029 catalogue preset (not "default"). */
export function isTradingWorldLayoutPresetId(layoutProfileId: string): boolean {
  return PRESET_BY_ID.has(layoutProfileId);
}

/**
 * Resolve a pane tab's layoutProfileId across [W029 presets ∪ W006 default].
 * Never throws: a catalogue hit returns the frozen preset; "default" returns
 * W006's canonical profile as an explicit default match (NOT a fallback);
 * anything else degrades to the default trader cockpit with
 * `fellBackToDefault: true` — the never-brick law.
 */
export function resolveTradingWorldLayoutPreset(
  layoutProfileId: string,
): TradingWorldLayoutPresetResolution {
  const preset = PRESET_BY_ID.get(layoutProfileId);
  if (preset !== undefined) {
    return {
      profile: preset,
      requestedId: layoutProfileId,
      source: "preset",
      fellBackToDefault: false,
      preset,
    };
  }
  // Never-brick law: delegate to W006's resolver so "default" and unknown
  // ids behave exactly as W006 shipped them — an unknown id degrades to the
  // default trader cockpit (never an error), observable in this result.
  const profile = resolveTradingWorldLayoutProfile(layoutProfileId);
  return {
    profile,
    requestedId: layoutProfileId,
    source: "default",
    fellBackToDefault:
      layoutProfileId !== DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
    preset: null,
  };
}

/** Every profile id this resolver answers: "default" plus the catalogue. */
export function listTradingWorldLayoutProfileIds(): readonly string[] {
  return [
    DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
    ...TRADING_WORLD_LAYOUT_PRESETS.map((preset) => preset.id),
  ];
}
