# ZCode Integration Map

This file is the implementation map for the first TradRL feature inside the existing ZCode fork.

## Existing authoritative seams

### Outer shell

- packages/ui/src/app-shell/WorkspaceShellLayout.tsx
- packages/ui/src/app-shell/AnimatedSidePanePanel.tsx
- packages/ui/src/app-shell/animatedSidePanePanelModel.ts
- packages/ui/src/lib/workspaceSidePane.ts
- packages/ui/src/app-shell/SidePaneTabTrigger.tsx
- packages/ui/src/app-shell/SidePaneTabOverview.tsx
- packages/ui/src/hooks/useAppPanels.ts

These modules already own side-pane lifecycle, tab presentation, tab ordering, persistence and panel rendering.

### Layout

- packages/ui/src/components/ui/resizable.tsx
- packages/ui/src/v4/paneLayoutTree.ts
- packages/ui/src/v4/paneLayoutStore.ts
- packages/ui/src/v4/workbenchGroupStore.ts
- packages/ui/src/v4/V4WorkspaceChatArea.tsx

Use the existing resizable/dnd and workbench primitives before evaluating a new docking framework.

### Terminal reference

- packages/ui/src/Terminal.tsx
- packages/ui/src/terminal/terminalPanelState.ts
- packages/ui/src/SidePaneTerminalPane.tsx

Trading World should follow the same lifecycle principles: collapsing a panel is not destroying world state.

### Browser reference

- packages/ui/src/browser-use/
- packages/desktop/src/main/browserView/
- packages/ui/src/app-shell/AnimatedSidePanePanel.tsx

Browser's residency model is a useful reference for a long-lived world surface, but Trading World must not inherit browser-specific assumptions.

### Shared contracts / transport

- packages/shared/src/
- packages/rpc/src/
- packages/client/src/
- packages/server/src/

TradRL World contracts should be independent packages with explicit public entrypoints.

## Required first integration

Add a new discriminated WorkspaceSidePaneTab variant:

trading-world

Minimum tab identity:

- id
- type
- workspaceKey
- ownerTaskId/session scope if applicable
- openedAt
- worldId
- layoutProfileId

The outer shell only needs to:

1. recognize the tab;
2. render TradingWorldSidePane;
3. preserve its state/persistence rules;
4. expose normal activate/reorder/close behavior.

## Forbidden coupling

The following are prohibited:

- UI importing order-book implementation classes.
- WorkspaceShell knowing order-matching rules.
- Electron Main owning portfolio state.
- Browser/Terminal components depending on trading-world state.
- Trading World directly importing Nautilus/ABIDES/JAX-LOB types.
- Agent runtime owning Market World state.

## First implementation files

Prefer new files under:

packages/ui/src/trading-world/
packages/tradrl-world-contracts/
packages/tradrl-world-sim/

Only modify existing ZCode shell files at the exact minimal integration seam approved by W005.

## Advanced docking

FlexLayout is not a Phase-1 dependency. Evaluate it only after World Alpha if real acceptance requires nested tabsets/popouts that existing ZCode primitives cannot express without excessive complexity.
