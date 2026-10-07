# TradRL Complete Architecture

## 1. System

```
ZCode Workbench
  ├─ WorkspaceShell
  ├─ side panes
  ├─ Terminal
  ├─ Browser
  ├─ desktop/web runtime
  └─ shared transport
          │
          ▼
Trading World Surface
  ├─ layout
  ├─ tool registry
  └─ world client
          │
          ▼
World Protocol
  ├─ Query
  ├─ Command
  ├─ Clock
  └─ Evidence
          │
          ▼
World Runtime
  ├─ clock
  ├─ instruments
  ├─ market state
  ├─ order books
  ├─ matching
  ├─ accounts
  ├─ portfolio
  ├─ risk
  ├─ participants
  ├─ information
  ├─ journal
  └─ snapshots / branches
          │
      ┌───┼───────────────────┐
      ▼   ▼                   ▼
   Replay Reactive       Counterfactual
      │   │                   │
  Nautilus ABIDES       generative adapters
          │
          ▼
Future Intelligence Plane
  ├─ Agent Body
  ├─ Cognitive Substrate
  ├─ Possession
  ├─ Organization
  ├─ trajectory / experiment
  ├─ RL / non-RL learning
  ├─ evaluation
  ├─ Firm Brain
  └─ optional capability providers
```

## 2. ZCode boundary

Reuse existing ZCode:

- `WorkspaceShellLayout`
- `WorkspaceSidePaneTab` state
- `AnimatedSidePanePanel`
- `react-resizable-panels`
- `dnd-kit`
- Zustand
- Electron platform bridge
- web/server transport
- existing shared protocol patterns

TradRL should add the smallest adapter necessary to expose Trading World as a pane.

## 3. World client

The renderer owns presentation only:

- `TradingWorldSidePane`
- `TradingWorldApp`
- `world-client`
- `world-store`
- `world-layout`
- `world-tool-registry`
- `world-projections`

The client sends typed commands and consumes projections.

## 4. World runtime

The first runtime is TypeScript and deterministic. It must run in a Web Worker and headlessly in Node.

Modules:

- clock
- instrument
- market
- order
- orderbook
- matching
- execution
- account
- portfolio
- risk
- participant
- information
- journal
- snapshot
- branch

## 5. State

Instrument:

- id/symbol
- venue
- asset class
- quote currency
- tick size
- lot size
- precision
- trading state

Venue:

- matching rules
- order types
- fee schedule
- latency
- calendar
- halt/auction policy

Account:

- balances
- buying power
- margin
- leverage
- permissions

Position:

- quantity
- average entry
- mark price
- realized/unrealized P&L

## 6. Execution

World Alpha supports:

- market
- limit
- stop
- stop-limit
- IOC
- FOK
- post-only
- reduce-only
- cancel/replace

It models partial fills, fees, latency hooks, deterministic matching and rejection reasons.

## 7. Information world

Every information artifact has:

- id
- source
- createdAt
- availableAt
- scope
- provenance
- version

## 8. Simulation modes

### Exact historical replay
Immutable historical inputs; simulated trader actions.

### Reactive replay
Historical inputs plus endogenous participants.

### Counterfactual
Snapshot-derived child world with explicit altered scenario rules.

### Live mirror
Real observations with simulated positions/execution; never live execution.

## 9. Branching

A branch records:

- parentWorldId
- sourceSnapshotId
- branch configuration
- engine/version
- seed
- creation command
- provenance

Parent history is immutable.

## 10. Evidence

An evidence capsule connects:

observation → decision metadata → action → resulting state

No private model chain-of-thought is stored.

## 11. Analytical plane

High-volume analytical data uses Apache Arrow-compatible representations and Polars-compatible processing. Event and analytical planes are separate.

## 12. Future learning

Agent = Body possessed by Cognitive Substrate.

Organization discovers capabilities and composes Bodies.

Learning can use RL, offline RL, self-play, adversarial, evolutionary, imitation, preference, bandit or statistical methods depending on evidence.

## 13. Evaluation

Evaluation is constraint-aware and includes unseen periods, walk-forward, regime/asset/venue holdouts, execution stress, adversarial stress, organization ablations, model substitution and search-history integrity.

Raw P&L is never the sole objective.

## 14. Security

Execution authority is always outside model outputs. Tenant/project/world identity is explicit in persistence and transport.
