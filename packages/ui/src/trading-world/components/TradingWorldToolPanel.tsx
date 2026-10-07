/**
 * Cockpit dock panel — W006 shell rendering unit.
 *
 * One stable docking target (UX-DESIGN default cockpit cell): a tab stack of
 * docked tool surfaces. All OPEN tools stay mounted — the inactive tabs are
 * hidden with CSS, never unmounted, so tool state survives tab switches and
 * pane collapse (J-WORLD-02 hidden-panel continuation, the same law the outer
 * shell applies to the pane itself).
 */

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import type {
  TradingWorldPanelLayout,
} from "../layout/cockpitLayout.js";
import { TRADING_WORLD_EMPTY_PANEL_HINT } from "../layout/cockpitLayout.js";
import type {
  TradingWorldToolDescriptor,
  TradingWorldToolHostingPhase,
} from "../registry/toolRegistry.js";
import { surfaceVisibilityClass } from "./PlaceholderToolSurface.js";

export interface TradingWorldToolPanelProps {
  /** Panel layout slice (tools, active tab). */
  readonly panel: TradingWorldPanelLayout;
  /** Resolved descriptors for every docked tool (unknown ids are skipped). */
  readonly descriptors: readonly TradingWorldToolDescriptor[];
  /** Opaque world identity / profile passed through to the surfaces. */
  readonly worldId: string;
  readonly layoutProfileId: string;
  /** Pane presentation phase (mounted-focused vs mounted-hidden). */
  readonly paneFocused: boolean;
  readonly onActivateTool: (toolId: TradingWorldToolDescriptor["id"]) => void;
  readonly onCloseTool: (toolId: TradingWorldToolDescriptor["id"]) => void;
}

/** Host one dock panel: tab strip + mounted surfaces + empty-dock state. */
export function TradingWorldToolPanel({
  panel,
  descriptors,
  worldId,
  layoutProfileId,
  paneFocused,
  onActivateTool,
  onCloseTool,
}: TradingWorldToolPanelProps) {
  const phase: TradingWorldToolHostingPhase = paneFocused
    ? "mounted-focused"
    : "mounted-hidden";
  if (descriptors.length === 0) {
    return (
      <section
        data-trading-world-panel={panel.id}
        data-trading-world-panel-empty="true"
        aria-label={`${panel.id} dock (empty)`}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/50 bg-surface"
      >
        <header className="flex h-8 shrink-0 items-center border-b border-border/50 px-2">
          <span className="font-mono text-ui-xs uppercase tracking-wide text-foreground-subtlest">
            {panel.id}
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3 text-center">
          <p className="text-ui-sm text-foreground-subtle">No tool docked</p>
          <p className="max-w-[16rem] text-ui-xs text-foreground-subtlest">
            {TRADING_WORLD_EMPTY_PANEL_HINT}
          </p>
        </div>
      </section>
    );
  }
  const activeToolId = panel.activeToolId ?? descriptors[0]!.id;
  return (
    <section
      data-trading-world-panel={panel.id}
      aria-label={`${panel.id} dock`}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/50 bg-surface"
    >
      <header
        role="tablist"
        aria-label={`${panel.id} tools`}
        className="flex h-8 shrink-0 items-stretch gap-0.5 border-b border-border/50 px-1"
      >
        {descriptors.map((descriptor) => {
          const active = descriptor.id === activeToolId;
          return (
            <span
              key={descriptor.id}
              className={cn(
                "group/tab flex items-center gap-1.5 rounded-t-sm border-b-2 px-2",
                active
                  ? "border-b-foreground/70 bg-surface-hover text-foreground"
                  : "border-b-transparent text-foreground-subtle hover:text-foreground",
              )}
            >
              <descriptor.icon
                className={cn("size-3.5 shrink-0", !active && "text-foreground-subtle")}
              />
              <button
                type="button"
                role="tab"
                aria-selected={active}
                data-trading-world-tool-tab={descriptor.id}
                data-active={active ? "true" : "false"}
                tabIndex={active ? 0 : -1}
                onClick={() => onActivateTool(descriptor.id)}
                className="truncate py-1 text-ui-sm outline-none focus-visible:underline"
              >
                {descriptor.title}
              </button>
              {active ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Close ${descriptor.title}`}
                  data-trading-world-tool-close={descriptor.id}
                  className="size-5 shrink-0"
                  onClick={() => onCloseTool(descriptor.id)}
                >
                  <XIcon className="size-3" />
                </Button>
              ) : null}
            </span>
          );
        })}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {descriptors.map((descriptor) => {
          const active = descriptor.id === activeToolId;
          const Surface = descriptor.surface;
          return (
            <div key={descriptor.id} className={surfaceVisibilityClass(active)}>
              <Surface
                toolId={descriptor.id}
                worldId={worldId}
                layoutProfileId={layoutProfileId}
                active={active}
                phase={active ? phase : "mounted-hidden"}
                onRequestClose={() => onCloseTool(descriptor.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
