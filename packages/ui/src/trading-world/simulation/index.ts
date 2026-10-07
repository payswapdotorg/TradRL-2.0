/**
 * Trading World simulation-clock surface package — W012 public entrypoint.
 *
 * The cockpit's clock strip + timeline surface (UX-DESIGN "Default trader
 * cockpit", the full-width strip under the main grid; "Clock": the clock is
 * world-owned, UI controls send ClockPort commands): the simulation axis
 * (the engine's ClockView through `clock.getClock` + the W018 clock
 * channel — the settled view after acked mutating clock calls), the wall
 * axis (recorded by the engine, never mixed — rendered as the honest
 * not-projected note because the ports project no wallTime, A7), the
 * step/seek/playback controls (REAL `clock.step`/`clock.seek`/
 * `clock.play`/`clock.pause`/`clock.setSpeed`/`clock.jumpToEvent` calls
 * whose typed outcomes — the W004 closed rejection set, the A8
 * `rewind-requires-branch` included — render visibly, never swallowed),
 * and the announced-regime timeline (`market.regime.changed` journal
 * truth, the W017 ORIGIN RULE, read through `query.getTimeline` —
 * semantics shared with the W008 watchlist's parser, never duplicated).
 * Everything the composition point (`../surfaces.ts`), the cockpit shell
 * and the tests need from W012 lives under
 * `packages/ui/src/trading-world/simulation/`.
 *
 * REGISTRY INTEGRATION (W006 seam): the shell hosts tools through the tool
 * registry; the simulation-clock placeholder is swapped with the immutable
 * `withSurfaceOverride` seam. Because `../surfaces.ts` (the composition
 * point) is W006's file and outside W012's frozen write surface, the swap
 * is exported HERE as {@link withSimulationClockToolSurface} — one call
 * from the composition point (or any registry consumer, e.g. a test
 * harness):
 *
 * ```ts
 * import { withSimulationClockToolSurface } from "./simulation/index.js";
 * const registry = withSimulationClockToolSurface(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the
 * W012 PR (the W007–W011 precedent).
 */

import type { ComponentType } from "react";

import type {
  TradingWorldToolRegistry,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { SimulationClockToolSurface } from "./SimulationClockToolSurface.js";

export {
  SimulationClockToolSurface,
  createSimulationClockToolSurface,
  DEFAULT_SIMULATION_CLOCK_POLL_MS,
} from "./SimulationClockToolSurface.js";
export type { SimulationClockToolSurfaceConfig } from "./SimulationClockToolSurface.js";

export {
  createClockTimelineProjectionController,
} from "./clockTimelineProjection.js";
export type {
  ClockTimelineProjectionController,
  ClockTimelineProjectionControllerInput,
  ClockTimelineProjectionSnapshot,
} from "./clockTimelineProjection.js";

export {
  CLOCK_REJECTION_EXPLANATIONS,
  CLOCK_SPEED_PRESET_OPTIONS,
  CLOCK_STEP_SIZE_OPTIONS,
  clockRejectionFromError,
  describeSimulationClockView,
  describeWallAxis,
  parseSeekTargetText,
  parseTimelineRegimeEntries,
  SimulationClockDataError,
} from "./clockTimelineData.js";
export type {
  ClockCommandOutcome,
  ClockRejectionCapsule,
  SimulationClockView,
  SimulationTimelineEvent,
  SimulationClockReadout,
  SeekTargetParse,
  TimelineRegimeEntry,
  WallAxisNote,
} from "./clockTimelineData.js";

export { ClockTimelineList } from "./ClockTimelineList.js";
export { SimulationClockSurfaceStatusBody } from "./SimulationClockSurfaceStates.js";

/** The registered tool id this package owns (W006 registry slot). */
export const SIMULATION_CLOCK_TOOL_ID = "simulation-clock";

/**
 * Swap the registry's simulation-clock placeholder for the real W012
 * surface — the immutable `withSurfaceOverride` seam, applied from THIS
 * module (W012 owns the call; no registry file is edited). Unknown ids
 * already throw inside the registry (loud, never silent).
 */
export function withSimulationClockToolSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = SimulationClockToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(SIMULATION_CLOCK_TOOL_ID, surface);
}
