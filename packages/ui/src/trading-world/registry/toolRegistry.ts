/**
 * Trading World tool registry — W006 surface framework core.
 *
 * Spec: spec/UX-DESIGN.md "Tool identity" ("Each tool has a stable id and
 * contract. Layout placement is independent from domain state") and the
 * "Core World Alpha tools" list; spec/WORK-ITEMS.md W006 ("shell that hosts
 * the trader cockpit's tool surfaces … with a tool REGISTRY so those surfaces
 * register as first-class tools with layout persistence — WITHOUT
 * implementing the tools themselves").
 *
 * This module owns the REGISTRY MECHANISM plus the built-in descriptors for
 * the W007–W012 tool set. Every tool ships with a clearly labeled placeholder
 * surface here; the owning work order replaces it through
 * {@link TradingWorldToolRegistry.withSurfaceOverride} (one call, no registry
 * file edits — the frozen write surfaces of W007–W012 are the per-tool
 * directories under packages/ui/src/trading-world/).
 *
 * Domain-data law (ARCHITECTURE-LOCK A6): a registered surface is always a
 * PROJECTION of world truth reached through the world-client seam
 * (`../runtime/worldClient.ts`). Descriptors only declare which W003 port
 * methods the tool will consume (`consumes`, type-checked against the real
 * QueryPort/CommandPort/ClockPort/EvidencePort signatures via the type-only
 * contracts shim) — the registry itself never touches data.
 */

import type { ComponentType } from "react";
import {
  BookOpenIcon,
  BriefcaseIcon,
  CandlestickChartIcon,
  ClipboardListIcon,
  LayersIcon,
  ListIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  TimerIcon,
  WalletIcon,
} from "lucide-react";

import {
  createPlaceholderToolSurface,
  placeholderSurfaceDescription,
} from "../components/PlaceholderToolSurface.js";
import type { TradingWorldPanelId } from "../layout/cockpitLayout.js";
import type {
  ClockPort,
  CommandPort,
  EvidencePort,
  QueryPort,
} from "../runtime/worldContracts.js";

/**
 * The core W006 tool ids — the W007–W012 set (UX-DESIGN "Core World Alpha
 * tools"). Closed union: the registry, layout profiles and tests all key off
 * these stable identities.
 */
export type CoreTradingWorldToolId =
  | "watchlist" // W008 market overview
  | "chart" // W007 main chart
  | "order-book" // W009 DOM / order book
  | "time-and-sales" // W009 time & sales tape
  | "order-ticket" // W010 order entry
  | "working-orders" // W010 open/working orders
  | "fills" // W010 execution/fill blotter
  | "positions" // W011 positions
  | "portfolio" // W011 portfolio & P&L
  | "risk" // W011 risk state
  | "simulation-clock"; // W012 clock/timeline

/**
 * Stable tool identity: the core set plus FUTURE extension ids (W027
 * research/news, ...). The `string & {}` member keeps literal autocomplete
 * and typo-checking pressure for the core ids while letting later work
 * orders register new tools without editing this module (their frozen
 * surfaces are their own directories). Layout persistence treats ids as
 * opaque strings and the registry filters unknowns on hydrate.
 */
export type TradingWorldToolId = CoreTradingWorldToolId | (string & Record<never, never>);

/**
 * Owning surface package (one per work order). Mirrors the WORK-ITEMS W007–
 * W012 `surface:` directories under packages/ui/src/trading-world/.
 */
export type TradingWorldToolKind =
  | "market" // market/ (W008)
  | "charts" // charts/ (W007)
  | "orderbook" // orderbook/ (W009)
  | "orders" // orders/ (W010)
  | "portfolio" // portfolio/ (W011)
  | "simulation"; // simulation/ (W012)

/** Placeholder until the owning work order overrides the surface. */
export type TradingWorldToolStatus = "placeholder" | "implemented";

/** Icon contract for tab strips, menus and placeholder surfaces. */
export type TradingWorldToolIcon = ComponentType<{ readonly className?: string }>;

/**
 * Hosting phase for a mounted tool surface — the in-pane projection of the
 * W005 pane-level `TradingWorldSurfaceHostingPhase`. A mounted surface is
 * either presented (`mounted-focused`) or kept alive in the background
 * (`mounted-hidden`: inactive tab, collapsed pane, or another pane tab is
 * active). Collapsing/switching never destroys tool state (J-WORLD-02).
 */
export type TradingWorldToolHostingPhase = "mounted-focused" | "mounted-hidden";

/** Props every registered tool surface receives from the cockpit shell. */
export interface TradingWorldToolSurfaceProps {
  /** The registered tool being hosted. */
  readonly toolId: TradingWorldToolId;
  /** Opaque world identity from the pane tab (W005). */
  readonly worldId: string;
  /** Layout profile the pane opened with (W005 `layoutProfileId`). */
  readonly layoutProfileId: string;
  /** Whether this surface is the active tab of its dock panel. */
  readonly active: boolean;
  /** Pane presentation phase (never `unmounted` — see phase docs). */
  readonly phase: TradingWorldToolHostingPhase;
  /** Close this tool inside the cockpit (layout-level close, not pane close). */
  readonly onRequestClose: () => void;
}

/**
 * Mountable surface component contract. A React component (hooks-safe: the
 * shell renders it as JSX, not called as a function). Placeholder surfaces
 * until W007–W012 land.
 */
export type TradingWorldToolSurfaceComponent = ComponentType<TradingWorldToolSurfaceProps>;

/**
 * W003 World Protocol port method a tool projects. Literal template type
 * checked against the canonical port signatures — a typo or a contracts
 * rename is a compile error, not silent drift.
 */
export type TradingWorldPortMethod =
  | `query.${Extract<keyof QueryPort, string>}`
  | `command.${Extract<keyof CommandPort, string>}`
  | `clock.${Extract<keyof ClockPort, string>}`
  | `evidence.${Extract<keyof EvidencePort, string>}`;

/** A registered Trading World tool (one entry per W007–W012 surface). */
export interface TradingWorldToolDescriptor {
  /** Stable identity (UX-DESIGN "Tool identity"); also the layout key. */
  readonly id: TradingWorldToolId;
  /** Owning surface package / work order. */
  readonly kind: TradingWorldToolKind;
  /** Fixed display title (product copy; no i18n id indirection). */
  readonly title: string;
  /** One-line description shown by placeholder surfaces and menus. */
  readonly description: string;
  /** Tab/menu icon. */
  readonly icon: TradingWorldToolIcon;
  /** Panel the tool docks into when opened (layout persistence key). */
  readonly defaultPanel: TradingWorldPanelId;
  /** Owning work order (traceability for placeholder → real swaps). */
  readonly ownerWorkOrder: "W007" | "W008" | "W009" | "W010" | "W011" | "W012";
  /** W003 port methods this tool projects (documentation + telemetry seam). */
  readonly consumes: readonly TradingWorldPortMethod[];
  /** Placeholder until the owner work order overrides the surface. */
  readonly status: TradingWorldToolStatus;
  /** Mountable surface component (placeholder until the owning WO lands). */
  readonly surface: TradingWorldToolSurfaceComponent;
}

/** Read-only registry view the shell and layout ops consume. */
export interface TradingWorldToolRegistry {
  getTool(toolId: TradingWorldToolId): TradingWorldToolDescriptor | undefined;
  /** Registration order (stable for menus and layout defaults). */
  listTools(): readonly TradingWorldToolDescriptor[];
  /**
   * Replace a registered tool's surface (W007–W012 swap placeholder → real).
   * Immutable: returns a new registry; unknown ids throw (registration
   * mistakes must be loud, never silent no-ops).
   */
  withSurfaceOverride(
    toolId: TradingWorldToolId,
    surface: TradingWorldToolSurfaceComponent,
  ): TradingWorldToolRegistry;
  /**
   * Register an ADDITIONAL tool (future work orders, e.g. W027 research).
   * Immutable; duplicate ids throw.
   */
  withTool(descriptor: TradingWorldToolDescriptor): TradingWorldToolRegistry;
}

/** Ordered core tool list — UX-DESIGN "Core World Alpha tools" order. */
export const TRADING_WORLD_CORE_TOOL_IDS: readonly TradingWorldToolId[] = [
  "watchlist",
  "chart",
  "order-book",
  "time-and-sales",
  "order-ticket",
  "working-orders",
  "fills",
  "positions",
  "portfolio",
  "risk",
  "simulation-clock",
];

/** Private implementation; the public registry type is the immutable view. */
class TradingWorldToolRegistryImpl implements TradingWorldToolRegistry {
  constructor(
    private readonly tools: ReadonlyMap<string, TradingWorldToolDescriptor>,
  ) {}

  getTool(toolId: TradingWorldToolId): TradingWorldToolDescriptor | undefined {
    return this.tools.get(toolId);
  }

  listTools(): readonly TradingWorldToolDescriptor[] {
    return [...this.tools.values()];
  }

  withSurfaceOverride(
    toolId: TradingWorldToolId,
    surface: TradingWorldToolSurfaceComponent,
  ): TradingWorldToolRegistry {
    const existing = this.tools.get(toolId);
    if (!existing) {
      throw new Error(`[trading-world] cannot override unknown tool: ${toolId}`);
    }
    return new TradingWorldToolRegistryImpl(
      new Map(this.tools).set(toolId, { ...existing, surface, status: "implemented" }),
    );
  }

  withTool(descriptor: TradingWorldToolDescriptor): TradingWorldToolRegistry {
    if (this.tools.has(descriptor.id)) {
      throw new Error(`[trading-world] tool already registered: ${descriptor.id}`);
    }
    return new TradingWorldToolRegistryImpl(
      new Map(this.tools).set(descriptor.id, descriptor),
    );
  }
}

/** Build a registry from an ordered descriptor list (duplicate ids throw). */
export function createTradingWorldToolRegistry(
  descriptors: readonly TradingWorldToolDescriptor[] = [],
): TradingWorldToolRegistry {
  const tools = new Map<string, TradingWorldToolDescriptor>();
  for (const descriptor of descriptors) {
    if (tools.has(descriptor.id)) {
      throw new Error(`[trading-world] tool already registered: ${descriptor.id}`);
    }
    tools.set(descriptor.id, descriptor);
  }
  return new TradingWorldToolRegistryImpl(tools);
}

/** Placeholder surface bound to one tool (labels come from the registry). */
function placeholderFor(
  descriptor: Omit<TradingWorldToolDescriptor, "status" | "surface" | "description">,
  description: string,
): TradingWorldToolSurfaceComponent {
  return createPlaceholderToolSurface({
    toolId: descriptor.id,
    title: descriptor.title,
    ownerWorkOrder: descriptor.ownerWorkOrder,
    kind: descriptor.kind,
    description,
    icon: descriptor.icon,
  });
}

/** Descriptor factory shared by every built-in (placeholder) tool. */
function coreToolDescriptor(
  descriptor: Omit<TradingWorldToolDescriptor, "status" | "surface" | "description"> & {
    readonly displayTitle: string;
  },
): TradingWorldToolDescriptor {
  const { displayTitle: _displayTitle, ...rest } = descriptor;
  const description = placeholderSurfaceDescription(
    descriptor.displayTitle,
    descriptor.ownerWorkOrder,
  );
  return {
    ...rest,
    description,
    status: "placeholder",
    surface: placeholderFor(descriptor, description),
  };
}

/**
 * Built-in descriptors for the W007–W012 tool set. Panels mirror the
 * UX-DESIGN default cockpit; `consumes` mirrors the WORLD-PROTOCOL ports.
 */
export function createTradingWorldCoreToolDescriptors(): readonly TradingWorldToolDescriptor[] {
  return [
    coreToolDescriptor({
      id: "watchlist",
      kind: "market",
      title: "Watchlist",
      displayTitle: "Watchlist",
      icon: ListIcon,
      defaultPanel: "market",
      ownerWorkOrder: "W008",
      consumes: ["query.getWorldMeta", "query.getInstrument", "query.getQuote"],
    }),
    coreToolDescriptor({
      id: "chart",
      kind: "charts",
      title: "Chart",
      displayTitle: "Chart",
      icon: CandlestickChartIcon,
      defaultPanel: "chart",
      ownerWorkOrder: "W007",
      consumes: ["query.getTrades", "query.getOrderBook", "query.getTimeline"],
    }),
    coreToolDescriptor({
      id: "order-book",
      kind: "orderbook",
      title: "Order Book",
      displayTitle: "Order Book / DOM",
      icon: BookOpenIcon,
      defaultPanel: "book",
      ownerWorkOrder: "W009",
      consumes: ["query.getOrderBook"],
    }),
    coreToolDescriptor({
      id: "time-and-sales",
      kind: "orderbook",
      title: "Time & Sales",
      displayTitle: "Time & Sales",
      icon: ScrollTextIcon,
      defaultPanel: "tape",
      ownerWorkOrder: "W009",
      consumes: ["query.getTrades", "query.getTimeline"],
    }),
    coreToolDescriptor({
      id: "order-ticket",
      kind: "orders",
      title: "Order Ticket",
      displayTitle: "Order Ticket",
      icon: ClipboardListIcon,
      defaultPanel: "ticket",
      ownerWorkOrder: "W010",
      consumes: ["command.submitOrder", "command.replaceOrder", "command.cancelOrder"],
    }),
    coreToolDescriptor({
      id: "working-orders",
      kind: "orders",
      title: "Working Orders",
      displayTitle: "Working Orders",
      icon: LayersIcon,
      defaultPanel: "bookkeeping",
      ownerWorkOrder: "W010",
      consumes: ["query.getOrders", "command.cancelOrder", "command.replaceOrder"],
    }),
    coreToolDescriptor({
      id: "fills",
      kind: "orders",
      title: "Fills",
      displayTitle: "Fills",
      icon: ReceiptTextIcon,
      defaultPanel: "bookkeeping",
      ownerWorkOrder: "W010",
      consumes: ["query.getOrders", "evidence.getEvents"],
    }),
    coreToolDescriptor({
      id: "positions",
      kind: "portfolio",
      title: "Positions",
      displayTitle: "Positions",
      icon: BriefcaseIcon,
      defaultPanel: "bookkeeping",
      ownerWorkOrder: "W011",
      consumes: ["query.getPositions", "command.closePosition"],
    }),
    coreToolDescriptor({
      id: "portfolio",
      kind: "portfolio",
      title: "Portfolio",
      displayTitle: "Portfolio",
      icon: WalletIcon,
      defaultPanel: "accounts",
      ownerWorkOrder: "W011",
      consumes: ["query.getPortfolio", "query.getPositions"],
    }),
    coreToolDescriptor({
      id: "risk",
      kind: "portfolio",
      title: "Risk",
      displayTitle: "Risk",
      icon: ShieldAlertIcon,
      defaultPanel: "accounts",
      ownerWorkOrder: "W011",
      consumes: ["query.getRisk", "query.getPortfolio"],
    }),
    coreToolDescriptor({
      id: "simulation-clock",
      kind: "simulation",
      title: "Simulation Clock",
      displayTitle: "Simulation Clock",
      icon: TimerIcon,
      defaultPanel: "clock-strip",
      ownerWorkOrder: "W012",
      consumes: [
        "clock.play",
        "clock.pause",
        "clock.step",
        "clock.seek",
        "clock.jumpToEvent",
        "clock.setSpeed",
        "clock.getClock",
      ],
    }),
  ];
}

/**
 * The default registry: every W007–W012 tool registered with its placeholder
 * surface. W007–W012 call `withSurfaceOverride` from their own surface
 * package; the composition point is `../surfaces.js`.
 */
export function createTradingWorldCoreToolRegistry(): TradingWorldToolRegistry {
  return createTradingWorldToolRegistry(createTradingWorldCoreToolDescriptors());
}
