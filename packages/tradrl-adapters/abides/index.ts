/**
 * Public surface of the W024 `tradrl-adapters-abides` package — the
 * ABIDES-style reactive-market adapter.
 *
 * Spec: spec/WORK-ITEMS.md W024, spec/ARCHITECTURE-LOCK.md A4/A5/A6/A7/A9/
 * A10/A15, spec/WORLD-PROTOCOL.md ("Command lifecycle", "Event envelope",
 * "Determinism"), spec/SIMULATION.md "Matching"/"Participants".
 *
 * Layering (each module stands alone):
 * - `./errors.js` — the typed fail-closed violation taxonomy (unknown agent
 *   kind, malformed latency spec, unregistered venue, out-of-order messages,
 *   …);
 * - `./latency.js` — the per-agent transport latency specs and their PURE
 *   keyed-seeded resolution (arrival = send time + latency, A7/A9);
 * - `./messaging.js` — the ordered message fabric over the simulation clock
 *   (total order: arrival time → class priority → enqueue sequence);
 * - `./book.js` — the price-time-priority limit-order book (two-phase
 *   matching: plan, then apply);
 * - `./ledger.js` — exact fill economics (positions, fees, portfolio, risk);
 * - `./events.js` — the event taxonomy + the canonical envelope builders
 *   (availability law: acks vs market data);
 * - `./definition.js` — the declared world definition + LOUD validation +
 *   the deterministic digest;
 * - `./exchange.js` — the exchange process (the venue's public surface);
 * - `./execution.js` — the four order commands' full lifecycle, two-phase
 *   matching application, and the armed-stop cascade;
 * - `./agents.js` — the registered reactive agent kinds (market-maker,
 *   noise-trader);
 * - `./kernel.js` — the reactive-loop kernel: the deterministic scheduler
 *   that wakes agents on observed market events and their own scheduled
 *   wakes, driving participants through the REAL W023 runtime
 *   (tradrl-market-participants) and emitting ordered WorldEvents.
 *
 * CLEAN-ROOM PROVENANCE (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md): this
 * adapter reimplements the documented public semantics of an ABIDES-style
 * reactive market as ORIGINAL TypeScript; zero upstream code copied, no
 * pinned-commit obligation triggered. See README.md.
 */

export * from "./errors.js";
export * from "./latency.js";
export * from "./messaging.js";
export * from "./book.js";
export * from "./ledger.js";
export * from "./events.js";
export * from "./definition.js";
export * from "./exchange.js";
export * from "./execution.js";
export * from "./agents.js";
export * from "./kernel.js";
