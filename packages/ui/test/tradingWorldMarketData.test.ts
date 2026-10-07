/**
 * Watchlist data-transform tests (W008) — the pure projection laws.
 *
 * Guards `src/trading-world/market/marketData.ts`: instrument discovery and
 * regime-announcement parsing over real timeline shapes (typed errors on
 * malformed payloads), the declared-schedule lookups (generator covering
 * semantics), the announced>scheduled>absent regime precedence, and the
 * row builder's ordering/dedup/pass-through laws (canonical quote text is
 * truth; absent fields stay absent; per-row typed errors surface per row —
 * ARCHITECTURE-LOCK A6: never fabricated, never swallowed).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldMarketData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWatchlistRows,
  describeSimulationClock,
  discoverInstrumentIds,
  formatSimulationTimestampMs,
  MarketProjectionDataError,
  nextScheduledRegimeChange,
  parseRegimeAnnouncements,
  REGIME_CHANGED_EVENT_TYPE,
  regimeInForceFor,
  scheduledRegimeAt,
  WATCHLIST_TIMELINE_EVENT_TYPES,
  worldRegimeInForce,
  type MarketInstrumentId,
  type MarketTimelineEvent,
} from "../src/trading-world/market/marketData.js";

/** Configured/discovered ids enter the builder as the branded opaque keys
 * (plain strings at composition; the brand mirrors the port signature). */
const ids = (values: readonly string[]): readonly MarketInstrumentId[] =>
  values as readonly MarketInstrumentId[];

function event(
  eventType: string,
  sequence: number,
  occurredAt: number,
  payload: unknown,
): MarketTimelineEvent {
  return { eventType, occurredAt, sequence, payload };
}

const SCHEDULE = [
  { regime: "mean-reversion", from: 1_000, to: 2_000, parameters: { anchorPrice: 4800 } },
  { regime: "trend", from: 2_000, to: 3_000 },
  { regime: "high-volatility", from: 3_000 },
] as const;

test("the timeline read list covers instrument-bearing market events + regime announcements", () => {
  assert.deepEqual(WATCHLIST_TIMELINE_EVENT_TYPES, [
    "market.quote.updated",
    "market.trade.printed",
    "market.book.delta",
    "market.book.snapshot",
    "market.halted",
    "market.reopened",
    "market.regime.changed",
  ]);
  assert.equal(REGIME_CHANGED_EVENT_TYPE, "market.regime.changed");
});

test("discovery extracts first-observed-order, de-duplicated instrument ids", () => {
  const events: MarketTimelineEvent[] = [
    event("market.regime.changed", 1, 1_000, { type: "market.regime.changed", to: "trend" }),
    event("market.book.delta", 2, 1_100, { type: "market.book.delta", instrumentId: "inst-b" }),
    event("market.quote.updated", 3, 1_150, { type: "market.quote.updated", instrumentId: "inst-a" }),
    event("market.trade.printed", 4, 1_200, { type: "market.trade.printed", instrumentId: "inst-b" }),
    event("market.halted", 5, 1_250, {
      type: "market.halted",
      scope: { kind: "instrument", instrumentId: "inst-c" },
      reason: "regime",
    }),
    event("market.reopened", 6, 1_300, {
      type: "market.reopened",
      scope: { kind: "venue", venueId: "venue-x" },
    }),
    event("market.regime.changed", 7, 1_350, {
      type: "market.regime.changed",
      to: "shock",
      instrumentId: "inst-d",
    }),
  ];
  assert.deepEqual(discoverInstrumentIds(events), [
    "inst-b",
    "inst-a",
    "inst-c",
    "inst-d",
  ]);
  // World-scoped regime announcements and venue-scoped halts discover nothing.
  assert.deepEqual(discoverInstrumentIds([events[0]!]), []);
  assert.deepEqual(discoverInstrumentIds([events[5]!]), []);
});

test("discovery refuses malformed instrument payloads with the typed error", () => {
  assert.throws(
    () => discoverInstrumentIds([event("market.trade.printed", 1, 1, { instrumentId: 42 })]),
    MarketProjectionDataError,
  );
  assert.throws(
    () =>
      discoverInstrumentIds([
        event("market.halted", 2, 1, {
          scope: { kind: "instrument", instrumentId: 7 },
          reason: "regime",
        }),
      ]),
    MarketProjectionDataError,
  );
  assert.throws(
    () => discoverInstrumentIds([event("market.quote.updated", 3, 1, "no payload object")]),
    MarketProjectionDataError,
  );
});

test("regime announcements parse world- and instrument-scoped transitions in journal order", () => {
  const events: MarketTimelineEvent[] = [
    event("market.book.delta", 1, 1_000, { type: "market.book.delta", instrumentId: "x" }),
    event(REGIME_CHANGED_EVENT_TYPE, 2, 1_000, {
      type: "market.regime.changed",
      to: "mean-reversion",
      parameters: { anchorPrice: 4800, direction: 1 },
    }),
    event(REGIME_CHANGED_EVENT_TYPE, 3, 2_000, {
      type: "market.regime.changed",
      from: "mean-reversion",
      to: "trend",
    }),
    event(REGIME_CHANGED_EVENT_TYPE, 4, 2_500, {
      type: "market.regime.changed",
      to: "shock",
      instrumentId: "inst-a",
    }),
  ];
  const announcements = parseRegimeAnnouncements(events);
  assert.equal(announcements.length, 3);
  assert.deepEqual(announcements[0], {
    at: 1_000,
    to: "mean-reversion",
    parameters: { anchorPrice: 4800, direction: 1 },
  });
  assert.deepEqual(announcements[1], { at: 2_000, from: "mean-reversion", to: "trend" });
  assert.deepEqual(announcements[2], { at: 2_500, to: "shock", instrumentId: "inst-a" });
  // Non-regime events are ignored (no error — they are not announcements).
  assert.deepEqual(
    parseRegimeAnnouncements([events[0]!]),
    [],
  );
});

test("regime announcement parsing refuses payloads without a regime `to`", () => {
  assert.throws(
    () => parseRegimeAnnouncements([event(REGIME_CHANGED_EVENT_TYPE, 1, 1, { type: "market.regime.changed" })]),
    MarketProjectionDataError,
  );
  assert.throws(
    () => parseRegimeAnnouncements([event(REGIME_CHANGED_EVENT_TYPE, 2, 1, { to: 5 })]),
    MarketProjectionDataError,
  );
  assert.throws(
    () =>
      parseRegimeAnnouncements([
        event(REGIME_CHANGED_EVENT_TYPE, 3, 1, { to: "trend", from: 9 }),
      ]),
    MarketProjectionDataError,
  );
});

test("scheduledRegimeAt mirrors the generator covering semantics ([from, to), latest from wins)", () => {
  assert.equal(scheduledRegimeAt(SCHEDULE, 999), undefined, "before the first entry");
  assert.equal(scheduledRegimeAt(SCHEDULE, 1_000)!.regime, "mean-reversion", "from is inclusive");
  assert.equal(scheduledRegimeAt(SCHEDULE, 1_999)!.regime, "mean-reversion");
  assert.equal(scheduledRegimeAt(SCHEDULE, 2_000)!.regime, "trend", "to is exclusive");
  assert.equal(scheduledRegimeAt(SCHEDULE, 4_000)!.regime, "high-volatility", "open-ended");
  // A gap: nothing covers 3_500 when the last entry ends at 3_500.
  const gapped = [
    { regime: "a", from: 0, to: 3_500 },
    { regime: "b", from: 4_000 },
  ];
  assert.equal(scheduledRegimeAt(gapped, 3_700), undefined, "inside a schedule gap");
  // Latest `from` wins (ties → later array position).
  const overlapping = [
    { regime: "early", from: 0, to: 10_000 },
    { regime: "late", from: 5_000, to: 10_000 },
  ];
  assert.equal(scheduledRegimeAt(overlapping, 6_000)!.regime, "late");
  assert.equal(scheduledRegimeAt(overlapping, 4_000)!.regime, "early");
});

test("nextScheduledRegimeChange returns the nearest boundary strictly after `at`", () => {
  assert.deepEqual(nextScheduledRegimeChange(SCHEDULE, 1_500), {
    at: 2_000,
    entry: SCHEDULE[1],
  });
  assert.deepEqual(nextScheduledRegimeChange(SCHEDULE, 2_000), {
    at: 3_000,
    entry: SCHEDULE[2],
  });
  const openEnded = [{ regime: "calm", from: 0 }];
  assert.equal(nextScheduledRegimeChange(openEnded, 5), undefined, "no boundary left");
});

test("regimeInForceFor: announced beats scheduled; applicable announcements only", () => {
  const announcements = parseRegimeAnnouncements([
    event(REGIME_CHANGED_EVENT_TYPE, 1, 1_000, { type: "market.regime.changed", to: "trend" }),
    event(REGIME_CHANGED_EVENT_TYPE, 2, 2_400, {
      type: "market.regime.changed",
      to: "shock",
      instrumentId: "inst-a",
    }),
  ]);
  // inst-a: the instrument-scoped announcement (seq 2) is the last applicable.
  const forA = regimeInForceFor({
    instrumentId: "inst-a",
    announcements,
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.equal(forA?.kind, "announced");
  assert.equal(forA.kind === "announced" && forA.announcement.to, "shock");
  // inst-b: only the world-scoped announcement applies.
  const forB = regimeInForceFor({
    instrumentId: "inst-b",
    announcements,
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.equal(forB?.kind, "announced");
  assert.equal(forB.kind === "announced" && forB.announcement.to, "trend");
});

test("regimeInForceFor falls back to the declared schedule, labeled scheduled", () => {
  const scheduled = regimeInForceFor({
    instrumentId: "inst-a",
    announcements: [],
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.deepEqual(scheduled, { kind: "scheduled", entry: SCHEDULE[1] });
  // No announcements, no clock position, no schedule: the honest absence.
  assert.equal(
    regimeInForceFor({ instrumentId: "inst-a", announcements: [], schedule: [], simulationTime: 5 }),
    undefined,
  );
  assert.equal(
    regimeInForceFor({ instrumentId: "inst-a", announcements: [], schedule: SCHEDULE }),
    undefined,
    "no clock position ⇒ no scheduled lookup",
  );
  assert.equal(
    regimeInForceFor({
      instrumentId: "inst-a",
      announcements: [],
      schedule: [
        { regime: "a", from: 0, to: 3_500 },
        { regime: "b", from: 4_000 },
      ],
      simulationTime: 3_700,
    }),
    undefined,
    "inside a gap ⇒ no fabricated regime",
  );
});

test("worldRegimeInForce uses only world-scoped announcements", () => {
  const announcements = parseRegimeAnnouncements([
    event(REGIME_CHANGED_EVENT_TYPE, 1, 1_000, { type: "market.regime.changed", to: "trend" }),
    event(REGIME_CHANGED_EVENT_TYPE, 2, 2_400, {
      type: "market.regime.changed",
      to: "shock",
      instrumentId: "inst-a",
    }),
  ]);
  const world = worldRegimeInForce({
    announcements,
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.equal(world?.kind, "announced");
  assert.equal(world.kind === "announced" && world.announcement.to, "trend");
  // Without the world-scoped announcement the instrument-scoped one must NOT
  // leak into the world chip — the schedule is the fallback.
  const onlyScoped = announcements.slice(1);
  const worldScheduled = worldRegimeInForce({
    announcements: onlyScoped,
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.deepEqual(worldScheduled, { kind: "scheduled", entry: SCHEDULE[1] });
});

test("buildWatchlistRows orders configured-then-discovered, dedups, passes values verbatim", () => {
  const rows = buildWatchlistRows({
    configuredIds: ids(["inst-es", "inst-bogus", "inst-es"]),
    discoveredIds: ids(["inst-nq", "inst-es", "inst-ym"]),
    fetches: [
      {
        instrumentId: "inst-es" as MarketInstrumentId,
        instrument: {
          instrumentId: "inst-es",
          symbol: "ES-TEST",
          venueId: "venue-sim",
          tradingState: "open",
          tradable: true,
          tickSize: "0.25",
          pricePrecision: 2,
        },
        quote: {
          instrumentId: "inst-es",
          bid: "4799.75",
          bidSize: "14",
          ask: "4800.25",
          askSize: "13",
          last: "4799.75",
          asOf: 1_700_000_010_000,
        },
      },
      {
        instrumentId: "inst-bogus" as MarketInstrumentId,
        quoteError: "UnknownWorldEntityError: unknown instrument: inst-bogus",
        instrumentError: "UnknownWorldEntityError: unknown instrument: inst-bogus",
      },
      {
        instrumentId: "inst-nq" as MarketInstrumentId,
        quote: { instrumentId: "inst-nq", asOf: 1_700_000_010_000 },
      },
    ],
    announcements: [],
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.deepEqual(
    rows.map((row) => [row.instrumentId, row.source]),
    [
      ["inst-es", "configured"],
      ["inst-bogus", "configured"],
      ["inst-nq", "discovered"],
      ["inst-ym", "discovered"],
    ],
    "configured order first, discovered in first-observed order, deduped",
  );
  const es = rows[0]!;
  assert.equal(es.instrument?.symbol, "ES-TEST");
  assert.equal(es.quote?.bid, "4799.75", "canonical text passes through verbatim");
  assert.equal(es.quote?.bidSize, "14");
  // Regime context rides along (scheduled at 2_500).
  assert.deepEqual(es.regime, { kind: "scheduled", entry: SCHEDULE[1] });
  // The bogus configured instrument surfaces its typed errors per row.
  const bogus = rows[1]!;
  assert.equal(bogus.quote, undefined);
  assert.equal(bogus.instrument, undefined);
  assert.match(bogus.quoteError ?? "", /UnknownWorldEntityError/);
  assert.match(bogus.instrumentError ?? "", /unknown instrument/);
  // The discovered instrument with an origin-time quote: absent fields stay
  // absent — never a zero-invented price.
  const nq = rows[2]!;
  assert.deepEqual(nq.quote, { instrumentId: "inst-nq", asOf: 1_700_000_010_000 });
  // A discovered id with NO fetch entry still renders its (empty) row.
  const ym = rows[3]!;
  assert.equal(ym.instrument, undefined);
  assert.equal(ym.quote, undefined);
});

test("buildWatchlistRows applies announcements per instrument", () => {
  const announcements = parseRegimeAnnouncements([
    event(REGIME_CHANGED_EVENT_TYPE, 1, 1_000, { type: "market.regime.changed", to: "trend" }),
    event(REGIME_CHANGED_EVENT_TYPE, 2, 2_400, {
      type: "market.regime.changed",
      to: "shock",
      instrumentId: "inst-a",
    }),
  ]);
  const rows = buildWatchlistRows({
    configuredIds: ids(["inst-a"]),
    discoveredIds: ids(["inst-b"]),
    fetches: [],
    announcements,
    schedule: SCHEDULE,
    simulationTime: 2_500,
  });
  assert.equal(rows[0]!.regime?.kind, "announced");
  assert.equal(rows[0]!.regime!.kind === "announced" && rows[0]!.regime!.announcement.to, "shock");
  assert.equal(rows[1]!.regime?.kind, "announced");
  assert.equal(rows[1]!.regime!.kind === "announced" && rows[1]!.regime!.announcement.to, "trend");
});

test("describeSimulationClock labels world time and status textually", () => {
  assert.deepEqual(
    describeSimulationClock({
      simulationTime: 1_700_000_010_000,
      status: "paused",
      speed: 1,
      followingRealtime: false,
    }),
    { label: "2023-11-14 22:13:30 UTC · paused", status: "paused" },
  );
  assert.deepEqual(
    describeSimulationClock({
      simulationTime: 1_700_000_010_000,
      status: "playing",
      speed: 10,
      followingRealtime: false,
    }),
    { label: "2023-11-14 22:13:30 UTC · playing 10×", status: "playing 10×" },
  );
  const following = describeSimulationClock({
    simulationTime: 1,
    status: "playing",
    speed: 1,
    followingRealtime: true,
  });
  assert.match(following.label, /following realtime$/);
});

test("formatSimulationTimestampMs is deterministic UTC and refuses invalid instants", () => {
  assert.equal(formatSimulationTimestampMs(1_700_000_000_000), "2023-11-14 22:13:20 UTC");
  assert.throws(() => formatSimulationTimestampMs(Number.NaN), MarketProjectionDataError);
});
