/**
 * Placeholder tool surface — W006.
 *
 * Every W007–W012 tool registers with one of these until its owning work
 * order replaces the surface (`TradingWorldToolRegistry.withSurfaceOverride`).
 * A placeholder is clearly labeled (tool identity + owning work order), shows
 * the persistent simulation disclosure (ACCEPTANCE-WORLD-ALPHA K: mounted ⇒
 * visible, text — never color alone) and demonstrates the world-client seam
 * (status chip from `useTradingWorldClient`). It NEVER fabricates market,
 * order or portfolio data (ARCHITECTURE-LOCK A6: UI is a projection).
 */

import type { ComponentType } from "react";

import { cn } from "@/components/lib/utils.js";
import type {
  TradingWorldToolIcon,
  TradingWorldToolId,
  TradingWorldToolSurfaceProps,
} from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";

/** Persistent simulation disclosure wording (UX-DESIGN "Simulation disclosure"). */
export const TRADING_WORLD_SIMULATED_DISCLOSURE = "SIMULATED · HISTORICAL";

/** Description copy shared by the registry descriptor and the surface body. */
export function placeholderSurfaceDescription(title: string, workOrder: string): string {
  return `${title} surface placeholder — the ${workOrder} work order implements the real projection.`;
}

/** Labels the registry binds into each placeholder surface instance. */
export interface PlaceholderToolSurfaceLabels {
  readonly toolId: TradingWorldToolId;
  readonly title: string;
  readonly ownerWorkOrder: string;
  readonly kind: string;
  readonly description: string;
  readonly icon: TradingWorldToolIcon;
}

/**
 * Create the placeholder surface component for one tool. The registry calls
 * this once per built-in tool; W007–W012 replace the result.
 */
export function createPlaceholderToolSurface(
  labels: PlaceholderToolSurfaceLabels,
): ComponentType<TradingWorldToolSurfaceProps> {
  const Icon = labels.icon;
  function PlaceholderToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-tool-status="placeholder"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
      >
        <div className="flex items-center gap-2 text-foreground">
          <Icon className="size-4 shrink-0 text-foreground-subtle" />
          <p className="text-ui-base font-medium">{labels.title}</p>
        </div>
        <span
          data-trading-world-simulation-disclosure=""
          title="Simulation disclosure — this world has no live execution authority (World Alpha)"
          className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
        >
          {TRADING_WORLD_SIMULATED_DISCLOSURE}
        </span>
        <p className="max-w-[18rem] text-ui-sm text-foreground-subtle">{labels.description}</p>
        <p
          data-trading-world-placeholder-owner=""
          className="font-mono text-ui-xs text-foreground-subtlest"
        >
          {labels.toolId} · {labels.ownerWorkOrder} · {labels.kind}/
        </p>
        <p
          data-trading-world-runtime=""
          data-trading-world-runtime-status={client.status}
          title="World client seam (W006): the deterministic engine + UI transport land with W013/W018"
          className="text-ui-xs text-foreground-subtlest"
        >
          {client.status === "unattached"
            ? "World runtime not attached — awaiting W013 engine / W018 transport"
            : `World runtime: ${client.status}`}
        </p>
        <p className="max-w-[18rem] text-ui-xs text-foreground-subtlest">
          Placeholder shows no market data — projections render real world state only.
        </p>
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }
  return PlaceholderToolSurface;
}

/** Class helper exported for the shell's hidden-surface containers. */
export function surfaceVisibilityClass(active: boolean): string {
  return cn(active ? "flex" : "hidden", "h-full min-h-0 flex-1");
}
