# TradRL 2.0 — Final TL Handoff

A fresh Tech Lead can implement the architecture using this repository alone.

## Mission

Turn the ZCode fork into TradRL by first delivering a complete simulated trader world as a dockable workspace, then progressively attach high-fidelity simulation, Agent Bodies, Cognitive Substrates, organizations, learning, evaluation, Firm Brain, optional Arena and production integrations.

## Immediate implementation

World Alpha:

- Trading World dockable side-pane
- trader cockpit
- deterministic synthetic market
- order book/matching
- order ticket
- fills
- portfolio
- risk
- simulation clock
- snapshot/branch
- journal/evidence
- headless runner
- deterministic parity
- responsive UI

## Preferred open-source stack

- ZCode: outer workbench
- Lightweight Charts: charts
- Perspective: dense streaming tables
- Arrow + Polars: analytical data
- NautilusTrader: high-fidelity replay/execution adapter
- ABIDES: reactive population adapter
- JAX-LOB: RL-scale simulator
- LEAN/Hummingbot/OpenBB/CCXT: references or later adapters
- FlexLayout: only if internal World docking later requires it

See the third-party register before integrating.

## Concurrency

Three-worker pattern:

Wave A: W001 / then W002 + W003
Wave B: W004 + W005
Wave C: W006 + W013 + W002/other safe ready work
Wave D: W007 + W008 + W009
Wave E: W010 + W011 + W012
Wave F: W014 + W015 + W016
Wave G: W017 + W018 + W029 or another independent ready task
Wave H: W019 acceptance/integration followed by Phase 2.

Exact dispatch always comes from graph readiness and current main SHA.

## Worker contract

Each worker owns one Work Order and one branch.

No worker may touch another worker's frozen surface.

Root manifests and shared files are serialized by the TL.

## Architecture invariants

World state is authoritative outside the UI.

Human and AI use one command protocol.

Time and information availability are explicit.

Rewind branches immutable snapshots.

Arena is optional.

Execution authority is outside prompts.

Capability/role/model selection is empirical.

## Completion

Do not declare World Alpha complete until its acceptance document is green.

Do not declare the overall architecture complete until every Work Order in graph.json is merged and production/evidence gates pass.
