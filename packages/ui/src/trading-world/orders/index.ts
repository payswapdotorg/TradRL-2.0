/**
 * Trading World order surfaces package — W010 public entrypoint.
 *
 * The order-entry ticket + the order-lifecycle surfaces of the trader
 * cockpit (UX-DESIGN "Core World Alpha tools": order ticket, working
 * orders, fills). Everything projects world truth through the W006
 * world-client seam: submissions and cancel/replace go through the REAL
 * CommandPort (typed VALUES — acks with journalCursor/commandId, rejections
 * with typed codes — never wire errors, never fabricated state), statuses
 * and fills come from the engine's own projections (query.getOrders,
 * evidence.getEvents) refreshed by engine publications, settled clock views
 * and an honest poll fallback.
 *
 * REGISTRY INTEGRATION (W006 seam): this package owns the three W010 tool
 * slots (`order-ticket`, `working-orders`, `fills`). Because
 * `../surfaces.ts` (the composition point) is W006's file and outside
 * W010's frozen write surface, the swaps are exported HERE — one call (or
 * the combined {@link withOrdersToolSurfaces}) from the composition point:
 *
 * ```ts
 * import { withOrdersToolSurfaces } from "./orders/index.js";
 * const registry = withOrdersToolSurfaces(tradingWorldSurfaceRegistry);
 * ```
 *
 * The exact `surfaces.ts` change is recorded as a TL action item in the W010
 * PR (the W007 precedent).
 */

import type { ComponentType } from "react";

import type {
  TradingWorldToolRegistry,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { OrderTicketSurface } from "./OrderTicketSurface.js";
import { WorkingOrdersSurface } from "./WorkingOrdersSurface.js";
import { FillsSurface } from "./FillsSurface.js";

export {
  OrderTicketSurface,
  createOrderTicketSurface,
} from "./OrderTicketSurface.js";
export type { OrderTicketSurfaceConfig } from "./OrderTicketSurface.js";
export {
  WorkingOrdersSurface,
  createWorkingOrdersSurface,
} from "./WorkingOrdersSurface.js";
export type { WorkingOrdersSurfaceConfig } from "./WorkingOrdersSurface.js";
export { FillsSurface, createFillsSurface } from "./FillsSurface.js";
export type { FillsSurfaceConfig } from "./FillsSurface.js";

export {
  ALPHA_TRADER_IDENTITY,
  ALPHA_VENUE_POLICY,
  alphaTraderIdentity,
  buildCancelOrderCommand,
  buildReplaceOrderCommand,
  buildSubmitOrderCommand,
  createDefaultOrderTicketFormState,
  isCanonicalPositiveDecimal,
  newUiCommandId,
  ORDER_TICKET_KINDS,
  ORDER_TICKET_SIDES,
  ORDER_TICKET_TIFS,
  ORDER_REJECTION_REASON_LABELS,
  resolveOrderTicketIdentity,
  shortOrderId,
  validateOrderTicketForm,
} from "./orderTicket.js";
export type {
  OrderTicketField,
  OrderTicketFormState,
  OrderTicketIdentity,
  OrderTicketIdentitySpec,
  OrderTicketInstrumentFacts,
  OrderTicketProblem,
  OrderTicketVenuePolicy,
} from "./orderTicket.js";

export {
  applyOrderDisplayFilter,
  deriveFillRows,
  deriveOrderRowModel,
  describeCommandOutcome,
  describeThrownCommandError,
  isOrderFillEventPayload,
  isWorkingStatus,
  sortOrdersForDisplay,
} from "./orderLifecycle.js";
export type {
  CommandOutcomeCapsule,
  FillRowModel,
  OrderDisplayFilter,
  OrderFillEventPayload,
  OrderRowModel,
} from "./orderLifecycle.js";

export {
  editorFor,
  ReplaceOrderEditor,
} from "./ReplaceOrderEditor.js";
export type { ReplaceEditorState } from "./ReplaceOrderEditor.js";

export {
  DEFAULT_ORDERS_POLL_MS,
  formatSimulationTime,
  useEngineClockView,
  useEngineProjectionRevision,
} from "./OrderSurfaceStates.js";
export type { OrdersProjectionState } from "./OrderSurfaceStates.js";

/** The registered tool ids this package owns (W006 registry slots). */
export const ORDER_TICKET_TOOL_ID = "order-ticket";
export const WORKING_ORDERS_TOOL_ID = "working-orders";
export const FILLS_TOOL_ID = "fills";

/** Swap the registry's order-ticket placeholder for the real W010 surface. */
export function withOrderTicketSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = OrderTicketSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(ORDER_TICKET_TOOL_ID, surface);
}

/** Swap the registry's working-orders placeholder for the real W010 surface. */
export function withWorkingOrdersSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = WorkingOrdersSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(WORKING_ORDERS_TOOL_ID, surface);
}

/** Swap the registry's fills placeholder for the real W010 surface. */
export function withFillsSurface(
  registry: TradingWorldToolRegistry,
  surface: ComponentType<TradingWorldToolSurfaceProps> = FillsSurface,
): TradingWorldToolRegistry {
  return registry.withSurfaceOverride(FILLS_TOOL_ID, surface);
}

/**
 * Swap ALL THREE W010 tool slots in one call — the composition-point
 * one-liner (each swap is the immutable `withSurfaceOverride` seam; unknown
 * ids throw inside the registry — loud, never silent).
 */
export function withOrdersToolSurfaces(
  registry: TradingWorldToolRegistry,
  surfaces: {
    readonly orderTicket?: ComponentType<TradingWorldToolSurfaceProps>;
    readonly workingOrders?: ComponentType<TradingWorldToolSurfaceProps>;
    readonly fills?: ComponentType<TradingWorldToolSurfaceProps>;
  } = {},
): TradingWorldToolRegistry {
  let next = withOrderTicketSurface(registry, surfaces.orderTicket ?? OrderTicketSurface);
  next = withWorkingOrdersSurface(next, surfaces.workingOrders ?? WorkingOrdersSurface);
  return withFillsSurface(next, surfaces.fills ?? FillsSurface);
}
