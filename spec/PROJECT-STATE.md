# TradRL Project State

Repository: payswapdotorg/TradRL-2.0
Upstream base: zai-org/zcode
Program: TRADRL-2.0

## Current program state

- All 66 work items (W001–W066) are merged; `program/graph.json` is authoritative for per-item status
- Ready frontier: empty (last recompute after W066, PR #66)
- 2026-10-16: the root typecheck gate was found RED on the completion commit (TL battery: the W006/W018 `.d.ts` seam shims re-exported through relative paths, pulling the contracts/sim source closure into the ui composite program — the TS6059/TS6307 storm — plus 10 source-level errors in the W030 performance surface) and REPAIRED: PR #67, squash-merged as 1e315a5 — shims flipped to package specifiers (the 8cc3d82 precedent) + the source fixes; all gates green (typecheck 12/12 EXIT 0, lint 0 errors, governance PASS, W019 golden suite)
- World Alpha: complete (W013–W019, golden suite green)
- Agent/RL implementation: complete through Phase 5 (W032–W058)
- Arena: complete as the optional capability provider (W057)
- Maximum workers: 3

## Immediate objective

The 66-item implementation program is complete and gate-verified. The pending
human step is the operator's launch-gate sign-off. The live-data pilot
decision (production deployment mode) remains open per W062/W065 deliverables.

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
