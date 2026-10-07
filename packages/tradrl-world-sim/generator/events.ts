/**
 * The market-generator event taxonomy (W017 `generator` module) — the typed
 * payloads for the market facts this producer owns.
 *
 * Spec: spec/SIMULATION.md "Synthetic regimes" (the generator must support
 * seeded trend / mean reversion / high volatility / low liquidity / shock /
 * halt-reopen; "Regime schedules are part of world metadata") and
 * "Participants" (deterministic noise traders, liquidity takers, passive
 * market makers, momentum participants — through the venue contracts, never
 * around them).
 * Spec: W004 contracts (`tradrl-world-contracts/time` marketEvents) — the
 * payload SHAPES are W004's closed market-event taxonomy; this module owns
 * the producer identity, the schema version and the structural guards the
 * reducer needs on replay. Timing lives in the ENVELOPE (`occurredAt`,
 * optional delayed `availableAt` — A7).
 *
 * PRODUCER BOUNDARY (the W014 note, honored): this generator NEVER emits
 * `matching.*`, `market.trade.printed` or `market.book.delta` events — every
 * such fact in a journal is produced by the real matching engine
 * (`MATCHING_PRODUCER`) because generated liquidity ENTERS the book as real
 * submit-order commands from synthetic participants. The generator's own
 * event types are the market-structure facts:
 * - `market.regime.changed` — a regime window of the schedule came into
 *   force (announced at the window's exact `from` time);
 * - `market.quote.updated` — the top-of-book quote after a generator turn
 *   (a projection of the authoritative book, never fabricated prices);
 * - `market.halted` / `market.reopened` — halt/reopen regime transitions
 *   (and venue-policy shock halts), journaled here so they flow through the
 *   halt/reopen reduction paths W014 built (matching/marketFacts.ts).
 *
 * Closed set — additions go through a deliberate generator change, mirrored
 * in tests.
 */

import type {
  InstrumentId,
  ProducerId,
  RegimeKind,
  TimestampMs,
} from "tradrl-world-contracts";
import type {
  MarketHaltPayload,
  MarketReopenPayload,
  QuoteUpdatePayload,
  RegimeChangePayload,
} from "tradrl-world-contracts/time";

/** Schema version stamped on every market-generator event. */
export const GENERATOR_EVENT_SCHEMA_VERSION = "tradrl-world-sim.generator@1";

/** The producer identity for market-generator events. */
export const MARKET_GENERATOR_PRODUCER = "market-generator" as ProducerId;

/**
 * Closed set of market event types the generator produces itself. The halt /
 * reopen payloads are W004's; their REDUCTION belongs to the matching module
 * (the book's trading-state transitions — W014), which is why they are not
 * generator-state event types (see state.ts).
 */
export const GENERATOR_EVENT_TYPES = [
  "market.regime.changed",
  "market.quote.updated",
  "market.halted",
  "market.reopened",
] as const;

export type GeneratorEventType = (typeof GENERATOR_EVENT_TYPES)[number];

/**
 * The event types whose reduction belongs to the generator state reducer
 * (generator/state.ts): the regime announcements and quote projections the
 * generator owns. `market.halted`/`market.reopened` reduce in the matching
 * slice (W014) — the generator only PRODUCES them.
 */
export const GENERATOR_STATE_EVENT_TYPES: readonly string[] = [
  "market.regime.changed",
  "market.quote.updated",
];

/** Type guard: does this event type belong to the generator state reducer? */
export function isGeneratorStateEventType(eventType: string): boolean {
  return GENERATOR_STATE_EVENT_TYPES.includes(eventType);
}

export type GeneratorEventPayload =
  | RegimeChangePayload
  | QuoteUpdatePayload
  | MarketHaltPayload
  | MarketReopenPayload;

/** The deterministic causation id of one generator pass at a simulation time. */
export function generatorTurnId(worldId: string, at: TimestampMs): string {
  return `gen:${worldId}:${String(at)}`;
}

/** Deterministic command id for one generated order command (unique per turn). */
export function generatedCommandId(
  worldId: string,
  at: TimestampMs,
  sequence: number,
): string {
  return `cmd-gen:${worldId}:${String(at)}:${String(sequence)}`;
}

// --- structural payload guards (used by the reducer on replay) ---------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const REGIME_KINDS: readonly RegimeKind[] = [
  "trend",
  "mean-reversion",
  "high-volatility",
  "low-liquidity",
  "shock",
  "halt-reopen",
];

function isRegimeKind(value: unknown): value is RegimeKind {
  return typeof value === "string" && (REGIME_KINDS as readonly string[]).includes(value);
}

export function isRegimeChangePayload(payload: unknown): payload is RegimeChangePayload {
  if (!isRecord(payload) || payload.type !== "market.regime.changed") return false;
  if (!isRegimeKind(payload.to)) return false;
  if (payload.from !== undefined && !isRegimeKind(payload.from)) return false;
  if (payload.instrumentId !== undefined && typeof payload.instrumentId !== "string") {
    return false;
  }
  if (payload.parameters !== undefined) {
    if (!isRecord(payload.parameters)) return false;
    for (const value of Object.values(payload.parameters)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
    }
  }
  return true;
}

export function isQuoteUpdatePayload(payload: unknown): payload is QuoteUpdatePayload {
  if (!isRecord(payload) || payload.type !== "market.quote.updated") return false;
  if (typeof payload.instrumentId !== "string") return false;
  for (const field of ["bid", "bidSize", "ask", "askSize", "last"] as const) {
    if (payload[field] !== undefined && typeof payload[field] !== "string") return false;
  }
  return true;
}

export function isMarketHaltPayload(payload: unknown): payload is MarketHaltPayload {
  if (!isRecord(payload) || payload.type !== "market.halted") return false;
  const scope = payload.scope;
  if (!isRecord(scope)) return false;
  if (scope.kind === "instrument") return typeof scope.instrumentId === "string";
  if (scope.kind === "venue") return typeof scope.venueId === "string";
  return false;
}

export function isMarketReopenPayload(payload: unknown): payload is MarketReopenPayload {
  if (!isRecord(payload) || payload.type !== "market.reopened") return false;
  const scope = payload.scope;
  if (!isRecord(scope)) return false;
  if (scope.kind === "instrument") {
    if (typeof scope.instrumentId !== "string") return false;
  } else if (scope.kind === "venue") {
    if (typeof scope.venueId !== "string") return false;
  } else {
    return false;
  }
  return payload.referencePrice === undefined || typeof payload.referencePrice === "string";
}

/** Narrow a plain string into an instrument id (ids are opaque strings). */
export function asInstrumentId(value: string): InstrumentId {
  return value as InstrumentId;
}
