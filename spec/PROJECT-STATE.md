# TradRL Project State

Repository: payswapdotorg/TradRL-2.0
Upstream base: zai-org/zcode
Program: TRADRL-2.0

## Current program state

- W001: merged at 9f0e10924cac319261f7689b40ebe11988f772e9
- Current ready frontier: W002, W003
- World Alpha: not started
- Agent/RL implementation: gated behind World Alpha
- Arena: optional, non-blocking
- Maximum workers: 3

## Immediate objective

Build Trader World Alpha inside the existing ZCode workbench.

That means a first-class Trading World dockable surface backed by a real deterministic simulated market with order-book execution, portfolio/risk, clock, snapshots, branching, journal/evidence, headless parity and responsive UX.

## Authoritative state

program/graph.json is authoritative for Work Order status.

## Architectural decisions carried forward

- ZCode is the outer workbench.
- Trading World is the first product surface.
- Market World is the authoritative primitive.
- Human and AI use the same World Protocol.
- Agent = Body possessed by Cognitive Substrate.
- Capability discovery is empirical.
- Specialized models are chosen by measured capability, not labels.
- World fidelity modes are exact replay, reactive replay and counterfactual.
- Time Machine is point-in-time safe.
- Evaluation is constraint-aware and search-integrity aware.
- Firm Brain is tenant isolated.
- Arena is optional human expertise, never the core learning engine.
