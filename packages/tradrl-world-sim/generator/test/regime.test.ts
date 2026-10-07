/**
 * Pure regime-schedule model tests (W017 `generator` module): window
 * covering, the active-entry rule, boundary announcements (including the
 * origin rule and schedule gaps), the halt/reopen and shock schedules, the
 * action grid and the behavior profiles.
 *
 * Everything under test is a PURE function of (schedule, interval, time) —
 * the property that makes stepping and seeking produce identical journals
 * (ARCHITECTURE-LOCK.md A9).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegimeScheduleEntry, Venue } from "tradrl-world-contracts";
import {
  DEFAULT_GENERATOR_TICK_MS,
  DEFAULT_REOPEN_AFTER_MS,
  activeEntryAt,
  gridTimesForInterval,
  haltReopenEventsForInterval,
  haltTimeOf,
  isShockGapTurn,
  isFirstGridTimeInWindow,
  referenceModeOf,
  regimeAnnouncementsForInterval,
  regimeProfileOf,
  reopenTimeOf,
  scheduleBoundaries,
  scheduleEntriesOf,
  scheduleTickMs,
  shockGapTimeOf,
  shockHaltEventsForInterval,
} from "../regime.js";
import { INSTRUMENT, START, at, testInstrument } from "./helpers.js";

function entry(
  regime: RegimeScheduleEntry["regime"],
  from: number,
  to?: number,
  parameters?: Record<string, number>,
): RegimeScheduleEntry {
  return {
    regime,
    from: at(from),
    ...(to === undefined ? {} : { to: at(to) }),
    ...(parameters === undefined ? {} : { parameters }),
  };
}

test("activeEntryAt: covering window, latest from wins, ties go to the later position", () => {
  const entries = [
    entry("trend", START, START + 10_000),
    entry("shock", START + 3_000, START + 6_000),
  ];
  assert.equal(activeEntryAt(entries, START - 1)?.regime, undefined);
  assert.equal(activeEntryAt(entries, START)?.regime, "trend");
  assert.equal(activeEntryAt(entries, START + 2_999)?.regime, "trend");
  // the later-from window overrides while it covers
  assert.equal(activeEntryAt(entries, START + 3_000)?.regime, "shock");
  assert.equal(activeEntryAt(entries, START + 5_999)?.regime, "shock");
  // its `to` is exclusive: the trend window covers again
  assert.equal(activeEntryAt(entries, START + 6_000)?.regime, "trend");
  assert.equal(activeEntryAt(entries, START + 9_999)?.regime, "trend");
  // past every window: schedule gap
  assert.equal(activeEntryAt(entries, START + 10_000), undefined);
  // equal `from` → the later array position wins (scenario authoring order)
  const ties = [entry("trend", START), entry("halt-reopen", START)];
  assert.equal(activeEntryAt(ties, START)?.regime, "halt-reopen");
});

test("scheduleBoundaries collects every from and to, sorted, deduplicated", () => {
  const entries = [
    entry("trend", START + 5_000, START + 15_000),
    entry("shock", START, START + 5_000),
  ];
  assert.deepEqual(scheduleBoundaries(entries), [START, START + 5_000, START + 15_000]);
  assert.deepEqual(scheduleBoundaries([]), []);
});

test("announcements: transitions fire with from→to inside (A, B]; steady boundaries stay silent", () => {
  const entries = [
    entry("trend", START, START + 10_000),
    entry("halt-reopen", START + 10_000, START + 20_000),
  ];
  // the transition at START+10k lands inside this interval
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 9_000, START + 12_000), [
    { at: at(START + 10_000), from: "trend", to: "halt-reopen" },
  ]);
  // an interval that ends exactly AT the boundary carries it (A, B]
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 8_000, START + 10_000), [
    { at: at(START + 10_000), from: "trend", to: "halt-reopen" },
  ]);
  // an interval that ends just BEFORE the boundary carries nothing
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 8_000, START + 9_999), []);
  // a boundary already behind the clock (at <= A) never re-fires
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 10_000, START + 12_000), []);
  // parameters ride along on the announcement
  const parameterized = [
    entry("trend", START, START + 1_000, { direction: -1 }),
    entry("shock", START + 1_000, undefined, { gapLots: 30 }),
  ];
  assert.deepEqual(regimeAnnouncementsForInterval(parameterized, START, START + 2_000), [
    { at: at(START + 1_000), from: "trend", to: "shock", parameters: { gapLots: 30 } },
  ]);
});

test("announcements: gaps announce nothing on the way out and carry no `from` on the way in", () => {
  const entries = [
    entry("trend", START, START + 10_000),
    entry("low-liquidity", START + 15_000, START + 20_000),
  ];
  // the trend window ends into a gap: nothing to announce at START+10k
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 9_000, START + 11_000), []);
  // the next window opens from the gap: announced with no `from`
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 14_000, START + 16_000), [
    { at: at(START + 15_000), to: "low-liquidity" },
  ]);
});

test("announcements: the ORIGIN RULE announces the regime in force at the world origin, exactly once", () => {
  const entries = [entry("trend", START, START + 10_000, { anchorPrice: 4800 })];
  // the first advance from the origin announces the initial regime (no from)
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START, START + 1_000, START), [
    { at: at(START), to: "trend", parameters: { anchorPrice: 4800 } },
  ]);
  // later intervals never re-announce it (intervalFrom moved past the origin)
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START + 1_000, START + 2_000, START), []);
  // no worldStart passed (pure interval semantics): nothing at the left edge
  assert.deepEqual(regimeAnnouncementsForInterval(entries, START, START + 1_000), []);
  // a gap at the origin announces nothing
  const gapped = [entry("trend", START + 5_000, START + 10_000)];
  assert.deepEqual(regimeAnnouncementsForInterval(gapped, START, START + 6_000, START), [
    { at: at(START + 5_000), to: "trend" },
  ]);
  // an origin mid-window announces that window (the journal's regime truth
  // is complete from the first tick, whatever the authoring)
  const midOrigin = [entry("trend", START - 7_000, START + 10_000)];
  assert.deepEqual(regimeAnnouncementsForInterval(midOrigin, START, START + 1_000, START), [
    { at: at(START), to: "trend" },
  ]);
  // stepping and seeking agree: the origin announcement fires on the FIRST
  // interval only, so 1×10s and 10×1s produce the same union
  const stepped = [
    ...regimeAnnouncementsForInterval(entries, START, START + 1_000, START),
    ...regimeAnnouncementsForInterval(entries, START + 1_000, START + 10_000, START),
  ];
  const sought = regimeAnnouncementsForInterval(entries, START, START + 10_000, START);
  assert.deepEqual(stepped, sought);
});

test("halt/reopen schedule: defaults, parameters, window clamps and supersession", () => {
  // defaults: halt at the window start, reopen 4000ms later
  const window = entry("halt-reopen", START, START + 20_000);
  assert.equal(haltTimeOf(window), START);
  assert.equal(reopenTimeOf(window), START + DEFAULT_REOPEN_AFTER_MS);
  // parameters move both, and the reopen never passes the window end
  const tuned = entry("halt-reopen", START, START + 6_000, {
    haltAfterMs: 1_000,
    reopenAfterMs: 10_000,
  });
  assert.equal(haltTimeOf(tuned), START + 1_000);
  assert.equal(reopenTimeOf(tuned), START + 6_000);
  // events land in (A, B] per instrument, in definition order
  const events = haltReopenEventsForInterval(
    [window],
    [testInstrument()],
    START - 1,
    START + 5_000,
  );
  assert.deepEqual(events, [
    { at: at(START), kind: "halt", reason: "regime", instrumentId: INSTRUMENT },
    { at: at(START + 4_000), kind: "reopen", reason: "regime", instrumentId: INSTRUMENT },
  ]);
  // an interval that starts at the halt still sees the reopen (A, B]
  assert.deepEqual(
    haltReopenEventsForInterval([window], [testInstrument()], START, START + 4_000).map((x) => x.kind),
    ["reopen"],
  );
  // a superseded halt-reopen window (overridden before its halt) emits nothing
  const superseded = [
    window,
    entry("trend", START, START + 20_000),
  ];
  assert.deepEqual(haltReopenEventsForInterval(superseded, [testInstrument()], START - 1, START + 5_000), []);
});

test("shock halts fire only for venues that declare haltOnShock, reopening per venue policy", () => {
  const shock = entry("shock", START, START + 10_000);
  const instruments = [testInstrument()];
  // no venues declared: no shock halts (the documented default)
  assert.deepEqual(shockHaltEventsForInterval([shock], instruments, [], START - 1, START + 5_000), []);
  const haltingVenue: Venue = {
    venueId: "venue-sim-gen" as never,
    worldId: "world-w017-tests" as never,
    name: "halting",
    matchingModel: "price-time-priority",
    allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
    feeSchedule: { makerRateBps: 0, takerRateBps: 0 },
    latency: { acknowledgementMs: 0, fillPropagationMs: 0 },
    calendar: { sessions: [{ opensAt: at(0), closesAt: at(Number.MAX_SAFE_INTEGER) }] },
    haltPolicy: { haltOnShock: true, reopenAfterMs: 2_000 },
  };
  assert.deepEqual(shockHaltEventsForInterval([shock], instruments, [haltingVenue], START - 1, START + 3_000), [
    { at: at(START), kind: "halt", reason: "volatility", instrumentId: INSTRUMENT },
    { at: at(START + 2_000), kind: "reopen", reason: "volatility", instrumentId: INSTRUMENT },
  ]);
  // a venue without the policy never halts on shock
  const calmVenue: Venue = { ...haltingVenue, haltPolicy: { haltOnShock: false } };
  assert.deepEqual(shockHaltEventsForInterval([shock], instruments, [calmVenue], START - 1, START + 3_000), []);
});

test("the action grid: anchored at the first entry, scenario-wide cadence, (A, B] semantics", () => {
  const entries = [entry("trend", START, START + 10_000)];
  // default cadence 1000ms
  assert.equal(scheduleTickMs(entries), DEFAULT_GENERATOR_TICK_MS);
  assert.deepEqual(gridTimesForInterval(entries, START, START + 3_000), [
    START + 1_000,
    START + 2_000,
    START + 3_000,
  ]);
  // a seek across a long interval replays every intermediate grid turn
  assert.deepEqual(gridTimesForInterval(entries, START + 500, START + 2_500), [
    START + 1_000,
    START + 2_000,
  ]);
  // the grid exists before the anchor only from the anchor itself
  const later = [entry("trend", START + 5_000, START + 10_000)];
  assert.deepEqual(gridTimesForInterval(later, START, START + 6_000), [START + 5_000, START + 6_000]);
  // custom cadence from the first entry's parameters, floor-clamped at 1
  const fast = [entry("trend", START, START + 10_000, { tickMs: 250 }), entry("shock", START + 2_000)];
  assert.equal(scheduleTickMs(fast), 250);
  assert.deepEqual(gridTimesForInterval(fast, START, START + 600), [
    START + 250,
    START + 500,
  ]);
  const broken = [entry("trend", START, undefined, { tickMs: 0.5 })];
  assert.equal(scheduleTickMs(broken), 1);
  // no schedule: no grid
  assert.deepEqual(gridTimesForInterval([], START, START + 10_000), []);
});

test("window-first grid turns and the shock gap are fixed timeline points (stateless, once)", () => {
  const entries = [entry("trend", START, START + 10_000, { tickMs: 1_000 })];
  const window = entries[0]!;
  // the anchor itself is the window's first grid turn (at - tick < from)
  assert.equal(isFirstGridTimeInWindow(entries, window, START), true);
  assert.equal(isFirstGridTimeInWindow(entries, window, START + 1_000), false);
  const shock = entry("shock", START + 5_000, START + 12_000, { gapAfterMs: 1_500 });
  const withShock = [...entries, shock];
  // gap fires 1500ms into the window: first grid time at/after it, in-window
  assert.equal(shockGapTimeOf(withShock, shock), START + 6_500);
  assert.equal(isShockGapTurn(withShock, shock, START + 6_000), false);
  assert.equal(isShockGapTurn(withShock, shock, START + 7_000), true);
  assert.equal(isShockGapTurn(withShock, shock, START + 8_000), false, "the gap fires exactly once");
  // default: two grid turns after the window start (makers seed the book first)
  const defaultGap = entry("shock", START + 5_000, START + 12_000);
  assert.equal(shockGapTimeOf([...entries, defaultGap], defaultGap), START + 7_000);
});

test("regime profiles: seeded defaults per regime, parameter overrides, honest clamps", () => {
  const trend = regimeProfileOf(entry("trend", START));
  assert.equal(trend.mmSpreadTicks, 2);
  assert.equal(trend.mmLevels, 3);
  assert.equal(trend.takerBias, 0.75);
  assert.equal(trend.direction, 1);
  assert.equal(trend.gapLots, 0);
  assert.equal(trend.anchorPrice, undefined);
  // mean reversion pins to the anchor and is symmetric
  const mr = regimeProfileOf(entry("mean-reversion", START, undefined, { anchorPrice: 4800 }));
  assert.equal(mr.takerBias, 0.5);
  assert.equal(mr.anchorPrice, 4800);
  assert.equal(referenceModeOf(entry("mean-reversion", START)), "anchor");
  assert.equal(referenceModeOf(entry("trend", START)), "tape");
  // shock defaults to a dislocating gap down
  const shock = regimeProfileOf(entry("shock", START));
  assert.equal(shock.direction, -1);
  assert.equal(shock.gapLots, 25);
  // parameters override, direction snaps to ±1, rates clamp into [0,1]
  const tuned = regimeProfileOf(
    entry("high-volatility", START, undefined, {
      direction: -3,
      takerRate: 7,
      noiseRate: -1,
      mmLevels: 0,
      anchorPrice: -5,
    }),
  );
  assert.equal(tuned.direction, -1);
  assert.equal(tuned.takerRate, 1);
  assert.equal(tuned.noiseRate, 0);
  assert.equal(tuned.mmLevels, 3, "a non-positive override falls back to the default");
  assert.equal(tuned.anchorPrice, undefined, "a non-positive anchor is not carried");
});

test("scheduleEntriesOf: the scenario in force, or none", () => {
  assert.deepEqual(scheduleEntriesOf(undefined), []);
  const entries = [entry("trend", START)];
  assert.deepEqual(scheduleEntriesOf({ entries }), entries);
  assert.deepEqual(scheduleEntriesOf({ label: "l", entries }), entries);
});
