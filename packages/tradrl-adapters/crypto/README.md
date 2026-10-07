# tradrl-adapters-crypto — crypto provider adapter baseline (W026)

Maps real-world crypto exchange public REST market-data record shapes into
the W020 dataset/import surfaces: provider descriptors (exchange, symbol
mapping, polling/fidelity declarations) and per-feed record mappers
(exchange-native JSON -> the W020 `HistoricalRecord` shapes with explicit
timestamps — `occurredAt`/`availableAt` come from the record, never
invented).

**Fixture-based: NO live network IO.** The mappers consume recorded JSON
(fixtures labeled with the doc source + snapshot date they transcribe); the
live fetch layer is a later work order. Every provider descriptor's polling
declaration says so honestly, and `validateCryptoProvider` enforces it
(`liveFetch: "not-implemented"` is the only legal claim in this baseline).

## Providers (baseline scope: two well-documented exchanges)

| Provider | Feed | Maps onto | Timestamp convention | Declared order |
| --- | --- | --- | --- | --- |
| `binance-spot` | `binance.klines` (`GET /api/v3/klines`) | bar | epoch **ms**; close time is the *inclusive* last ms -> interval end = close + 1ms (declared conversion) | ascending |
| `binance-spot` | `binance.aggTrades` (`GET /api/v3/aggTrades`) | trade | epoch **ms**; `m` (buyer-maker) -> aggressor side (declared conversion) | ascending |
| `binance-spot` | `binance.bookTicker` (`GET /api/v3/ticker/bookTicker`) | **unmappable** | the response carries NO timestamp — the event-time basis is never invented (A7); mapping attempts are loud typed rejections | single |
| `coinbase-exchange` | `coinbase.candles` (`GET /products/{id}/candles`) | bar | epoch **SECONDS** (the classic unit trap — converted explicitly ×1000 behind a seconds-window check); rows carry only the bucket start -> interval end = start + declared granularity | descending (newest first; reversed deterministically) |
| `coinbase-exchange` | `coinbase.trades` (`GET /products/{id}/trades`) | trade | ISO-8601 UTC (µs truncated to the ms contract); `side` declared as the MAKER side -> aggressor = opposite | descending (reversed) |
| `coinbase-exchange` | `coinbase.ticker` (`GET /products/{id}/ticker`) | quote | ISO-8601 UTC; bid/ask/last carried, bid/ask sizes honestly absent (the endpoint has none) | single |

Record shapes are transcribed from the published API references on
**2026-10-07** (see each provider's `docs` declaration); the test fixtures
are hand-authored to those documented shapes, not live captures — every
fixture carries a provenance label, and a meta-test enforces the labeling.

## Modules

| Module | Owns |
| --- | --- |
| `errors.ts` | the typed violation taxonomy (unknown symbol, malformed record, missing field, out-of-range timestamp, unsupported/unmappable feed, invalid provider, interval-length mismatch) |
| `timestamps.ts` | the timestamp unit laws: epoch-ms / epoch-s / strict ISO-8601 UTC conversion with the loud sanity window (Bitcoin genesis floor, 2100 ceiling) that catches the classic s/ms swaps |
| `symbols.ts` | per-provider symbol tables; typed resolution (unmapped symbols are never silently dropped) |
| `providers.ts` | provider/feed descriptor types (polling + fidelity declarations), structural validation, the record-mapping context/result types |
| `binance.ts` / `coinbase.ts` | the two exchanges: raw documented shapes, pure per-record mappers, provider factories |
| `dataset.ts` | W020 `DatasetDescriptor` building: derived range (never claimed), adapter-detected bar-sequence holes declared as known gaps, honest limitations |
| `mapping.ts` | the batch engine: recorded payload -> records + descriptor + symbolMap (the exact `loadHistoricalDataset` input triple); declared-order normalization; collect-everything violations |
| `shape.ts` | internal shared validation helpers (canonical-decimal law reused from `tradrl-data`, OHLC consistency) |

## Laws

- **A7 (information boundary):** `occurredAt` is the record's event-time
  basis — trade/quote `timestamp`, bar `closeTime` — verbatim from the
  record fields under the feed's DECLARED unit convention. `availableAt` is
  carried from the record or omitted (no mapped endpoint declares delayed
  availability). Never invented, never defaulted.
- **Timestamp units are explicit per feed:** epoch-ms passes through
  verbatim; epoch-s converts ×1000 behind a seconds-window check; ISO-8601
  parses strictly (Z-form only, µs truncated to ms, component round-trip
  check). Values outside the loud sanity window (Bitcoin genesis .. 2100)
  are typed `timestamp-out-of-range` rejections — a unit swap is corruption,
  not a warning.
- **A9 (determinism):** every transform is pure — no IO, no clock reads, no
  RNG. Same (provider, feed, payload, context) => bit-identical mapping;
  dataset ids derive deterministically from (provider, feed, event-time
  span).
- **Honest symbol mapping:** the provider's table is a declaration; an
  unmapped exchange symbol is a typed `unknown-symbol` violation — records
  are never silently dropped, instruments are never invented.
- **Honest fidelity declarations:** what the provider gives, its known gaps
  (bookTicker has no timestamp; ticker has no sizes; candle rows carry no
  interval end), and every declared conversion (inclusive-close + 1ms,
  seconds ×1000, maker->aggressor, µs truncation) are stated in the
  provider descriptor and pinned by tests.
- **Collect-everything validation:** one pass reports every violation; a
  batch with any violation maps nothing. Residual stream-order garbage is
  NOT re-validated here — it surfaces as the W020 loader's typed
  `out-of-order-records` rejection (the adapter normalizes only the
  DECLARED provider order: newest-first feeds are reversed, ascending feeds
  untouched — the `sortHistoricalRecords` precedent).
- **Bar-sequence holes are detected and declared** as dataset known gaps
  (single-symbol batches; multi-symbol batches say so in the limitations) —
  an honest declaration of what the batch does not cover.

## Wiring into W020

```ts
const provider = binanceSpotProvider({ BTCUSDT: "instrument-btcusdt" });
const mapping = mapCryptoFeed(provider, "binance.klines", recordedRows, {
  symbol: "BTCUSDT", granularity: "1m", granularityMs: 60_000,
});
if (mapping.ok) {
  const outcome = loadHistoricalDataset({
    worldId, descriptor: mapping.datasetDescriptor,
    records: [...mapping.records], symbolMap: mapping.symbolMap,
  });
}
```

`mapCryptoRecord` is the pure single-record surface for the future
streaming fetch layer.

## Dependencies / environment note

Direct dependencies: `tradrl-world-contracts` (contracts) and `tradrl-data`
(W020 import surface). **Zero new third-party dependencies** — CCXT is the
register's approved crypto-adapter basis for the FUTURE live layer; this
fixture-based baseline needs none of it.

TL action items (root-manifest surfaces, deliberately untouched here):
1. Register the importer in `pnpm-lock.yaml` (the W020/3f75b68 precedent).
2. **Add `packages/tradrl-adapters/*` to `pnpm-workspace.yaml`'s `packages`
   globs** — the current `packages/*` glob does not match this
   two-level-deep package (W021 nautilus / W024 abides / W049 jax-lob sit
   in the same tree and will need it too).

Worktree stand-ins (untracked, never committed; symlink creation is blocked
in this sandbox — the W020 pattern): `node_modules/` inside this package
holds hardlink copies of the workspace packages for module resolution; the
sim's own `packages/tradrl-world-sim/node_modules/tradrl-world-contracts`
stand-in is an `.mjs` re-export shim (hardlink copies break tsx's transform
under worker threads — the shim keeps resolution outside `node_modules`).
