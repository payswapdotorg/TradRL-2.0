/**
 * Trading World side-pane lifecycle contract — UI side.
 *
 * This is the canonical, UI-side seam contract for hosting a `trading-world`
 * panel inside the ZCode outer shell (spec/ZCODE-INTEGRATION-MAP.md
 * "Required first integration", spec/ARCHITECTURE-LOCK.md A1/A2, W005).
 *
 * The contract is deliberately TYPE-ONLY and dependency-free:
 *
 * - It declares what the generic ZCode shell needs from a "Trading World"
 *   panel type (registration) and what a hosted Trading World surface
 *   receives from the shell (hosting/lifecycle).
 * - It must never declare trading-domain types. `worldId` and
 *   `layoutProfileId` are OPAQUE strings to the shell: the shell persists and
 *   scopes them, TradRL (W006+) owns their meaning. This is the product
 *   boundary law from AGENTS.md ("Do not import trading-domain
 *   implementations into generic ZCode infrastructure") expressed as types —
 *   see the forbidden-key assertions in `test/tradingWorldSidePane.test.ts`.
 *
 * The concrete implementation of this seam lives in the ZCode shell repo
 * surface granted to W005:
 *
 * - `packages/ui/src/lib/workspaceSidePane.ts` — tab identity + lifecycle
 *   state functions (`TradingWorldSidePaneTab`,
 *   `openTradingWorldSidePane`, `toggleTradingWorldSidePane`,
 *   `closeTradingWorldSidePane`) and membership in `WorkspaceSidePaneTab`.
 * - `packages/ui/src/app-shell/TradingWorldSidePane.tsx` — the hosted
 *   placeholder surface component + presentation constants.
 * - `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx` — render branch,
 *   tab strip, and (callback-gated) open-tab launcher integration.
 *
 * Drift between this contract and the implementation is guarded by
 * `packages/ui/test/tradingWorldSidePane.test.ts`, which checks the minimum
 * tab identity and lifecycle semantics against the real registry functions.
 */

/**
 * The discriminated side-pane tab kind the shell registers for Trading World.
 * Mirrors `WorkspaceSidePaneTab["type"]` member `"trading-world"`.
 */
export type TradingWorldPanelTypeKind = "trading-world";

/**
 * Persisted tab identity for a Trading World side-pane tab.
 *
 * Mirrors `TradingWorldSidePaneTab` in
 * `packages/ui/src/lib/workspaceSidePane.ts` and the minimum tab identity
 * required by spec/ZCODE-INTEGRATION-MAP.md: id, type, workspaceKey,
 * owner/session scope, openedAt, worldId, layoutProfileId.
 *
 * Laws:
 * - `id` is structural (`trading-world:<encoded workspaceKey>:<encoded
 *   worldId>`), so re-opening the same world focuses the existing tab
 *   instead of duplicating it (same rule as `bash-output` / `git` tabs).
 * - `workspaceKey` scopes the tab to one workspace: the tab is visible for
 *   every conversation of that workspace and hidden in other workspaces.
 * - `worldId` / `layoutProfileId` are opaque. The shell MUST NOT branch on
 *   their content; only TradRL surfaces interpret them.
 * - Outer state (open / collapsed / size / order / active) is owned by the
 *   shell's existing side-pane persistence; the tab identity is the only
 *   Trading World data it carries.
 */
export interface TradingWorldSidePaneTabContract {
  /** Stable structural tab id; keys React mounting and tab focus. */
  readonly id: string;
  /** Discriminator; always {@link TradingWorldPanelTypeKind}. */
  readonly type: TradingWorldPanelTypeKind;
  /** Conversation ownership frozen at open time; null = draft scope. */
  readonly ownerTaskId?: string | null;
  /** Workspace isolation key (workspaceIdentity || workspacePath). */
  readonly workspaceKey: string;
  /** Epoch ms when the tab was first opened. */
  readonly openedAt?: number;
  /** Opaque world identity (TradRL-owned; never interpreted by the shell). */
  readonly worldId: string;
  /** Opaque layout profile / preset reference (TradRL-owned, see W029). */
  readonly layoutProfileId: string;
}

/** Request shape for opening (or focusing) a Trading World side-pane tab. */
export interface OpenTradingWorldSidePaneRequestContract {
  readonly workspaceKey: string;
  readonly worldId: string;
  readonly layoutProfileId: string;
  readonly ownerTaskId?: string | null;
}

/**
 * Hosting phases the shell drives a mounted surface through.
 *
 * - `unmounted`: tab closed (or never opened). The surface MUST NOT assume
 *   its internal state survived; world-truth lives outside the renderer.
 * - `mounted-hidden`: mounted but not presented (side pane collapsed, or
 *   another tab is active). State MUST survive — collapsing a panel is not
 *   destroying world state (J-WORLD-02). Implemented today via force-mounted
 *   tab content hidden by CSS plus the panel's mount latch.
 * - `mounted-focused`: mounted and presented to the user.
 */
export type TradingWorldSurfaceHostingPhase =
  | "unmounted"
  | "mounted-hidden"
  | "mounted-focused";

/**
 * Props the shell passes to a hosted Trading World surface component.
 *
 * Mirrors what the shell actually passes to existing panes (Terminal:
 * `isVisible`; subagent/actor panes: `focused`; Model trajectory:
 * `onClose`). There is no imperative mount/unmount/focus/resize API:
 * lifecycle follows React mounting under the phases above, resize is
 * layout-driven (the surface fills its container and observes its own
 * size), and closing goes through the shell's generic close path.
 */
export interface TradingWorldSurfacePropsContract {
  /** Persisted tab identity (the shell-owned outer state). */
  readonly tab: TradingWorldSidePaneTabContract;
  /** True when the side pane is presented at all (independent of activity). */
  readonly visible: boolean;
  /** True when this tab is the presented, active tab (`visible && active`). */
  readonly focused: boolean;
  /** Ask the shell to close this tab through the generic close path. */
  readonly onClose: () => void;
}

/**
 * A Trading World surface component the shell can host. Structural (a
 * function from props to a renderable) so this contract stays
 * dependency-free; the implementation is a React function component.
 */
export type TradingWorldSurfaceComponentContract = (
  props: TradingWorldSurfacePropsContract,
) => unknown;

/**
 * Icon contract for the tab strip / launcher. Structural stand-in for a
 * lucide icon component; the shell renders it with a `className`.
 */
export type TradingWorldPanelIconContract = (
  props: { readonly className?: string },
) => unknown;

/**
 * Default outer layout of the panel. Mirrors the shell's standard animated
 * side-pane layout (`resolveAnimatedSidePanePanelLayout` /
 * `SIDE_PANE_DEFAULT_EXPANDED_RATIO`); Trading World does not introduce a
 * second docking system (ARCHITECTURE-LOCK A1).
 */
export interface TradingWorldPaneLayoutProfileContract {
  /** Minimum expanded width in px. */
  readonly minWidthPx: number;
  /** Maximum expanded width as a ratio of the workspace area (0–1). */
  readonly maxWidthRatio: number;
  /** Default expanded width as a ratio of the workspace area (0–1). */
  readonly defaultWidthRatio: number;
  /** Collapsed width in px. */
  readonly collapsedWidthPx: number;
}

/**
 * What the shell needs from a Trading World panel type registration
 * (the pane-type pattern every existing pane follows): a kind, presentation,
 * a default layout, and lifecycle functions in the side-pane registry.
 */
export interface TradingWorldPanelTypeRegistrationContract {
  readonly kind: TradingWorldPanelTypeKind;
  /** Fixed display title (product name; TradRL-owned). */
  readonly title: string;
  readonly icon: TradingWorldPanelIconContract;
  readonly defaultLayout: TradingWorldPaneLayoutProfileContract;
}
