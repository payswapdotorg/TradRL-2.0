/**
 * Market-event contract tests: taxonomy/payloads, the ordered-stream laws
 * and the determinism digest.
 *
 * Spec: spec/SIMULATION.md ("Synthetic regimes", "Headless report"),
 * spec/WORLD-PROTOCOL.md ("Event envelope", "Determinism"),
 * spec/ARCHITECTURE-LOCK.md A9, spec/ACCEPTANCE-WORLD-ALPHA.md B/F/I.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  BookDeltaPayload,
  DeterministicStreamVerification,
  EventStreamDigest,
  EventStreamViolationKind,
  MarketEvent,
  MarketEventPayload,
  MarketEventType,
  MarketHaltPayload,
  MarketHaltReason,
  MarketHaltScope,
  QuoteUpdatePayload,
  RegimeChangePayload,
  TradePrintPayload,
} from "../src/marketEvents.js";
import {
  MARKET_EVENT_TYPES,
  canonicalEventString,
  eventStreamDigest,
  isMarketEvent,
  validateEventStream,
} from "../src/marketEvents.js";
import type { WorldEventEnvelope } from "../../src/events.js";
import type { DeterminismManifest } from "../../src/world.js";
import type {
  CausationId,
  CorrelationId,
  EventId,
  InstrumentId,
  ProducerId,
  TradeId,
  VenueId,
  WorldId,
} from "../../src/ids.js";
import type { SequenceNumber } from "../../src/primitives.js";
import { asId, asPrice, asQuantity, asTimestamp } from "../../test/helpers.js";
import type { Equal, Expect, RequiredKeys } from "../../test/helpers.js";

// --- type-level assertions ---------------------------------------------------

const ALL_MARKET_EVENT_TYPES = [
  "market.quote.updated",
  "market.trade.printed",
  "market.book.delta",
  "market.book.snapshot",
  "market.halted",
  "market.reopened",
  "market.regime.changed",
] as const;

type _typeSet = Expect<
  Equal<MarketEventType, (typeof ALL_MARKET_EVENT_TYPES)[number]>
>;
// The closed set is pinned at exactly seven types.
type _closedSetSize = Expect<Equal<typeof MARKET_EVENT_TYPES["length"], 7>>;

// The payload union is fully discriminated by the event-type set.
type _payloadDiscriminant = Expect<
  Equal<MarketEventPayload["type"], MarketEventType>
>;

// A trade print carries the full public-trade facts (no envelope duplication).
type _tradePrintKeys = Expect<
  Equal<
    RequiredKeys<TradePrintPayload>,
    "type" | "tradeId" | "instrumentId" | "price" | "quantity" | "aggressorSide"
  >
>;

// A regime change must name the regime now in force.
type _regimeToRequired = Expect<Equal<"to" extends RequiredKeys<RegimeChangePayload> ? true : false, true>>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const instrumentId = asId<InstrumentId>("instrument-btcusd");

let nextSequence = 0;
function makeEvent<TPayload extends MarketEventPayload>(
  payload: TPayload,
  overrides: Partial<WorldEventEnvelope<TPayload>> = {},
): WorldEventEnvelope<TPayload> {
  nextSequence += 1;
  return {
    worldId,
    sequence: nextSequence as SequenceNumber,
    eventId: asId<EventId>(`event-${nextSequence}`),
    eventType: payload.type,
    occurredAt: asTimestamp(1_000 + nextSequence),
    causationId: asId<CausationId>("clock-tick"),
    correlationId: asId<CorrelationId>("flow-1"),
    producer: asId<ProducerId>("producer-market"),
    schemaVersion: "1",
    payload,
    ...overrides,
  };
}

const quotePayload: QuoteUpdatePayload = {
  type: "market.quote.updated",
  instrumentId,
  bid: asPrice("100.25"),
  bidSize: asQuantity("5.5"),
  ask: asPrice("100.50"),
  askSize: asQuantity("3.25"),
};

const tradePayload: TradePrintPayload = {
  type: "market.trade.printed",
  tradeId: asId<TradeId>("trade-1"),
  instrumentId,
  price: asPrice("100.25"),
  quantity: asQuantity("1.5"),
  aggressorSide: "buy",
};

const bookDeltaPayload: BookDeltaPayload = {
  type: "market.book.delta",
  instrumentId,
  operations: [
    { op: "set", side: "bid", price: asPrice("100.25"), quantity: asQuantity("6") },
    { op: "remove", side: "ask", price: asPrice("101.00") },
  ],
};

const haltScope: MarketHaltScope = { kind: "instrument", instrumentId };
const haltPayload: MarketHaltPayload = {
  type: "market.halted",
  scope: haltScope,
  reason: "volatility",
};

const regimePayload: RegimeChangePayload = {
  type: "market.regime.changed",
  from: "trend",
  to: "high-volatility",
  parameters: { sigma: 0.04 },
};

// --- taxonomy and payloads -------------------------------------------------------

test("the market event type set is closed and matches the payload union", () => {
  assert.equal(MARKET_EVENT_TYPES.length, 7);
  for (const eventType of MARKET_EVENT_TYPES) {
    assert.equal(typeof eventType, "string");
  }
});

test("market event payloads ride the canonical envelope and are recognized", () => {
  const envelopes = [
    makeEvent(quotePayload),
    makeEvent(tradePayload),
    makeEvent(bookDeltaPayload),
    makeEvent({
      type: "market.book.snapshot",
      instrumentId,
      bids: [{ price: asPrice("100.25"), quantity: asQuantity("6") }],
      asks: [],
    }),
    makeEvent(haltPayload),
    makeEvent({ type: "market.reopened", scope: haltScope, referencePrice: asPrice("99.75") }),
    makeEvent(regimePayload),
  ];
  for (const envelope of envelopes) {
    assert.equal(isMarketEvent(envelope), true);
  }
  const notMarket: WorldEventEnvelope<{ orderId: string }> = {
    ...makeEvent(tradePayload),
    eventType: "order.filled",
    payload: { orderId: "order-1" },
  };
  assert.equal(isMarketEvent(notMarket), false);
});

test("a market event narrows its payload via the guard", () => {
  const envelope = makeEvent(tradePayload);
  if (isMarketEvent(envelope)) {
    const marketEvent: MarketEvent = envelope;
    assert.equal(marketEvent.payload.type, "market.trade.printed");
    assert.equal(marketEvent.payload.aggressorSide, "buy");
  } else {
    assert.fail("expected a market event");
  }
});

test("halt scopes cover instrument and venue levels with typed reasons", () => {
  const venueHalt: MarketHaltPayload = {
    type: "market.halted",
    scope: { kind: "venue", venueId: asId<VenueId>("venue-1") },
    reason: "circuit-breaker",
  };
  assert.equal(haltPayload.scope.kind, "instrument");
  assert.equal(venueHalt.scope.kind, "venue");
  const reasons: readonly MarketHaltReason[] = [
    "regime",
    "volatility",
    "circuit-breaker",
    "administrative",
  ];
  assert.deepEqual(reasons, ["regime", "volatility", "circuit-breaker", "administrative"]);
});

// --- ordered-stream laws -----------------------------------------------------------

test("a well-formed stream passes validation", () => {
  const events = [
    makeEvent(quotePayload),
    makeEvent(tradePayload),
    makeEvent(bookDeltaPayload),
  ];
  const result = validateEventStream(events);
  assert.deepEqual(result, { ok: true });
});

test("the stream laws reject every violation kind with the offending index", () => {
  const otherWorld = asId<WorldId>("world-2");
  const bad = [
    makeEvent(quotePayload), // 0: fine
    makeEvent(tradePayload, {
      sequence: 1 as SequenceNumber, // 1: sequence not monotonic
      worldId: otherWorld, // 1: world mismatch
    }),
    makeEvent(bookDeltaPayload, { occurredAt: asTimestamp(900) }), // 2: time not monotonic
    makeEvent(haltPayload, {
      occurredAt: asTimestamp(2_000),
      availableAt: asTimestamp(1_999),
    }), // 3: available before occurred
  ];
  const result = validateEventStream(bad);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const kinds = result.violations.map((v) => v.kind);
    assert.deepEqual(kinds, [
      "world-mismatch",
      "sequence-not-monotonic",
      "time-not-monotonic",
      "available-before-occurred",
    ]);
    assert.deepEqual(result.violations.map((v) => v.index), [1, 1, 2, 3]);
    const violationKind: EventStreamViolationKind = result.violations[0]!.kind;
    assert.equal(violationKind, "world-mismatch");
  }
});

test("equal sequence numbers are not monotonic (strictly increasing)", () => {
  const events = [
    makeEvent(quotePayload),
    makeEvent(tradePayload, { sequence: nextSequence as SequenceNumber }),
  ];
  const result = validateEventStream(events);
  assert.equal(result.ok, false);
});

// --- canonical serialization and determinism digest ----------------------------------

test("canonical serialization is key-order independent and omits undefined", () => {
  const withDelay = makeEvent(tradePayload, { availableAt: asTimestamp(9_000) });
  const reordered: WorldEventEnvelope<typeof withDelay.payload> = {
    payload: withDelay.payload,
    schemaVersion: withDelay.schemaVersion,
    producer: withDelay.producer,
    correlationId: withDelay.correlationId,
    causationId: withDelay.causationId,
    availableAt: withDelay.availableAt,
    occurredAt: withDelay.occurredAt,
    eventType: withDelay.eventType,
    eventId: withDelay.eventId,
    sequence: withDelay.sequence,
    worldId: withDelay.worldId,
  };
  assert.equal(canonicalEventString(withDelay), canonicalEventString(reordered));

  const withoutDelay = makeEvent(quotePayload);
  assert.ok(!canonicalEventString(withoutDelay).includes("availableAt"));
  assert.ok(canonicalEventString(withDelay).includes("availableAt"));
});

test("identical streams produce identical digests; changes change them", () => {
  const a = [makeEvent(quotePayload), makeEvent(tradePayload)];
  // Value-identical copies: fresh object identities, identical facts.
  const b = a.map((event) => ({ ...event, payload: { ...event.payload } }));
  const digestA = eventStreamDigest(a);
  const digestB = eventStreamDigest(b);
  assert.equal(digestA.eventCount, 2);
  assert.equal(digestA.eventChecksum, digestB.eventChecksum);

  const reordered = [a[1]!, a[0]!];
  assert.notEqual(eventStreamDigest(reordered).eventChecksum, digestA.eventChecksum);

  const changedPrice: WorldEventEnvelope<QuoteUpdatePayload> = {
    ...a[0]!,
    payload: { ...quotePayload, bid: asPrice("101.00") },
  };
  assert.notEqual(eventStreamDigest([changedPrice, a[1]!]).eventChecksum, digestA.eventChecksum);
});

test("digests carry count, last sequence and final event time", () => {
  const events = [
    makeEvent(quotePayload, { sequence: 7 as SequenceNumber }),
    makeEvent(tradePayload, { sequence: 9 as SequenceNumber, occurredAt: asTimestamp(5_000) }),
  ];
  const digest: EventStreamDigest = eventStreamDigest(events);
  assert.equal(digest.eventCount, 2);
  assert.equal(digest.lastSequence, 9);
  assert.equal(digest.finalEventTime, 5_000);

  const empty = eventStreamDigest([]);
  assert.equal(empty.eventCount, 0);
  assert.equal(empty.lastSequence, undefined);
  assert.equal(empty.finalEventTime, undefined);
  assert.match(empty.eventChecksum, /^[0-9a-f]{8}$/u);
});

test("a determinism claim composes the manifest with the stream digest", () => {
  const manifest: DeterminismManifest = {
    worldDefinitionVersion: "1",
    engine: "tradrl-world-sim",
    engineVersion: "0.1.0",
    seed: "seed-42",
    inputHashes: { "market-config": "aa" },
    dependencyVersions: { typescript: "6.0.2" },
    commandStreamHash: "bb",
  };
  const verification: DeterministicStreamVerification = {
    manifest,
    digest: eventStreamDigest([makeEvent(quotePayload)]),
  };
  assert.equal(verification.manifest.seed, "seed-42");
  assert.equal(verification.digest.eventCount, 1);
});
