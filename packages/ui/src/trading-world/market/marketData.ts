/**
 * World-driven watchlist data transforms — W008.
 *
 * Deterministic projection of world-client projections into the watchlist's
 * quote rows. PURE functions — the React surface
 * (`./WatchlistToolSurface.tsx`) and the framework-free live projection
 * (`./watchlistProjection.ts`) only call them; nothing here touches React,
 * the DOM or any engine.
 *
 * Laws (ARCHITECTURE-LOCK A6 + WORLD-PROTOCOL "UI projection law"):
 * - NEVER INVENT FACTS: every symbol, bid/ask/last price, size and regime
 *   label is a real world projection (getInstrument / getQuote / the
 *   journaled market events / the world's declared regime schedule). Absent
 *   quote fields stay absent — an empty book at the world origin is shown as
 *   an empty row, never a zero or a carried-forward price.
 * - CANONICAL TEXT IS TRUTH: prices/sizes are the canonical decimal text of
 *   the projections, displayed as-is (no re-formatting, no derived spread
 *   math, no float conversion).
 * - DETERMINISM: same projections in, same rows out. Row order is configured
 *   ids first (configured order), then discovered ids in first-observed
 *   journal order.
 * - REGIME CONTEXT (work order W008): the regime in force for an instrument
 *   comes from the ANNOUNCED `market.regime.changed` events (journal truth)
 *   when one applies, else from the declared regime schedule
 *   (getWorldMeta — world metadata, SIMULATION.md "Synthetic regimes")
 *   evaluated at the clock's simulation time, labeled `scheduled` because
 *   the journal has not announced it yet. Never fabricated.
 */

/**
 * Structural mirror of the W003 `InstrumentId` opaque brand
 * (`string & { readonly __brand: "InstrumentId" }` — packages/tradrl-world-
 * contracts/src/ids.ts). The watchlist treats instrument identity as an
 * opaque query key; the mirror keeps the port call sites type-checked
 * against the real branded signature (a contracts brand change breaks this
 * file at compile time) without packages/ui importing the contracts package
 * (W006 `.d.ts` shim rationale — same as W007's `ChartInstrumentId`).
 */
export type MarketInstrumentId = string & { readonly __brand: "InstrumentId" };

/** Typed error for projection input that violates the canonical contracts. */
export class MarketProjectionDataError extends Error {
  constructor(detail: string) {
    super(`[trading-world/market] refusing to project malformed market data: ${detail}`);
    this.name = "MarketProjectionDataError";
  }
}

/**
 * Minimal structural slice of the W003 `Instrument` contract the watchlist
 * projects (structural, not imported — same rationale as W007's chart
 * slices; contracts drift breaks the call site at compile time).
 */
export interface MarketInstrumentProjection {
  readonly instrumentId: string;
  /** Display attribute only — never the identity (DOMAIN-MODEL). */
  readonly symbol: string;
  readonly venueId: string;
  readonly tradingState: string;
  readonly tradable: boolean;
  readonly tickSize: string;
  readonly pricePrecision: number;
}

/** Minimal structural slice of the W003 `Quote` contract. */
export interface MarketQuoteProjection {
  readonly instrumentId: string;
  readonly bid?: string;
  readonly bidSize?: string;
  readonly ask?: string;
  readonly askSize?: string;
  readonly last?: string;
  readonly asOf: number;
}

/**
 * Minimal structural slice of the W003 `WorldEventEnvelope` the watchlist
 * reads (the timeline read is filtered server-side to the event types
 * below; every field used here is part of the envelope contract).
 */
export interface MarketTimelineEvent {
  readonly eventType: string;
  readonly occurredAt: number;
  readonly sequence: number;
  readonly payload: unknown;
}

/** Structural slice of `WorldMeta["regimeSchedule"]` entries. */
export interface MarketRegimeScheduleEntry {
  readonly regime: string;
  readonly from: number;
  readonly to?: number;
}

/** One announced regime transition (journal truth, W017 origin rule). */
export interface MarketRegimeAnnouncement {
  /** Simulation time the announcement was journaled. */
  readonly at: number;
  readonly to: string;
  readonly from?: string;
  /** Set when the announcement is instrument-scoped; world-scoped when absent. */
  readonly instrumentId?: string;
  readonly parameters?: Readonly<Record<string, number>>;
}

/**
 * The timeline event types the watchlist reads: instrument-bearing market
 * events (discovery) + regime announcements (regime context). One
 * server-side-filtered `query.getTimeline` read serves both.
 */
export const WATCHLIST_TIMELINE_EVENT_TYPES: readonly string[] = [
  "market.quote.updated",
  "market.trade.printed",
  "market.book.delta",
  "market.book.snapshot",
  "market.halted",
  "market.reopened",
  "market.regime.changed",
];

/** The regime-announcement event type (W004 market events). */
export const REGIME_CHANGED_EVENT_TYPE = "market.regime.changed";

function payloadOf(event: MarketTimelineEvent): Record<string, unknown> {
  if (typeof event.payload !== "object" || event.payload === null) {
    throw new MarketProjectionDataError(
      `timeline event ${event.eventType} (seq ${event.sequence}) has no payload object`,
    );
  }
  return event.payload as Record<string, unknown>;
}

/**
 * The instrument ids a timeline read reveals — instruments that have
 * actually quoted/traded/been halted in this world (real journal truth).
 * Order: first-observed journal (sequence) order, de-duplicated.
 */
export function discoverInstrumentIds(
  events: readonly MarketTimelineEvent[],
): readonly MarketInstrumentId[] {
  const seen: string[] = [];
  const add = (id: string): void => {
    if (!seen.includes(id)) {
      seen.push(id);
    }
  };
  for (const event of events) {
    const payload = payloadOf(event);
    if (event.eventType === REGIME_CHANGED_EVENT_TYPE) {
      // RegimeChangePayload.instrumentId is optional (world-scoped when absent).
      if (payload.instrumentId !== undefined) {
        if (typeof payload.instrumentId !== "string") {
          throw new MarketProjectionDataError(
            `regime announcement (seq ${event.sequence}) carries a non-string instrumentId`,
          );
        }
        add(payload.instrumentId);
      }
      continue;
    }
    // Quote/trade/book events carry instrumentId; halt/reopen carry a scope.
    if (payload.instrumentId !== undefined) {
      if (typeof payload.instrumentId !== "string") {
        throw new MarketProjectionDataError(
          `${event.eventType} (seq ${event.sequence}) carries a non-string instrumentId`,
        );
      }
      add(payload.instrumentId);
      continue;
    }
    if (
      typeof payload.scope === "object" &&
      payload.scope !== null &&
      (payload.scope as { kind?: unknown }).kind === "instrument"
    ) {
      const scoped = (payload.scope as { instrumentId?: unknown }).instrumentId;
      if (typeof scoped !== "string") {
        throw new MarketProjectionDataError(
          `${event.eventType} (seq ${event.sequence}) has an instrument scope without an id`,
        );
      }
      add(scoped);
    }
  }
  return seen.map((id) => id as MarketInstrumentId);
}

/**
 * The announced regime transitions of a timeline read, in journal
 * (sequence) order. Only well-formed `market.regime.changed` payloads pass;
 * anything else under that event type is a typed projection error.
 */
export function parseRegimeAnnouncements(
  events: readonly MarketTimelineEvent[],
): readonly MarketRegimeAnnouncement[] {
  const announcements: MarketRegimeAnnouncement[] = [];
  for (const event of events) {
    if (event.eventType !== REGIME_CHANGED_EVENT_TYPE) {
      continue;
    }
    const payload = payloadOf(event);
    if (typeof payload.to !== "string") {
      throw new MarketProjectionDataError(
        `regime announcement (seq ${event.sequence}) has no regime \`to\``,
      );
    }
    if (payload.from !== undefined && typeof payload.from !== "string") {
      throw new MarketProjectionDataError(
        `regime announcement (seq ${event.sequence}) carries a non-string \`from\``,
      );
    }
    if (payload.instrumentId !== undefined && typeof payload.instrumentId !== "string") {
      throw new MarketProjectionDataError(
        `regime announcement (seq ${event.sequence}) carries a non-string instrumentId`,
      );
    }
    announcements.push({
      at: event.occurredAt,
      to: payload.to,
      ...(payload.from === undefined ? {} : { from: payload.from as string }),
      ...(payload.instrumentId === undefined
        ? {}
        : { instrumentId: payload.instrumentId as string }),
      ...(payload.parameters === undefined
        ? {}
        : { parameters: payload.parameters as Readonly<Record<string, number>> }),
    });
  }
  return announcements;
}

/**
 * The scheduled regime entry covering simulation time `at` — the declared
 * schedule (world metadata) evaluated with the generator's own covering
 * semantics (`from <= at && (to === undefined || at < to)`, latest `from`
 * wins, ties → later array position; undefined inside schedule gaps).
 */
export function scheduledRegimeAt(
  schedule: readonly MarketRegimeScheduleEntry[],
  at: number,
): MarketRegimeScheduleEntry | undefined {
  let active: MarketRegimeScheduleEntry | undefined;
  for (const entry of schedule) {
    const covers = entry.from <= at && (entry.to === undefined || at < entry.to);
    if (covers && (active === undefined || entry.from >= active.from)) {
      active = entry;
    }
  }
  return active;
}

/**
 * The next scheduled regime WINDOW START strictly after `at` — the next
 * time a new regime takes force per the declared schedule. Window ends
 * (into gaps) are not regime changes TO something and are honestly omitted.
 */
export function nextScheduledRegimeChange(
  schedule: readonly MarketRegimeScheduleEntry[],
  at: number,
): { readonly at: number; readonly entry: MarketRegimeScheduleEntry } | undefined {
  let next: { readonly at: number; readonly entry: MarketRegimeScheduleEntry } | undefined;
  for (const entry of schedule) {
    if (entry.from > at && (next === undefined || entry.from < next.at)) {
      next = { at: entry.from, entry };
    }
  }
  return next;
}

/** The regime context shown for one instrument (announced > scheduled). */
export type MarketRegimeInForce =
  | { readonly kind: "announced"; readonly announcement: MarketRegimeAnnouncement }
  | { readonly kind: "scheduled"; readonly entry: MarketRegimeScheduleEntry };

/**
 * The regime in force for one instrument: the last announcement that
 * applies to it (instrument-scoped for it, or world-scoped), else the
 * scheduled entry covering the clock position (labeled `scheduled` — the
 * journal has not announced it yet). Undefined when neither exists: no
 * guesswork, no fabricated regime.
 */
export function regimeInForceFor(input: {
  readonly instrumentId: string;
  readonly announcements: readonly MarketRegimeAnnouncement[];
  readonly schedule: readonly MarketRegimeScheduleEntry[];
  readonly simulationTime?: number;
}): MarketRegimeInForce | undefined {
  let announced: MarketRegimeAnnouncement | undefined;
  for (const announcement of input.announcements) {
    const applies =
      announcement.instrumentId === undefined ||
      announcement.instrumentId === input.instrumentId;
    if (applies) {
      announced = announcement; // journal order: the last applicable wins
    }
  }
  if (announced !== undefined) {
    return { kind: "announced", announcement: announced };
  }
  return scheduledRegimeFor(input.schedule, input.simulationTime);
}

/** The world-scoped regime in force (header chip): announced > scheduled. */
export function worldRegimeInForce(input: {
  readonly announcements: readonly MarketRegimeAnnouncement[];
  readonly schedule: readonly MarketRegimeScheduleEntry[];
  readonly simulationTime?: number;
}): MarketRegimeInForce | undefined {
  let announced: MarketRegimeAnnouncement | undefined;
  for (const announcement of input.announcements) {
    if (announcement.instrumentId === undefined) {
      announced = announcement;
    }
  }
  if (announced !== undefined) {
    return { kind: "announced", announcement: announced };
  }
  return scheduledRegimeFor(input.schedule, input.simulationTime);
}

function scheduledRegimeFor(
  schedule: readonly MarketRegimeScheduleEntry[],
  simulationTime: number | undefined,
): MarketRegimeInForce | undefined {
  if (simulationTime === undefined) {
    return undefined;
  }
  const entry = scheduledRegimeAt(schedule, simulationTime);
  return entry === undefined ? undefined : { kind: "scheduled", entry };
}

/** One watchlist quote row (immutable projection). */
export interface WatchlistRow {
  readonly instrumentId: MarketInstrumentId;
  /** Where the id came from: composition config or journal discovery. */
  readonly source: "configured" | "discovered";
  readonly instrument?: MarketInstrumentProjection;
  /** Typed error text when getInstrument rejected (unknown id, transport…). */
  readonly instrumentError?: string;
  readonly quote?: MarketQuoteProjection;
  /** Typed error text when getQuote rejected. */
  readonly quoteError?: string;
  readonly regime?: MarketRegimeInForce;
}

/** Row input: per-instrument projection results (values or typed errors). */
export interface WatchlistRowFetch {
  readonly instrumentId: MarketInstrumentId;
  readonly instrument?: MarketInstrumentProjection;
  readonly instrumentError?: string;
  readonly quote?: MarketQuoteProjection;
  readonly quoteError?: string;
}

/**
 * Build the ordered watchlist rows: configured ids first (configured
 * order), then discovered ids in first-observed journal order; duplicates
 * collapse onto the configured row. Quote/instrument values pass through
 * verbatim (canonical text; absent fields stay absent); per-row failures
 * surface as per-row error text — one bad instrument never blanks the list.
 */
export function buildWatchlistRows(input: {
  readonly configuredIds: readonly MarketInstrumentId[];
  readonly discoveredIds: readonly MarketInstrumentId[];
  readonly fetches: readonly WatchlistRowFetch[];
  readonly announcements: readonly MarketRegimeAnnouncement[];
  readonly schedule: readonly MarketRegimeScheduleEntry[];
  readonly simulationTime?: number;
}): readonly WatchlistRow[] {
  const fetchById = new Map<string, WatchlistRowFetch>(
    input.fetches.map((fetch) => [fetch.instrumentId, fetch]),
  );
  const ordered: { id: MarketInstrumentId; source: "configured" | "discovered" }[] = [];
  const seen = new Set<string>();
  for (const id of input.configuredIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push({ id, source: "configured" });
    }
  }
  for (const id of input.discoveredIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push({ id, source: "discovered" });
    }
  }
  return ordered.map(({ id, source }) => {
    const fetch = fetchById.get(id) ?? { instrumentId: id };
    const regime = regimeInForceFor({
      instrumentId: id,
      announcements: input.announcements,
      schedule: input.schedule,
      ...(input.simulationTime === undefined ? {} : { simulationTime: input.simulationTime }),
    });
    return {
      instrumentId: id,
      source,
      ...(fetch.instrument === undefined ? {} : { instrument: fetch.instrument }),
      ...(fetch.instrumentError === undefined ? {} : { instrumentError: fetch.instrumentError }),
      ...(fetch.quote === undefined ? {} : { quote: fetch.quote }),
      ...(fetch.quoteError === undefined ? {} : { quoteError: fetch.quoteError }),
      ...(regime === undefined ? {} : { regime }),
    };
  });
}

/** Simulation-clock chip (W004: the watchlist's "as of" axis is world time). */
export function describeSimulationClock(clock: {
  readonly simulationTime: number;
  readonly status: string;
  readonly speed: number;
  readonly followingRealtime: boolean;
}): { readonly label: string; readonly status: string } {
  const status =
    clock.status === "playing"
      ? `playing ${Number.isFinite(clock.speed) ? clock.speed : 1}×${
          clock.followingRealtime ? " · following realtime" : ""
        }`
      : "paused";
  return { label: `${formatSimulationTimestampMs(clock.simulationTime)} · ${status}`, status };
}

/** UTC simulation-time label (deterministic, no locale). */
export function formatSimulationTimestampMs(simulationMs: number): string {
  const date = new Date(simulationMs);
  if (Number.isNaN(date.getTime())) {
    throw new MarketProjectionDataError(`timestamp ${simulationMs} is not a valid instant`);
  }
  const pad = (value: number, width = 2): string => String(Math.abs(value)).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}
