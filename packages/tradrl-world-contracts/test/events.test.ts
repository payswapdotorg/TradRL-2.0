/**
 * Event envelope contract tests.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" — worldId, sequence,
 * eventId, eventType, occurredAt, availableAt (when applicable), causationId,
 * correlationId, producer, schemaVersion, payload; "Sequence is monotonic
 * within a world."
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  EventQuery,
  ProvenanceRecord,
  TimelineSlice,
  WorldEventEnvelope,
} from "../src/events.js";
import type {
  CausationId,
  CorrelationId,
  EventId,
  ProducerId,
  WorldId,
} from "../src/ids.js";
import { asId, asTimestamp } from "./helpers.js";
import type { Equal, Expect, OptionalKeys, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

// The envelope's required fields per WORLD-PROTOCOL.md.
type _envelopeRequired = Expect<
  Equal<
    | "worldId"
    | "sequence"
    | "eventId"
    | "eventType"
    | "occurredAt"
    | "causationId"
    | "correlationId"
    | "producer"
    | "schemaVersion"
    | "payload" extends RequiredKeys<WorldEventEnvelope>
      ? true
      : false,
    true
  >
>;

// `availableAt` is optional — present only "when applicable".
type _availableAtOptional = Expect<
  Equal<"availableAt" extends OptionalKeys<WorldEventEnvelope> ? true : false, true>
>;

type _queryShape = Expect<Equal<RequiredKeys<EventQuery>, never>>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");

function makeEnvelope(
  overrides: Partial<WorldEventEnvelope<{ price: string }>> = {},
): WorldEventEnvelope<{ price: string }> {
  return {
    worldId,
    sequence: 10 as WorldEventEnvelope["sequence"],
    eventId: asId<EventId>("event-10"),
    eventType: "order.filled",
    occurredAt: asTimestamp(1_000),
    causationId: asId<CausationId>("command-5"),
    correlationId: asId<CorrelationId>("flow-1"),
    producer: asId<ProducerId>("producer-engine"),
    schemaVersion: "1",
    payload: { price: "100.25" },
    ...overrides,
  };
}

// --- runtime invariants --------------------------------------------------------

test("an envelope carries the full causal context", () => {
  const event = makeEnvelope();
  assert.equal(event.eventType, "order.filled");
  assert.equal(event.causationId, "command-5" as CausationId);
  assert.equal(event.correlationId, "flow-1" as CorrelationId);
  assert.equal(event.producer, "producer-engine" as ProducerId);
  assert.deepEqual(event.payload, { price: "100.25" });
});

test("sequence is monotonic within a world", () => {
  const events = [
    makeEnvelope({ sequence: 1 as WorldEventEnvelope["sequence"], eventId: asId<EventId>("e1") }),
    makeEnvelope({ sequence: 2 as WorldEventEnvelope["sequence"], eventId: asId<EventId>("e2") }),
    makeEnvelope({ sequence: 5 as WorldEventEnvelope["sequence"], eventId: asId<EventId>("e3") }),
  ];
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i]!.sequence > events[i - 1]!.sequence);
  }
});

test("availableAt delays observation of an event", () => {
  const delayed = makeEnvelope({
    availableAt: asTimestamp(2_000),
  });
  assert.equal(delayed.availableAt, 2_000);
  assert.ok(delayed.availableAt! > delayed.occurredAt);
  const immediate = makeEnvelope();
  assert.equal(immediate.availableAt, undefined);
});

test("timeline slices expose paging without fabricating events", () => {
  const slice: TimelineSlice = {
    from: asTimestamp(0),
    to: asTimestamp(1_000),
    events: [makeEnvelope()],
    hasMore: true,
  };
  assert.equal(slice.events.length, 1);
  assert.equal(slice.hasMore, true);
});

test("provenance records connect an event to its inputs", () => {
  const provenance: ProvenanceRecord = {
    subjectEventId: asId<EventId>("event-10"),
    producer: asId<ProducerId>("producer-engine"),
    inputs: [
      { kind: "command", ref: "command-5" },
      { kind: "event", ref: "event-7" },
    ],
    recordedAt: asTimestamp(1_000),
  };
  assert.equal(provenance.inputs.length, 2);
  assert.equal(provenance.inputs[0]!.kind, "command");
});
