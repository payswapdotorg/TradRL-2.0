/**
 * Trading World cockpit layout profiles — W006.
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (the ASCII layout) and
 * "Presets" ("Presets are declarative configurations"). The shell opens with
 * the profile named by the pane tab's opaque `layoutProfileId` (W005); the
 * profile is the RESET POINT for user layout adjustments, which persist
 * separately (see ./cockpitLayoutPersistence.ts).
 *
 * W029 (layout presets/workspace profiles) extends THIS resolver with the
 * full preset catalogue (Day Trader / Execution / Research / Portfolio /
 * Risk / Quant / Market Maker / RL Training); W006 ships only the canonical
 * default trader cockpit every preset starts from. Unknown profile ids fall
 * back to it so a persisted tab never bricks the pane.
 */

import {
  column,
  panel,
  type TradingWorldCockpitLayout,
} from "./cockpitLayout.js";

/** Canonical profile id — also the TL launcher's `layoutProfileId` value. */
export const DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID = "default";

/** A declarative layout profile (W029 extends this catalogue). */
export interface TradingWorldLayoutProfile {
  /** The `layoutProfileId` value this profile resolves (opaque to the shell). */
  readonly id: string;
  /** Fixed display label shown in the cockpit toolbar. */
  readonly label: string;
  /** Base layout: reset point and first-paint default. */
  readonly layout: TradingWorldCockpitLayout;
}

/**
 * The default trader cockpit (UX-DESIGN ASCII layout):
 *
 * ┌────────────┬───────────────────────┬─────────────────────────┐
 * │ Watchlist  │ Main Chart            │ Order Book / DOM        │
 * │ (W008)     │ (W007)                │ Order Ticket (W010)     │
 * ├────────────┼───────────────────────┼─────────────────────────┤
 * │ Research   │ Time & Sales          │ Positions/Orders (W011) │
 * │ (reserved) │ (W009)                │ Portfolio/Risk  (W011)  │
 * └────────────┴───────────────────────┴─────────────────────────┘
 * │ Simulation clock strip (W012, full width)                    │
 *
 * The research panel stays an EMPTY reserved dock until W008/W027 register
 * surfaces for it — panels are stable docking targets, never removed.
 */
export function createDefaultTradingWorldCockpitLayout(): TradingWorldCockpitLayout {
  return {
    schemaVersion: 1,
    columns: [
      column(
        "market-rail",
        [panel("market", ["watchlist"], 3), panel("research", [], 2)],
        22,
      ),
      column(
        "focus",
        [panel("chart", ["chart"], 3), panel("tape", ["time-and-sales"], 2)],
        46,
      ),
      column(
        "execution",
        [
          panel("book", ["order-book"], 3),
          panel("ticket", ["order-ticket"], 3),
          panel("bookkeeping", ["positions", "working-orders", "fills"], 2),
          panel("accounts", ["portfolio", "risk"], 2),
        ],
        32,
      ),
    ],
    clockStrip: { open: true, heightRatio: 1 },
  };
}

/** The default trader cockpit profile every known profile starts from. */
export function createDefaultTradingWorldLayoutProfile(): TradingWorldLayoutProfile {
  return {
    id: DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
    label: "Trader Cockpit",
    layout: createDefaultTradingWorldCockpitLayout(),
  };
}

/**
 * Resolve the layout profile for a pane tab's `layoutProfileId`. Unknown ids
 * (stale presets, not-yet-landed W029 catalogue entries) resolve to the
 * default trader cockpit so the pane always opens usable.
 */
export function resolveTradingWorldLayoutProfile(
  layoutProfileId: string,
): TradingWorldLayoutProfile {
  if (layoutProfileId === DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID) {
    return createDefaultTradingWorldLayoutProfile();
  }
  // W029 presets resolve here; until then unknown profiles degrade to the
  // default cockpit (documented W006 behavior, not an error — the shell
  // treats layoutProfileId as an opaque string and must never crash on it).
  return {
    ...createDefaultTradingWorldLayoutProfile(),
    id: layoutProfileId,
    label: `Profile: ${layoutProfileId}`,
  };
}
