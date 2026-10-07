/**
 * Trading World portfolio surfaces package — W011 public entrypoint.
 *
 * The trader's financial surfaces (UX-DESIGN "Core World Alpha tools":
 * positions, portfolio, risk). Everything projects world truth through the
 * W006 world-client seam: positions/financials/risk come from the engine's
 * OWN projections (query.getPositions / getPortfolio / getRisk — the W015
 * financial state through the W018 provider), exact decimal text, never
 * fabricated (WORLD-PROTOCOL.md "UI projection law"); the Close action
 * terminates at the REAL CommandPort (command.closePosition) with typed
 * outcomes. Live updates ride the engine's published/clock channels with an
 * honest poll fallback, so unrealized P&L moves with the generated market.
 *
 * REGISTRY INTEGRATION (W006 seam): this package owns the three W011 tool
 * slots (`positions`, `portfolio`, `risk`). Because `../surfaces.ts` (the
 * composition point) is W006's file and outside W011's frozen write
 * surface, the swaps are exported HERE — one call (or the combined
 * {@link withPortfolioToolSurfaces}) from the composition point:
 *
 * ```ts
 * import { withPortfolioToolSurfaces } from "./portfolio/index.js";
 * const registry = withPortfolioToolSurfaces(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the W011
 * PR (the W007/W008/W009/W010 precedent).
 */

import type { ComponentType } from "react";

import type {
  TradingWorldToolRegistry,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { PositionsToolSurface } from "./PositionsToolSurface.js";
import { PortfolioToolSurface } from "./PortfolioToolSurface.js";
import { RiskToolSurface } from "./RiskToolSurface.js";

export {
  PositionsToolSurface,
  createPositionsToolSurface,
} from "./PositionsToolSurface.js";
export type { PositionsToolSurfaceConfig } from "./PositionsToolSurface.js";
export {
  PortfolioToolSurface,
  createPortfolioToolSurface,
} from "./PortfolioToolSurface.js";
export type { PortfolioToolSurfaceConfig } from "./PortfolioToolSurface.js";
export { RiskToolSurface, createRiskToolSurface } from "./RiskToolSurface.js";
export type { RiskToolSurfaceConfig } from "./RiskToolSurface.js";

export {
  PortfolioDataConsistencyError,
  deriveFinancialSummary,
  derivePositionRow,
  derivePositionRows,
  grossExposureUnitsOf,
  sortPositionsForDisplay,
} from "./portfolioData.js";
export type {
  DerivedMarginModel,
  FinancialSummaryModel,
  PositionRowModel,
} from "./portfolioData.js";

export {
  deriveRiskConstraintCards,
  deriveRiskSummary,
  formatRiskTimestamp,
  positionNotionalText,
  totalUnrealizedUnitsOf,
} from "./riskCards.js";
export type {
  RiskBreachDisplayRow,
  RiskConstraintCardModel,
  RiskSummaryModel,
} from "./riskCards.js";

export {
  PortfolioProjectionDataError,
  formatMoneyUnits,
  parseMoneyText,
} from "./decimalText.js";

export {
  createPortfolioProjectionFeedController,
  fetchPortfolioProjection,
} from "./portfolioProjection.js";
export type {
  PortfolioProjectionFeedController,
  PortfolioProjectionFeedState,
  PortfolioProjectionSnapshot,
} from "./portfolioProjection.js";
export { usePortfolioProjectionFeed } from "./usePortfolioProjection.js";
export type { PortfolioProjectionFeed, PortfolioProjectionFeedInput } from "./usePortfolioProjection.js";

export {
  alphaTraderPortfolioIdentity,
  ALPHA_TRADER_PORTFOLIO_IDENTITY,
  buildClosePositionCommand,
  describePortfolioCommandError,
  describePortfolioCommandOutcome,
  newPortfolioCommandId,
  resolvePortfolioIdentity,
} from "./portfolioIdentity.js";
export type {
  PortfolioCommandOutcomeCapsule,
  PortfolioIdentity,
  PortfolioIdentitySpec,
} from "./portfolioIdentity.js";

export {
  DEFAULT_PORTFOLIO_POLL_MS,
  formatPortfolioTime,
  PortfolioSurfaceErrorBody,
  PortfolioSurfaceHeader,
  PortfolioSurfaceNotice,
  usePortfolioClockView,
} from "./PortfolioSurfaceStates.js";

/** The registered tool ids this package owns (W006 registry slots). */
export const POSITIONS_TOOL_ID = "positions";
export const PORTFOLIO_TOOL_ID = "portfolio";
export const RISK_TOOL_ID = "risk";

/** Swap the registry's positions placeholder for the real W011 surface. */
export function withPositionsSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = PositionsToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(POSITIONS_TOOL_ID, surface);
}

/** Swap the registry's portfolio placeholder for the real W011 surface. */
export function withPortfolioSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = PortfolioToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(PORTFOLIO_TOOL_ID, surface);
}

/** Swap the registry's risk placeholder for the real W011 surface. */
export function withRiskSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = RiskToolSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(RISK_TOOL_ID, surface);
}

/**
 * Swap ALL THREE W011 tool slots in one call — the composition-point
 * one-liner (each swap is the immutable `withSurfaceOverride` seam; unknown
 * ids throw inside the registry — loud, never silent).
 */
export function withPortfolioToolSurfaces(
  registry: TradingWorldToolRegistry,
  surfaces: {
    readonly positions?: ComponentType<TradingWorldToolSurfaceProps>;
    readonly portfolio?: ComponentType<TradingWorldToolSurfaceProps>;
    readonly risk?: ComponentType<TradingWorldToolSurfaceProps>;
  } = {},
): TradingWorldToolRegistry {
  let next = withPositionsSurface(registry, surfaces.positions ?? PositionsToolSurface);
  next = withPortfolioSurface(next, surfaces.portfolio ?? PortfolioToolSurface);
  return withRiskSurface(next, surfaces.risk ?? RiskToolSurface);
}
