/**
 * The coalescable projection surface table (W030 `performance` module).
 *
 * Spec: spec/WORLD-PROTOCOL.md "UI projection law" — "Projections may batch,
 * conflate, virtualize and drop stale display frames. They may never
 * fabricate financial facts." This table is the honest inventory of WHICH
 * QueryPort surfaces exist for coalescing, HOW each is keyed, and — the
 * load-bearing part — WHICH journal events change each surface's content. The
 * mapping is conservative where the engine's own semantics make an event
 * possibly-content-changing, precise where the closed event taxonomies let
 * us be, and FAIL-SAFE for unknown event types (see below).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — coalescing NEVER fabricates: the
 * coalesced view IS the latest projection (a fresh port read at the
 * observation point), never a blend of intermediate states.
 *
 * The event→surface mapping covers the CLOSED producer taxonomies of the
 * alpha engine (world core, matching engine, market generator). Unknown
 * event types dirty EVERY configured surface — a future producer's events
 * must never leave a surface stale (fail-safe; disclosed in the README).
 */

import type { WorldEventEnvelope } from "tradrl-world-contracts";

/**
 * The coalescable QueryPort projection surfaces. The eight tool-surface data
 * sources plus the journal timeline (every event extends it).
 */
export const COALESCED_SURFACE_NAMES = [
  "quote",
  "orderbook",
  "trades",
  "orders",
  "positions",
  "portfolio",
  "risk",
  "news",
  "timeline",
] as const;

export type CoalescedSurfaceName = (typeof COALESCED_SURFACE_NAMES)[number];

/** How one surface's coalescing keys are derived. */
export type SurfaceKeyKind = "instrument" | "account" | "world";

/** A surface's key (`undefined` for world-keyed surfaces). */
export type CoalescedSurfaceKey = string | undefined;

export interface CoalescedSurfaceSpec {
  readonly name: CoalescedSurfaceName;
  readonly keyKind: SurfaceKeyKind;
}

function surfaceKeyKindOf(name: CoalescedSurfaceName): SurfaceKeyKind {
  switch (name) {
    case "quote":
    case "orderbook":
    case "trades":
      return "instrument";
    case "orders":
    case "positions":
    case "portfolio":
    case "risk":
      return "account";
    case "news":
    case "timeline":
      return "world";
  }
}

/**
 * The surface table in canonical drain order (the order `drain()` emits
 * entries in; a fixed order is part of the determinism contract).
 */
export const COALESCED_SURFACES: readonly CoalescedSurfaceSpec[] =
  COALESCED_SURFACE_NAMES.map((name) => ({
    name,
    keyKind: surfaceKeyKindOf(name),
  }));

const SURFACE_BY_NAME: ReadonlyMap<CoalescedSurfaceName, CoalescedSurfaceSpec> = new Map(
  COALESCED_SURFACES.map((spec) => [spec.name, spec]),
);

export function coalescedSurfaceSpec(
  name: CoalescedSurfaceName,
): CoalescedSurfaceSpec | undefined {
  return SURFACE_BY_NAME.get(name);
}

/** One (surface, key) pair an event touches. */
export interface SurfaceKeyTouch {
  readonly surface: CoalescedSurfaceName;
  readonly key: CoalescedSurfaceKey;
}

/** The journal's own projection: every journaled event extends the timeline. */
const TIMELINE_TOUCH: SurfaceKeyTouch = { surface: "timeline", key: undefined };

/** Instrument-scoped market + order touch: quote and order book content. */
function instrumentMarketTouches(instrumentId: string): SurfaceKeyTouch[] {
  return [
    { surface: "quote", key: instrumentId },
    { surface: "orderbook", key: instrumentId },
  ];
}

/**
 * Order-lifecycle touch: the account's order registry, plus book/quote when
 * resting liquidity changed (accepts, triggers, cancels and replaces all move
 * book quantity; fills are covered by their batch's trade print + deltas).
 */
function orderLifecycleTouches(
  instrumentId: string,
  accountId: string,
  bookAlso: boolean,
): SurfaceKeyTouch[] {
  const touches: SurfaceKeyTouch[] = [{ surface: "orders", key: accountId }];
  if (bookAlso) {
    touches.push(
      { surface: "quote", key: instrumentId },
      { surface: "orderbook", key: instrumentId },
    );
  }
  return touches;
}

/** The financial surfaces one fill moves (positions, portfolio, risk). */
function accountFinancialTouches(accountId: string): SurfaceKeyTouch[] {
  return [
    { surface: "positions", key: accountId },
    { surface: "portfolio", key: accountId },
    { surface: "risk", key: accountId },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function payloadOf(event: WorldEventEnvelope): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

/**
 * Which (surface, key) pairs does one journal event touch?
 *
 * `seenInstrumentKeys` is the set of instrument keys the caller has observed
 * so far (venue-scoped halts apply to every instrument of the venue — the
 * coalescer cannot see world definitions, so every seen instrument key is
 * dirtied; disclosed limitation).
 */
export function surfacesTouchedByEvent(
  event: WorldEventEnvelope,
  seenInstrumentKeys: readonly string[],
): readonly SurfaceKeyTouch[] {
  // EVERY journaled event extends the timeline (the journal's own
  // projection); the content surfaces it also touches depend on the type.
  return [...contentTouchesOfEvent(event, seenInstrumentKeys), TIMELINE_TOUCH];
}

/** The content-surface touches of one event (timeline excluded). */
function contentTouchesOfEvent(
  event: WorldEventEnvelope,
  seenInstrumentKeys: readonly string[],
): readonly SurfaceKeyTouch[] {
  const payload = payloadOf(event);
  const instrumentId =
    typeof payload.instrumentId === "string" ? payload.instrumentId : undefined;
  const accountId = typeof payload.accountId === "string" ? payload.accountId : undefined;

  switch (event.eventType) {
    case "market.book.delta":
    case "market.quote.updated":
      return instrumentId === undefined ? [] : instrumentMarketTouches(instrumentId);
    case "market.trade.printed":
      // The print extends the tape and re-marks the quote's `last`.
      return instrumentId === undefined
        ? []
        : [{ surface: "trades", key: instrumentId }, { surface: "quote", key: instrumentId }];
    case "market.halted":
    case "market.reopened": {
      const scope = payload.scope;
      if (!isRecord(scope)) {
        return [];
      }
      if (scope.kind === "instrument" && typeof scope.instrumentId === "string") {
        return instrumentMarketTouches(scope.instrumentId);
      }
      // Venue-scoped: every seen instrument key (conservative, honest).
      return seenInstrumentKeys.flatMap((key) => instrumentMarketTouches(key));
    }
    case "matching.order.accepted":
    case "matching.order.triggered":
    case "matching.order.canceled":
    case "matching.order.replaced":
      return instrumentId === undefined || accountId === undefined
        ? []
        : orderLifecycleTouches(instrumentId, accountId, true);
    case "matching.order.rejected":
      return instrumentId === undefined || accountId === undefined
        ? []
        : orderLifecycleTouches(instrumentId, accountId, false);
    case "matching.order.filled":
      // The fill moves the account's financial state; the order registry row
      // updates (cumulative quantity/status). Book/quote/tape changes arrive
      // via the batch's own trade-print and book-delta events.
      return instrumentId === undefined || accountId === undefined
        ? []
        : [{ surface: "orders", key: accountId }, ...accountFinancialTouches(accountId)];
    default:
      // Unknown event types are handled by the coalescer's fail-safe path
      // (dirty every configured/observed surface). Here: no content mapping.
      return [];
  }
}

/** Does this event type carry an unknown (non-alpha) taxonomy? */
export function isUnknownEventType(eventType: string): boolean {
  return !KNOWN_EVENT_TYPES.has(eventType);
}

/** The union of the alpha engine's closed event taxonomies. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  // world core (world/events.ts)
  "world.annotation.added",
  "world.scenario.set",
  "world.snapshot.created",
  "world.branch.created",
  // matching engine (matching/events.ts — order lifecycle + market facts)
  "matching.order.accepted",
  "matching.order.filled",
  "matching.order.triggered",
  "matching.order.canceled",
  "matching.order.rejected",
  "matching.order.replaced",
  "market.trade.printed",
  "market.book.delta",
  "market.halted",
  "market.reopened",
  // market generator (generator/events.ts)
  "market.regime.changed",
  "market.quote.updated",
]);
