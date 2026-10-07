/**
 * Historical dataset/event import contracts — the W020 `contracts/data`
 * surface (consumed by the `tradrl-data` package; the export path
 * `tradrl-world-contracts/data`).
 *
 * Spec: spec/WORK-ITEMS.md W020 — "Historical dataset/event import" (typed
 * interfaces for importing HISTORICAL market data — bars/trades/quotes —
 * into the world's journal as first-class events: dataset descriptors,
 * event adapters, deterministic loader).
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — `occurredAt` and `availableAt` are
 * distinct concepts; "historical information must not be observable before
 * `availableAt`". A historical record's availability is PART OF THE RECORD:
 * it is carried verbatim into the event envelope, never invented, never
 * defaulted, never derived from wall time.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism; the import transform is
 * a pure function of (descriptor, records, symbol map, world id).
 * Spec: spec/SIMULATION.md "Fidelity declarations" — every dataset declares
 * its source, covered range, granularity, known gaps, known limitations and
 * a determinism declaration; declarations are honest and never claim beyond
 * the data.
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" — imported events ride the
 * canonical W004 `WorldEventEnvelope`; this module defines the payload
 * taxonomy for the historical-import producer and EXTENDS the W004
 * market-event stream by reference (it does not duplicate it).
 *
 * Boundary law (producer identities): quotes and trades reuse the W004
 * canonical market-event types (`market.quote.updated`,
 * `market.trade.printed`) so downstream projections can consume historical
 * streams through the same taxonomy; bars have no W004 type, so W020 owns
 * `market.bar.closed` here as a deliberate, reviewed contract extension.
 * The PRODUCER of every imported event is the historical-import producer —
 * engines verify producers per their own laws (the `tradrl-world-sim`
 * matching/generator reducers fail closed on foreign producers by design;
 * engine-side replay of imported events is the W021 adapter surface).
 */

import type { InstrumentId, ProducerId } from "./ids.js";
import type { Price, Quantity, TimestampMs } from "./primitives.js";
import type { OrderSide } from "./orders.js";
import type { DeterminismDeclaration } from "./world.js";
import type { QuoteUpdatePayload, TradePrintPayload } from "../time/src/marketEvents.js";

// --- dataset identity and fidelity declarations --------------------------------

/** Opaque dataset identity (DOMAIN-MODEL.md "Identity laws": ids are opaque). */
export type DatasetId = string & { readonly __brand: "DatasetId" };

/**
 * Where the dataset came from. This is a DECLARATION (SIMULATION.md
 * "Fidelity declarations": "input data source"), not a fetcher — W020 does
 * no network IO; acquisition (W026 crypto providers, W021 Nautilus
 * catalogs) is declared here honestly.
 */
export interface DatasetSource {
  /** Who produced/published the dataset (e.g. "fixture", "nautilus-catalog"). */
  readonly provider: string;
  /** Dataset name inside the provider's namespace. */
  readonly name: string;
  /** Declared interchange form (e.g. "ohlcv-bars", "trades-csv", "l2-quotes"). */
  readonly format: string;
  /** Honest acquisition provenance note (how the bytes were obtained). */
  readonly obtained?: string;
}

/**
 * The time range the dataset CLAIMS to cover. Records must fall inside it
 * (validated loudly); `from`/`to` are optional for open-ended declarations.
 * A claim beyond what the data backs must be covered by `knownGaps` or not
 * be made.
 */
export interface DatasetRange {
  readonly from?: TimestampMs;
  readonly to?: TimestampMs;
}

/**
 * A known absence of data inside the declared range (e.g. exchange
 * maintenance). Half-open `[from, to)`. Honest datasets declare their gaps;
 * a record falling inside a declared gap contradicts the declaration and is
 * rejected.
 */
export interface DatasetGap {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
  readonly reason?: string;
}

/** The record kinds a dataset contains. */
export type HistoricalRecordKind = "bar" | "trade" | "quote";

/**
 * The dataset descriptor — the fidelity declaration of one historical
 * dataset (SIMULATION.md "Fidelity declarations"). Everything here is
 * declaration, never derived state; the loader validates records against it.
 */
export interface DatasetDescriptor {
  readonly datasetId: DatasetId;
  readonly source: DatasetSource;
  readonly range: DatasetRange;
  /** Kinds the dataset claims to contain (records of other kinds are rejected). */
  readonly recordKinds: readonly HistoricalRecordKind[];
  /** Declared granularity/scale, e.g. "1m" (honest scale statement). */
  readonly granularity: string;
  /** Known absences inside `range` (half-open intervals). */
  readonly knownGaps: readonly DatasetGap[];
  /** Known limitations — the honest disclosure channel, never claiming beyond the data. */
  readonly limitations: readonly string[];
  /** Determinism declaration (A9: nondeterministic sources are declared). */
  readonly determinism: DeterminismDeclaration;
}

// --- historical records (typed inputs; availability is part of the record) ------

/**
 * One OHLCV bar. A bar is an INTERVAL fact: it is complete exactly at
 * `closeTime`, which is therefore the event's domain timestamp basis
 * (`occurredAt`) — an open-time basis would leak the bar's close/high/low
 * before the interval ends (an A7 violation by construction). `availableAt`,
 * when the source declares delayed availability, must not precede
 * `closeTime`.
 */
export interface HistoricalBarRecord {
  readonly kind: "bar";
  /** Source symbol (mapped to an `InstrumentId` at import; never invented). */
  readonly symbol: string;
  readonly openTime: TimestampMs;
  readonly closeTime: TimestampMs;
  readonly open: Price;
  readonly high: Price;
  readonly low: Price;
  readonly close: Price;
  readonly volume: Quantity;
  /** Earliest legal observation time, when the source declares one (A7). */
  readonly availableAt?: TimestampMs;
}

/**
 * One public trade print. `aggressorSide` is optional in the RECORD (many
 * historical feeds do not carry it) but REQUIRED by the W004
 * `TradePrintPayload` — a trade without it cannot be mapped to the canonical
 * trade event and is rejected loudly at import (never fabricated).
 */
export interface HistoricalTradeRecord {
  readonly kind: "trade";
  readonly symbol: string;
  readonly timestamp: TimestampMs;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly aggressorSide?: OrderSide;
  /** Source trade id, when the feed carries one (must be unique in the import). */
  readonly tradeId?: string;
  readonly availableAt?: TimestampMs;
}

/**
 * One top-of-book quote observation. Sides are optional (one-sided books
 * are honest); `last` is carried when the feed's quote tick includes it.
 */
export interface HistoricalQuoteRecord {
  readonly kind: "quote";
  readonly symbol: string;
  readonly timestamp: TimestampMs;
  readonly bid?: Price;
  readonly bidSize?: Quantity;
  readonly ask?: Price;
  readonly askSize?: Quantity;
  readonly last?: Price;
  readonly availableAt?: TimestampMs;
}

/** Discriminated union of importable historical records. */
export type HistoricalRecord =
  | HistoricalBarRecord
  | HistoricalTradeRecord
  | HistoricalQuoteRecord;

// --- the imported-event taxonomy (W020 extension of the W004 market stream) -----

/**
 * Closed set of journal event types the historical-import producer emits.
 * Quotes and trades are the W004 canonical market-event types (payloads are
 * W004's, imported by reference); `market.bar.closed` is the W020-owned bar
 * extension below. Additions go through a contract change.
 */
export const HISTORICAL_IMPORT_EVENT_TYPES = [
  "market.quote.updated",
  "market.trade.printed",
  "market.bar.closed",
] as const;

export type HistoricalImportEventType = (typeof HISTORICAL_IMPORT_EVENT_TYPES)[number];

/** The producer identity for imported historical events (provenance law). */
export const HISTORICAL_IMPORT_PRODUCER = "historical-data-import" as ProducerId;

/** Schema version stamped on every imported historical event. */
export const HISTORICAL_IMPORT_SCHEMA_VERSION = "tradrl-data.import@1";

/**
 * Payload of `market.bar.closed` — the completed OHLCV bar as an interval
 * fact. Timing lives in the ENVELOPE (`occurredAt` = `closeTime`); the
 * payload carries the interval verbatim plus the market facts.
 */
export interface HistoricalBarClosedPayload {
  readonly type: "market.bar.closed";
  readonly instrumentId: InstrumentId;
  /** The bar's half-open interval `[start, end)` on the simulation axis. */
  readonly interval: { readonly start: TimestampMs; readonly end: TimestampMs };
  readonly open: Price;
  readonly high: Price;
  readonly low: Price;
  readonly close: Price;
  readonly volume: Quantity;
}

/**
 * Discriminated union of historical-import payloads: the W004 quote/trade
 * payloads by reference plus the W020 bar payload.
 */
export type HistoricalImportPayload =
  | QuoteUpdatePayload
  | TradePrintPayload
  | HistoricalBarClosedPayload;
