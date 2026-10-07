/**
 * Instrument / market identity contract tests.
 *
 * Spec: spec/ARCHITECTURE.md §5 (Instrument + Venue state attributes),
 * spec/DOMAIN-MODEL.md ("Identity laws", "Financial precision").
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetClass,
  Instrument,
  InstrumentTradingState,
  Venue,
} from "../src/instrument.js";
import type { OrderKind } from "../src/orders.js";
import type { InstrumentId, VenueId, WorldId } from "../src/ids.js";
import type { Price, Quantity, CurrencyCode } from "../src/primitives.js";
import { asCurrency, asId, asPrice, asQuantity, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// Runtime mirrors of the closed unions. The Equal assertions below keep these
// lists in lockstep with the contract types.
const ALL_ORDER_KINDS = ["market", "limit", "stop", "stop-limit"] as const;
const ALL_TRADING_STATES = ["pre-open", "open", "halted", "auction", "closed"] as const;
const ALL_ASSET_CLASSES = [
  "equity",
  "crypto",
  "future",
  "option",
  "forex",
  "commodity",
] as const;

// --- type-level assertions -------------------------------------------------

type _orderKindExact = Expect<Equal<OrderKind, (typeof ALL_ORDER_KINDS)[number]>>;
type _tradingStateExact = Expect<
  Equal<InstrumentTradingState, (typeof ALL_TRADING_STATES)[number]>
>;
type _assetClassExact = Expect<Equal<AssetClass, (typeof ALL_ASSET_CLASSES)[number]>>;

// ARCHITECTURE.md §5: instrument carries tick size, lot size, precision,
// quote currency and trading state as REQUIRED attributes; financial
// precision is explicit (Price/Quantity are decimal strings, never floats).
type _tickIsPrice = Expect<Equal<Instrument["tickSize"], Price>>;
type _lotIsQuantity = Expect<Equal<Instrument["lotSize"], Quantity>>;
type _quoteIsCurrency = Expect<Equal<Instrument["quoteCurrency"], CurrencyCode>>;
type _precisionKeysRequired = Expect<
  Equal<
    "tickSize" | "lotSize" | "quoteCurrency" | "tradingState" extends RequiredKeys<Instrument>
      ? true
      : false,
    true
  >
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const instrumentId = asId<InstrumentId>("instr-SIM-INDEX");
const venueId = asId<VenueId>("venue-SIM");

const instrument: Instrument = {
  instrumentId,
  worldId,
  venueId,
  symbol: "SIM.INDEX",
  assetClass: "future",
  quoteCurrency: asCurrency("USD"),
  tickSize: asPrice("0.25"),
  lotSize: asQuantity("1"),
  pricePrecision: 2,
  quantityPrecision: 0,
  tradingState: "open",
  tradable: true,
};

const venue: Venue = {
  venueId,
  worldId,
  name: "Simulated Exchange",
  matchingModel: "price-time-priority",
  allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
  feeSchedule: { makerRateBps: 1, takerRateBps: 2 },
  latency: { acknowledgementMs: 5, fillPropagationMs: 10 },
  calendar: {
    sessions: [
      { opensAt: asTimestamp(0), closesAt: asTimestamp(3_600_000) },
    ],
  },
  haltPolicy: { haltOnShock: true, reopenAfterMs: 60_000 },
};

// --- runtime invariants ------------------------------------------------------

test("instrument identity is opaque and distinct from its symbol", () => {
  assert.equal(instrument.instrumentId, instrumentId);
  assert.notEqual(instrument.instrumentId as string, instrument.symbol);
  assert.match(instrument.tickSize as string, /^\d+(\.\d+)?$/);
});

test("instrument carries explicit decimal precision policy", () => {
  assert.equal(typeof (instrument.tickSize as string), "string");
  assert.equal(typeof (instrument.lotSize as string), "string");
  assert.ok(instrument.pricePrecision >= 0);
  assert.ok(instrument.quantityPrecision >= 0);
  assert.equal(instrument.quoteCurrency as string, "USD");
});

test("venue advertises a subset of the canonical order kinds", () => {
  assert.ok(venue.allowedOrderKinds.length > 0);
  for (const kind of venue.allowedOrderKinds) {
    assert.ok(
      (ALL_ORDER_KINDS as readonly string[]).includes(kind),
      `venue advertises unknown order kind ${kind}`,
    );
  }
});

test("venue carries explicit fee, latency, calendar and halt policy", () => {
  assert.ok(venue.feeSchedule.makerRateBps >= 0);
  assert.ok(venue.feeSchedule.takerRateBps >= 0);
  assert.ok(venue.latency.acknowledgementMs >= 0);
  assert.ok(venue.latency.fillPropagationMs >= 0);
  assert.equal(venue.matchingModel, "price-time-priority");
  assert.ok(venue.calendar.sessions.length > 0);
  assert.equal(venue.haltPolicy.haltOnShock, true);
});

test("trading state is one of the closed set", () => {
  assert.ok(
    (ALL_TRADING_STATES as readonly string[]).includes(instrument.tradingState),
  );
});
