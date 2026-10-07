/**
 * The batch mapping engine (W026 `tradrl-adapters-crypto`).
 *
 * Binds the provider/feed declarations (`./providers.js`) to the
 * exchange-specific record mappers (`./binance.js`, `./coinbase.js`) and
 * produces the W020-importable surface of one feed batch: the
 * `HistoricalRecord` set (event-time ordered), the W020
 * `DatasetDescriptor` (`./dataset.js`) and the import `symbolMap` — the
 * exact triple `loadHistoricalDataset` consumes.
 *
 * Laws:
 * - NO network IO — the payload is recorded JSON (the live fetch layer is a
 *   later work order; the provider's polling declaration says so honestly);
 * - pure + deterministic (A9): same (provider, feedId, payload, context)
 *   always yields the bit-identical mapping;
 * - collect-everything: one pass reports EVERY violation; a batch with any
 *   violation maps nothing (`ok: false` carries the complete list — the W020
 *   never-partially-import discipline);
 * - the declared `recordOrder` is normalized deterministically: newest-first
 *   feeds are REVERSED (a pure reversal of the documented order — the W020
 *   `sortHistoricalRecords` precedent for importers repairing provider
 *   order); ascending feeds are never reordered. Residual ordering garbage
 *   is caught loudly at the W020 import boundary (`out-of-order-records`),
 *   deliberately not re-validated here;
 * - context requirements are feed declarations, not guesses: request-scoped
 *   symbols and candle granularities are REQUIRED because the documented
 *   records do not carry them (never invented).
 */

import type { DeterminismDeclaration } from "tradrl-world-contracts";
import type { DatasetDescriptor, DatasetId, HistoricalRecord } from "tradrl-world-contracts/data";
import type { RecordSymbolMap } from "tradrl-data";
import type { CryptoMappingViolation } from "./errors.js";
import type {
  CryptoFeedDescriptor,
  CryptoProviderDescriptor,
  CryptoRecordContext,
  CryptoRecordMapping,
} from "./providers.js";
import { feedOf, validateCryptoProvider } from "./providers.js";
import { mapBinanceAggTrade, mapBinanceBookTicker, mapBinanceKline } from "./binance.js";
import {
  mapCoinbaseCandle,
  mapCoinbaseTicker,
  mapCoinbaseTrade,
} from "./coinbase.js";
import { symbolMapOf } from "./symbols.js";
import { buildCryptoDatasetDescriptor } from "./dataset.js";

/**
 * The batch mapping context: what the importer must DECLARE because the
 * documented records do not carry it (request symbol, granularities), plus
 * optional descriptor overrides.
 */
export interface CryptoFeedContext {
  /** The exchange symbol of the request (required by request-scoped feeds). */
  readonly symbol?: string;
  /** Honest scale label for the dataset descriptor; REQUIRED for bar feeds. */
  readonly granularity?: string;
  /** Declared interval in ms — required by feeds whose records lack an end. */
  readonly granularityMs?: number;
  /** Overrides the derived dataset id. */
  readonly datasetId?: DatasetId;
  /** Overrides the default `{ kind: "deterministic" }` declaration. */
  readonly determinism?: DeterminismDeclaration;
}

/** The complete outcome of mapping one feed batch. */
export type CryptoFeedMapping =
  | {
      readonly ok: true;
      readonly provider: CryptoProviderDescriptor;
      readonly feed: CryptoFeedDescriptor;
      /** Mapped records in event-time order (declared order normalized). */
      readonly records: readonly HistoricalRecord[];
      /** W020 dataset descriptor, ready for `loadHistoricalDataset`. */
      readonly datasetDescriptor: DatasetDescriptor;
      /** W020 symbol map (the provider's declared table). */
      readonly symbolMap: RecordSymbolMap;
    }
  | { readonly ok: false; readonly violations: readonly CryptoMappingViolation[] };

/** One exchange-native record -> one W020 record (the mapper contract). */
type RecordMapper = (raw: unknown, context: CryptoRecordContext) => CryptoRecordMapping;

/** The baseline's feed-id -> mapper registry (declared feeds, bound mappers). */
const FEED_MAPPERS: Readonly<Record<string, RecordMapper>> = {
  "binance.klines": mapBinanceKline,
  "binance.aggTrades": mapBinanceAggTrade,
  "binance.bookTicker": (raw, context) => mapBinanceBookTicker(context.symbols, raw),
  "coinbase.candles": mapCoinbaseCandle,
  "coinbase.trades": mapCoinbaseTrade,
  "coinbase.ticker": mapCoinbaseTicker,
};

/** Provider/feed-level violations that make record mapping meaningless. */
function structuralViolations(
  provider: CryptoProviderDescriptor,
  feedId: string,
): readonly CryptoMappingViolation[] {
  const violations = validateCryptoProvider(provider);
  if (violations.length > 0) {
    return violations;
  }
  const feed = feedOf(provider, feedId);
  if (feed === undefined) {
    return [
      {
        kind: "unsupported-feed",
        detail: `provider '${provider.providerId}' offers no feed '${feedId}' (offered: ${provider.feeds.map((entry) => entry.feedId).join(", ")})`,
      },
    ];
  }
  if (FEED_MAPPERS[feedId] === undefined) {
    return [
      {
        kind: "unsupported-feed",
        detail: `feed '${feedId}' is declared but this baseline ships no mapper for it`,
      },
    ];
  }
  if (feed.outputKind === "unmappable") {
    return [
      {
        kind: "unmappable-feed",
        detail:
          `feed '${feedId}' is declared unmappable: ${feed.notes.join("; ")} — ` +
          `the W020 record requires its event time from the record itself (A7), which this endpoint does not provide`,
      },
    ];
  }
  return [];
}

/** Build the per-record mapping context from the provider + batch context. */
function recordContextOf(
  provider: CryptoProviderDescriptor,
  context: CryptoFeedContext,
): CryptoRecordContext {
  return {
    symbols: provider.symbols,
    symbol: context.symbol,
    granularityMs: context.granularityMs,
  };
}

/**
 * Map ONE exchange-native record (the pure single-record surface — the
 * future streaming fetch layer consumes this directly). The provider and
 * feed must be structurally valid and the feed mappable; record-level
 * problems arrive as collected typed violations.
 */
export function mapCryptoRecord(
  provider: CryptoProviderDescriptor,
  feedId: string,
  raw: unknown,
  context: CryptoFeedContext,
): CryptoRecordMapping {
  const structural = structuralViolations(provider, feedId);
  if (structural.length > 0) {
    return { ok: false, violations: structural };
  }
  const mapper = FEED_MAPPERS[feedId]!;
  return mapper(raw, recordContextOf(provider, context));
}

/** Context-level requirements the documented record shapes impose. */
function contextViolations(
  feed: CryptoFeedDescriptor,
  context: CryptoFeedContext,
): CryptoMappingViolation[] {
  const violations: CryptoMappingViolation[] = [];
  if (feed.symbolLocation === "request" && context.symbol === undefined) {
    violations.push({
      kind: "missing-field",
      detail:
        `mapping context symbol: the documented ${feed.feedId} records carry no symbol — ` +
        `pass the request's exchange symbol in the mapping context`,
    });
  }
  if (feed.requiresGranularityMs && context.granularityMs === undefined) {
    violations.push({
      kind: "missing-field",
      detail:
        `mapping context granularityMs: the documented ${feed.feedId} records carry no interval end — ` +
        `declare the granularity in milliseconds (never invented)`,
    });
  }
  if (feed.outputKind === "bar" && (context.granularity ?? "").trim().length === 0) {
    violations.push({
      kind: "missing-field",
      detail:
        `mapping context granularity: bar feeds require an honest scale label (e.g. "1m") ` +
        `for the dataset descriptor — the documented records carry no interval label`,
    });
  }
  return violations;
}

/**
 * Map one recorded feed batch onto the W020 import surface. Pure and
 * deterministic; collect-everything on failure (never a partial mapping);
 * declared provider order normalized to event-time order (newest-first
 * feeds reversed; ascending feeds untouched).
 */
export function mapCryptoFeed(
  provider: CryptoProviderDescriptor,
  feedId: string,
  rawPayload: unknown,
  context: CryptoFeedContext = {},
): CryptoFeedMapping {
  const structural = structuralViolations(provider, feedId);
  if (structural.length > 0) {
    return { ok: false, violations: structural };
  }
  const feed = feedOf(provider, feedId)!;
  const violations: CryptoMappingViolation[] = [...contextViolations(feed, context)];
  let rows: readonly unknown[];
  if (feed.recordOrder === "single") {
    if (Array.isArray(rawPayload)) {
      violations.push({
        kind: "malformed-record",
        detail: `the documented ${feed.feedId} response is a SINGLE record object, not an array`,
      });
      rows = [];
    } else {
      rows = [rawPayload];
    }
  } else if (Array.isArray(rawPayload)) {
    rows = rawPayload;
  } else {
    violations.push({
      kind: "malformed-record",
      detail: `the documented ${feed.feedId} response is an array of records, got '${typeof rawPayload}'`,
    });
    rows = [];
  }
  const mapper = FEED_MAPPERS[feedId]!;
  const recordContext = recordContextOf(provider, context);
  const mapped: HistoricalRecord[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = mapper(rows[index]!, recordContext);
    if (result.ok) {
      mapped.push(result.record);
    } else {
      for (const violation of result.violations) {
        violations.push({ ...violation, index });
      }
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  // Declared order normalization: newest-first batches are REVERSED (a pure
  // reversal of the documented order); ascending/single stay untouched.
  const records = feed.recordOrder === "descending" ? [...mapped].reverse() : mapped;
  const datasetDescriptor = buildCryptoDatasetDescriptor({
    provider,
    feed,
    records,
    granularity: context.granularity ?? "tick",
    ...(context.determinism === undefined ? {} : { determinism: context.determinism }),
    ...(context.datasetId === undefined ? {} : { datasetId: context.datasetId }),
  });
  return {
    ok: true,
    provider,
    feed,
    records,
    datasetDescriptor,
    symbolMap: symbolMapOf(provider.symbols),
  };
}
