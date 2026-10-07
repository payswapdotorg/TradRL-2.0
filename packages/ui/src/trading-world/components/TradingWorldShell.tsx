/**
 * Trading World cockpit shell — W006 mount integration.
 *
 * The world-side surface hosted inside the W005 pane: it interprets the
 * pane tab's opaque `worldId` / `layoutProfileId`, resolves the declarative
 * layout profile, hydrates the persisted layout adjustments (per
 * (workspaceKey, layoutProfileId) scope) and renders the trader cockpit —
 * the UX-DESIGN default grid of dock panels + the simulation-clock strip.
 *
 * Outer shell still owns open/focus/reorder/close/persist of the PANE (A1/
 * A2); this shell owns the layout INSIDE the pane only. Every W007–W012
 * tool surface mounts through the tool registry; until those work orders
 * land they render as clearly-labeled placeholders. World data flows only
 * through the fail-closed world-client seam (W018 wires the real runtime).
 */

import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { Group } from "react-resizable-panels";
import {
  CheckIcon,
  ChevronDownIcon,
  RotateCcwIcon,
  TimerIcon,
  WrenchIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable.js";
import type { TradingWorldSidePaneTab } from "@/lib/workspaceSidePane.js";
import {
  closeToolInCockpit,
  openToolInCockpit,
  resetCockpitLayout,
  setClockStripHeightRatio,
  setColumnWidthRatios,
  setPanelHeightRatios,
  isToolOpen,
  type TradingWorldCockpitLayout,
} from "../layout/cockpitLayout.js";
import {
  cockpitLayoutStorageKey,
  getSharedCockpitLayoutStore,
} from "../layout/cockpitLayoutPersistence.js";
import { resolveTradingWorldLayoutProfile } from "../layout/layoutProfiles.js";
import {
  type TradingWorldToolId,
  type TradingWorldToolRegistry,
} from "../registry/toolRegistry.js";
import { tradingWorldSurfaceRegistry } from "../surfaces.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
} from "../runtime/worldClient.js";
import { TradingWorldToolPanel } from "./TradingWorldToolPanel.js";

export interface TradingWorldShellProps {
  /** Persisted pane tab identity (shell-owned outer state, W005). */
  readonly tab: TradingWorldSidePaneTab;
  /** Side pane presented at all (independent of tab activity). */
  readonly visible: boolean;
  /** This tab is the presented, active tab (`visible && active`). */
  readonly focused: boolean;
  /** Registry override (tests / future composition points). */
  readonly registry?: TradingWorldToolRegistry;
}

/** The world-side trader cockpit hosted inside the W005 pane. */
export function TradingWorldShell({
  tab,
  visible,
  focused,
  registry: registryOverride,
}: TradingWorldShellProps) {
  const registry = useMemo(
    () => registryOverride ?? tradingWorldSurfaceRegistry,
    [registryOverride],
  );
  const profile = useMemo(
    () => resolveTradingWorldLayoutProfile(tab.layoutProfileId),
    [tab.layoutProfileId],
  );
  const knownToolIds = useMemo(
    () => new Set(registry.listTools().map((descriptor) => descriptor.id)),
    [registry],
  );
  const store = useMemo(
    () =>
      getSharedCockpitLayoutStore(
        cockpitLayoutStorageKey(tab.workspaceKey, tab.layoutProfileId),
        profile.layout,
        knownToolIds,
      ),
    [tab.workspaceKey, tab.layoutProfileId, profile.layout, knownToolIds],
  );
  const layout = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getServerState,
  );
  // Uncontrolled resizable groups re-seed their ratios only on remount;
  // "reset layout" bumps this epoch to re-mount them from the profile base.
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const worldClient = useMemo(() => createSimulatedNoopWorldClient(tab.worldId), [tab.worldId]);

  const updateLayout = (next: TradingWorldCockpitLayout) => store.setState(next);
  const openTool = (toolId: TradingWorldToolId) =>
    updateLayout(openToolInCockpit(layout, toolId, registry));
  const closeTool = (toolId: TradingWorldToolId) =>
    updateLayout(closeToolInCockpit(layout, toolId));
  const resetLayout = () => {
    updateLayout(resetCockpitLayout(profile.layout));
    setLayoutEpoch((epoch) => epoch + 1);
  };

  return (
    <TradingWorldClientContext.Provider value={worldClient}>
      <div
        data-trading-world-cockpit=""
        data-trading-world-profile={tab.layoutProfileId}
        data-trading-world-focused={focused ? "true" : "false"}
        data-trading-world-visible={visible ? "true" : "false"}
        className="flex h-full min-h-0 flex-col bg-background"
      >
        <TradingWorldCockpitToolbar
          tab={tab}
          profileLabel={profile.label}
          layout={layout}
          registry={registry}
          runtimeStatus={worldClient.status}
          onOpenTool={openTool}
          onCloseTool={closeTool}
          onResetLayout={resetLayout}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <Group
            key={`cockpit-root-${layoutEpoch}`}
            orientation="vertical"
            className="flex h-full w-full"
            defaultLayout={{
              "cockpit-main": 8,
              ...(layout.clockStrip.open ? { "clock-strip": layout.clockStrip.heightRatio } : {}),
            }}
            onLayoutChanged={(changed) => {
              const stripRatio = changed["clock-strip"];
              if (stripRatio !== undefined) {
                updateLayout(setClockStripHeightRatio(layout, stripRatio));
              }
            }}
          >
            <ResizablePanel id="cockpit-main" className="flex min-h-0 flex-col">
              <Group
                key={`cockpit-columns-${layoutEpoch}`}
                orientation="horizontal"
                className="flex h-full w-full gap-1 p-1"
                defaultLayout={Object.fromEntries(
                  layout.columns.map((columnLayout) => [
                    columnLayout.id,
                    columnLayout.widthRatio,
                  ]),
                )}
                onLayoutChanged={(changed) =>
                  updateLayout(setColumnWidthRatios(layout, changed))
                }
              >
                {layout.columns.map((columnLayout, columnIndex) => (
                  <ResizablePanel
                    key={columnLayout.id}
                    id={columnLayout.id}
                    className="flex min-h-0 flex-col"
                  >
                    <Group
                      key={`cockpit-column-${columnLayout.id}-${layoutEpoch}`}
                      orientation="vertical"
                      className="flex h-full w-full gap-1"
                      defaultLayout={Object.fromEntries(
                        columnLayout.panels.map((panelLayout) => [
                          panelLayout.id,
                          panelLayout.heightRatio,
                        ]),
                      )}
                      onLayoutChanged={(changed) =>
                        updateLayout(
                          setPanelHeightRatios(layout, columnLayout.id, changed),
                        )
                      }
                    >
                      {columnLayout.panels.map((panelLayout, panelIndex) => (
                        <Fragment key={panelLayout.id}>
                          {panelIndex > 0 ? <ResizableHandle /> : null}
                          <ResizablePanel
                            id={panelLayout.id}
                            className="flex min-h-0 flex-col"
                          >
                            <TradingWorldToolPanel
                              panel={panelLayout}
                              descriptors={panelLayout.tools.flatMap((toolId) => {
                                const descriptor = registry.getTool(toolId);
                                return descriptor ? [descriptor] : [];
                              })}
                              worldId={tab.worldId}
                              layoutProfileId={tab.layoutProfileId}
                              paneFocused={visible && focused}
                              onActivateTool={(toolId) =>
                                updateLayout(
                                  openToolInCockpit(layout, toolId, registry),
                                )
                              }
                              onCloseTool={closeTool}
                            />
                          </ResizablePanel>
                        </Fragment>
                      ))}
                    </Group>
                    {columnIndex < layout.columns.length - 1 ? <ResizableHandle /> : null}
                  </ResizablePanel>
                ))}
              </Group>
            </ResizablePanel>
            {layout.clockStrip.open ? (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="clock-strip"
                  className="flex min-h-0 flex-col px-1 pb-1"
                >
                  <TradingWorldClockStrip
                    layout={layout}
                    registry={registry}
                    worldId={tab.worldId}
                    layoutProfileId={tab.layoutProfileId}
                    paneFocused={visible && focused}
                    onCloseTool={closeTool}
                    onActivateTool={(toolId) =>
                      updateLayout(openToolInCockpit(layout, toolId, registry))
                    }
                  />
                </ResizablePanel>
              </>
            ) : null}
          </Group>
        </div>
      </div>
    </TradingWorldClientContext.Provider>
  );
}

interface TradingWorldCockpitToolbarProps {
  readonly tab: TradingWorldSidePaneTab;
  readonly profileLabel: string;
  readonly layout: TradingWorldCockpitLayout;
  readonly registry: TradingWorldToolRegistry;
  readonly runtimeStatus: string;
  readonly onOpenTool: (toolId: TradingWorldToolId) => void;
  readonly onCloseTool: (toolId: TradingWorldToolId) => void;
  readonly onResetLayout: () => void;
}

function TradingWorldCockpitToolbar({
  tab,
  profileLabel,
  layout,
  registry,
  runtimeStatus,
  onOpenTool,
  onCloseTool,
  onResetLayout,
}: TradingWorldCockpitToolbarProps) {
  return (
    <div
      data-trading-world-toolbar=""
      className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2"
    >
      <span
        data-trading-world-id=""
        title="Opaque world identity persisted by the workspace shell"
        className="shrink-0 rounded-sm border border-border bg-surface px-1.5 font-mono text-ui-xs leading-5 text-foreground-subtle"
      >
        {tab.worldId}
      </span>
      <span
        data-trading-world-profile-label=""
        title="Layout profile (W029 extends the preset catalogue)"
        className="shrink-0 text-ui-xs text-foreground-subtle"
      >
        {profileLabel}
      </span>
      <span
        data-trading-world-runtime=""
        data-trading-world-runtime-status={runtimeStatus}
        title="World client seam: the deterministic engine + UI transport land with W013/W018"
        className="shrink-0 text-ui-xs text-foreground-subtlest"
      >
        runtime: {runtimeStatus}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-trading-world-tools-menu=""
              aria-label="Open or close cockpit tools"
            >
              <WrenchIcon className="size-3.5" />
              <span className="text-ui-sm">Tools</span>
              <ChevronDownIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {registry.listTools().map((descriptor) => {
              const open = isToolOpen(layout, descriptor.id);
              return (
                <DropdownMenuItem
                  key={descriptor.id}
                  data-trading-world-tools-menu-item={descriptor.id}
                  onSelect={() => (open ? onCloseTool(descriptor.id) : onOpenTool(descriptor.id))}
                >
                  <span className="flex size-4 items-center justify-center">
                    {open ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  <descriptor.icon className="size-4" />
                  <span>{descriptor.title}</span>
                  <span className="ml-auto font-mono text-ui-xs text-foreground-subtlest">
                    {descriptor.ownerWorkOrder}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-trading-world-clock-toggle=""
          aria-label={
            layout.clockStrip.open ? "Hide simulation clock strip" : "Show simulation clock strip"
          }
          onClick={() =>
            layout.clockStrip.open ? onCloseTool("simulation-clock") : onOpenTool("simulation-clock")
          }
        >
          <TimerIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-trading-world-reset-layout=""
          aria-label="Reset cockpit layout to profile default"
          onClick={onResetLayout}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

interface TradingWorldClockStripProps {
  readonly layout: TradingWorldCockpitLayout;
  readonly registry: TradingWorldToolRegistry;
  readonly worldId: string;
  readonly layoutProfileId: string;
  readonly paneFocused: boolean;
  readonly onActivateTool: (toolId: TradingWorldToolId) => void;
  readonly onCloseTool: (toolId: TradingWorldToolId) => void;
}

/** Full-width simulation-clock strip (W012 tool host; placeholder inside). */
function TradingWorldClockStrip({
  registry,
  worldId,
  layoutProfileId,
  paneFocused,
  onCloseTool,
}: TradingWorldClockStripProps) {
  const descriptor = registry.getTool("simulation-clock");
  const Surface = descriptor?.surface;
  return (
    <section
      data-trading-world-clock-strip=""
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/50 bg-surface"
    >
      {Surface ? (
        <Surface
          toolId="simulation-clock"
          worldId={worldId}
          layoutProfileId={layoutProfileId}
          active
          phase={paneFocused ? "mounted-focused" : "mounted-hidden"}
          onRequestClose={() => onCloseTool("simulation-clock")}
        />
      ) : null}
    </section>
  );
}
