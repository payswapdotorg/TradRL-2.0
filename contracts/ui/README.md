# contracts/ui — Trading World side-pane lifecycle contract

This directory is the canonical UI-side contracts surface for TradRL
(spec/ZCODE-INTEGRATION-MAP.md "Shared contracts", W005 write surface).

It is type-only and dependency-free: no runtime, no framework imports, no
package manifest. The ZCode shell implementation
(`packages/ui/src/lib/workspaceSidePane*`, `packages/ui/src/app-shell/*`)
satisfies it; `packages/ui/test/tradingWorldSidePane.test.ts` guards drift
against the real registry functions.

## Files

- `src/trading-world-side-pane.ts` — the lifecycle + registration contract:

  - `TradingWorldSidePaneTabContract` — the persisted tab identity
    (id / type / workspaceKey / ownerTaskId / openedAt / worldId /
    layoutProfileId) the shell round-trips through its existing side-pane
    persistence.
  - `TradingWorldSurfaceHostingPhase` — `unmounted` / `mounted-hidden` /
    `mounted-focused`. Collapse is NOT destroy (J-WORLD-02); close unmounts.
  - `TradingWorldSurfacePropsContract` — what the shell passes to a hosted
    surface (tab identity, visible, focused, onClose). Resize is
    layout-driven; there is no imperative controller.
  - `TradingWorldPanelTypeRegistrationContract` — what the shell needs from
    a panel type: kind, fixed title, icon, default outer layout.

## Laws encoded here

1. The shell stays generic: it never learns markets, orders, or portfolios.
   `worldId` and `layoutProfileId` are opaque strings — TradRL surfaces
   (W006+) own their meaning. The forbidden-key test below makes importing
   trading-domain concepts into this contract a compile failure.
2. Outer state (open / collapsed / size / order / active / persistence) is
   shell-owned and rides the existing `WorkspaceSidePaneState` path. Trading
   World adds no second docking or persistence system (A1).
3. Simulation must be visibly and persistently disclosed
   (`SIMULATED · HISTORICAL` or the appropriate world mode; never color
   alone) — ACCEPTANCE-WORLD-ALPHA K, UX-DESIGN "Simulation disclosure".
4. The hosted surface must survive `mounted-hidden` with its internal state
   intact; only closing (unmount) may drop renderer-local state.

## Verification

```sh
node_modules/.bin/tsc -p contracts/ui          # typecheck (includes test/)
node_modules/.bin/tsx --test contracts/ui/test/*.test.ts   # contract tests
```

See the W005 PR for the ui-side behavioral drift guard.
