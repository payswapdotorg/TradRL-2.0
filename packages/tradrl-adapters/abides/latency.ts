/**
 * The ABIDES-style latency model (W024) — typed per-agent latency specs and
 * their deterministic resolution.
 *
 * Spec: spec/WORK-ITEMS.md W024 — "typed per-agent latency specs (message
 * arrival = send time + latency, deterministic given seed) … loud validation
 * of latency configs". Spec: spec/ARCHITECTURE-LOCK.md A7 — arrival is
 * computed on the SIMULATION clock only; wall time never enters the model
 * (the adapter contains zero wall-time reads).
 *
 * The venue-side half of the latency law reuses the CANONICAL contract type
 * `VenueLatency` (tradrl-world-contracts/src/instrument.ts — R022 explicit
 * latency policy: `acknowledgementMs` + `fillPropagationMs`); this module
 * owns the AGENT-side half (to-venue / from-venue transport bounds), so an
 * event becomes observable to a remote actor at
 * `availableAt + that actor's from-venue latency` — the A7 firewall made
 * structural by the message flow.
 *
 * DETERMINISM (A9): latency draws are KEYED, cursor-free draws over the
 * world seed (the W023 `keyedRandom` doctrine — tradrl-market-participants/
 * src/rng.ts, our own package, reused): `resolveLatencyMs` is a pure
 * function of (seed, direction, actor, key). No sequential RNG cursor
 * exists anywhere in the adapter, so the same world definition + seed +
 * message stream always produces the same arrivals.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import { keyedRandom } from "tradrl-market-participants/rng";
import { AbidesAdapterError } from "./errors.js";

/**
 * One latency bound: either a fixed number of simulated milliseconds, or an
 * inclusive seeded-uniform range `[minMs, maxMs]`.
 */
export type LatencyBound = number | { readonly minMs: number; readonly maxMs: number };

/** The per-agent transport latency spec (both directions are required). */
export interface AgentLatencySpec {
  /** Delay applied to messages the actor SENDS to the exchange (commands). */
  readonly toVenueMs: LatencyBound;
  /** Delay applied to messages the exchange SENDS to the actor (data, responses). */
  readonly fromVenueMs: LatencyBound;
}

/** The zero-latency spec (a co-located actor; still explicit, never a default). */
export const ZERO_LATENCY: AgentLatencySpec = { toVenueMs: 0, fromVenueMs: 0 };

/** Validate one bound loudly. Returns the violation detail, or undefined. */
function boundProblem(bound: LatencyBound, label: string): string | undefined {
  if (typeof bound === "number") {
    if (!Number.isInteger(bound)) return `${label} must be integer milliseconds (got ${String(bound)})`;
    if (bound < 0) return `${label} must be non-negative (got ${String(bound)})`;
    return undefined;
  }
  if (typeof bound !== "object" || bound === null) {
    return `${label} must be a number or {minMs, maxMs} (got ${String(bound)})`;
  }
  const { minMs, maxMs } = bound;
  if (!Number.isInteger(minMs) || !Number.isInteger(maxMs)) {
    return `${label} range bounds must be integer milliseconds (got ${String(minMs)}..${String(maxMs)})`;
  }
  if (minMs < 0 || maxMs < 0) {
    return `${label} range bounds must be non-negative (got ${String(minMs)}..${String(maxMs)})`;
  }
  if (minMs > maxMs) {
    return `${label} range is inverted (min ${String(minMs)} > max ${String(maxMs)})`;
  }
  return undefined;
}

/**
 * Validate an entire latency spec loudly. Every problem is collected (the
 * W021 discipline: importers see ALL violations, never just the first).
 */
export function latencySpecViolations(
  spec: unknown,
  label: string,
): readonly string[] {
  const problems: string[] = [];
  if (typeof spec !== "object" || spec === null) {
    return [`${label} must be an AgentLatencySpec object (got ${String(spec)})`];
  }
  const candidate = spec as Partial<AgentLatencySpec>;
  const to = boundProblem(candidate.toVenueMs as LatencyBound, `${label}.toVenueMs`);
  if (to !== undefined) problems.push(to);
  const from = boundProblem(candidate.fromVenueMs as LatencyBound, `${label}.fromVenueMs`);
  if (from !== undefined) problems.push(from);
  return problems;
}

/** Assert a latency spec (the loud construction/registration path). */
export function assertLatencySpec(spec: unknown, label: string): void {
  const problems = latencySpecViolations(spec, label);
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-latency-spec", `${label}: ${problems.join("; ")}`);
  }
}

/**
 * Resolve one bound to a concrete latency, as a PURE keyed draw.
 *
 * Fixed bounds resolve to themselves; range bounds draw a seeded uniform
 * integer in `[minMs, maxMs]` (inclusive) keyed by
 * `(seed, direction, actor, key)` — deterministic given the world seed, with
 * no cursor (A9).
 */
export function resolveLatencyMs(input: {
  readonly bound: LatencyBound;
  readonly seed: string;
  readonly direction: "to-venue" | "from-venue";
  readonly actor: string;
  readonly key: string | number;
}): number {
  const { bound } = input;
  if (typeof bound === "number") {
    return bound;
  }
  const span = bound.maxMs - bound.minMs + 1;
  const draw = keyedRandom(input.seed, "latency", input.direction, input.actor, input.key);
  return bound.minMs + Math.floor(draw() * span);
}

/** Human-readable bound description (telemetry/rationale text only). */
export function describeLatencyBound(bound: LatencyBound): string {
  if (typeof bound === "number") {
    return `${String(bound)}ms`;
  }
  return `${String(bound.minMs)}..${String(bound.maxMs)}ms`;
}

/** Describe a full spec (deterministic, display-only). */
export function describeLatencySpec(spec: AgentLatencySpec): string {
  return `to-venue ${describeLatencyBound(spec.toVenueMs)}, from-venue ${describeLatencyBound(spec.fromVenueMs)}`;
}
