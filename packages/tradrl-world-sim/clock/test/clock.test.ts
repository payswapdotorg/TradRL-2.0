/**
 * Tests for the deterministic simulation clock (W013 `clock` module).
 *
 * Laws under test (spec/SIMULATION.md, spec/WORLD-PROTOCOL.md "ClockPort"/
 * "Time", spec/ARCHITECTURE-LOCK.md A7/A8, spec/ACCEPTANCE-WORLD-ALPHA.md E):
 * - play/pause follow the W004 status transition law; step/seek/jump move
 *   time but never change status;
 * - seeks are bounded (before-start / beyond-end) and backward motion is the
 *   typed `rewind-requires-branch` rejection (A8: branching, not rewind);
 * - speed/delta validation uses W004's predicates and rejection codes;
 * - wall time is recorded, never mixed into simulation-axis math (A7);
 * - a request sequence fully determines the resulting state (A9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventId, SequenceNumber, TimestampMs, WorldId } from "tradrl-world-contracts";
import type { ClockRequest, WallTimeMs } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";
import { realtimeDriftMs } from "tradrl-world-contracts/time";
import {
  ClockRejectionError,
  InvalidClockSetupError,
  asClockPort,
  createSimulationClock,
  type SimulationClock,
  type SimulationClockOptions,
} from "../index.js";

const WORLD = "world-clock-test" as WorldId;
const START = 1_700_000_000_000;
const WALL_0 = 1_700_000_500_000;

/** Distributive Omit: keeps the request union discriminated per kind. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ClockOperation = DistributiveOmit<ClockRequest, "worldId" | "requestedAt">;

function clockOptions(overrides: Partial<SimulationClockOptions> = {}): SimulationClockOptions {
  return {
    worldId: WORLD,
    simulationTime: START as SimulationClockOptions["simulationTime"],
    wallTime: asWallTime(WALL_0),
    ...overrides,
  };
}

function request(clock: SimulationClock, operation: ClockOperation) {
  return clock.request({
    worldId: WORLD,
    requestedAt: asWallTime(WALL_0),
    ...operation,
  } as ClockRequest);
}

test("initial state carries the W004 defaults", () => {
  const clock = createSimulationClock(clockOptions());
  const state = clock.state();
  assert.equal(state.worldId, WORLD);
  assert.equal(state.simulationTime, START);
  assert.equal(state.wallTime, WALL_0);
  assert.equal(state.status, "paused");
  assert.equal(state.speed, 1);
  assert.equal(state.followingRealtime, false);
  assert.equal(state.defaultStepMs, 1000);
  assert.equal(state.bounds, undefined);
});

test("declared bounds and defaults are honored", () => {
  const clock = createSimulationClock(
    clockOptions({
      bounds: { start: START as never, end: (START + 60_000) as never },
      defaultStepMs: 250,
      speed: 4,
    }),
  );
  const state = clock.state();
  assert.deepEqual(state.bounds, { start: START, end: START + 60_000 });
  assert.equal(state.defaultStepMs, 250);
  assert.equal(state.speed, 4);
});

test("play and pause follow the status transition law and are idempotent", () => {
  const clock = createSimulationClock(clockOptions());
  assert.equal(request(clock, { kind: "play" }).status, "acked");
  assert.equal(clock.state().status, "playing");
  assert.equal(request(clock, { kind: "play" }).status, "acked");
  assert.equal(clock.state().status, "playing");
  assert.equal(request(clock, { kind: "pause" }).status, "acked");
  assert.equal(clock.state().status, "paused");
  assert.equal(request(clock, { kind: "pause" }).status, "acked");
  assert.equal(clock.state().status, "paused");
});

test("step/seek/jump move time but never change status", () => {
  const clock = createSimulationClock(clockOptions());
  request(clock, { kind: "play" });
  request(clock, { kind: "step", deltaMs: 5_000 });
  request(clock, { kind: "seek", to: (START + 30_000) as never });
  assert.equal(clock.state().status, "playing");
  request(clock, { kind: "pause" });
  request(clock, { kind: "step", deltaMs: 5_000 });
  assert.equal(clock.state().status, "paused");
});

test("step uses defaultStepMs when deltaMs is omitted", () => {
  const clock = createSimulationClock(clockOptions({ defaultStepMs: 250 }));
  const result = request(clock, { kind: "step" });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 250);
});

test("step applies an explicit positive delta", () => {
  const clock = createSimulationClock(clockOptions());
  const result = request(clock, { kind: "step", deltaMs: 1_500 });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 1_500);
});

test("step rejects non-finite and non-positive deltas with invalid-step-delta", () => {
  const clock = createSimulationClock(clockOptions());
  for (const deltaMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = request(clock, { kind: "step", deltaMs });
    assert.equal(result.status, "rejected");
    assert.equal(result.status === "rejected" && result.rejection.code, "invalid-step-delta");
  }
  assert.equal(clock.state().simulationTime, START);
});

test("step clamps at a finite timeline end instead of rejecting", () => {
  const clock = createSimulationClock(
    clockOptions({ bounds: { start: START as never, end: (START + 1_000) as never } }),
  );
  const result = request(clock, { kind: "step", deltaMs: 10_000 });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 1_000);
});

test("seek moves forward to an absolute point", () => {
  const clock = createSimulationClock(clockOptions());
  const result = request(clock, { kind: "seek", to: (START + 123_456) as never });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 123_456);
  // an equal seek is an idempotent ack
  assert.equal(request(clock, { kind: "seek", to: (START + 123_456) as never }).status, "acked");
});

test("seek backward is the typed rewind-requires-branch rejection (A8)", () => {
  const clock = createSimulationClock(clockOptions());
  request(clock, { kind: "step", deltaMs: 10_000 });
  const result = request(clock, { kind: "seek", to: (START + 5_000) as never });
  assert.deepEqual(result, {
    status: "rejected",
    rejection: {
      code: "rewind-requires-branch",
      message:
        "in-place backward move to 1700000005000 is refused: rewind creates a branch " +
        "from an immutable snapshot (ARCHITECTURE-LOCK A8)",
    },
  });
  assert.equal(clock.state().simulationTime, START + 10_000);
});

test("seek before the world origin is rejected with seek-before-start", () => {
  const clock = createSimulationClock(
    clockOptions({ bounds: { start: START as never, end: (START + 60_000) as never } }),
  );
  // bounds are checked before the rewind law: before-start is the more
  // specific typed rejection for a point outside the declared timeline.
  const result = request(clock, { kind: "seek", to: (START - 1) as never });
  assert.equal(result.status === "rejected" && result.rejection.code, "seek-before-start");
});

test("seek past a finite end is rejected with seek-beyond-end", () => {
  const clock = createSimulationClock(
    clockOptions({ bounds: { start: START as never, end: (START + 60_000) as never } }),
  );
  const result = request(clock, { kind: "seek", to: (START + 60_001) as never });
  assert.equal(result.status === "rejected" && result.rejection.code, "seek-beyond-end");
  // the end itself is reachable
  assert.equal(request(clock, { kind: "seek", to: (START + 60_000) as never }).status, "acked");
});

test("seek with a non-finite target is reported as seek-before-start (closed code set)", () => {
  const clock = createSimulationClock(clockOptions());
  const result = request(clock, { kind: "seek", to: Number.NaN as never });
  assert.equal(result.status === "rejected" && result.rejection.code, "seek-before-start");
  assert.equal(clock.state().simulationTime, START);
});

test("setSpeed accepts positive finite multipliers", () => {
  const clock = createSimulationClock(clockOptions());
  for (const speed of [0.5, 1, 2, 1000]) {
    const result = request(clock, { kind: "set-speed", speed });
    assert.equal(result.status, "acked");
    assert.equal(clock.state().speed, speed);
  }
});

test("setSpeed rejects non-finite and non-positive speeds with invalid-speed", () => {
  const clock = createSimulationClock(clockOptions());
  for (const speed of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = request(clock, { kind: "set-speed", speed });
    assert.equal(result.status, "rejected");
    assert.equal(result.status === "rejected" && result.rejection.code, "invalid-speed");
  }
  assert.equal(clock.state().speed, 1);
});

test("followRealtime records the mode without auto-advancing time (headless determinism)", () => {
  const clock = createSimulationClock(clockOptions({ wallTime: asWallTime(WALL_0) }));
  assert.equal(realtimeDriftMs(clock.state()), 0, "drift is zero outside follow mode");
  const result = request(clock, { kind: "follow-realtime", enabled: true });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().followingRealtime, true);
  assert.equal(clock.state().simulationTime, START, "no wall-clock timer moved the clock");
  // drift readout (W004): wallTime - simulationTime while following
  assert.equal(realtimeDriftMs(clock.state()), WALL_0 - START);
  request(clock, { kind: "follow-realtime", enabled: false });
  assert.equal(clock.state().followingRealtime, false);
  assert.equal(realtimeDriftMs(clock.state()), 0);
});

test("wallTime is recorded from requestedAt and never mixed into the simulation axis", () => {
  const clock = createSimulationClock(clockOptions());
  clock.request({
    kind: "step",
    worldId: WORLD,
    requestedAt: asWallTime(WALL_0 + 42_000),
    deltaMs: 1_000,
  });
  const state = clock.state();
  assert.equal(state.wallTime, WALL_0 + 42_000);
  assert.equal(state.simulationTime, START + 1_000);
});

test("jump-to-event resolves by event id and by sequence, moving to occurredAt", () => {
  let clock = createSimulationClock(
    clockOptions({
      eventLookup: {
        findEvent: (target) =>
          target === ("evt-1" as EventId) || target === (7 as SequenceNumber)
            ? { occurredAt: START + 5_000 }
            : undefined,
      },
    }),
  );
  let result = request(clock, { kind: "jump-to-event", target: "evt-1" as EventId });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 5_000);

  clock = createSimulationClock(
    clockOptions({
      eventLookup: {
        findEvent: (target) =>
          target === (7 as SequenceNumber) ? { occurredAt: START + 9_000 } : undefined,
      },
    }),
  );
  result = request(clock, { kind: "jump-to-event", target: 7 as SequenceNumber });
  assert.equal(result.status, "acked");
  assert.equal(clock.state().simulationTime, START + 9_000);
});

test("jump-to-event rejects unknown targets with unknown-event", () => {
  const clock = createSimulationClock(
    clockOptions({ eventLookup: { findEvent: () => undefined } }),
  );
  const result = request(clock, { kind: "jump-to-event", target: "evt-x" as EventId });
  assert.equal(result.status === "rejected" && result.rejection.code, "unknown-event");
});

test("jump-to-event backward is refused like a backward seek (A8)", () => {
  const clock = createSimulationClock(
    clockOptions({
      eventLookup: { findEvent: () => ({ occurredAt: START - 5_000 }) },
    }),
  );
  request(clock, { kind: "step", deltaMs: 1_000 });
  const result = request(clock, { kind: "jump-to-event", target: 1 as SequenceNumber });
  assert.equal(result.status === "rejected" && result.rejection.code, "rewind-requires-branch");
});

test("invalid clock setup fails fast", () => {
  assert.throws(
    () => createSimulationClock(clockOptions({ defaultStepMs: 0 })),
    InvalidClockSetupError,
  );
  assert.throws(() => createSimulationClock(clockOptions({ speed: -1 })), InvalidClockSetupError);
  assert.throws(
    () =>
      createSimulationClock(
        clockOptions({
          simulationTime: (START - 1) as SimulationClockOptions["simulationTime"],
          bounds: { start: START as never },
        }),
      ),
    InvalidClockSetupError,
  );
  assert.throws(
    () =>
      createSimulationClock(
        clockOptions({
          bounds: { start: (START + 10) as never, end: START as never },
        }),
      ),
    InvalidClockSetupError,
  );
});

test("a request sequence fully determines the resulting state (determinism)", () => {
  const run = () => {
    const clock = createSimulationClock(
      clockOptions({
        bounds: { start: START as never, end: (START + 500_000) as never },
        defaultStepMs: 100,
      }),
    );
    const requestedAt = asWallTime(WALL_0);
    clock.request({ kind: "play", worldId: WORLD, requestedAt });
    clock.request({ kind: "step", worldId: WORLD, requestedAt });
    clock.request({ kind: "set-speed", worldId: WORLD, requestedAt, speed: 3 });
    clock.request({ kind: "step", worldId: WORLD, requestedAt, deltaMs: 2_500 });
    clock.request({
      kind: "seek",
      worldId: WORLD,
      requestedAt,
      to: (START + 400_000) as never,
    });
    clock.request({ kind: "pause", worldId: WORLD, requestedAt });
    clock.request({ kind: "follow-realtime", worldId: WORLD, requestedAt, enabled: true });
    return clock.state();
  };
  assert.deepEqual(run(), run());
});

test("asClockPort adapts the clock to ClockPort semantics with typed rejections", async () => {
  const wallTimes = [WALL_0, WALL_0 + 10, WALL_0 + 20];
  let i = 0;
  const clock = createSimulationClock(clockOptions());
  const port = asClockPort(clock, () => asWallTime(wallTimes[i++] ?? WALL_0));

  await port.play();
  assert.equal(clock.state().status, "playing");
  await port.step(2_000);
  assert.equal(clock.state().simulationTime, START + 2_000);
  await port.setSpeed(5);
  assert.equal(clock.state().speed, 5);

  await assert.rejects(port.step(-1), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "invalid-step-delta");
    return true;
  });
  await assert.rejects(port.seek(START as TimestampMs), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "rewind-requires-branch");
    return true;
  });

  const view = await port.getClock();
  assert.deepEqual(view, {
    simulationTime: START + 2_000,
    status: "playing",
    speed: 5,
    followingRealtime: false,
  });
  assert.equal(clock.state().wallTime, WALL_0 + 20, "requestedAt came from the wall source");
});

test("asClockPort follows realtime by flag only", async () => {
  const clock = createSimulationClock(clockOptions());
  const port = asClockPort(clock, () => asWallTime(WALL_0));
  await port.followRealtime(true);
  assert.equal((await port.getClock()).followingRealtime, true);
  assert.equal(clock.state().simulationTime, START, "no auto-advance in the headless engine");
});

test("wall-time values are host-axis numbers (A7 compile-time separation)", () => {
  const wall: WallTimeMs = asWallTime(0);
  assert.equal(typeof wall, "number");
});
