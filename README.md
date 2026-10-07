# TradRL

TradRL is a trader operating environment built from the ZCode workbench.

The repository is the **sole source of truth** for product architecture, implementation scope, work-order state, contracts, acceptance criteria, and engineering decisions. Chat history is non-authoritative.

## Product north star

TradRL turns the ZCode desktop/web workbench into an AI-native trader workspace.

The central primitive is a **Market World** that a human or AI trader can inhabit, observe, control, replay, branch, and eventually train against.

The first implementation milestone is **Trader World Alpha**: a complete dockable simulated trading environment. Agent/RL infrastructure follows only after the world itself is useful.

## Architectural layers

```
ZCode Workbench
  ├─ desktop / Electron
  ├─ web
  ├─ terminal
  ├─ browser
  ├─ workspace / sessions / docking
  └─ shared protocols
          │
          ▼
TradRL World
  ├─ Market World Protocol
  ├─ simulation runtime
  ├─ trader UI
  ├─ clock / replay / branching
  ├─ orders / execution
  ├─ portfolio / risk
  ├─ information world
  └─ evidence / provenance
          │
          ▼
Future learning plane
  ├─ Agent Body
  ├─ Cognitive Substrate
  ├─ Organization
  ├─ RL / other learning
  ├─ evaluation / search integrity
  ├─ Firm Brain
  └─ optional Arena capability provider
```

## Upstream lineage

This repository is based on the public `zai-org/zcode` codebase. The existing ZCode workbench is retained where valuable. TradRL-specific code must remain behind explicit boundaries instead of leaking trading-domain assumptions into generic ZCode infrastructure.

Upstream-inspired infrastructure is not automatically approved for direct code copying. See `spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md`.

## Source of truth

Read:

- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/ARCHITECTURE.md`
- `spec/WORLD-PROTOCOL.md`
- `spec/UX-DESIGN.md`
- `spec/WORK-ITEMS.md`
- `program/graph.json`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/WORKER-RUNBOOK.md`
- `docs/LLM-ARCHITECT-HANDOFF.md`

If chat and repository disagree, **the repository wins**.

## First milestone

Trader World Alpha must prove:

- opens as a normal ZCode dockable surface beside Terminal/Browser;
- has a real simulated market, order book, order entry, execution, account, portfolio and risk;
- has a real simulation clock with play/pause/step/speed/seek;
- supports immutable snapshots and branching;
- is deterministic under fixed engine/version/seed/commands;
- has an event journal and provenance;
- can run headless without the Agent or Arena;
- uses one authoritative world state with UI projections.

## Existing ZCode development

Retain existing upstream commands until corresponding TradRL Work Orders explicitly migrate them. Do not rename or delete upstream subsystems merely for branding.

Maximum concurrent worker count: **3**.
