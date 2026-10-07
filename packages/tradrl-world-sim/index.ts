/**
 * tradrl-world-sim — the headless deterministic World engine.
 *
 * Spec: spec/SIMULATION.md (determinism, event ordering, runtime topology,
 * seed/version discipline), spec/WORLD-PROTOCOL.md (command lifecycle,
 * event envelope, ports), spec/DOMAIN-MODEL.md, spec/ARCHITECTURE-LOCK.md
 * (A6 event-driven truth, A7 time separation, A8 branching not rewind,
 * A9 determinism), spec/ACCEPTANCE-WORLD-ALPHA.md (E clock, L evidence,
 * I headless parity).
 *
 * Modules:
 * - ./clock/index.js — the deterministic simulation clock (W013).
 * - ./journal/index.js — the append-only ordered event journal + replay
 *   (W013).
 * - ./world/index.js — the world core, command lifecycle and headless
 *   engine exposing the four World Protocol ports (W013, with the W014
 *   order-command seam, the W016 snapshot/branch command seams and the
 *   W017 generator seam).
 * - ./orderbook/index.js — the authoritative per-instrument limit-order
 *   book (W014): price levels, FIFO queues, halt/reopen, W004 book deltas.
 * - ./matching/index.js — the matching engine (W014): order kinds × TIF ×
 *   policies, fees, latency, fills with the causal trade reference, the
 *   typed lifecycle seam the world core calls.
 * - ./account/index.js — the authoritative account state (W015): ledger,
 *   margin model, order acceptance checks, the composite financial state.
 * - ./portfolio/index.js — the position ledger and P&L (W015): signed
 *   exact-money math, mark-to-market, the W003 Portfolio projection and
 *   the close-position seam.
 * - ./risk/index.js — the pre-trade risk gate (W015): declared limits,
 *   typed outcomes, breach history, the reduce-only position check.
 * - ./snapshot/index.js — the snapshot engine (W016): content-addressed
 *   restorable captures, snapshot command seam, restore fold.
 * - ./branch/index.js — the branch engine (W016): lineage-complete branch
 *   records, branch world definitions/genesis, branch command seam.
 * - ./generator/index.js — the deterministic synthetic market generator
 *   (W017): seeded regime schedules (trend, mean-reversion, high
 *   volatility, low liquidity, shock, halt/reopen), synthetic participants
 *   quoting and trading through the REAL matching engine, and the
 *   clock-driven `createGeneratedWorldEngine` that makes clock advance fill
 *   the books, print trades and move the quote.
 * - ./adapter/index.js — the W018 worker/process adapter.
 *
 * Zero runtime dependencies beyond `tradrl-world-contracts`.
 */

export * from "./clock/index.js";
export * from "./journal/index.js";
export * from "./world/index.js";
export * from "./snapshot/index.js";
export * from "./branch/index.js";
export * from "./generator/index.js";
export * from "./adapter/index.js";
export * from "./account/index.js";
export * from "./portfolio/index.js";
export * from "./risk/index.js";
