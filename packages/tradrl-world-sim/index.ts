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
 *   order-command seam).
 * - ./orderbook/index.js — the authoritative per-instrument limit-order
 *   book (W014): price levels, FIFO queues, halt/reopen, W004 book deltas.
 * - ./matching/index.js — the matching engine (W014): order kinds × TIF ×
 *   policies, fees, latency, fills with the causal trade reference, the
 *   typed lifecycle seam the world core calls.
 *
 * Zero runtime dependencies beyond `tradrl-world-contracts`.
 */

export * from "./clock/index.js";
export * from "./journal/index.js";
export * from "./world/index.js";
export * from "./adapter/index.js";
