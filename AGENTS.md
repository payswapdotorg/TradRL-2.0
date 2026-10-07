# TradRL Engineering Contract

## Source of truth

This repository is authoritative. Do not depend on conversation history, worker memory, undocumented plans, or unstored assumptions.

Before changing behavior:

1. Read `spec/ARCHITECTURE-LOCK.md`.
2. Read the relevant domain spec.
3. Read the assigned Work Order in `spec/WORK-ITEMS.md`.
4. Verify the current `program/graph.json` base SHA/status.
5. Respect the Work Order write surface.

If implementation and repository specifications disagree, reconcile the repository specification before coding.

## Product boundary

TradRL extends the ZCode workbench rather than replacing it.

Existing ZCode infrastructure remains generic:

- desktop lifecycle
- browser
- terminal
- workspace/session handling
- docking / side-pane lifecycle
- RPC / shared transport
- platform abstraction
- UI primitives

TradRL owns:

- Market World
- market-domain contracts
- simulation
- trader UI
- financial state
- simulation clock
- world journal
- snapshot/branch semantics
- future agent/RL interfaces

Do not import trading-domain implementations into generic ZCode infrastructure.

## Architecture laws

- One authoritative owner per state.
- UI is a projection; never authoritative for world state.
- Commands enter the world through a typed command boundary.
- World changes emit ordered events and journal records.
- Simulation time, event time, availability time and wall time are distinct.
- Historical information is unavailable before `availableAt`.
- Rewind means immutable snapshot + branch, never destructive history mutation.
- Fixed engine/version/seed/command stream must produce deterministic results where promised.
- Human and AI traders use the same World Protocol.
- Arena is optional; core simulation, learning, evaluation and improvement run without Arena.
- Execution authority and risk gates live outside model prompts.
- Model labels never imply capability; capability selection is empirical.
- Simulation/live boundaries fail closed and remain visibly distinct.
- Generic protocols depend on domain contracts; UI depends on protocols, not concrete engines.

## Work Orders

Maximum active worker count: **3**.

One Work Order = one worker = one branch = one PR.

Workers must:

- start from the exact assigned base SHA;
- modify only the frozen write surface;
- keep changes reviewable and focused;
- add/modify tests before behavior changes;
- run required gates;
- record exact HEAD SHA and evidence;
- never amend/force-push after dispatch;
- never modify another worker's files;
- never edit shared root manifests/lockfiles unless explicitly authorized.

The TL owns shared-file serialization and merges.

## Concurrency

The TL must maximize concurrency subject to dependency and write-surface constraints.

A task is ready only when every dependency is merged.

Two tasks may run concurrently only when:

- dependency sets are satisfied;
- write surfaces are disjoint or an explicit exception exists;
- neither depends on unmerged behavior;
- shared fixtures remain contract-compatible.

Prefer three concurrent tasks whenever three safe independent ready items exist.

## Verification

Behavioral work requires, as applicable:

`pnpm typecheck`
`pnpm lint`
target-package tests
browser/E2E for UI
headless determinism tests for World changes

Never report a gate as passed without evidence.

## UI

Read `DESIGN.md` before UI changes.

Use existing ZCode shell, shared primitives, resizable panels and dnd-kit where possible.

Trading World must work on desktop and constrained Web layouts.

## Runtime boundary

- React renderer owns presentation.
- World runtime owns simulation truth.
- Desktop Main owns native capabilities, not trading state.
- Server/remote services are transport/persistence boundaries.
- External simulation engines sit behind adapter boundaries.

## Security

Never commit API keys, broker credentials or real account data.

World Alpha must not have live execution authority.

## Third-party software

Do not copy external code/assets until the technology is registered and permitted in `spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md`.

Licensing constraints are architecture constraints.
