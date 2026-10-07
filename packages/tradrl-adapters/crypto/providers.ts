/**
 * Crypto provider/feed descriptors (W026 `tradrl-adapters-crypto`).
 *
 * Spec: spec/WORK-ITEMS.md W026 — "provider descriptors (exchange, symbol
 * mapping, polling/fidelity declarations)". A provider descriptor is a
 * DECLARATION, never a fetcher: this baseline performs NO network IO — the
 * live fetch layer is a later work order, and the polling declaration says
 * so honestly (`liveFetch: "not-implemented"` is enforced by
 * `validateCryptoProvider`).
 *
 * Each feed models ONE documented public REST endpoint: what record kind it
 * maps onto, its timestamp convention, its documented record order, where
 * the symbol lives (in the record, or only in the request — klines and
 * candle rows carry no symbol), and its honest notes (declared conversions,
 * known gaps). Feed mappers live in `./binance.ts` and `./coinbase.ts`;
 * `./mapping.ts` binds them.
 */

import type { HistoricalRecord, HistoricalRecordKind } from "tradrl-world-contracts/data";
import type { CryptoMappingViolation } from "./errors.js";
import type { CryptoSymbolTable } from "./symbols.js";
import type { TimestampUnit } from "./timestamps.js";

/** The documented ordering of records in one feed response. */
export type FeedRecordOrder =
  | "ascending" // oldest first (event-time ascending)
  | "descending" // newest first (the batch mapper deterministically reverses)
  | "single"; // the endpoint returns ONE record object, not an array

/** What a feed maps onto; "unmappable" is an honest declaration, not a stub. */
export type FeedOutputKind = HistoricalRecordKind | "unmappable";

/** Where the exchange puts the traded symbol. */
export type SymbolLocation = "record" | "request";

/** One documented public REST endpoint of an exchange, as a declaration. */
export interface CryptoFeedDescriptor {
  /** Stable feed id, `<provider>.<endpoint>` (e.g. "binance.klines"). */
  readonly feedId: string;
  /** The documented route — declared, never fetched in this baseline. */
  readonly endpoint: string;
  readonly outputKind: FeedOutputKind;
  readonly timestampUnit: TimestampUnit;
  /** Doc labels of the timestamp-bearing fields (human-facing declaration). */
  readonly timestampFields: readonly string[];
  readonly recordOrder: FeedRecordOrder;
  readonly symbolLocation: SymbolLocation;
  /**
   * The records do not carry their interval end, so the mapping context must
   * declare it (Coinbase candles: time is the bucket START only).
   */
  readonly requiresGranularityMs: boolean;
  /** Declared conversions and per-feed known gaps (honest notes). */
  readonly notes: readonly string[];
}

/** Polling declaration — honest about what this baseline does and does not do. */
export interface CryptoPollingDeclaration {
  /** LAW: the baseline performs no network IO. A provider claiming otherwise is invalid. */
  readonly liveFetch: "not-implemented";
  /** The acquisition model the future fetch layer will implement. */
  readonly intendedModel: string;
  /**
   * Rate limits are exchange POLICY, verified when the fetch layer exists —
   * no numbers are asserted here that were not verified against the docs.
   */
  readonly rateLimits: string;
}

/** Fidelity declaration — what the provider gives, and its known gaps. */
export interface CryptoFidelityDeclaration {
  readonly gives: readonly string[];
  readonly knownGaps: readonly string[];
  /** Deterministic declared conversions (never silent reinterpretations). */
  readonly conventions: readonly string[];
}

/** A crypto exchange as an importable data provider (declaration, not a fetcher). */
export interface CryptoProviderDescriptor {
  readonly providerId: string;
  readonly exchange: string;
  /** The public API documentation the record shapes were transcribed from. */
  readonly docs: {
    readonly source: string;
    readonly shapeSnapshotDate: string;
    readonly note: string;
  };
  readonly symbols: CryptoSymbolTable;
  readonly feeds: readonly CryptoFeedDescriptor[];
  readonly polling: CryptoPollingDeclaration;
  readonly fidelity: CryptoFidelityDeclaration;
}

/** The per-record mapping context the feed mappers consume (pure data). */
export interface CryptoRecordContext {
  /** The provider's declared symbol table. */
  readonly symbols: CryptoSymbolTable;
  /** The request-scoped symbol (required by feeds with `symbolLocation: "request"`). */
  readonly symbol?: string;
  /** Caller-declared interval in ms (required by `requiresGranularityMs` feeds). */
  readonly granularityMs?: number;
}

/** Typed outcome of mapping ONE exchange-native record. */
export type CryptoRecordMapping =
  | { readonly ok: true; readonly record: HistoricalRecord }
  | { readonly ok: false; readonly violations: readonly CryptoMappingViolation[] };

/** Look up one feed of a provider by id. */
export function feedOf(
  provider: CryptoProviderDescriptor,
  feedId: string,
): CryptoFeedDescriptor | undefined {
  return provider.feeds.find((feed) => feed.feedId === feedId);
}

const RECORD_ORDERS: readonly string[] = ["ascending", "descending", "single"];
const SYMBOL_LOCATIONS: readonly string[] = ["record", "request"];
const TIMESTAMP_UNITS: readonly string[] = ["epoch-ms", "epoch-s", "iso-8601"];
const OUTPUT_KINDS: readonly string[] = ["bar", "trade", "quote", "unmappable"];

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArrayProblems(
  values: readonly string[],
  label: string,
  problems: string[],
): void {
  if (values.length === 0) {
    problems.push(`${label} must be a non-empty array`);
  } else if (!values.every(isNonBlank)) {
    problems.push(`${label}: every entry must be a non-blank string`);
  }
}

/**
 * Validate a provider descriptor structurally. Returns every problem as
 * `invalid-provider` violations (empty list = valid). Honest-declaration
 * laws enforced: the polling claim must stay "not-implemented", the symbol
 * table must be non-empty with non-blank instruments, feed ids must be
 * unique and their conventions well-formed.
 */
export function validateCryptoProvider(
  provider: CryptoProviderDescriptor,
): readonly CryptoMappingViolation[] {
  const problems: string[] = [];
  if (typeof provider !== "object" || provider === null) {
    return [{ kind: "invalid-provider", detail: "provider must be an object" }];
  }
  if (!isNonBlank(provider.providerId)) {
    problems.push("providerId must be a non-blank string");
  }
  if (!isNonBlank(provider.exchange)) {
    problems.push("exchange must be a non-blank string");
  }
  if (typeof provider.docs !== "object" || provider.docs === null) {
    problems.push("docs must be an object");
  } else {
    if (!isNonBlank(provider.docs.source)) problems.push("docs.source must be a non-blank string");
    if (!isNonBlank(provider.docs.shapeSnapshotDate)) {
      problems.push("docs.shapeSnapshotDate must be a non-blank string");
    }
    if (!isNonBlank(provider.docs.note)) problems.push("docs.note must be a non-blank string");
  }
  const symbolEntries = Object.entries(provider.symbols ?? {});
  if (symbolEntries.length === 0) {
    problems.push("symbols must declare at least one exchange symbol -> instrument mapping");
  }
  for (const [symbol, instrumentId] of symbolEntries) {
    if (!isNonBlank(symbol) || !isNonBlank(instrumentId)) {
      problems.push(`symbols: '${String(symbol)}' -> '${String(instrumentId)}' must both be non-blank`);
    }
  }
  if (!Array.isArray(provider.feeds) || provider.feeds.length === 0) {
    problems.push("feeds must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const feed of provider.feeds) {
      if (typeof feed !== "object" || feed === null) {
        problems.push("feeds: every entry must be an object");
        continue;
      }
      if (!isNonBlank(feed.feedId)) {
        problems.push("feeds: feedId must be a non-blank string");
      } else if (seen.has(feed.feedId)) {
        problems.push(`feeds: duplicate feed id '${feed.feedId}'`);
      }
      seen.add(String(feed.feedId));
      if (!isNonBlank(feed.endpoint)) {
        problems.push(`feed '${String(feed.feedId)}': endpoint must be a non-blank string`);
      }
      if (!OUTPUT_KINDS.includes(String(feed.outputKind))) {
        problems.push(`feed '${String(feed.feedId)}': unknown outputKind '${String(feed.outputKind)}'`);
      }
      if (!TIMESTAMP_UNITS.includes(String(feed.timestampUnit))) {
        problems.push(`feed '${String(feed.feedId)}': unknown timestampUnit '${String(feed.timestampUnit)}'`);
      }
      if (!RECORD_ORDERS.includes(String(feed.recordOrder))) {
        problems.push(`feed '${String(feed.feedId)}': unknown recordOrder '${String(feed.recordOrder)}'`);
      }
      if (!SYMBOL_LOCATIONS.includes(String(feed.symbolLocation))) {
        problems.push(`feed '${String(feed.feedId)}': unknown symbolLocation '${String(feed.symbolLocation)}'`);
      }
      stringArrayProblems(feed.notes ?? [], `feed '${String(feed.feedId)}': notes`, problems);
    }
  }
  if (typeof provider.polling !== "object" || provider.polling === null) {
    problems.push("polling must be an object");
  } else {
    if (provider.polling.liveFetch !== "not-implemented") {
      problems.push(
        "polling.liveFetch must be 'not-implemented' — the W026 baseline performs no network IO (the live fetch layer is a later work order; a provider descriptor may not claim it)",
      );
    }
    if (!isNonBlank(provider.polling.intendedModel)) {
      problems.push("polling.intendedModel must be a non-blank string");
    }
    if (!isNonBlank(provider.polling.rateLimits)) {
      problems.push("polling.rateLimits must be a non-blank string");
    }
  }
  if (typeof provider.fidelity !== "object" || provider.fidelity === null) {
    problems.push("fidelity must be an object");
  } else {
    stringArrayProblems(provider.fidelity.gives ?? [], "fidelity.gives", problems);
    stringArrayProblems(provider.fidelity.knownGaps ?? [], "fidelity.knownGaps", problems);
    stringArrayProblems(provider.fidelity.conventions ?? [], "fidelity.conventions", problems);
  }
  return problems.map((detail) => ({ kind: "invalid-provider", detail }) as const);
}
