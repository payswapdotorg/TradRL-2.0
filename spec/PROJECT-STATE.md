# TradRL Project State

Repository: payswapdotorg/TradRL-2.0
Upstream base: zai-org/zcode
Program: TRADRL-2.0

## Current program state

- All 67 work items (W001–W067) are merged; `program/graph.json` is authoritative for per-item status
- W067 (desktop application release packaging) MERGED 2026-10-16 as 4cb42ba: tag-triggered 4-target release workflow, SHA256-refusing quick installers, runbook. Released as **v3.14.3-tradrl.2** (2026-10-17, run 39003930654 6/6 green): 7 installers + SHASUMS256.txt. Release repairs merged after live E2E: R1 #69 = 28d7f08 (linux pacman libarchive-tools + governance workflow fix), R2 #70 = 0b30d87 (asset-name regex + matrix docs), R3 #71 = 39cf8b5 (installer rate-limit resilience — optional token auth + 403 diagnosis). Quick-installer E2E verified both paths 2026-10-17 (rate-limit diagnostic + authenticated full install, SHA256-verified)
- 2026-10-16: the root typecheck gate was found RED on the completion commit (TL battery: the W006/W018 `.d.ts` seam shims re-exported through relative paths, pulling the contracts/sim source closure into the ui composite program — the TS6059/TS6307 storm — plus 10 source-level errors in the W030 performance surface) and REPAIRED: PR #67, squash-merged as 1e315a5 — shims flipped to package specifiers (the 8cc3d82 precedent) + the source fixes; all gates green (typecheck 12/12 EXIT 0, lint 0 errors, governance PASS, W019 golden suite)
- World Alpha: complete (W013–W019, golden suite green)
- Agent/RL implementation: complete through Phase 5 (W032–W058)
- Arena: complete as the optional capability provider (W057)
- Maximum workers: 3

## Immediate objective

The 67-item program is complete and gate-verified. The operator-directed
objective (2026-10-16) — **an application downloadable and installable from
the GitHub repo** — is DELIVERED: release v3.14.3-tradrl.2 is live with
7 installers + SHASUMS256.txt, terminal-verified (SHA256 digests, .deb FHS
layout, Xvfb live launch + VLM UI confirmation) and quick-installer E2E green.
SIGN-01 (merged 0723125, 2026-10-17) landed the code-signing pre-research:
`docs/release/CODE-SIGNING.md` is the decision document + operator checklist
for the signing gate. Open operator decisions: the launch-gate sign-off, the
live-data pilot (production deployment mode, per W062/W065 deliverables), and
the signing-path choice + credentials (per CODE-SIGNING.md).

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
