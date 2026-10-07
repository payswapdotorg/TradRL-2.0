/**
 * Binance Spot provider (W026 `tradrl-adapters-crypto`).
 *
 * Record shapes transcribed from the public Binance Spot API reference
 * (klines, aggTrades, bookTicker) — see `binanceSpotProvider().docs` for
 * the snapshot label. NO network IO: mappers consume recorded/documented
 * JSON; the live fetch layer is a later work order.
 *
 * Declared conventions (all tested, all disclosed in the provider's
 * fidelity declaration):
 * - kline times are epoch MILLISECONDS; kline `closeTime` is the INCLUSIVE
 *   last millisecond of the interval, converted explicitly (+1ms) to the
 *   world's half-open `[start, end)` bar interval;
 * - kline/aggTrade rows carry NO symbol — the symbol is request-scoped and
 *   must arrive in the mapping context;
 * - aggTrades `m` is "was the buyer the maker" — aggressor side is its
 *   declared conversion (`m` true -> the aggressor sold);
 * - bookTicker carries NO timestamp — the W020 record requires the
 *   event-time basis from the record (A7), so this feed is declared
 *   UNMAPPABLE and every mapping attempt is a loud typed rejection, never
 *   an invented timestamp.
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type { HistoricalBarRecord, HistoricalTradeRecord } from "tradrl-world-contracts/data";
import type {
  CryptoFeedDescriptor,
  CryptoProviderDescriptor,
  CryptoRecordContext,
  CryptoRecordMapping,
} from "./providers.js";
import type { CryptoSymbolTable } from "./symbols.js";
import { resolveProviderSymbol } from "./symbols.js";
import { epochMsFromMs } from "./timestamps.js";
import type { CryptoMappingViolation } from "./errors.js";
import {
  asPrice,
  asQuantity,
  decimalOrPush,
  missingField,
  ohlcvViolation,
  timestampOrPush,
} from "./shape.js";

/** Documented kline row: 12 columns (openTime, OHLC, volume, closeTime, ...). */
export type BinanceKlineRow = readonly [
  number, // Kline open time (epoch ms)
  string, // Open price
  string, // High price
  string, // Low price
  string, // Close price
  string, // Volume
  number, // Kline close time (epoch ms, INCLUSIVE last millisecond)
  string, // Quote asset volume
  number, // Number of trades
  string, // Taker buy base volume
  string, // Taker buy quote volume
  string, // Unused ("0")
];

/** Documented aggregate-trade row. */
export interface BinanceAggTradeRow {
  readonly a: number; // Aggregate trade id
  readonly p: string; // Price
  readonly q: string; // Quantity
  readonly T: number; // Trade time (epoch ms)
  readonly m: boolean; // Was the buyer the maker?
  readonly M?: boolean; // Was the trade the best price match?
}

/** Documented book-ticker row (best bid/ask — carries NO timestamp). */
export interface BinanceBookTickerRow {
  readonly symbol: string;
  readonly bidPrice: string;
  readonly bidQty: string;
  readonly askPrice: string;
  readonly askQty: string;
}

const KLINE_COLUMNS = 12;

/** The request-scoped symbol check (klines/aggTrades rows carry none). */
function requestSymbolViolations(
  context: CryptoRecordContext,
  violations: CryptoMappingViolation[],
): void {
  if (context.symbol === undefined) {
    violations.push(
      missingField(
        "mapping context symbol",
        "the documented kline/aggTrade response rows carry no symbol — pass the request's exchange symbol in the mapping context",
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
 * Map one documented kline row onto a W020 bar record. Pure; collects every
 * violation. The interval end is the declared conversion `closeTime + 1ms`
 * (inclusive last millisecond -> half-open end). When the context declares
 * `granularityMs`, the resulting interval length is cross-checked loudly.
 */
export function mapBinanceKline(
  raw: unknown,
  context: CryptoRecordContext,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  requestSymbolViolations(context, violations);
  if (!Array.isArray(raw) || raw.length < KLINE_COLUMNS) {
    violations.push({
      kind: "malformed-record",
      detail:
        `kline row must be an array of ${String(KLINE_COLUMNS)} documented columns, got ` +
        `${Array.isArray(raw) ? `${String(raw.length)} columns` : typeof raw}`,
    });
    return { ok: false, violations };
  }
  const openTime = timestampOrPush(epochMsFromMs(raw[0], "kline open time"), violations);
  const closeTime = timestampOrPush(epochMsFromMs(raw[6], "kline close time"), violations);
  const open = decimalOrPush("kline open", raw[1], violations);
  const high = decimalOrPush("kline high", raw[2], violations);
  const low = decimalOrPush("kline low", raw[3], violations);
  const close = decimalOrPush("kline close", raw[4], violations);
  const volume = decimalOrPush("kline volume", raw[5], violations);
  if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
    const problem = ohlcvViolation("kline", open, high, low, close);
    if (problem !== undefined) violations.push(problem);
  }
  if (openTime !== undefined && closeTime !== undefined) {
    if (closeTime < openTime) {
      violations.push({
        kind: "malformed-record",
        detail: `kline close time ${String(closeTime)} precedes open time ${String(openTime)}`,
      });
    } else if (
      context.granularityMs !== undefined &&
      closeTime + 1 - openTime !== context.granularityMs
    ) {
      violations.push({
        kind: "interval-length-mismatch",
        detail:
          `kline interval [${String(openTime)}, ${String(closeTime + 1)}) is ` +
          `${String(closeTime + 1 - openTime)}ms but the declared granularity is ${String(context.granularityMs)}ms`,
      });
    }
  }
  if (
    violations.length > 0 ||
    openTime === undefined ||
    closeTime === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volume === undefined ||
    context.symbol === undefined
  ) {
    return { ok: false, violations };
  }
  const record: HistoricalBarRecord = {
    kind: "bar",
    symbol: context.symbol,
    openTime,
    // Declared conversion: the documented close time is the inclusive LAST
    // millisecond; the world bar interval is half-open [start, end).
    closeTime: (closeTime + 1) as HistoricalBarRecord["closeTime"],
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
 * Map one documented aggregate-trade row onto a W020 trade record. The
 * aggressor side is the declared conversion of `m` ("was the buyer the
 * maker"): buyer-maker -> the aggressor sold.
 */
export function mapBinanceAggTrade(
  raw: unknown,
  context: CryptoRecordContext,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  requestSymbolViolations(context, violations);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    violations.push({
      kind: "malformed-record",
      detail: `aggTrade must be a JSON object, got '${typeof raw}'`,
    });
    return { ok: false, violations };
  }
  const row = raw as Record<string, unknown>;
  if (row.a === undefined) {
    violations.push(missingField("aggTrade a", "the aggregate trade id is required"));
  } else if (typeof row.a !== "number" || !Number.isSafeInteger(row.a)) {
    violations.push({
      kind: "malformed-record",
      detail: `aggTrade a must be a safe integer, got '${String(row.a)}'`,
    });
  }
  let price: string | undefined;
  if (row.p === undefined) {
    violations.push(missingField("aggTrade p", "the price is required"));
  } else {
    price = decimalOrPush("aggTrade p", row.p, violations);
  }
  let quantity: string | undefined;
  if (row.q === undefined) {
    violations.push(missingField("aggTrade q", "the quantity is required"));
  } else {
    quantity = decimalOrPush("aggTrade q", row.q, violations);
  }
  let tradeTime: TimestampMs | undefined;
  if (row.T === undefined) {
    violations.push(missingField("aggTrade T", "the trade timestamp is required"));
  } else {
    tradeTime = timestampOrPush(epochMsFromMs(row.T, "aggTrade T"), violations);
  }
  if (row.m === undefined) {
    violations.push(missingField("aggTrade m", "the buyer-maker flag is required"));
  } else if (typeof row.m !== "boolean") {
    violations.push({
      kind: "malformed-record",
      detail: `aggTrade m must be a boolean, got '${String(row.m)}'`,
    });
  }
  if (
    violations.length > 0 ||
    price === undefined ||
    quantity === undefined ||
    tradeTime === undefined ||
    context.symbol === undefined ||
    row.a === undefined ||
    typeof row.a !== "number" ||
    row.m === undefined ||
    typeof row.m !== "boolean"
  ) {
    return { ok: false, violations };
  }
  const record: HistoricalTradeRecord = {
    kind: "trade",
    symbol: context.symbol,
    timestamp: tradeTime,
    price: asPrice(price),
    quantity: asQuantity(quantity),
    // Declared conversion: the buyer was the maker -> the aggressor sold.
    aggressorSide: row.m ? "sell" : "buy",
    tradeId: String(row.a),
    // availableAt: the documented row carries none — omitted, never invented.
  };
  return { ok: true, record };
}

/**
 * Map one documented book-ticker row. This feed is UNMAPPABLE by honest
 * declaration: the documented response carries NO timestamp, and the W020
 * quote record requires the event-time basis from the record (A7) — it is
 * never invented. Every attempt returns violations (the missing timestamp
 * above all); `ok: true` is structurally unreachable. The symbol is
 * record-scoped and resolves against the provider's declared table.
 */
export function mapBinanceBookTicker(
  symbols: CryptoSymbolTable,
  raw: unknown,
): CryptoRecordMapping {
  const violations: CryptoMappingViolation[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-record",
          detail: `bookTicker must be a JSON object, got '${typeof raw}'`,
        },
      ],
    };
  }
  const row = raw as Record<string, unknown>;
  if (row.symbol === undefined) {
    violations.push(missingField("bookTicker symbol", "the symbol is required"));
  } else if (typeof row.symbol !== "string") {
    violations.push({
      kind: "malformed-record",
      detail: `bookTicker symbol must be a string, got '${String(row.symbol)}'`,
    });
  } else {
    const symbol = resolveProviderSymbol(symbols, row.symbol);
    if (!symbol.ok) violations.push(symbol.violation);
  }
  decimalOrPush("bookTicker bidPrice", row.bidPrice, violations);
  decimalOrPush("bookTicker bidQty", row.bidQty, violations);
  decimalOrPush("bookTicker askPrice", row.askPrice, violations);
  decimalOrPush("bookTicker askQty", row.askQty, violations);
  violations.push(
    missingField(
      "bookTicker timestamp",
      "the documented bookTicker response carries no timestamp and the W020 quote record " +
        "requires the event-time basis from the record (A7) — never invented; this feed is declared unmappable",
    ),
  );
  return { ok: false, violations };
}

/** The Binance Spot baseline provider descriptor over a declared symbol table. */
export function binanceSpotProvider(symbols: CryptoSymbolTable): CryptoProviderDescriptor {
  const feeds: readonly CryptoFeedDescriptor[] = [
    {
      feedId: "binance.klines",
      endpoint: "GET /api/v3/klines?symbol=<S>&interval=<I>&startTime=<T>",
      outputKind: "bar",
      timestampUnit: "epoch-ms",
      timestampFields: ["open time (column 0)", "close time (column 6)"],
      recordOrder: "ascending",
      symbolLocation: "request",
      requiresGranularityMs: false,
      notes: [
        "close time is the inclusive last millisecond; interval end = close time + 1ms (declared conversion to the half-open bar interval)",
        "response rows carry no symbol — the request symbol must be declared in the mapping context",
      ],
    },
    {
      feedId: "binance.aggTrades",
      endpoint: "GET /api/v3/aggTrades?symbol=<S>&startTime=<T>",
      outputKind: "trade",
      timestampUnit: "epoch-ms",
      timestampFields: ["T (trade time)"],
      recordOrder: "ascending",
      symbolLocation: "request",
      requiresGranularityMs: false,
      notes: [
        "m (was the buyer the maker) -> aggressorSide: m true = sell, m false = buy (declared conversion)",
        "aggregate trade id `a` becomes the W020 tradeId",
        "response rows carry no symbol — the request symbol must be declared in the mapping context",
      ],
    },
    {
      feedId: "binance.bookTicker",
      endpoint: "GET /api/v3/ticker/bookTicker?symbol=<S>",
      outputKind: "unmappable",
      timestampUnit: "epoch-ms",
      timestampFields: [],
      recordOrder: "single",
      symbolLocation: "record",
      requiresGranularityMs: false,
      notes: [
        "UNMAPPABLE in this baseline: the response carries no timestamp, and the event-time basis is never invented (A7)",
      ],
    },
  ];
  return {
    providerId: "binance-spot",
    exchange: "Binance (Spot API)",
    docs: {
      source:
        "Binance Spot API reference (developers.binance.com, binance-spot-api-docs): " +
        "GET /api/v3/klines, GET /api/v3/aggTrades, GET /api/v3/ticker/bookTicker",
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
        "interval polling of the public REST endpoints declared by each feed (per-symbol, time-windowed pages)",
      rateLimits:
        "Binance applies weight-based request limits per IP — exact limits are exchange policy, " +
        "verified when the live fetch layer is built; no numbers are asserted here",
    },
    fidelity: {
      gives: [
        "klines: OHLCV bars with open and close times (epoch ms) at the requested interval",
        "aggTrades: aggregated public trade prints with price, quantity, epoch-ms time, buyer-maker flag and aggregate id",
        "bookTicker: best bid/ask price and quantity (no timestamp)",
      ],
      knownGaps: [
        "bookTicker carries no timestamp — it cannot become a quote record whose event time comes from the record; the feed is declared unmappable and mapping attempts are loud typed rejections",
        "no mapped endpoint declares delayed availability — mapped records carry no availableAt (never invented)",
        "REST polling returns pages/snapshots, not a complete tick history between polls — completeness belongs to the future fetch layer",
      ],
      conventions: [
        "kline close time is the inclusive last millisecond; the world bar interval end is close time + 1ms",
        "aggTrades m = 'was the buyer the maker': aggressor side is its opposite-taker conversion",
        "kline/aggTrade rows carry no symbol; the symbol is request-scoped",
        "klines and aggTrades pages are returned in ascending time order",
      ],
    },
  };
}
