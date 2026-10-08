/**
 * W030 coalescer unit laws: loud config validation (every issue, typed), the
 * event→surface dirty mapping over the closed alpha taxonomy (precise pins +
 * the fail-safe unknown-type law), window bounds (maxEvents / maxSimMs,
 * overflow reported exactly once), clock observations, canonical drain order,
 * drain clearing, forced drains, and key filtering/discovery.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { SequenceNumber, WorldEventEnvelope } from "tradrl-world-contracts";
import {
  createProjectionCoalescer,
  ProjectionCoalescerConfigError,
  type CoalescerConfigIssue,
  type CoalescedSurfaceEntry,
  type ProjectionCoalescerConfig,
} from "../coalescer.js";
import { surfacesTouchedByEvent } from "../surfaces.js";
import { at } from "./helpers.js";

function envelope(
  eventType: string,
  sequence: number,
  payload: Record<string, unknown>,
  occurredAt = 1_000,
): WorldEventEnvelope {
  return {
    worldId: "world-w030-perf" as never,
    sequence: sequence as SequenceNumber,
    eventId: `evt:${String(sequence)}` as never,
    eventType,
    occurredAt: at(occurredAt),
    causationId: "cause" as never,
    correlationId: "corr" as never,
    producer: "producer" as never,
    schemaVersion: "test@1",
    payload,
  } as const as WorldEventEnvelope;
}

function touchesOf(
  events: readonly WorldEventEnvelope[],
): { readonly surface: string; readonly key: string | undefined }[] {
  return events.flatMap((event) =>
    surfacesTouchedByEvent(event, ["instrument-known"]).map((touch) => ({
      surface: touch.surface,
      key: touch.key,
    })),
  );
}

// --- loud validation ----------------------------------------------------------

test("config validation: every issue is reported at once, typed", () => {
  const issues = captureConfigIssues({
    quot: { window: { maxEvents: 3 } },
    quote: {},
    orderbook: { window: { maxEvents: 0, maxSimMs: -5 } },
    trades: { window: {}, keys: ["es", "es"] },
    trades2: undefined,
    tape: { window: { maxEvents: 2 } },
  });
  // every issue, not just the first:
  assert.deepEqual(
    issues.map((issue) => `${issue.surface}:${issue.kind}`).sort(),
    [
      "orderbook:window-max-events",
      "orderbook:window-max-sim-ms",
      "quot:unknown-surface",
      "quote:window-missing",
      "tape:unknown-surface",
      "trades2:unknown-surface",
      "trades:key-duplicate",
      "trades:window-unbounded",
    ].sort(),
  );
});

test("config validation: empty config, blank keys, fractional events, NaN sim-ms", () => {
  assert.deepEqual(
    captureConfigIssues({}).map((issue) => issue.kind),
    ["empty-config"],
  );
  assert.deepEqual(
    captureConfigIssues({
      quote: { window: { maxEvents: 1.5 } },
      trades: { window: { maxSimMs: Number.NaN }, keys: [""] },
    })
      .map((issue) => issue.kind)
      .sort(),
    ["key-blank", "window-max-events", "window-max-sim-ms"],
  );
});

/** Run the loud validation and capture its issues (asserting the type). */
function captureConfigIssues(surfaces: Record<string, unknown>): CoalescerConfigIssue[] {
  try {
    createProjectionCoalescer({
      surfaces: surfaces as unknown as ProjectionCoalescerConfig["surfaces"],
    });
  } catch (error) {
    assert.ok(error instanceof ProjectionCoalescerConfigError);
    return error.issues.slice();
  }
  assert.fail("invalid config must throw");
}

test("maxEvents 1 is a legal degenerate config (coalescing disabled per key)", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: { quote: { window: { maxEvents: 1 } } },
  });
  const overflow = coalescer.ingestEvent(
    envelope("market.book.delta", 1, { instrumentId: "es", operations: [] }),
  );
  assert.deepEqual(overflow, [{ surface: "quote", key: "es" }]);
});

// --- the event→surface mapping (closed taxonomy, precise pins) ----------------

test("the dirty mapping: market events", () => {
  const bookDelta = envelope("market.book.delta", 1, { instrumentId: "es" });
  const quoteUpdate = envelope("market.quote.updated", 2, { instrumentId: "es" });
  const print = envelope("market.trade.printed", 3, {
    instrumentId: "es",
    tradeId: "t1",
    price: "4800.25",
    quantity: "1",
    aggressorSide: "buy",
  });
  assert.deepEqual(touchesOf([bookDelta]), [
    { surface: "quote", key: "es" },
    { surface: "orderbook", key: "es" },
    { surface: "timeline", key: undefined },
  ]);
  assert.deepEqual(touchesOf([quoteUpdate]), [
    { surface: "quote", key: "es" },
    { surface: "orderbook", key: "es" },
    { surface: "timeline", key: undefined },
  ]);
  assert.deepEqual(touchesOf([print]), [
    { surface: "trades", key: "es" },
    { surface: "quote", key: "es" },
    { surface: "timeline", key: undefined },
  ]);
  // no instrument id on the payload: no content to key on — but the journal's
  // own projection (the timeline) still extends (never stale).
  assert.deepEqual(touchesOf([envelope("market.book.delta", 4, {})]), [
    { surface: "timeline", key: undefined },
  ]);
});

test("the dirty mapping: instrument-scoped and venue-scoped halts", () => {
  const instrumentHalt = envelope("market.halted", 1, {
    scope: { kind: "instrument", instrumentId: "es" },
    reason: "volatility",
  });
  assert.deepEqual(touchesOf([instrumentHalt]), [
    { surface: "quote", key: "es" },
    { surface: "orderbook", key: "es" },
    { surface: "timeline", key: undefined },
  ]);
  const venueHalt = envelope("market.halted", 2, {
    scope: { kind: "venue", venueId: "venue-1" },
    reason: "volatility",
  });
  // venue-scoped: every SEEN instrument key (the coalescer sees no world
  // definitions — conservative over every instrument the stream produced).
  assert.deepEqual(touchesOf([venueHalt]), [
    { surface: "quote", key: "instrument-known" },
    { surface: "orderbook", key: "instrument-known" },
    { surface: "timeline", key: undefined },
  ]);
});

test("the dirty mapping: order lifecycle (book-moving vs registry-only)", () => {
  const accepted = envelope("matching.order.accepted", 1, {
    orderId: "o1",
    instrumentId: "es",
    accountId: "acct",
  });
  const rejected = envelope("matching.order.rejected", 2, {
    orderId: "o1",
    instrumentId: "es",
    accountId: "acct",
    rejectionReason: "risk",
  });
  const filled = envelope("matching.order.filled", 3, {
    orderId: "o1",
    instrumentId: "es",
    accountId: "acct",
    fillId: "f1",
  });
  assert.deepEqual(touchesOf([accepted]), [
    { surface: "orders", key: "acct" },
    { surface: "quote", key: "es" },
    { surface: "orderbook", key: "es" },
    { surface: "timeline", key: undefined },
  ]);
  assert.deepEqual(touchesOf([rejected]), [
    { surface: "orders", key: "acct" },
    { surface: "timeline", key: undefined },
  ]);
  assert.deepEqual(touchesOf([filled]), [
    { surface: "orders", key: "acct" },
    { surface: "positions", key: "acct" },
    { surface: "portfolio", key: "acct" },
    { surface: "risk", key: "acct" },
    { surface: "timeline", key: undefined },
  ]);
});

test("the dirty mapping: world-structure facts go to the timeline", () => {
  for (const eventType of [
    "market.regime.changed",
    "world.annotation.added",
    "world.scenario.set",
    "world.snapshot.created",
    "world.branch.created",
  ]) {
    assert.deepEqual(touchesOf([envelope(eventType, 1, {})]), [
      { surface: "timeline", key: undefined },
    ]);
  }
});

test("the fail-safe law: an unknown event type dirties every existing key", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: {
      quote: { window: { maxEvents: 50 }, keys: ["es"] },
      orders: { window: { maxEvents: 50 }, keys: ["acct"] },
      timeline: { window: { maxEvents: 50 } },
    },
  });
  coalescer.drain(); // consume the initial entries
  const drain = coalescer.drain();
  assert.equal(drain.entries.length, 0);
  coalescer.ingestEvent(
    envelope("future.producer.event", 1, { instrumentId: "es", accountId: "acct" }),
  );
  const after = coalescer.drain();
  assert.deepEqual(
    after.entries.map((entry) => [entry.surface, entry.key, entry.reason]),
    [
      ["quote", "es", "events"],
      ["orders", "acct", "events"],
      ["timeline", undefined, "events"],
    ],
  );
});

// --- ingest/drain mechanics ---------------------------------------------------

test("declared keys and world surfaces start dirty (the initial drain)", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: {
      quote: { window: { maxEvents: 10 }, keys: ["es", "nq"] },
      timeline: { window: { maxEvents: 10 } },
    },
  });
  const drain = coalescer.drain();
  assert.deepEqual(
    drain.entries.map((entry) => [entry.surface, entry.key, entry.reason]),
    [
      ["quote", "es", "initial"],
      ["quote", "nq", "initial"],
      ["timeline", undefined, "initial"],
    ],
    "canonical surface order, keys in declaration order",
  );
  assert.equal(drain.observedSequence, undefined);
  const again = coalescer.drain();
  assert.equal(again.entries.length, 0, "drain clears the dirty set");
});

test("unfiltered surfaces discover keys in first-touch order", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: { quote: { window: { maxEvents: 10 } } },
  });
  assert.equal(coalescer.drain().entries.length, 0, "nothing observed yet");
  coalescer.ingestEvent(envelope("market.book.delta", 1, { instrumentId: "nq" }));
  coalescer.ingestEvent(envelope("market.book.delta", 2, { instrumentId: "es" }));
  coalescer.ingestEvent(envelope("market.book.delta", 3, { instrumentId: "nq" }));
  const drain = coalescer.drain();
  assert.deepEqual(
    drain.entries.map((entry) => [entry.key, entry.eventCount, entry.fromSequence, entry.toSequence]),
    [
      ["nq", 2, 1, 3],
      ["es", 1, 2, 2],
    ],
    "first-touch order regardless of hit counts",
  );
});

test("events outside the configured key filter are not coalesced", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: { quote: { window: { maxEvents: 10 }, keys: ["es"] } },
  });
  coalescer.drain();
  coalescer.ingestEvent(envelope("market.book.delta", 1, { instrumentId: "nq" }));
  coalescer.ingestEvent(envelope("market.book.delta", 2, { instrumentId: "es" }));
  const drain = coalescer.drain();
  assert.deepEqual(
    drain.entries.map((entry) => [entry.key, entry.eventCount]),
    [["es", 1]],
  );
});

test("windows: maxEvents overflows exactly once, then resets on drain", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: { quote: { window: { maxEvents: 3 } } },
  });
  coalescer.drain();
  let overflow = coalescer.ingestEvent(envelope("market.book.delta", 1, { instrumentId: "es" }));
  assert.equal(overflow.length, 0, "1 of 3");
  overflow = coalescer.ingestEvent(envelope("market.book.delta", 2, { instrumentId: "es" }));
  assert.equal(overflow.length, 0, "2 of 3");
  overflow = coalescer.ingestEvent(envelope("market.book.delta", 3, { instrumentId: "es" }));
  assert.deepEqual(overflow, [{ surface: "quote", key: "es" }], "3 of 3 — the boundary");
  overflow = coalescer.ingestEvent(envelope("market.book.delta", 4, { instrumentId: "es" }));
  assert.equal(overflow.length, 0, "reported once, not spammed");
  const drain = coalescer.drain();
  assert.equal(drain.entries[0]!.eventCount, 4);
  // after the drain the window restarts fresh:
  overflow = coalescer.ingestEvent(envelope("market.book.delta", 5, { instrumentId: "es" }));
  assert.equal(overflow.length, 0, "1 of 3 in the new window");
});

test("windows: maxSimMs bounds the occurredAt span", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: { quote: { window: { maxSimMs: 500 } } },
  });
  coalescer.drain();
  let overflow = coalescer.ingestEvent(
    envelope("market.book.delta", 1, { instrumentId: "es" }, 1_000),
  );
  assert.equal(overflow.length, 0);
  overflow = coalescer.ingestEvent(
    envelope("market.book.delta", 2, { instrumentId: "es" }, 1_400),
  );
  assert.equal(overflow.length, 0, "span 400ms <= 500ms");
  overflow = coalescer.ingestEvent(
    envelope("market.book.delta", 3, { instrumentId: "es" }, 1_501),
  );
  assert.deepEqual(overflow, [{ surface: "quote", key: "es" }], "span 501ms > 500ms");
});

test("clock observations dirty every existing key with reason clock", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: {
      quote: { window: { maxEvents: 10 }, keys: ["es"] },
      orders: { window: { maxEvents: 10 }, keys: ["acct"] },
      news: { window: { maxEvents: 10 } },
    },
  });
  coalescer.drain();
  coalescer.ingestEvent(envelope("market.book.delta", 1, { instrumentId: "es" }));
  coalescer.ingestClock();
  const drain = coalescer.drain();
  assert.deepEqual(
    drain.entries.map((entry) => [entry.surface, entry.key, entry.reason, entry.eventCount]),
    [
      ["quote", "es", "clock", 1],
      ["orders", "acct", "clock", 0],
      ["news", undefined, "clock", 0],
    ],
  );
});

test("drain order is the canonical surface order across surfaces", () => {
  const window = { maxEvents: 100 };
  const coalescer = createProjectionCoalescer({
    surfaces: {
      risk: { window },
      timeline: { window },
      quote: { window, keys: ["es"] },
      trades: { window, keys: ["es"] },
    },
  });
  coalescer.drain();
  coalescer.ingestEvent(envelope("world.annotation.added", 1, {}));
  coalescer.ingestEvent(envelope("market.trade.printed", 2, { instrumentId: "es" }));
  coalescer.ingestEvent(
    envelope("matching.order.filled", 3, { orderId: "o1", instrumentId: "es", accountId: "acct" }),
  );
  const drain = coalescer.drain();
  assert.deepEqual(
    drain.entries.map((entry) => entry.surface),
    ["quote", "trades", "risk", "timeline"],
    "the COALESCED_SURFACE_NAMES order, never the config literal order",
  );
  assert.deepEqual(drain.observedSequence, 3);
  assert.deepEqual(drain.ingestedEvents, 3);
});

test("force drain dirties every known key", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: {
      quote: { window: { maxEvents: 10 }, keys: ["es"] },
      timeline: { window: { maxEvents: 10 } },
    },
  });
  coalescer.drain();
  const forced = coalescer.drain({ force: true });
  assert.deepEqual(
    forced.entries.map((entry) => [entry.surface, entry.key]),
    [
      ["quote", "es"],
      ["timeline", undefined],
    ],
  );
  assert.equal(coalescer.drain().entries.length, 0);
});

test("ingestPublication equals per-event ingestion", () => {
  const config: ProjectionCoalescerConfig = {
    surfaces: { quote: { window: { maxEvents: 10 } }, orders: { window: { maxEvents: 10 } } },
  };
  const left = createProjectionCoalescer(config);
  const right = createProjectionCoalescer(config);
  const events = [
    envelope("market.book.delta", 1, { instrumentId: "es" }),
    envelope("matching.order.filled", 2, { orderId: "o1", instrumentId: "es", accountId: "acct" }),
  ];
  left.ingestPublication(events);
  for (const event of events) {
    right.ingestEvent(event);
  }
  const leftDrain = left.drain();
  const rightDrain = right.drain();
  assert.deepEqual(leftDrain, rightDrain);
});

test("an entry never blends: eventCount and sequences are exact per key", () => {
  const coalescer = createProjectionCoalescer({
    surfaces: {
      quote: { window: { maxEvents: 100 } },
      orders: { window: { maxEvents: 100 } },
      positions: { window: { maxEvents: 100 } },
      portfolio: { window: { maxEvents: 100 } },
      risk: { window: { maxEvents: 100 } },
    },
  });
  coalescer.drain();
  coalescer.ingestEvent(envelope("market.book.delta", 7, { instrumentId: "es" }, 1_000));
  coalescer.ingestEvent(envelope("matching.order.filled", 8, { orderId: "o1", instrumentId: "es", accountId: "acct" }, 2_000));
  coalescer.ingestEvent(envelope("market.book.delta", 9, { instrumentId: "nq" }, 2_500));
  const entries: readonly CoalescedSurfaceEntry[] = coalescer.drain().entries;
  const byKey = new Map(entries.map((entry) => [`${entry.surface}:${String(entry.key)}`, entry]));
  // The fill's own quote/book content arrives via its batch's print + delta
  // events — the precise mapping counts only what each event itself moved.
  assert.deepEqual(byKey.get("quote:es")?.eventCount, 1);
  assert.deepEqual(byKey.get("quote:es")?.fromSequence, 7);
  assert.deepEqual(byKey.get("quote:es")?.toSequence, 7);
  assert.deepEqual(byKey.get("quote:nq")?.eventCount, 1);
  assert.deepEqual(byKey.get("quote:nq")?.fromSequence, 9);
  assert.deepEqual(byKey.get("orders:acct")?.eventCount, 1);
  assert.deepEqual(byKey.get("positions:acct")?.eventCount, 1);
  assert.deepEqual(byKey.get("portfolio:acct")?.eventCount, 1);
  assert.deepEqual(byKey.get("risk:acct")?.eventCount, 1);
  // Every entry carries its OWN exact window — no cross-key contamination:
  for (const entry of entries) {
    assert.ok(entry.eventCount >= 1, `${entry.surface}:${String(entry.key)} is freshly dirty`);
  }
});
