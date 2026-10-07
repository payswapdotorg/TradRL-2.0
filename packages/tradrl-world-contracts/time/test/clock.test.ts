/**
 * Clock contract tests: ClockPort data shapes, status transition law,
 * request/result envelopes, timeline windows/slices and realtime drift.
 *
 * Spec: spec/WORLD-PROTOCOL.md "ClockPort", spec/ARCHITECTURE-LOCK.md A7/A8,
 * spec/ACCEPTANCE-WORLD-ALPHA.md E.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  ClockBounds,
  ClockRejection,
  ClockRequest,
  ClockRequestKind,
  ClockResult,
  ClockState,
  ClockTimelineSlice,
  SimulationTimeWindow,
} from "../src/clock.js";
import {
  CLOCK_STATUS_TRANSITIONS,
  REALTIME_CLOCK_SPEED,
  canTransitionClockStatus,
  eventQueryForWindow,
  isBackwardSeek,
  isWithinSimulationWindow,
  isValidClockSpeed,
  isValidStepDeltaMs,
  realtimeDriftMs,
  simulationWindowDurationMs,
} from "../src/clock.js";
import type { ClockStatus, ClockView } from "../../src/ports.js";
import type { WorldEventEnvelope } from "../../src/events.js";
import type {
  CausationId,
  CorrelationId,
  EventId,
  ProducerId,
  WorldId,
} from "../../src/ids.js";
import type { SequenceNumber } from "../../src/primitives.js";
import { asSimulationTime, asWallTime } from "../src/timeSemantics.js";
import { asId, asTimestamp } from "../../test/helpers.js";
import type { Equal, Expect, RequiredKeys } from "../../test/helpers.js";

// --- type-level assertions ---------------------------------------------------

// The richer clock state is still a valid minimal ClockView (getClock result).
type _stateIsView = Expect<Equal<ClockState extends ClockView ? true : false, true>>;

// Exactly the seven WORLD-PROTOCOL.md ClockPort operations, as request kinds.
const ALL_CLOCK_REQUEST_KINDS = [
  "play",
  "pause",
  "step",
  "seek",
  "jump-to-event",
  "set-speed",
  "follow-realtime",
] as const;
type _requestKinds = Expect<
  Equal<ClockRequestKind, (typeof ALL_CLOCK_REQUEST_KINDS)[number]>
>;

// Every request carries world scope and a wall-axis request time.
type _requestBase = Expect<
  Equal<RequiredKeys<ClockRequest>, "kind" | "worldId" | "requestedAt">
>;

// The status transition table covers every ClockStatus exactly.
type _transitionKeys = Expect<
  Equal<keyof typeof CLOCK_STATUS_TRANSITIONS, ClockStatus>
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");

function makeClockState(overrides: Partial<ClockState> = {}): ClockState {
  return {
    worldId,
    simulationTime: asSimulationTime(1_000),
    wallTime: asWallTime(1_700_000_000_000),
    status: "paused",
    speed: REALTIME_CLOCK_SPEED,
    followingRealtime: false,
    defaultStepMs: 100,
    bounds: { start: asSimulationTime(0), end: asSimulationTime(10_000) },
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

// --- clock state ---------------------------------------------------------------

test("clock state carries both axes, status, speed and bounds", () => {
  const clock = makeClockState();
  assert.equal(clock.simulationTime, 1_000);
  assert.equal(clock.wallTime, 1_700_000_000_000);
  assert.equal(clock.status, "paused");
  assert.equal(clock.speed, 1);
  assert.equal(clock.followingRealtime, false);
  assert.deepEqual(clock.bounds, { start: asSimulationTime(0), end: asSimulationTime(10_000) });
});

test("a ClockState is directly usable as the minimal ClockView", () => {
  const view: ClockView = makeClockState();
  assert.equal(view.simulationTime, 1_000);
  assert.equal(view.status, "paused");
});

test("bounds are optional for open-ended synthetic worlds", () => {
  const bounds: ClockBounds = { start: asSimulationTime(0) };
  const clock = makeClockState({ bounds });
  assert.equal(bounds.end, undefined);
  assert.equal(clock.bounds?.end, undefined);
});

test("clock speeds must be finite and positive; steps too", () => {
  assert.equal(isValidClockSpeed(1), true);
  assert.equal(isValidClockSpeed(0.5), true);
  assert.equal(isValidClockSpeed(4), true);
  assert.equal(isValidClockSpeed(0), false);
  assert.equal(isValidClockSpeed(-2), false);
  assert.equal(isValidClockSpeed(Number.NaN), false);
  assert.equal(isValidClockSpeed(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidStepDeltaMs(250), true);
  assert.equal(isValidStepDeltaMs(0), false);
  assert.equal(isValidStepDeltaMs(-250), false);
  assert.equal(isValidStepDeltaMs(Number.NaN), false);
});

test("realtime drift is only defined while following realtime", () => {
  // While following realtime both axes advance together; drift is their gap.
  const lagging = makeClockState({
    followingRealtime: true,
    wallTime: asWallTime(1_500),
    simulationTime: asSimulationTime(1_000),
  });
  const leading = makeClockState({
    followingRealtime: true,
    wallTime: asWallTime(900),
    simulationTime: asSimulationTime(1_000),
  });
  const idle = makeClockState({
    followingRealtime: false,
    wallTime: asWallTime(1_500),
    simulationTime: asSimulationTime(1_000),
  });
  assert.equal(realtimeDriftMs(lagging), 500);
  assert.equal(realtimeDriftMs(leading), -100);
  assert.equal(realtimeDriftMs(idle), 0);
});

// --- status transition law --------------------------------------------------------

test("the only status transitions are playing ↔ paused", () => {
  assert.deepEqual(CLOCK_STATUS_TRANSITIONS.playing, ["paused"]);
  assert.deepEqual(CLOCK_STATUS_TRANSITIONS.paused, ["playing"]);
  assert.equal(canTransitionClockStatus("playing", "paused"), true);
  assert.equal(canTransitionClockStatus("paused", "playing"), true);
  assert.equal(canTransitionClockStatus("playing", "playing"), false);
  assert.equal(canTransitionClockStatus("paused", "paused"), false);
});

test("backward seeks are rewinds (A8: rewind = branch, not in-place)", () => {
  assert.equal(isBackwardSeek(asSimulationTime(1_000), asSimulationTime(999)), true);
  assert.equal(isBackwardSeek(asSimulationTime(1_000), asSimulationTime(1_000)), false);
  assert.equal(isBackwardSeek(asSimulationTime(1_000), asSimulationTime(1_001)), false);
});

// --- requests and results ------------------------------------------------------------

test("every ClockPort operation has a typed request envelope", () => {
  const requestedAt = asWallTime(1_700_000_000_000);
  const requests: readonly ClockRequest[] = [
    { kind: "play", worldId, requestedAt },
    { kind: "pause", worldId, requestedAt },
    { kind: "step", worldId, requestedAt, deltaMs: 250 },
    { kind: "step", worldId, requestedAt },
    { kind: "seek", worldId, requestedAt, to: asSimulationTime(5_000) },
    { kind: "jump-to-event", worldId, requestedAt, target: asId<EventId>("event-7") },
    { kind: "jump-to-event", worldId, requestedAt, target: 42 as SequenceNumber },
    { kind: "set-speed", worldId, requestedAt, speed: 4 },
    { kind: "follow-realtime", worldId, requestedAt, enabled: true },
  ];
  assert.deepEqual(requests.map((r) => r.kind), [
    "play",
    "pause",
    "step",
    "step",
    "seek",
    "jump-to-event",
    "jump-to-event",
    "set-speed",
    "follow-realtime",
  ]);
});

test("clock results mirror the ack/rejected command shape", () => {
  const acked: ClockResult = { status: "acked", clock: makeClockState() };
  const rejection: ClockRejection = {
    code: "rewind-requires-branch",
    message: "seek target 999 is before current simulation time 1000; branch instead",
  };
  const rejected: ClockResult = { status: "rejected", rejection };
  assert.equal(acked.status, "acked");
  assert.equal(acked.status === "acked" && acked.clock.simulationTime, 1_000);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejection.code, "rewind-requires-branch");
  const statuses = [acked, rejected].map((r) => r.status);
  assert.deepEqual(statuses, ["acked", "rejected"]);
});

// --- timeline windows and slices ------------------------------------------------------

test("simulation windows are inclusive on both ends", () => {
  const window: SimulationTimeWindow = {
    from: asSimulationTime(1_000),
    to: asSimulationTime(2_000),
  };
  assert.equal(isWithinSimulationWindow(asSimulationTime(999), window), false);
  assert.equal(isWithinSimulationWindow(asSimulationTime(1_000), window), true);
  assert.equal(isWithinSimulationWindow(asSimulationTime(1_500), window), true);
  assert.equal(isWithinSimulationWindow(asSimulationTime(2_000), window), true);
  assert.equal(isWithinSimulationWindow(asSimulationTime(2_001), window), false);
  assert.equal(simulationWindowDurationMs(window), 1_000);
});

test("a window maps onto the evidence timeline query for the same events", () => {
  const window: SimulationTimeWindow = {
    from: asSimulationTime(1_000),
    to: asSimulationTime(2_000),
  };
  const query = eventQueryForWindow(window);
  assert.equal(query.from, 1_000);
  assert.equal(query.to, 2_000);
});

test("timeline slices page around a simulation window without fabricating events", () => {
  const window: SimulationTimeWindow = {
    from: asSimulationTime(1_000),
    to: asSimulationTime(2_000),
  };
  const slice: ClockTimelineSlice = {
    window,
    events: [makeEnvelope()],
    hasMoreBefore: true,
    hasMoreAfter: false,
  };
  assert.equal(slice.events.length, 1);
  assert.equal(slice.events[0]?.occurredAt, 1_000);
  assert.equal(slice.hasMoreBefore, true);
  assert.equal(slice.hasMoreAfter, false);
});
