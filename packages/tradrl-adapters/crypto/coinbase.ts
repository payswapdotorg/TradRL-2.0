/**
 * Coinbase Exchange provider (W026 `tradrl-adapters-crypto`).
 *
 * Record shapes transcribed from the public Coinbase Exchange API reference
 * (candles, trades, ticker) — see `coinbaseExchangeProvider().docs` for the
 * snapshot label. NO network IO: mappers consume recorded/documented JSON;
 * the live fetch layer is a later work order.
 *
 * Declared conventions (all tested, all disclosed in the provider's
 * fidelity declaration):
 * - candle `time` is the bucket START in epoch SECONDS — the classic unit
 *   trap; converted explicitly (×1000) behind a seconds-window check;
 * - candle rows carry NO interval end — the mapping context must declare
 *   the granularity (end = start + granularity, half-open; never invented);
 * - the candle column order is [time, low, high, open, close, volume] — NOT
 *   the Binance order; the mapper reads the documented positions;
 * - candles/trades are returned NEWEST FIRST; the batch mapper
 *   deterministically reverses to event-time order;
 * - trade/ticker `time` is an ISO-8601 UTC string with up to microsecond
 *   precision — truncated to the millisecond contract (declared);
 * - trade `side` is declared as the MAKER side; the aggressor side is its
 *   opposite (declared conversion);
 * - ticker carries bid/ask/last but NO bid/ask sizes — sizes stay honestly
 *   absent, never fabricated from unrelated fields.
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type {
  HistoricalBarRecord,
  HistoricalQuoteRecord,
  HistoricalTradeRecord,
} from "tradrl-world-contracts/data";
import type {
  CryptoFeedDescriptor,
  CryptoProviderDescriptor,
  CryptoRecordContext,
  CryptoRecordMapping,
} from "./providers.js";
import type { CryptoSymbolTable } from "./symbols.js";
import { resolveProviderSymbol } from "./symbols.js";
import { epochMsFromIso8601Utc, epochMsFromSeconds } from "./timestamps.js";
import type { CryptoMappingViolation } from "./errors.js";
import {
  asPrice,
  asQuantity,
  decimalOrPush,
  missingField,
  ohlcvViolation,
  timestampOrPush,
} from "./shape.js";

/** Documented candle row: [time(s), low, high, open, close, volume]. */
export type CoinbaseCandleRow = readonly [
  number, // Bucket start (epoch SECONDS)
  string, // Low price
  string, // High price
  string, // Open price
  string, // Close price
  string, // Volume (base units)
];

/** Documented trade row. */
export interface CoinbaseTradeRow {
  readonly time: string; // ISO-8601 UTC (up to microseconds)
  readonly trade_id: number;
  readonly price: string;
  readonly size: string;
  readonly side: "buy" | "sell"; // declared: the MAKER side
}

/** Documented ticker row (bid/ask/last — carries NO bid/ask sizes). */
export interface CoinbaseTickerRow {
  readonly trade_id: number;
  readonly price: string; // last trade price
  readonly bid: string;
  readonly ask: string;
  readonly size: string; // last trade size — NOT a bid/ask size
  readonly time: string; // ISO-8601 UTC
  readonly volume: string; // 24h volume
}

const CANDLE_COLUMNS = 6;

/** The request-scoped symbol check (candle/trade/ticker rows carry none). */
function requestSymbolViolations(
  context: CryptoRecordContext,
  violations: CryptoMappingViolation[],
): void {
  if (context.symbol === undefined) {
    violations.push(
      missingField(
        "mapping context symbol",
        "the documented candle/trade/ticker responses carry no symbol — pass the request's product id in the mapping context",
      ),
    );
    return;
  }
  const symbol = resolveProviderSymbol(context.symbols, context.symbol);
  if (!symbol.ok) {
    violations.push(symbol.violation);
  }
}

/**
 * Map one documented candle row onto a W020 bar record. The bucket start is
 * epoch SECONDS (converted explicitly); the interval end is `start +
 * granularityMs` — the granularity MUST be declared in the mapping context
 * because the documented row does not carry it (never invented).
 */
export function mapCoinbaseCandle(
  raw: unknown,
  context: CryptoRecordContext,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  requestSymbolViolations(context, violations);
  if (context.granularityMs === undefined) {
    violations.push(
      missingField(
        "mapping context granularityMs",
        "the documented candle row carries only its bucket START — the interval end is start + granularity (half-open); declare granularityMs in the mapping context",
      ),
    );
  }
  if (!Array.isArray(raw) || raw.length < CANDLE_COLUMNS) {
    violations.push({
      kind: "malformed-record",
      detail:
        `candle row must be an array of ${String(CANDLE_COLUMNS)} documented columns ` +
        `[time, low, high, open, close, volume], got ` +
        `${Array.isArray(raw) ? `${String(raw.length)} columns` : typeof raw}`,
    });
    return { ok: false, violations };
  }
  const openTime = timestampOrPush(epochMsFromSeconds(raw[0], "candle time (epoch seconds)"), violations);
  const low = decimalOrPush("candle low", raw[1], violations);
  const high = decimalOrPush("candle high", raw[2], violations);
  const open = decimalOrPush("candle open", raw[3], violations);
  const close = decimalOrPush("candle close", raw[4], violations);
  const volume = decimalOrPush("candle volume", raw[5], violations);
  if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
    const problem = ohlcvViolation("candle", open, high, low, close);
    if (problem !== undefined) violations.push(problem);
  }
  if (
    violations.length > 0 ||
    openTime === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volume === undefined ||
    context.granularityMs === undefined ||
    context.symbol === undefined
  ) {
    return { ok: false, violations };
  }
  const record: HistoricalBarRecord = {
    kind: "bar",
    symbol: context.symbol,
    openTime,
    // Declared conversion: the row carries only the bucket start; the
    // half-open interval end is start + declared granularity.
    closeTime: (openTime + context.granularityMs) as HistoricalBarRecord["closeTime"],
    open: asPrice(open),
    high: asPrice(high),
    low: asPrice(low),
    close: asPrice(close),
    volume: asQuantity(volume),
    // availableAt: the documented row carries none — omitted, never invented.
  };
  return { ok: true, record };
}

/**
 * Map one documented trade row onto a W020 trade record. `time` is parsed
 * strictly (ISO-8601 UTC, microseconds truncated to the ms contract);
 * `side` is declared as the MAKER side, so the aggressor side is its
 * opposite (declared conversion).
 */
export function mapCoinbaseTrade(
  raw: unknown,
  context: CryptoRecordContext,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  requestSymbolViolations(context, violations);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    violations.push({
      kind: "malformed-record",
      detail: `trade must be a JSON object, got '${typeof raw}'`,
    });
    return { ok: false, violations };
  }
  const row = raw as Record<string, unknown>;
  let tradeTime: TimestampMs | undefined;
  if (row.time === undefined) {
    violations.push(missingField("trade time", "the trade timestamp is required"));
  } else {
    tradeTime = timestampOrPush(epochMsFromIso8601Utc(row.time, "trade time (ISO-8601)"), violations);
  }
  if (row.trade_id === undefined) {
    violations.push(missingField("trade trade_id", "the trade id is required"));
  } else if (typeof row.trade_id !== "number" || !Number.isSafeInteger(row.trade_id)) {
    violations.push({
      kind: "malformed-record",
      detail: `trade trade_id must be a safe integer, got '${String(row.trade_id)}'`,
    });
  }
  let price: string | undefined;
  if (row.price === undefined) {
    violations.push(missingField("trade price", "the price is required"));
  } else {
    price = decimalOrPush("trade price", row.price, violations);
  }
  let size: string | undefined;
  if (row.size === undefined) {
    violations.push(missingField("trade size", "the size is required"));
  } else {
    size = decimalOrPush("trade size", row.size, violations);
  }
  if (row.side === undefined) {
    violations.push(missingField("trade side", "the maker side is required"));
  } else if (row.side !== "buy" && row.side !== "sell") {
    violations.push({
      kind: "malformed-record",
      detail: `trade side must be 'buy' or 'sell', got '${String(row.side)}'`,
    });
  }
  if (
    violations.length > 0 ||
    tradeTime === undefined ||
    price === undefined ||
    size === undefined ||
    context.symbol === undefined ||
    row.trade_id === undefined ||
    typeof row.trade_id !== "number" ||
    row.side !== "buy" && row.side !== "sell"
  ) {
    return { ok: false, violations };
  }
  const record: HistoricalTradeRecord = {
    kind: "trade",
    symbol: context.symbol,
    timestamp: tradeTime,
    price: asPrice(price),
    quantity: asQuantity(size),
    // Declared conversion: `side` is the MAKER side — the aggressor is the opposite.
    aggressorSide: row.side === "buy" ? "sell" : "buy",
    tradeId: String(row.trade_id),
    // availableAt: the documented row carries none — omitted, never invented.
  };
  return { ok: true, record };
}

/**
 * Map one documented ticker row onto a W020 quote record. The endpoint
 * carries bid/ask/last but NO bid/ask sizes — the sizes stay honestly
 * absent (the `size` field is the last trade's size, not a book size; it is
 * never shoehorned into one).
 */
export function mapCoinbaseTicker(
  raw: unknown,
  context: CryptoRecordContext,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  requestSymbolViolations(context, violations);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    violations.push({
      kind: "malformed-record",
      detail: `ticker must be a JSON object, got '${typeof raw}'`,
    });
    return { ok: false, violations };
  }
  const row = raw as Record<string, unknown>;
  let time: TimestampMs | undefined;
  if (row.time === undefined) {
    violations.push(missingField("ticker time", "the timestamp is required"));
  } else {
    time = timestampOrPush(epochMsFromIso8601Utc(row.time, "ticker time (ISO-8601)"), violations);
  }
  let bid: string | undefined;
  if (row.bid !== undefined) {
    bid = decimalOrPush("ticker bid", row.bid, violations);
  }
  let ask: string | undefined;
  if (row.ask !== undefined) {
    ask = decimalOrPush("ticker ask", row.ask, violations);
  }
  let last: string | undefined;
  if (row.price !== undefined) {
    last = decimalOrPush("ticker price (last)", row.price, violations);
  }
  if (bid === undefined && ask === undefined && last === undefined) {
    violations.push({
      kind: "malformed-record",
      detail:
        "ticker carries none of bid/ask/price — the documented shape always carries them; refusing to emit an empty quote",
    });
  }
  if (violations.length > 0 || time === undefined || context.symbol === undefined) {
    return { ok: false, violations };
  }
  const record: HistoricalQuoteRecord = {
    kind: "quote",
    symbol: context.symbol,
    timestamp: time,
    // Sizes honestly absent: the endpoint does not carry bid/ask sizes.
    ...(bid === undefined ? {} : { bid: asPrice(bid) }),
    ...(ask === undefined ? {} : { ask: asPrice(ask) }),
    ...(last === undefined ? {} : { last: asPrice(last) }),
    // availableAt: the documented row carries none — omitted, never invented.
  };
  return { ok: true, record };
}

/** The Coinbase Exchange baseline provider descriptor over a declared symbol table. */
export function coinbaseExchangeProvider(symbols: CryptoSymbolTable): CryptoProviderDescriptor {
  const feeds: readonly CryptoFeedDescriptor[] = [
    {
      feedId: "coinbase.candles",
      endpoint: "GET /products/<product_id>/candles?granularity=<seconds>",
      outputKind: "bar",
      timestampUnit: "epoch-s",
      timestampFields: ["time (column 0, bucket start, epoch SECONDS)"],
      recordOrder: "descending",
      symbolLocation: "request",
      requiresGranularityMs: true,
      notes: [
        "time is the bucket START in SECONDS — converted explicitly (×1000) behind a seconds-window check",
        "rows carry no interval end — end = start + declared granularity (half-open); granularityMs is required in the mapping context",
        "column order is [time, low, high, open, close, volume] — NOT the Binance order",
        "rows are newest first; the batch mapper deterministically reverses to event-time order",
      ],
    },
    {
      feedId: "coinbase.trades",
      endpoint: "GET /products/<product_id>/trades",
      outputKind: "trade",
      timestampUnit: "iso-8601",
      timestampFields: ["time (ISO-8601 UTC, up to microseconds)"],
      recordOrder: "descending",
      symbolLocation: "request",
      requiresGranularityMs: false,
      notes: [
        "microsecond precision is truncated to the TimestampMs contract (declared deterministic conversion)",
        "side is declared as the MAKER side; the aggressor side is its opposite",
        "rows are newest first; the batch mapper deterministically reverses to event-time order",
      ],
    },
    {
      feedId: "coinbase.ticker",
      endpoint: "GET /products/<product_id>/ticker",
      outputKind: "quote",
      timestampUnit: "iso-8601",
      timestampFields: ["time (ISO-8601 UTC)"],
      recordOrder: "single",
      symbolLocation: "request",
      requiresGranularityMs: false,
      notes: [
        "the endpoint carries bid/ask/last but NO bid/ask sizes — sizes stay honestly absent",
        "price is the last trade price -> the quote's `last`",
      ],
    },
  ];
  return {
    providerId: "coinbase-exchange",
    exchange: "Coinbase Exchange",
    docs: {
      source:
        "Coinbase Exchange API reference (api.exchange.coinbase.com): " +
        "GET /products/{product_id}/candles, GET /products/{product_id}/trades, GET /products/{product_id}/ticker",
      shapeSnapshotDate: "2026-10-07",
      note:
        "record shapes transcribed from the published reference as of the snapshot date; " +
        "this package's fixtures are hand-authored to the documented shapes, not live captures",
    },
    symbols,
    feeds,
    polling: {
      liveFetch: "not-implemented",
      intendedModel:
        "interval polling of the public REST endpoints declared by each feed (per product, time-windowed pages)",
      rateLimits:
        "Coinbase applies public-endpoint request rate limits per IP — exact limits are exchange policy, " +
        "verified when the live fetch layer is built; no numbers are asserted here",
    },
    fidelity: {
      gives: [
        "candles: OHLCV bars with the bucket start (epoch seconds) at the requested granularity",
        "trades: public trade prints with ISO-8601 time, trade id, price, size and maker side",
        "ticker: best bid/ask and last trade price with an ISO-8601 time",
      ],
      knownGaps: [
        "candles carry only the bucket start — the interval end must be declared by the importer (never invented)",
        "the ticker endpoint carries no bid/ask sizes — mapped quotes honestly omit them",
        "trades `side` semantics are declared as the maker side; if Coinbase revises the documented phrasing, the declared conversion is one field to fix",
        "no mapped endpoint declares delayed availability — mapped records carry no availableAt (never invented)",
        "REST polling returns pages/snapshots, not a complete tick history between polls — completeness belongs to the future fetch layer",
      ],
      conventions: [
        "candle time is epoch SECONDS, converted ×1000 explicitly",
        "candle columns are [time, low, high, open, close, volume]",
        "candles/trades pages are newest first; the batch mapper reverses them deterministically",
        "trade/ticker times are ISO-8601 UTC; microseconds are truncated to milliseconds",
        "trades side = maker side; aggressor = opposite",
      ],
    },
  };
}
