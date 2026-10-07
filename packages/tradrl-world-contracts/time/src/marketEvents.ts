/**
 * Market-event contracts — the ordered market-event stream shapes.
 *
 * Spec: spec/SIMULATION.md "Synthetic regimes" (trend, mean-reversion,
 * high-volatility, low-liquidity, shock, halt/reopen as seeded regimes;
 * regime schedules are world metadata) and "Headless report" (event count,
 * event hash).
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" + "Determinism" — market
 * events ride the canonical `WorldEventEnvelope` (W003); sequence is
 * monotonic within a world, and a fixed world definition / engine version /
 * seed / command stream must reproduce the identical stream (ARCHITECTURE
 * -LOCK.md A9). The sequencing/determinism laws and digest below make that
 * claim machine-verifiable.
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md B — quote changes, order book
 * changes, Time & Sales changes from a deterministic multi-regime
 * generator.
 *
 * Timing lives in the ENVELOPE (`occurredAt`, optional delayed
 * `availableAt` — see ./timeSemantics.ts); payloads carry only market
 * facts. Book deltas apply their operations in array order — that order is
 * part of the deterministic contract.
 */

import type {
  InstrumentId,
  TradeId,
  VenueId,
} from "../../src/ids.js";
import type {
  Price,
  Quantity,
  SequenceNumber,
} from "../../src/primitives.js";
import type { OrderSide } from "../../src/orders.js";
import type { BookLevel } from "../../src/market.js";
import type {
  DeterminismManifest,
  RegimeKind,
} from "../../src/world.js";
import type { WorldEventEnvelope } from "../../src/events.js";
import type { EventTimeMs } from "./timeSemantics.js";
import { asEventTime } from "./timeSemantics.js";

// --- event type taxonomy -----------------------------------------------------

/**
 * Closed set of market event types (journal `eventType` values) for the
 * canonical synthetic/replay market stream. Extensions go through a
 * contract change.
 */
export const MARKET_EVENT_TYPES = [
  "market.quote.updated",
  "market.trade.printed",
  "market.book.delta",
  "market.book.snapshot",
  "market.halted",
  "market.reopened",
  "market.regime.changed",
] as const;

export type MarketEventType = (typeof MARKET_EVENT_TYPES)[number];

// --- payloads ------------------------------------------------------------------

/** Top-of-book quote change (facts only; timing is in the envelope). */
export interface QuoteUpdatePayload {
  readonly type: "market.quote.updated";
  readonly instrumentId: InstrumentId;
  readonly bid?: Price;
  readonly bidSize?: Quantity;
  readonly ask?: Price;
  readonly askSize?: Quantity;
  readonly last?: Price;
}

/** A public trade print (Time & Sales). */
export interface TradePrintPayload {
  readonly type: "market.trade.printed";
  readonly tradeId: TradeId;
  readonly instrumentId: InstrumentId;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly aggressorSide: OrderSide;
}

/** Book side affected by a delta operation. */
export type BookDeltaSide = "bid" | "ask";

/**
 * One incremental order-book change. `set` writes a level (price, quantity,
 * optional order count); `remove` deletes a level.
 */
export type BookDeltaOperation =
  | {
      readonly op: "set";
      readonly side: BookDeltaSide;
      readonly price: Price;
      readonly quantity: Quantity;
      readonly orderCount?: number;
    }
  | {
      readonly op: "remove";
      readonly side: BookDeltaSide;
      readonly price: Price;
    };

/** Incremental order-book delta; operations apply in array order. */
export interface BookDeltaPayload {
  readonly type: "market.book.delta";
  readonly instrumentId: InstrumentId;
  readonly operations: readonly BookDeltaOperation[];
}

/** Full order-book image (initial sync, or resync after halt/reopen). */
export interface BookSnapshotPayload {
  readonly type: "market.book.snapshot";
  readonly instrumentId: InstrumentId;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
}

/** What a halt/reopen applies to: one instrument or a whole venue. */
export type MarketHaltScope =
  | { readonly kind: "instrument"; readonly instrumentId: InstrumentId }
  | { readonly kind: "venue"; readonly venueId: VenueId };

/** Why trading halted (closed set for World Alpha). */
export type MarketHaltReason =
  | "regime" // scheduled halt/reopen regime (SIMULATION.md)
  | "volatility" // volatility break
  | "circuit-breaker" // exchange-style circuit breaker
  | "administrative"; // operator/engine intervention

/** Trading halted for a scope. */
export interface MarketHaltPayload {
  readonly type: "market.halted";
  readonly scope: MarketHaltScope;
  readonly reason: MarketHaltReason;
}

/** Trading resumed for a scope, optionally at a reference price. */
export interface MarketReopenPayload {
  readonly type: "market.reopened";
  readonly scope: MarketHaltScope;
  readonly referencePrice?: Price;
}

/**
 * Regime transition of the synthetic generator. `to` is required (the
 * regime now in force); `from` is carried when the previous regime is
 * known. Omitting `instrumentId` means the whole world/market.
 */
export interface RegimeChangePayload {
  readonly type: "market.regime.changed";
  readonly instrumentId?: InstrumentId;
  readonly from?: RegimeKind;
  readonly to: RegimeKind;
  readonly parameters?: Readonly<Record<string, number>>;
}

/** Discriminated union of all market-event payloads. */
export type MarketEventPayload =
  | QuoteUpdatePayload
  | TradePrintPayload
  | BookDeltaPayload
  | BookSnapshotPayload
  | MarketHaltPayload
  | MarketReopenPayload
  | RegimeChangePayload;

/** A journal event whose payload is a market-event payload. */
export type MarketEvent = WorldEventEnvelope<MarketEventPayload>;

const MARKET_EVENT_TYPE_SET: ReadonlySet<string> = new Set(MARKET_EVENT_TYPES);

/** Type guard: does this journal event belong to the market stream? */
export function isMarketEvent(envelope: WorldEventEnvelope): envelope is MarketEvent {
  return MARKET_EVENT_TYPE_SET.has(envelope.eventType);
}

// --- ordered-stream laws ----------------------------------------------------------

export type EventStreamViolationKind =
  | "world-mismatch" // events from more than one world in one stream
  | "sequence-not-monotonic" // WORLD-PROTOCOL.md: sequence is monotonic per world
  | "time-not-monotonic" // occurredAt went backwards as sequence advanced
  | "available-before-occurred"; // A7: observable before it occurred

/** One violated stream law, with the offending index. */
export interface EventStreamViolation {
  readonly kind: EventStreamViolationKind;
  readonly index: number;
  readonly detail: string;
}

/** Result of validating an ordered event stream. */
export type EventStreamValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly EventStreamViolation[] };

/**
 * The ordered-stream laws, as one pure validation:
 * - every event belongs to the same world;
 * - `sequence` strictly increases;
 * - `occurredAt` never decreases as sequence advances;
 * - `availableAt` (when present) is never before `occurredAt`.
 * Engines assert this before journaling/appending; evidence consumers use it
 * to verify replayed streams.
 */
export function validateEventStream(
  events: readonly WorldEventEnvelope[],
): EventStreamValidation {
  const violations: EventStreamViolation[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.worldId !== events[0]!.worldId) {
      violations.push({
        kind: "world-mismatch",
        index: i,
        detail: `event ${String(event.eventId)} belongs to ${String(event.worldId)}`,
      });
    }
    if (i > 0) {
      const previous = events[i - 1]!;
      if (event.sequence <= previous.sequence) {
        violations.push({
          kind: "sequence-not-monotonic",
          index: i,
          detail: `sequence ${String(event.sequence)} after ${String(previous.sequence)}`,
        });
      }
      if (event.occurredAt < previous.occurredAt) {
        violations.push({
          kind: "time-not-monotonic",
          index: i,
          detail: `occurredAt ${String(event.occurredAt)} after ${String(previous.occurredAt)}`,
        });
      }
    }
    if (event.availableAt !== undefined && event.availableAt < event.occurredAt) {
      violations.push({
        kind: "available-before-occurred",
        index: i,
        detail: `availableAt ${String(event.availableAt)} before occurredAt ${String(event.occurredAt)}`,
      });
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// --- determinism digest ------------------------------------------------------------

/**
 * Canonical, dependency-free serialization of one event: object keys sorted
 * (by code unit), `undefined`-valued fields omitted, arrays in order. Two
 * structurally equal events always serialize identically — the stable input
 * for stream checksums and journal digests.
 */
export function canonicalEventString(event: WorldEventEnvelope): string {
  return canonicalize(event);
}

/**
 * Verifiable digest of an ordered event stream (SIMULATION.md headless
 * report: "event count" and "event hash"). `eventChecksum` is a pure FNV-1a
 * chain over the canonical serialization of every event in order — identical
 * in Node, workers and the browser, so engine, headless runner and UI can
 * all verify the same stream (ACCEPTANCE-WORLD-ALPHA.md F/I). It is an
 * equality/determinism check, not a cryptographic digest.
 */
export interface EventStreamDigest {
  readonly eventCount: number;
  readonly lastSequence?: SequenceNumber;
  readonly finalEventTime?: EventTimeMs;
  readonly eventChecksum: string;
}

/** Compute the digest of an ordered event stream. */
export function eventStreamDigest(events: readonly WorldEventEnvelope[]): EventStreamDigest {
  let checksumSeed = FNV32_OFFSET;
  for (const event of events) {
    checksumSeed = fnv1a32Into(canonicalize(event), checksumSeed);
  }
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  if (last === undefined) {
    return { eventCount: 0, eventChecksum: fnv1a32HexOf(checksumSeed) };
  }
  return {
    eventCount: events.length,
    lastSequence: last.sequence,
    finalEventTime: asEventTime(last.occurredAt),
    eventChecksum: fnv1a32HexOf(checksumSeed),
  };
}

/**
 * A complete machine-verifiable determinism claim (A9): the same manifest
 * (W003 `DeterminismManifest` — fixed world definition, engine/version,
 * seed, input hashes, command-stream hash) plus the same event digest
 * implies the same run. Journal/snapshot (W016) and headless runner store
 * both.
 */
export interface DeterministicStreamVerification {
  readonly manifest: DeterminismManifest;
  readonly digest: EventStreamDigest;
}

// --- canonical serialization internals (pure) ----------------------------------------

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

function fnv1a32Into(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV32_PRIME);
  }
  return hash >>> 0;
}

function fnv1a32HexOf(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}
