/**
 * Canonical TradRL trading/world domain contracts.
 *
 * Source of truth: spec/DOMAIN-MODEL.md, spec/WORLD-PROTOCOL.md,
 * spec/ARCHITECTURE.md (§5 State, §6 Execution, §7 Information world, §9
 * Branching), spec/SIMULATION.md, spec/REQUIREMENTS.md.
 *
 * This package is type-first: interfaces, unions, and the small set of pure
 * tables/predicates that encode spec-stated invariants (order lifecycle
 * transitions, information-boundary availability). It has zero runtime
 * dependencies. The four World Protocol ports are TYPE-ONLY interfaces — no
 * engine types leak through them (ADR-003).
 */

export * from "./ids.js";
export * from "./primitives.js";
export * from "./instrument.js";
export * from "./orders.js";
export * from "./execution.js";
