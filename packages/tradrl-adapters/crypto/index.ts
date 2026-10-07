/**
 * Public surface of the W026 `tradrl-adapters-crypto` package — the crypto
 * provider adapter BASELINE.
 *
 * Spec: spec/WORK-ITEMS.md W026, spec/ARCHITECTURE-LOCK.md A7 (event time
 * and availability come from the record, never invented), A9 (deterministic
 * pure transforms), spec/SIMULATION.md "Fidelity declarations".
 *
 * Layering (each module stands alone):
 * - `./errors.js` — the typed violation taxonomy (unknown symbol, malformed
 *   record, missing field, out-of-range timestamp, feed/provider structure);
 * - `./timestamps.js` — the timestamp unit laws (epoch-ms / epoch-s /
 *   ISO-8601, loud range validation against the classic unit swaps);
 * - `./symbols.js` — per-provider symbol tables and typed resolution;
 * - `./providers.js` — provider/feed descriptor types, polling/fidelity
 *   declarations and structural validation (honesty laws enforced);
 * - `./binance.js` + `./coinbase.js` — the two baseline exchanges: raw
 *   documented shapes, per-record mappers, provider factories;
 * - `./dataset.js` — W020 `DatasetDescriptor` building (derived range,
 *   adapter-detected bar holes declared as gaps, honest limitations);
 * - `./mapping.js` — the batch engine: recorded payload -> records +
 *   descriptor + symbolMap, the exact `loadHistoricalDataset` input triple;
 * - `./shape.js` — internal shared validation helpers.
 *
 * NO LIVE NETWORK IO: the baseline maps recorded/documented JSON only; the
 * live fetch layer is a later work order (every provider descriptor's
 * polling declaration says so, and `validateCryptoProvider` enforces it).
 */

export {
  type CryptoMappingErrorKind,
  type CryptoMappingViolation,
} from "./errors.js";
export {
  CRYPTO_EPOCH_CEILING_MS,
  CRYPTO_EPOCH_CEILING_SECONDS,
  CRYPTO_EPOCH_FLOOR_MS,
  CRYPTO_EPOCH_FLOOR_SECONDS,
  type TimestampConversion,
  type TimestampUnit,
  epochMsFromIso8601Utc,
  epochMsFromMs,
  epochMsFromSeconds,
} from "./timestamps.js";
export {
  type CryptoSymbolTable,
  type SymbolResolution,
  declaredSymbols,
  resolveProviderSymbol,
  symbolMapOf,
} from "./symbols.js";
export {
  type CryptoFeedDescriptor,
  type CryptoFidelityDeclaration,
  type CryptoPollingDeclaration,
  type CryptoProviderDescriptor,
  type CryptoRecordContext,
  type CryptoRecordMapping,
  type FeedOutputKind,
  type FeedRecordOrder,
  type SymbolLocation,
  feedOf,
  validateCryptoProvider,
} from "./providers.js";
export {
  type BinanceAggTradeRow,
  type BinanceBookTickerRow,
  type BinanceKlineRow,
  binanceSpotProvider,
  mapBinanceAggTrade,
  mapBinanceBookTicker,
  mapBinanceKline,
} from "./binance.js";
export {
  type CoinbaseCandleRow,
  type CoinbaseTickerRow,
  type CoinbaseTradeRow,
  coinbaseExchangeProvider,
  mapCoinbaseCandle,
  mapCoinbaseTicker,
  mapCoinbaseTrade,
} from "./coinbase.js";
export {
  type CryptoDatasetContext,
  buildCryptoDatasetDescriptor,
  deriveCryptoDatasetId,
  detectBarHoles,
} from "./dataset.js";
export {
  type CryptoFeedContext,
  type CryptoFeedMapping,
  mapCryptoFeed,
  mapCryptoRecord,
} from "./mapping.js";
