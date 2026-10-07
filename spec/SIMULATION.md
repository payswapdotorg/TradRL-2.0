# Simulation Architecture

## Phase 1

The canonical first implementation is a deterministic TypeScript runtime.

Execution targets:

- Web Worker
- Electron/local adapter
- Node headless runner

## Runtime topology

```
TradingWorld UI
   │
World Client
   │
Worker/Process Adapter
   │
World Engine
 ├─ clock
 ├─ synthetic market
 ├─ orderbook
 ├─ matching
 ├─ accounts
 ├─ portfolio
 ├─ risk
 ├─ participants
 ├─ information
 └─ journal
```

## Matching

Use price-time priority.

Support deterministic:

- market
- limit
- stop
- stop-limit
- IOC
- FOK
- post-only
- reduce-only
- cancellation/replacement

Partial fills are mandatory.

## Participants

World Alpha may include deterministic:

- noise trader
- liquidity taker
- passive market maker
- momentum participant

Participant code cannot bypass venue/account/risk contracts.

## Synthetic regimes

The generator must support seeded:

- trend
- mean reversion
- high volatility
- low liquidity
- shock
- halt/reopen

Regime schedules are part of world metadata.

## Fidelity declarations

Every World reports:

- mode
- input data source
- engine
- engine version
- known limitations
- deterministic/nondeterministic declaration

## External engines

### NautilusTrader
Candidate high-fidelity replay/execution engine.

### ABIDES
Candidate reactive agent-market environment.

### JAX-LOB
Candidate high-throughput RL environment.

They are adapters, not canonical World implementations.

## Headless report

A headless run returns:

- world id
- mode
- seed
- final simulation time
- balances
- positions
- P&L
- risk
- event count
- event hash
- branch lineage
