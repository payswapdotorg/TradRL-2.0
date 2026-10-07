/**
 * The pure regime-schedule model of the synthetic market generator (W017) —
 * the seeded regime state machine of spec/SIMULATION.md "Synthetic regimes":
 * trend, mean reversion, high volatility, low liquidity, shock and
 * halt/reopen, with regime schedules as world metadata (the world
 * definition's `regimeSchedule`, or the scenario in force set through the
 * CommandPort).
 *
 * EVERYTHING HERE IS A PURE FUNCTION of (schedule, simulation time). There
 * is no hidden generator cursor: the active regime, the announcement
 * boundaries, the halt/reopen schedule and the action grid for a clock
 * interval (A, B] are recomputed from the schedule alone, which is what
 * makes stepping and seeking produce identical events (A9) — the engine
 * wrapper (generator/engine.ts) only walks the merged timeline in order.
 *
 * SCHEDULE SEMANTICS (deliberate, part of the contract):
 * - A window COVERS T when `from <= T` and (`to` is absent or `T < to`).
 * - The ACTIVE entry at T is the covering entry with the LATEST `from`
 *   (equal `from` → the later array position wins): later entries override
 *   earlier ones, the way a scenario is authored.
 * - `market.regime.changed` fires at every boundary (a `from` or a `to`)
 *   inside the clock interval where the active entry CHANGES; the payload
 *   carries the new entry's regime and parameters. When a window ends into
 *   a schedule GAP there is no active entry — the W004 payload cannot
 *   express "no regime", so no announcement fires and the generator takes
 *   no participant actions until the next window opens (documented; the
 *   last announcement remains the journal's regime truth).
 * - ORIGIN RULE: on the clock interval whose left edge IS the world origin
 *   (`worldStart`, passed only by the generator engine), the regime in force
 *   AT the origin is announced too (with no `from` — nothing precedes the
 *   world). The journal's regime truth is then complete from the first
 *   tick: the initial regime is not a silent definition-carried fact. The
 *   rule is stateless (a pure function of schedule + interval + origin), so
 *   stepping and seeking produce the same announcement exactly once.
 * - A `halt-reopen` window halts every instrument `haltAfterMs` (default 0)
 *   after its start and reopens `reopenAfterMs` (default 4000) after the
 *   halt, never later than the window's `to` — the halt ALWAYS reopens, so
 *   a book can never stick halted past its regime window.
 * - A `shock` window on a venue whose `haltPolicy.haltOnShock` is true
 *   additionally halts (reason `volatility`) at the window start and
 *   reopens per the venue's `reopenAfterMs`.
 * - The ACTION GRID is anchored at the FIRST entry's `from` with a
 *   scenario-wide cadence `tickMs` (its `parameters.tickMs`, default
 *   1000ms): participant actions happen at `anchor + k * tickMs` only.
 */

import type {
  Instrument,
  RegimeKind,
  RegimeScheduleEntry,
  ScenarioDefinition,
  TimestampMs,
  Venue,
} from "tradrl-world-contracts";

/** Default action-grid cadence (ms) when the schedule does not declare one. */
export const DEFAULT_GENERATOR_TICK_MS = 1000;

/** Default delay from a halt-reopen window start to the halt itself. */
export const DEFAULT_HALT_AFTER_MS = 0;

/** Default reopen delay after a halt (ms). */
export const DEFAULT_REOPEN_AFTER_MS = 4000;

/** The schedule entries in force (the scenario's, or the definition's). */
export function scheduleEntriesOf(scenario: ScenarioDefinition | undefined): readonly RegimeScheduleEntry[] {
  return scenario?.entries ?? [];
}

/** Does one window cover simulation time T? */
function covers(entry: RegimeScheduleEntry, at: number): boolean {
  return entry.from <= at && (entry.to === undefined || at < entry.to);
}

/**
 * The active schedule entry at T: the covering entry with the latest `from`
 * (ties → later array position). Undefined inside schedule gaps.
 */
export function activeEntryAt(
  entries: readonly RegimeScheduleEntry[],
  at: number,
): RegimeScheduleEntry | undefined {
  let active: RegimeScheduleEntry | undefined;
  for (const entry of entries) {
    if (covers(entry, at) && (active === undefined || entry.from >= active.from)) {
      active = entry;
    }
  }
  return active;
}

/** All distinct boundary times of the schedule (every `from` and `to`). */
export function scheduleBoundaries(entries: readonly RegimeScheduleEntry[]): readonly number[] {
  const times = new Set<number>();
  for (const entry of entries) {
    times.add(entry.from);
    if (entry.to !== undefined) {
      times.add(entry.to);
    }
  }
  return [...times].sort((a, b) => a - b);
}

/** One `market.regime.changed` announcement at a boundary time. */
export interface RegimeAnnouncement {
  readonly at: TimestampMs;
  readonly from?: RegimeKind;
  readonly to: RegimeKind;
  readonly parameters?: Readonly<Record<string, number>>;
}

/**
 * The regime announcements for a clock interval (A, B]: at every boundary in
 * the interval where the active entry changes, announcing the new entry —
 * plus, when `worldStart` is given and equals `intervalFrom` (the world's
 * FIRST clock advance), the regime in force at the origin (the ORIGIN RULE
 * above), announced first. Boundaries that fall into a gap announce nothing
 * (no payload can express "no regime" — see module semantics).
 */
export function regimeAnnouncementsForInterval(
  entries: readonly RegimeScheduleEntry[],
  intervalFrom: number,
  intervalTo: number,
  worldStart?: number,
): readonly RegimeAnnouncement[] {
  const announcements: RegimeAnnouncement[] = [];
  if (worldStart !== undefined && intervalFrom === worldStart) {
    const atOrigin = activeEntryAt(entries, worldStart);
    if (atOrigin !== undefined) {
      announcements.push({
        at: worldStart as TimestampMs,
        to: atOrigin.regime,
        ...(atOrigin.parameters === undefined ? {} : { parameters: atOrigin.parameters }),
      });
    }
  }
  for (const at of scheduleBoundaries(entries)) {
    if (at <= intervalFrom || at > intervalTo) {
      continue;
    }
    const before = activeEntryAt(entries, at - 1);
    const after = activeEntryAt(entries, at);
    if (after === undefined) {
      continue; // window ended into a gap: no announcement possible
    }
    if (before !== undefined && before.regime === after.regime && before.from === after.from) {
      continue; // same entry stays in force across the boundary
    }
    announcements.push({
      at: at as TimestampMs,
      ...(before === undefined ? {} : { from: before.regime }),
      to: after.regime,
      ...(after.parameters === undefined ? {} : { parameters: after.parameters }),
    });
  }
  return announcements;
}

/** A scheduled halt or reopen event at an exact simulation time. */
export interface ScheduledHaltEvent {
  readonly at: TimestampMs;
  readonly kind: "halt" | "reopen";
  readonly reason: "regime" | "volatility";
  readonly instrumentId: Instrument["instrumentId"];
  /** The reopen's reference price is resolved from live state at emission. */
}

function numberParameter(
  entry: RegimeScheduleEntry,
  name: string,
  fallback: number,
): number {
  const value = entry.parameters?.[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

/** The halt time of a halt-reopen window (never before its start). */
export function haltTimeOf(entry: RegimeScheduleEntry): number {
  return entry.from + Math.max(0, Math.trunc(numberParameter(entry, "haltAfterMs", DEFAULT_HALT_AFTER_MS)));
}

/** The reopen time of a halt-reopen window (at least 1ms after the halt). */
export function reopenTimeOf(entry: RegimeScheduleEntry): number {
  const delay = Math.max(1, Math.trunc(numberParameter(entry, "reopenAfterMs", DEFAULT_REOPEN_AFTER_MS)));
  const reopen = haltTimeOf(entry) + delay;
  return entry.to === undefined ? reopen : Math.min(reopen, entry.to);
}

/** Did a halt-reopen window actually take force (was active at its halt)? */
function haltWindowTookForce(entries: readonly RegimeScheduleEntry[], entry: RegimeScheduleEntry): boolean {
  return activeEntryAt(entries, haltTimeOf(entry)) === entry;
}

/**
 * The halt/reopen events of `halt-reopen` windows for a clock interval
 * (A, B], per instrument (the regime is market-wide; every declared
 * instrument halts, in definition order). The reopen always follows the halt
 * so a book never sticks halted past its window.
 */
export function haltReopenEventsForInterval(
  entries: readonly RegimeScheduleEntry[],
  instruments: readonly Instrument[],
  intervalFrom: number,
  intervalTo: number,
): readonly ScheduledHaltEvent[] {
  const events: ScheduledHaltEvent[] = [];
  for (const entry of entries) {
    if (entry.regime !== "halt-reopen") {
      continue;
    }
    const haltAt = haltTimeOf(entry);
    const reopenAt = reopenTimeOf(entry);
    if (!haltWindowTookForce(entries, entry) || haltAt > intervalTo) {
      continue; // superseded before its halt, or the halt is still in the future
    }
    for (const instrument of instruments) {
      if (haltAt > intervalFrom && haltAt <= intervalTo) {
        events.push({
          at: haltAt as TimestampMs,
          kind: "halt",
          reason: "regime",
          instrumentId: instrument.instrumentId,
        });
      }
      if (reopenAt > intervalFrom && reopenAt <= intervalTo) {
        events.push({
          at: reopenAt as TimestampMs,
          kind: "reopen",
          reason: "regime",
          instrumentId: instrument.instrumentId,
        });
      }
    }
  }
  return events;
}

/**
 * The venue-policy shock halts for a clock interval (A, B]: instruments on
 * venues that declare `haltPolicy.haltOnShock` halt (reason `volatility`)
 * when a shock window takes force, reopening per the venue policy. Only
 * worlds that declare the policy get shock halts — the default venue does
 * not (matching/policy.ts documents the synthetic default).
 */
export function shockHaltEventsForInterval(
  entries: readonly RegimeScheduleEntry[],
  instruments: readonly Instrument[],
  venues: readonly Venue[],
  intervalFrom: number,
  intervalTo: number,
): readonly ScheduledHaltEvent[] {
  const events: ScheduledHaltEvent[] = [];
  for (const entry of entries) {
    if (entry.regime !== "shock") {
      continue;
    }
    if (activeEntryAt(entries, entry.from) !== entry || entry.from > intervalTo) {
      continue; // superseded at its start, or still in the future
    }
    for (const instrument of instruments) {
      const venue = venues.find((candidate) => candidate.venueId === instrument.venueId);
      if (venue?.haltPolicy.haltOnShock !== true) {
        continue;
      }
      const haltAt = entry.from;
      const reopenAt = Math.min(
        haltAt + Math.max(1, Math.trunc(venue.haltPolicy.reopenAfterMs ?? DEFAULT_REOPEN_AFTER_MS)),
        entry.to === undefined ? Number.POSITIVE_INFINITY : entry.to,
      );
      if (haltAt > intervalFrom && haltAt <= intervalTo) {
        events.push({
          at: haltAt as TimestampMs,
          kind: "halt",
          reason: "volatility",
          instrumentId: instrument.instrumentId,
        });
      }
      if (Number.isFinite(reopenAt) && reopenAt > intervalFrom && reopenAt <= intervalTo) {
        events.push({
          at: reopenAt as TimestampMs,
          kind: "reopen",
          reason: "volatility",
          instrumentId: instrument.instrumentId,
        });
      }
    }
  }
  return events;
}

/** The scenario-wide action-grid cadence (the FIRST entry's `tickMs`). */
export function scheduleTickMs(entries: readonly RegimeScheduleEntry[]): number {
  const first = entries[0];
  if (first === undefined) {
    return DEFAULT_GENERATOR_TICK_MS;
  }
  return Math.max(1, Math.trunc(numberParameter(first, "tickMs", DEFAULT_GENERATOR_TICK_MS)));
}

/**
 * The participant-action grid times for a clock interval (A, B]: anchored at
 * the FIRST entry's `from`, cadence `tickMs` from the first entry's
 * parameters (default 1000ms). No entries ⇒ no grid.
 */
export function gridTimesForInterval(
  entries: readonly RegimeScheduleEntry[],
  intervalFrom: number,
  intervalTo: number,
): readonly number[] {
  const first = entries[0];
  if (first === undefined) {
    return [];
  }
  const anchor = first.from;
  const tick = scheduleTickMs(entries);
  const times: number[] = [];
  let k = intervalFrom < anchor ? 0 : Math.floor((intervalFrom - anchor) / tick) + 1;
  for (let at = anchor + k * tick; at <= intervalTo; at = anchor + k * tick) {
    times.push(at);
    k += 1;
  }
  return times;
}

/** Is `at` the FIRST grid time inside this window? */
export function isFirstGridTimeInWindow(
  entries: readonly RegimeScheduleEntry[],
  entry: RegimeScheduleEntry,
  at: number,
): boolean {
  const tick = scheduleTickMs(entries);
  return at >= entry.from && (entry.to === undefined || at < entry.to) && at - tick < entry.from;
}

/**
 * When a shock window's opening gap order fires: `gapAfterMs` after the
 * window start (default: two grid turns — the market makers seed the book on
 * the window's first turn(s), the gap hits the seeded book after that). A
 * fixed timeline point, so it fires exactly once, statelessly.
 */
export function shockGapTimeOf(
  entries: readonly RegimeScheduleEntry[],
  entry: RegimeScheduleEntry,
): number {
  const tick = scheduleTickMs(entries);
  return entry.from + Math.max(0, Math.trunc(numberParameter(entry, "gapAfterMs", 2 * tick)));
}

/**
 * Is `at` the grid turn where the shock window's gap order fires: the first
 * grid time at/after {@link shockGapTimeOf}, still inside the window. Fires
 * exactly once (a fixed timeline point on the uniform grid).
 */
export function isShockGapTurn(
  entries: readonly RegimeScheduleEntry[],
  entry: RegimeScheduleEntry,
  at: number,
): boolean {
  const tick = scheduleTickMs(entries);
  const gapAt = shockGapTimeOf(entries, entry);
  return (
    at >= entry.from &&
    (entry.to === undefined || at < entry.to) &&
    at >= gapAt &&
    at - tick < gapAt
  );
}

/**
 * How a regime's market makers derive their reference price (see
 * quotes.ts `referencePriceOf`): mean-reversion pins quotes to the declared
 * `anchorPrice`; every other regime follows the tape (mid blended with the
 * last trade) so directional flow walks the quotes.
 */
export function referenceModeOf(entry: RegimeScheduleEntry): "anchor" | "tape" {
  return entry.regime === "mean-reversion" ? "anchor" : "tape";
}

// --- the regime behavior profiles ---------------------------------------------

/**
 * The participant-behavior profile of one regime (the seeded market's
 * character). Regimes shape PARTICIPANT behavior; the statistical market
 * character (drift, oscillation, thinness, gaps) EMERGES from the real
 * matching of those orders — the generator never fabricates prices.
 *
 * Parameter names (overridable per schedule entry via `parameters`):
 * `mmSpreadTicks`, `mmLevels`, `mmDepth` (lots), `takerRate`, `takerMaxLots`,
 * `takerBias` (P(taker sides with the trend direction)), `direction` (±1),
 * `noiseRate`, `momentumRate`, `gapLots`, `anchorPrice`, `tickMs`,
 * `haltAfterMs`, `reopenAfterMs`.
 */
export interface RegimeProfile {
  /** Half-spread of the innermost market-maker level, in ticks. */
  readonly mmSpreadTicks: number;
  /** Market-maker levels per side. */
  readonly mmLevels: number;
  /** Market-maker quantity per level, in lots. */
  readonly mmDepthLots: number;
  /** Probability a liquidity taker acts on a grid turn. */
  readonly takerRate: number;
  /** Maximum liquidity-taker order size, in lots. */
  readonly takerMaxLots: number;
  /** Probability an acting taker sides WITH the direction (0.5 = fair). */
  readonly takerBias: number;
  /** The trend/shock direction: +1 up, -1 down. */
  readonly direction: 1 | -1;
  /** Probability a noise trader acts on a grid turn. */
  readonly noiseRate: number;
  /** Probability a momentum participant acts (trend regimes). */
  readonly momentumRate: number;
  /** The shock window's opening gap order size, in lots (0 = none). */
  readonly gapLots: number;
  /** Cold-start reference price when the book and tape are empty. */
  readonly anchorPrice?: number;
}

const PROFILE_DEFAULTS: Readonly<Record<RegimeKind, Omit<RegimeProfile, "anchorPrice" | "direction"> & { direction: 1 | -1 }>> = {
  // A directional tape: takers and momentum lean with the drift while
  // market makers follow the mid — the price trends.
  trend: {
    mmSpreadTicks: 2,
    mmLevels: 3,
    mmDepthLots: 5,
    takerRate: 0.5,
    takerMaxLots: 5,
    takerBias: 0.75,
    direction: 1,
    noiseRate: 0.15,
    momentumRate: 0.3,
    gapLots: 0,
  },
  // A mean-reverting tape: tight spreads, deep passive liquidity and
  // symmetric flow — the price oscillates in a range.
  "mean-reversion": {
    mmSpreadTicks: 1,
    mmLevels: 3,
    mmDepthLots: 8,
    takerRate: 0.25,
    takerMaxLots: 3,
    takerBias: 0.5,
    direction: 1,
    noiseRate: 0.15,
    momentumRate: 0,
    gapLots: 0,
  },
  // Wide quotes, hungry takers: large swings both ways.
  "high-volatility": {
    mmSpreadTicks: 4,
    mmLevels: 3,
    mmDepthLots: 4,
    takerRate: 0.6,
    takerMaxLots: 8,
    takerBias: 0.5,
    direction: 1,
    noiseRate: 0.25,
    momentumRate: 0,
    gapLots: 0,
  },
  // A thin market: one shallow level per side, sparse taking.
  "low-liquidity": {
    mmSpreadTicks: 3,
    mmLevels: 1,
    mmDepthLots: 2,
    takerRate: 0.08,
    takerMaxLots: 2,
    takerBias: 0.5,
    direction: 1,
    noiseRate: 0.05,
    momentumRate: 0,
    gapLots: 0,
  },
  // A dislocating event: one large gap order at the window's first turn,
  // then elevated two-way flow.
  shock: {
    mmSpreadTicks: 2,
    mmLevels: 3,
    mmDepthLots: 3,
    takerRate: 0.4,
    takerMaxLots: 4,
    takerBias: 0.5,
    direction: -1,
    noiseRate: 0.15,
    momentumRate: 0,
    gapLots: 25,
  },
  // A trading halt followed by a reopen, then moderate two-way flow.
  "halt-reopen": {
    mmSpreadTicks: 2,
    mmLevels: 2,
    mmDepthLots: 4,
    takerRate: 0.3,
    takerMaxLots: 3,
    takerBias: 0.5,
    direction: 1,
    noiseRate: 0.15,
    momentumRate: 0,
    gapLots: 0,
  },
};

function clampRate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** The behavior profile of one schedule entry (defaults × parameters). */
export function regimeProfileOf(entry: RegimeScheduleEntry): RegimeProfile {
  const defaults = PROFILE_DEFAULTS[entry.regime];
  const parameters = entry.parameters ?? {};
  const directionParam =
    typeof parameters.direction === "number" && Number.isFinite(parameters.direction)
      ? (parameters.direction < 0 ? -1 : 1)
      : undefined;
  const anchor =
    typeof parameters.anchorPrice === "number" &&
    Number.isFinite(parameters.anchorPrice) &&
    parameters.anchorPrice > 0
      ? parameters.anchorPrice
      : undefined;
  return {
    mmSpreadTicks: positiveInt(parameters.mmSpreadTicks ?? defaults.mmSpreadTicks, defaults.mmSpreadTicks),
    mmLevels: positiveInt(parameters.mmLevels ?? defaults.mmLevels, defaults.mmLevels),
    mmDepthLots: positiveInt(parameters.mmDepth ?? defaults.mmDepthLots, defaults.mmDepthLots),
    takerRate: clampRate(parameters.takerRate ?? defaults.takerRate),
    takerMaxLots: positiveInt(parameters.takerMaxLots ?? defaults.takerMaxLots, defaults.takerMaxLots),
    takerBias: clampRate(parameters.takerBias ?? defaults.takerBias),
    direction: directionParam ?? defaults.direction,
    noiseRate: clampRate(parameters.noiseRate ?? defaults.noiseRate),
    momentumRate: clampRate(parameters.momentumRate ?? defaults.momentumRate),
    gapLots: Math.max(0, Math.floor(parameters.gapLots ?? defaults.gapLots)),
    ...(anchor === undefined ? {} : { anchorPrice: anchor }),
  };
}
