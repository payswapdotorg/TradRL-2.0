# TradRL Architecture Lock

Status: **APPROVED / IMPLEMENTATION AUTHORITY**

## A1 — ZCode is the outer workbench

TradRL is built on the existing ZCode workbench. Desktop lifecycle, Browser, Terminal, workspace/session handling, docking, platform abstraction and generic RPC remain generic capabilities.

TradRL must not create a parallel global IDE or docking system in Phase 1.

## A2 — Trading World is a first-class dockable surface

TradRL adds a `trading-world` side-pane tab kind. The outer shell owns open/focus/reorder/close/persist semantics. Trading World owns its internal tools and domain state.

## A3 — World-first architecture

Market World is the authoritative product primitive. Charts, DOM, Time & Sales, orders, portfolio, risk, news, annotations and future agent observations are projections/consumers.

## A4 — One World Protocol

Human UI, future agents, headless tests and external simulation engines use the same typed World contracts.

## A5 — Four ports

Every world implementation exposes:

1. Query Port
2. Command Port
3. Clock Port
4. Evidence Port

## A6 — Event-driven truth

Commands validate, authorize, apply domain rules, mutate authoritative state, emit ordered domain events and append journal records. UI polling is never authoritative.

## A7 — Time separation

`wallTime`, `simulationTime`, `eventTime` and `availableAt` are different concepts.

Historical information must not be observable before `availableAt`.

## A8 — Branching, not destructive rewind

History is immutable. Rewind creates a child world from an immutable snapshot.

## A9 — Determinism

A determinism claim requires fixed world definition, engine version, seed and command stream. Nondeterministic modes must declare their nondeterministic sources.

## A10 — Simulator independence

Phase 1 implements a deterministic TypeScript runtime.

Later adapters may target:

- NautilusTrader — high-fidelity replay/execution
- ABIDES — reactive multi-agent markets
- JAX-LOB — massively parallel RL
- other engines through the same World Protocol

No external engine is allowed to become the canonical domain model.

## A11 — No Arena dependency

Arena is an optional capability provider. Core simulation, learning, evaluation and autonomous improvement work without Arena.

## A12 — Empirical capability discovery

Future model/role selection follows:

capability deficit → capability contract → candidates → benchmark → possession → organization evaluation.

Model names alone never establish role capability.

## A13 — Authority outside prompts

Risk, authorization, venue policy and execution gates are runtime controls, not model prompt instructions.

## A14 — Simulation/live safety

Every world declares its mode. Simulation is always visibly disclosed. World Alpha contains no live execution authority.

## A15 — Headless parity

Supported human actions are representable through headless World commands. UI and headless execution share the same command semantics.

## A16 — Shared root serialization

Root manifests, lockfiles, architecture policy, shared protocol indexes and central shell files are TL-owned unless a Work Order explicitly grants an exception.

## A17 — Third-party isolation

If license or technical coupling makes direct embedding undesirable, use an adapter/process boundary.

## A18 — Source-of-truth hierarchy

1. Architecture Lock
2. domain/contract specs
3. approved ADRs
4. Work Items + graph
5. implementation
6. chat

Lower layers do not silently override higher layers.

## A19 — Concurrency with quality

At most 3 worker Work Orders may be active. Parallelism is permitted only with satisfied dependencies and non-conflicting write surfaces.

## A20 — World Alpha gate

No future Agent/RL work can declare the product foundation complete until `spec/ACCEPTANCE-WORLD-ALPHA.md` is green.
