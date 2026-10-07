/**
 * Time-semantics contract tests: the four WORLD-PROTOCOL.md "Time" concepts,
 * their compile-time separation, and the A7 point-in-time laws.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Time" (wallTime / simulationTime / eventTime /
 * availableAt), spec/ARCHITECTURE-LOCK.md A7, spec/ACCEPTANCE-WORLD-ALPHA.md H,
 * spec/REQUIREMENTS.md R016.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  AvailableAtMs,
  EventTimeMs,
  SimulationTimeMs,
  WallTimeMs,
  WorldTimePoint,
} from "../src/timeSemantics.js";
import {
  asAvailableAt,
  asEventTime,
  asSimulationTime,
  asWallTime,
  availabilityDelayMs,
  eventObservationTime,
  hasEventOccurred,
  isArtifactObservableAt,
  isEventObservableAt,
  isEventTimeConsistent,
} from "../src/timeSemantics.js";
import type {
  InformationArtifact,
} from "../../src/information.js";
import type { WorldEventEnvelope } from "../../src/events.js";
import type {
  CausationId,
  CorrelationId,
  EventId,
  InformationArtifactId,
  ProducerId,
  WorldId,
} from "../../src/ids.js";
import type { SequenceNumber, TimestampMs } from "../../src/primitives.js";
import { asId, asTimestamp } from "../../test/helpers.js";
import type { Equal, Expect, RequiredKeys } from "../../test/helpers.js";

// --- type-level assertions ---------------------------------------------------

// A7: wall time and simulation time are different concepts — neither axis is
// assignable to the other, so cross-axis comparison is a compile error.
type _wallNotSim = Expect<Equal<WallTimeMs extends SimulationTimeMs ? true : false, false>>;
type _simNotWall = Expect<Equal<SimulationTimeMs extends WallTimeMs ? true : false, false>>;

// Both axis types are still TimestampMs values and flow into W003 fields.
type _wallIsTimestamp = Expect<Equal<WallTimeMs extends TimestampMs ? true : false, true>>;
type _simIsTimestamp = Expect<Equal<SimulationTimeMs extends TimestampMs ? true : false, true>>;

// Event time and availableAt live ON the simulation axis (role-narrowed):
// comparable with the clock, but not freely interchangeable roles.
type _eventIsSim = Expect<Equal<EventTimeMs extends SimulationTimeMs ? true : false, true>>;
type _simNotEvent = Expect<Equal<SimulationTimeMs extends EventTimeMs ? true : false, false>>;
type _availIsSim = Expect<Equal<AvailableAtMs extends SimulationTimeMs ? true : false, true>>;
type _simNotAvail = Expect<Equal<SimulationTimeMs extends AvailableAtMs ? true : false, false>>;
type _eventNotAvail = Expect<Equal<EventTimeMs extends AvailableAtMs ? true : false, false>>;

// A world time point carries both axes plus world scope.
type _pointKeys = Expect<
  Equal<RequiredKeys<WorldTimePoint>, "worldId" | "simulationTime" | "wallTime">
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");

function makeArtifact(
  overrides: Partial<InformationArtifact<{ headline: string }>> = {},
): InformationArtifact<{ headline: string }> {
  return {
    artifactId: asId<InformationArtifactId>("artifact-1"),
    worldId,
    source: "news-wire",
    createdAt: asTimestamp(90),
    availableAt: asTimestamp(100),
    scope: "news",
    provenance: {
      producer: asId<ProducerId>("producer-news"),
      recordedAt: asTimestamp(90),
    },
    version: "1",
    payload: { headline: "Earnings beat" },
    ...overrides,
  };
}

function makeEnvelope(
  overrides: Partial<WorldEventEnvelope<{ price: string }>> = {},
): WorldEventEnvelope<{ price: string }> {
  return {
    worldId,
    sequence: 10 as SequenceNumber,
    eventId: asId<EventId>("event-10"),
    eventType: "market.trade.printed",
    occurredAt: asTimestamp(1_000),
    causationId: asId<CausationId>("command-5"),
    correlationId: asId<CorrelationId>("flow-1"),
    producer: asId<ProducerId>("producer-engine"),
    schemaVersion: "1",
    payload: { price: "100.25" },
    ...overrides,
  };
}

// --- axis constructors ---------------------------------------------------------

test("axis constructors stamp roles and still flow into plain TimestampMs fields", () => {
  const wall = asWallTime(1_700_000_000_000);
  const sim = asSimulationTime(1_000);
  const event = asEventTime(1_050);
  const availableAt = asAvailableAt(1_200);
  // Assignability in action: every stamped value is a TimestampMs.
  const asTimestamps: readonly TimestampMs[] = [wall, sim, event, availableAt];
  assert.deepEqual(asTimestamps, [1_700_000_000_000, 1_000, 1_050, 1_200]);
});

// --- A7 point-in-time law for artifacts (acceptance H) -------------------------

test("an artifact whose availableAt is after simulation time is not observable", () => {
  const artifact = makeArtifact(); // availableAt = 100
  assert.equal(isArtifactObservableAt(artifact, asSimulationTime(99)), false);
  assert.equal(isArtifactObservableAt(artifact, asSimulationTime(100)), true);
  assert.equal(isArtifactObservableAt(artifact, asSimulationTime(101)), true);
});

// --- A7 point-in-time law for events --------------------------------------------

test("an event without delayed availability is observable once it occurred", () => {
  const event = makeEnvelope(); // occurredAt = 1000, no availableAt
  assert.equal(eventObservationTime(event), 1_000);
  assert.equal(isEventObservableAt(event, asSimulationTime(999)), false);
  assert.equal(isEventObservableAt(event, asSimulationTime(1_000)), true);
});

test("a delayed event is not observable before its availableAt", () => {
  const delayed = makeEnvelope({ availableAt: asTimestamp(2_000) });
  assert.equal(eventObservationTime(delayed), 2_000);
  assert.equal(isEventObservableAt(delayed, asSimulationTime(1_500)), false);
  assert.equal(isEventObservableAt(delayed, asSimulationTime(2_000)), true);
});

test("occurrence and observability are distinct concepts (the A7 case)", () => {
  const delayed = makeEnvelope({ availableAt: asTimestamp(2_000) });
  // At simulation time 1500 the event has already occurred…
  assert.equal(hasEventOccurred(delayed, asSimulationTime(1_500)), true);
  // …but the trader still cannot observe it.
  assert.equal(isEventObservableAt(delayed, asSimulationTime(1_500)), false);
  assert.equal(hasEventOccurred(delayed, asSimulationTime(999)), false);
});

test("availabilityDelayMs reports the delayed-feed delay deterministically", () => {
  assert.equal(availabilityDelayMs(makeEnvelope()), 0);
  assert.equal(availabilityDelayMs(makeEnvelope({ availableAt: asTimestamp(2_000) })), 1_000);
});

test("an event may never be observable strictly before it occurred", () => {
  assert.equal(isEventTimeConsistent(makeEnvelope()), true);
  assert.equal(
    isEventTimeConsistent(makeEnvelope({ availableAt: asTimestamp(2_000) })),
    true,
  );
  assert.equal(
    isEventTimeConsistent(makeEnvelope({ availableAt: asTimestamp(999) })),
    false,
  );
});

test("a world time point carries both axes for one instant", () => {
  const point: WorldTimePoint = {
    worldId,
    simulationTime: asSimulationTime(1_000),
    wallTime: asWallTime(1_700_000_000_000),
  };
  assert.equal(point.simulationTime, 1_000);
  assert.equal(point.wallTime, 1_700_000_000_000);
});
