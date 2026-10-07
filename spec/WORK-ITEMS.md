# TradRL Implementation Program

Program: TRADRL-2.0
Maximum concurrent workers: 3
One Work Order = one worker = one branch = one PR.

The full architecture is specified before implementation so a fresh TL can execute without chat context.

## Foundation
- W001 Repository TradRL governance/source-of-truth setup. deps: none. surface: root docs, program, spec, docs, scripts, CI.
- W002 Third-party technology/license gate. deps: W001. surface: spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md.
- W003 Canonical trading/world domain contracts. deps: W001. surface: packages/tradrl-world-contracts/, contracts/world/.
- W004 Market event/time/information contracts. deps: W003. surface: packages/tradrl-world-contracts/time/, contracts/world/time/.

## ZCode Trading World integration
- W005 Trading World side-pane lifecycle contract. deps: W001,W003. surface: packages/ui/src/lib/workspaceSidePane*, packages/ui/src/app-shell/* integration seam, contracts/ui/.
- W006 Trading World shell/tool registry. deps: W005. surface: packages/ui/src/trading-world/.
- W007 Chart surface. deps: W003,W006. surface: packages/ui/src/trading-world/charts/.
- W008 Watchlist/market overview. deps: W003,W006. surface: packages/ui/src/trading-world/market/.
- W009 DOM/order-book + Time & Sales. deps: W003,W006. surface: packages/ui/src/trading-world/orderbook/.
- W010 Order ticket/order lifecycle UI. deps: W003,W006. surface: packages/ui/src/trading-world/orders/.
- W011 Portfolio/positions/risk UI. deps: W003,W006. surface: packages/ui/src/trading-world/portfolio/.
- W012 Simulation clock/timeline UI. deps: W004,W006. surface: packages/ui/src/trading-world/simulation/.

## Deterministic World Alpha
- W013 Headless deterministic World engine skeleton. deps: W003,W004. surface: packages/tradrl-world-sim/clock, world, journal.
- W014 Order book + matching engine. deps: W013. surface: packages/tradrl-world-sim/orderbook, matching.
- W015 Account/portfolio/risk engine. deps: W013. surface: packages/tradrl-world-sim/account, portfolio, risk.
- W016 Journal/snapshot/branch engine. deps: W013. surface: packages/tradrl-world-sim/journal, snapshot, branch.
- W017 Deterministic synthetic market generator. deps: W013,W014. surface: packages/tradrl-world-sim/generator/.
- W018 World Worker adapter + UI transport. deps: W006,W013. surface: packages/tradrl-world-sim/adapter/, packages/ui/src/trading-world/runtime/.
- W019 World Alpha golden integration suite. deps: W007,W008,W009,W010,W011,W012,W014,W015,W016,W017,W018. surface: tests/trading-world/, limited integration seams in packages/ui/src/trading-world/.
- W020 Historical dataset/event import. deps: W004,W016. surface: packages/tradrl-data/, contracts/data/.
- W021 Nautilus high-fidelity replay adapter. deps: W020,W019,W002. surface: packages/tradrl-adapters/nautilus/.
- W022 Replay fidelity verification. deps: W021. surface: packages/tradrl-evaluation/replay/.
- W023 Reactive participant protocol. deps: W004,W019. surface: packages/tradrl-market-participants/, contracts/participants/.
- W024 ABIDES reactive-market adapter. deps: W023,W002. surface: packages/tradrl-adapters/abides/.
- W025 Counterfactual world framework. deps: W016,W023. surface: packages/tradrl-world-sim/counterfactual/.
- W026 Crypto provider adapter baseline. deps: W002,W020. surface: packages/tradrl-adapters/crypto/.
- W027 Research/news/event information world. deps: W004,W020. surface: packages/tradrl-information/.
- W028 Evidence/provenance projection. deps: W016,W027. surface: packages/tradrl-evidence/.
- W029 Layout presets/workspace profiles. deps: W006,W019. surface: packages/ui/src/trading-world/presets/.
- W030 Streaming performance/projection coalescing. deps: W019. surface: packages/tradrl-world-sim/performance/, packages/ui/src/trading-world/performance/.
- W031 Headless World CLI/replay runner. deps: W016,W020. surface: apps/tradrl-world-cli/.

## Agent foundation
- W032 Agent Body contracts. deps: W019. surface: packages/agent-body/, contracts/agent/.
- W033 Cognitive Substrate contract. deps: W032. surface: packages/cognitive-substrate/, contracts/agent/.
- W034 Possession/compatibility/lineage. deps: W032,W033. surface: packages/possession/.
- W035 Observation/action protocol. deps: W019,W032,W034. surface: packages/agent-world-protocol/.
- W036 Reward/constraint evaluation contract. deps: W019,W035. surface: packages/learning-objectives/.
- W037 Trajectory/experiment protocol. deps: W035,W036. surface: packages/trajectory/, packages/experiments/.
- W038 Evaluation/verification. deps: W022,W035,W036,W037. surface: packages/evaluation/, packages/verification/.
- W039 Organization model/compiler. deps: W034,W036,W038. surface: packages/organization/, services/organization-compiler/.
- W040 Capability registry. deps: W033,W038,W039. surface: packages/capability-registry/.
- W041 Skill extraction/Body Forge. deps: W034,W037,W039,W040. surface: packages/skills/, services/body-forge/.
- W042 Empirical substrate/model selection. deps: W040,W041. surface: services/model-selection/, benchmarks/model-capability/.
- W043 Autonomous Body commissioning. deps: W039,W041,W042. surface: services/body-forge/commissioning/.
- W044 Agent/organization binding to World. deps: W035,W039,W043. surface: services/world-agent-runtime/.
- W045 Multi-agent populations. deps: W023,W039,W044. surface: services/populations/.
- W046 Curriculum/self-play/adversarial populations. deps: W038,W045. surface: services/learning/curriculum/, services/learning/populations/.

## Learning / Time Machine
- W047 RL interface/trainer bridge. deps: W037,W038,W044. surface: packages/rl-protocol/, services/learning/rl/.
- W048 Distributed episode generation. deps: W047,W045. surface: services/learning/compute/.
- W049 JAX-LOB training adapter. deps: W047,W048,W002. surface: packages/tradrl-adapters/jax-lob/.
- W050 Time Machine + point-in-time knowledge firewall. deps: W004,W022,W027,W047. surface: packages/tradrl-time-machine/, services/time-machine/.
- W051 Backtest-overfitting/search integrity. deps: W038,W047,W050. surface: packages/search-integrity/.
- W052 Walk-forward/regime/asset/venue holdouts. deps: W038,W050,W051. surface: packages/evaluation-splits/.
- W053 Outcome/post-mortem learning. deps: W038,W051,W052. surface: services/outcome-learning/.
- W054 Firm Brain. deps: W028,W038,W053. surface: services/firm-brain/, packages/memory/.
- W055 Continuous autonomous improvement. deps: W041,W046,W051,W053,W054. surface: services/autonomous-learning/.

## Capability providers / Arena
- W056 Provider-neutral capability-provider interface. deps: W040,W041. surface: packages/capability-provider/, contracts/capability/.
- W057 Arena capability-provider adapter. deps: W056,W002. surface: packages/tradrl-adapters/arena/.
- W058 Commercial capability marketplace/entitlements. deps: W056,W057,W054. surface: packages/marketplace/, packages/entitlements/.

## Product / production
- W059 Public/private API + SDK. deps: W019,W028,W039,W050. surface: services/api/, packages/sdk/.
- W060 Security/tenancy/secrets/isolation. deps: W059,W054,W058. surface: packages/security/, services/security/.
- W061 Observability/audit/operations. deps: W019,W028,W059. surface: packages/observability/, services/operations/.
- W062 Production deployment/reliability/performance. deps: W059,W060,W061. surface: deploy/, ops/, tests/performance/.
- W063 Benchmark/evidence publication. deps: W022,W038,W051,W052,W061. surface: research/benchmarks/, docs/benchmarks/.
- W064 Reference end-to-end trading journey. deps: W043,W044,W047,W050,W054,W057,W059,W060,W061. surface: examples/reference-trading/, tests/e2e/.
- W065 Live-mirror/shadow execution adapter. deps: W050,W059,W060,W061. surface: packages/tradrl-adapters/broker/, services/shadow/.
- W066 Product identity/branding migration from ZCode. deps: W062. surface: product identity metadata and identity surfaces only.

## Phase gates
Phase 1 — Trader World Alpha: W001–W019 plus W029–W031 where required by acceptance.
Phase 2 — Rich worlds/data: W020–W031.
Phase 3 — Agent intelligence: W032–W046.
Phase 4 — Learning/Time Machine: W047–W055.
Phase 5 — Human capability: W056–W058.
Phase 6 — production/productization: W059–W066.

No later phase may claim the whole platform complete while an earlier phase gate is red.