/**
 * Simulation-clock data transform tests (W012) — the pure laws of
 * `src/trading-world/simulation/clockTimelineData.ts`.
 *
 * Covers: the ClockView readout projection (the sim axis is the engine's
 * own view — deterministic UTC text, verbatim status/speed), the honest
 * wall-axis note (the ports project no wallTime — A7), the W004 closed
 * rejection-code set and its extraction from REAL transport errors (the
 * sim engine's ClockRejectionError arrives as remote.data.rejection through
 * the W018 envelope), the announced-regime timeline parsing (validation is
 * the W008 market parser — coordinated semantics, no duplicated logic),
 * and the seek-input parsing (absolute UTC date-time or simulation-ms).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldSimulationClockData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOCK_REJECTION_EXPLANATIONS,
  CLOCK_SPEED_PRESET_OPTIONS,
  CLOCK_STEP_SIZE_OPTIONS,
  clockRejectionFromError,
  describeSimulationClockView,
  describeWallAxis,
  parseSeekTargetText,
  parseTimelineRegimeEntries,
} from "../src/trading-world/simulation/clockTimelineData.js";
import { MarketProjectionDataError } from "../src/trading-world/market/marketData.js";

/** The alpha world's simulation origin (runtime/engineAttachment.ts). */
const SIM_START = 1_700_000_000_000; // 2023-11-14T22:13:20Z

test("the readout projects the engine's ClockView verbatim (sim axis, deterministic UTC)", () => {
  assert.deepEqual(
    describeSimulationClockView({
      simulationTime: SIM_START,
      status: "paused",
      speed: 1,
      followingRealtime: false,
    }),
    {
      timeText: "2023-11-14 22:13:20 UTC",
      statusText: "paused",
      speedText: "1×",
      followingRealtime: false,
    },
  );
  assert.deepEqual(
    describeSimulationClockView({
      simulationTime: SIM_START + 10_000,
      status: "playing",
      speed: 10,
      followingRealtime: true,
    }),
    {
      timeText: "2023-11-14 22:13:30 UTC",
      statusText: "playing",
      speedText: "10×",
      followingRealtime: true,
    },
  );
});

test("the wall axis renders the honest not-projected note (A7 — never a client-side timer)", () => {
  const wall = describeWallAxis();
  assert.equal(wall.label, "wall");
  assert.equal(wall.text, "not projected");
  assert.match(wall.title, /not projected/);
  assert.match(wall.title, /A7/);
  assert.match(wall.title, /ClockView carries no wallTime/);
});

test("the W004 closed rejection-code set is exhaustively explained (drift-guarded by the Record type)", () => {
  assert.deepEqual(Object.keys(CLOCK_REJECTION_EXPLANATIONS).sort(), [
    "invalid-speed",
    "invalid-step-delta",
    "rewind-requires-branch",
    "seek-before-start",
    "seek-beyond-end",
    "unknown-event",
  ]);
  assert.match(
    CLOCK_REJECTION_EXPLANATIONS["rewind-requires-branch"],
    /history is immutable.*A8/,
  );
});

test("clockRejectionFromError extracts the engine's typed rejection from the W018 remote error shape", () => {
  // The W018 envelope serializes the sim engine's ClockRejectionError as a
  // WorldRemoteError: name + message + data.rejection (adapter/envelope.ts).
  const remoteShaped = Object.assign(new Error("ClockRejectionError: refused"), {
    name: "TradingWorldRemoteError",
    remote: {
      name: "ClockRejectionError",
      message: "in-place backward move to 1700000000000 is refused",
      data: {
        rejection: {
          code: "rewind-requires-branch",
          message: "in-place backward move to 1700000000000 is refused",
        },
      },
    },
  });
  assert.deepEqual(clockRejectionFromError(remoteShaped), {
    code: "rewind-requires-branch",
    message: "in-place backward move to 1700000000000 is refused",
    explanation: CLOCK_REJECTION_EXPLANATIONS["rewind-requires-branch"],
  });
});

test("clockRejectionFromError extracts the typed rejection from a same-process ClockRejectionError shape", () => {
  const direct = Object.assign(
    new Error("target 1700000000000 precedes the world origin 1700000000000"),
    {
      name: "ClockRejectionError",
      rejection: {
        code: "seek-before-start",
        message: "target 1699999999000 precedes the world origin 1700000000000",
      },
    },
  );
  assert.deepEqual(clockRejectionFromError(direct), {
    code: "seek-before-start",
    message: "target 1699999999000 precedes the world origin 1700000000000",
    explanation: CLOCK_REJECTION_EXPLANATIONS["seek-before-start"],
  });
});

test("clockRejectionFromError answers undefined for non-typed errors (never a guess)", () => {
  assert.equal(clockRejectionFromError(new Error("plain failure")), undefined);
  assert.equal(
    clockRejectionFromError(
      Object.assign(new Error("weird"), {
        rejection: { code: "not-a-real-code", message: "fabricated" },
      }),
    ),
    undefined,
  );
  assert.equal(clockRejectionFromError("string throw"), undefined);
  assert.equal(clockRejectionFromError(null), undefined);
});

test("parseTimelineRegimeEntries: journal identity + the validated announcement per regime event", () => {
  const entries = parseTimelineRegimeEntries([
    {
      eventId: "evt-quote-1",
      sequence: 7,
      eventType: "market.quote.updated",
      occurredAt: SIM_START,
      payload: { instrumentId: "instrument-es-alpha" },
    },
    {
      eventId: "evt-regime-1",
      sequence: 8,
      eventType: "market.regime.changed",
      occurredAt: SIM_START,
      payload: { to: "mean-reversion", parameters: { anchorPrice: 4800, direction: 1 } },
    },
    {
      eventId: "evt-regime-2",
      sequence: 21,
      eventType: "market.regime.changed",
      occurredAt: SIM_START + 30 * 60_000,
      payload: { from: "mean-reversion", to: "trend" },
    },
  ]);
  assert.deepEqual(entries, [
    {
      announcement: {
        at: SIM_START,
        to: "mean-reversion",
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      sequence: 8,
      eventId: "evt-regime-1",
    },
    {
      announcement: { at: SIM_START + 30 * 60_000, from: "mean-reversion", to: "trend" },
      sequence: 21,
      eventId: "evt-regime-2",
    },
  ]);
});

test("parseTimelineRegimeEntries: a malformed regime payload is the shared market parser's typed error", () => {
  assert.throws(
    () =>
      parseTimelineRegimeEntries([
        {
          eventId: "evt-bad",
          sequence: 3,
          eventType: "market.regime.changed",
          occurredAt: SIM_START,
          payload: { noRegimeHere: true },
        },
      ]),
    MarketProjectionDataError,
  );
});

test("parseSeekTargetText: absolute UTC date-times and simulation-ms integers are honest targets", () => {
  assert.deepEqual(parseSeekTargetText("2023-11-14 22:14:00"), {
    ok: true,
    to: SIM_START + 40_000,
    normalizedText: "2023-11-14 22:14:00 UTC",
  });
  assert.deepEqual(parseSeekTargetText("2023-11-14T22:14"), {
    ok: true,
    to: SIM_START + 40_000,
    normalizedText: "2023-11-14 22:14:00 UTC",
  });
  assert.deepEqual(parseSeekTargetText("  2023-11-14T22:14:30.5 "), {
    ok: true,
    to: SIM_START + 70_500,
    normalizedText: "2023-11-14 22:14:30 UTC",
  });
  assert.deepEqual(parseSeekTargetText("1700000040000"), {
    ok: true,
    to: SIM_START + 40_000,
    normalizedText: "1700000040000",
  });
});

test("parseSeekTargetText: everything else is a typed input error (never a silent guess)", () => {
  for (const bad of ["", "   ", "garbage", "22:14:00", "2023-11-14", "2023-13-99 99:99:99"]) {
    const parsed = parseSeekTargetText(bad);
    assert.equal(parsed.ok, false, `input ${JSON.stringify(bad)} must not parse`);
    if (!parsed.ok) {
      assert.ok(parsed.error.length > 0);
    }
  }
});

test("the playback options: positive step deltas and the UX-DESIGN speed presets", () => {
  assert.deepEqual(
    CLOCK_STEP_SIZE_OPTIONS.map((option) => option.deltaMs),
    [100, 1_000, 10_000, 60_000],
  );
  for (const option of CLOCK_STEP_SIZE_OPTIONS) {
    assert.ok(option.deltaMs > 0 && Number.isFinite(option.deltaMs));
    assert.ok(option.label.length > 0);
  }
  assert.deepEqual(
    CLOCK_SPEED_PRESET_OPTIONS.map((option) => option.speed),
    [0.1, 1, 10, 100],
  );
});
