/**
 * Trading World surface framework — W006 public entrypoint.
 *
 * Everything the ZCode shell and the W007–W012 tool surfaces need from the
 * trader cockpit framework lives under packages/ui/src/trading-world/:
 *
 * - `registry/` — the typed tool registry (W007–W012 slots, placeholder
 *   surfaces, override seam) plus `surfaces.ts`, the composition point.
 * - `layout/` — the world-side cockpit layout model, declarative profiles
 *   (default trader cockpit; W029 extends the catalogue) and persistence.
 * - `runtime/` — the typed world-client seam over the W003 four-port World
 *   Protocol: the fail-closed simulated noop (W006) and, since W018, the
 *   engine-backed transport provider (`engineWorldClient.ts` +
 *   `useEngineWorldClient.ts`) over the world adapter envelope.
 * - `components/` — the cockpit shell hosted inside the W005 pane.
 *
 * The registry contract types defined here are TradRL-UI-owned for now; if
 * they stabilize they can graduate to contracts/ui/ (a TL decision — see the
 * W006 PR notes).
 */

export {
  createTradingWorldCoreToolDescriptors,
  createTradingWorldCoreToolRegistry,
  createTradingWorldToolRegistry,
  TRADING_WORLD_CORE_TOOL_IDS,
} from "./registry/toolRegistry.js";
export type {
  TradingWorldPortMethod,
  TradingWorldToolDescriptor,
  TradingWorldToolHostingPhase,
  TradingWorldToolIcon,
  TradingWorldToolId,
  TradingWorldToolKind,
  TradingWorldToolRegistry,
  TradingWorldToolStatus,
  TradingWorldToolSurfaceComponent,
  TradingWorldToolSurfaceProps,
} from "./registry/toolRegistry.js";
export { tradingWorldSurfaceRegistry } from "./surfaces.js";

export {
  activateToolInCockpit,
  closeToolInCockpit,
  column,
  findToolPanelId,
  isToolOpen,
  listOpenToolIds,
  moveToolInCockpit,
  openToolInCockpit,
  panel,
  resetCockpitLayout,
  setClockStripHeightRatio,
  setClockStripOpen,
  setColumnWidthRatio,
  setColumnWidthRatios,
  setPanelHeightRatio,
  setPanelHeightRatios,
  TRADING_WORLD_CLOCK_STRIP_TOOL,
  TRADING_WORLD_EMPTY_PANEL_HINT,
} from "./layout/cockpitLayout.js";
export type {
  TradingWorldClockStripLayout,
  TradingWorldCockpitLayout,
  TradingWorldColumnId,
  TradingWorldColumnLayout,
  TradingWorldPanelId,
  TradingWorldPanelLayout,
} from "./layout/cockpitLayout.js";
export {
  clearSharedCockpitLayoutStores,
  cockpitLayoutStorageKey,
  createBrowserCockpitLayoutStorage,
  createCockpitLayoutStore,
  createInMemoryCockpitLayoutStorage,
  getSharedCockpitLayoutStore,
  normalizeCockpitLayout,
} from "./layout/cockpitLayoutPersistence.js";
export type {
  CockpitLayoutStorage,
  CockpitLayoutStoreOptions,
  TradingWorldCockpitLayoutStore,
} from "./layout/cockpitLayoutPersistence.js";
export {
  createDefaultTradingWorldCockpitLayout,
  createDefaultTradingWorldLayoutProfile,
  DEFAULT_TRADING_WORLD_LAYOUT_PROFILE_ID,
  resolveTradingWorldLayoutProfile,
} from "./layout/layoutProfiles.js";
export type { TradingWorldLayoutProfile } from "./layout/layoutProfiles.js";

export {
  createSimulatedNoopWorldClient,
  TRADING_WORLD_CLIENT_CONTEXT_DEFAULT,
  TradingWorldClientContext,
  TradingWorldRuntimeUnavailableError,
  useTradingWorldClient,
} from "./runtime/worldClient.js";
export type {
  TradingWorldClient,
  TradingWorldClientStatus,
} from "./runtime/worldClient.js";

// W018 — the engine-backed transport (provider + factory; the provider
// SELECTION still sits in components/TradingWorldShell.tsx, TL-wired).
export {
  attachEngineWorldClient,
  TradingWorldRemoteError,
  TradingWorldRuntimeMismatchError,
  TradingWorldTransportClosedError,
} from "./runtime/engineWorldClient.js";
export type {
  AttachEngineWorldClientInput,
  EngineWorldClient,
  EngineWorldHostSurface,
} from "./runtime/engineWorldClient.js";
export {
  createEngineWorldClientController,
  useEngineWorldClient,
} from "./runtime/useEngineWorldClient.js";
export type {
  EngineWorldClientController,
  UseEngineWorldClientInput,
} from "./runtime/useEngineWorldClient.js";

export { TradingWorldShell } from "./components/TradingWorldShell.js";
export type { TradingWorldShellProps } from "./components/TradingWorldShell.js";
export {
  createPlaceholderToolSurface,
  placeholderSurfaceDescription,
  TRADING_WORLD_SIMULATED_DISCLOSURE,
} from "./components/PlaceholderToolSurface.js";
