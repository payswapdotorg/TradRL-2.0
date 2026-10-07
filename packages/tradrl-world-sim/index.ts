/**
 * tradrl-world-sim — the headless deterministic World engine skeleton (W013).
 *
 * Spec: spec/SIMULATION.md (deterministic TypeScript runtime, Node headless
 * target, runtime topology), spec/WORLD-PROTOCOL.md (command lifecycle,
 * event envelope, the four ports), spec/ARCHITECTURE-LOCK.md (A6 event-driven
 * truth, A7 time separation, A8 branching not rewind, A9 determinism),
 * spec/ACCEPTANCE-WORLD-ALPHA.md (E clock, L evidence, I headless parity).
 *
 * Modules (W013 frozen surface; W014+ add orderbook/matching/account/
 * portfolio/risk/snapshot/branch/generator/adapter alongside):
 * - ./clock/index.js — the deterministic simulation clock (ClockPort
 *   semantics via W004's clock contracts).
 * - ./journal/index.js — the append-only ordered event journal + replay.
 * - ./world/index.js — the authoritative world core, the command lifecycle
 *   and the headless engine exposing the four World Protocol ports.
 *
 * Zero runtime dependencies beyond `tradrl-world-contracts`.
 */

export * from "./clock/index.js";
export * from "./journal/index.js";
