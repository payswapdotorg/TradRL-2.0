/**
 * Barrel for the market event/time/information contracts (W004).
 *
 * Source of truth: spec/WORLD-PROTOCOL.md (Time, ClockPort, Event envelope,
 * Determinism), spec/SIMULATION.md (Synthetic regimes, Headless report),
 * spec/DOMAIN-MODEL.md, spec/ARCHITECTURE-LOCK.md (A7 time separation, A8
 * branching, A9 determinism), spec/ACCEPTANCE-WORLD-ALPHA.md (E clock, H
 * information firewall), spec/REQUIREMENTS.md (R016 firewall).
 *
 * Modules:
 * - ./timeSemantics.js — the four time concepts (wallTime/simulationTime/
 *   eventTime/availableAt) and the A7 point-in-time laws.
 * - ./clock.js — ClockPort data shapes: clock state, typed requests/results,
 *   status transition law, timeline windows/slices.
 * - ./marketEvents.js — the ordered market-event stream: taxonomy, payloads,
 *   ordered-stream laws and the determinism digest.
 * - ./informationBoundary.js — what the information firewall stores/asserts:
 *   records, boundary computation/transitions, observation proofs.
 *
 * Consumed by W013 (headless engine: clock/journal) and W012 (simulation
 * clock/timeline UI) through the package export `tradrl-world-contracts/time`.
 */

export * from "./timeSemantics.js";
export * from "./clock.js";
export * from "./marketEvents.js";
export * from "./informationBoundary.js";
