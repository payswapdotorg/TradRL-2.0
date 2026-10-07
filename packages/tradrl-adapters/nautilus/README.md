# tradrl-adapters-nautilus (W021)

The NautilusTrader high-fidelity replay adapter: maps NautilusTrader-style
historical data (the W020 import surfaces) into world journals at HIGH
fidelity — bar/trade/quote record mappers for Nautilus's documented dtype
shapes, dataset descriptors that declare the fidelity honestly (what is
preserved, what is approximate — never claimed beyond the data), and the
replay-path alignment (a W031 CLI `datasets` declaration runs a Nautilus
dataset through a world; see `test/cli.e2e.test.ts`).

## The three dtype mappers (the documented shapes)

| dtype | documented fields | maps to |
| --- | --- | --- |
| `nautilus.bars` (Bar) | `bar_type`, `open/high/low/close`, `volume`, `ts_event`, `ts_init` | W020 `HistoricalBarRecord` |
| `nautilus.trade_ticks` (TradeTick) | `instrument_id`, `price`, `size`, `aggressor_side`, `trade_id`, `ts_event`, `ts_init` | W020 `HistoricalTradeRecord` |
| `nautilus.quote_ticks` (QuoteTick) | `instrument_id`, `bid_price/ask_price`, `bid_size/ask_size`, `ts_event`, `ts_init` | W020 `HistoricalQuoteRecord` |

`nautilus.order_book_deltas` (OrderBookDelta) is declared UNMAPPABLE by this
baseline: a book delta is a level-change event, not a top-of-book
observation; mapping it would require reconstructing book state — never
guessed here. Every attempt is a loud typed `unmappable-dtype` rejection.

## The declared conversions (every one tested)

- **ns → ms, explicitly and loudly** (the classic silent-corruption site):
  all timestamps are UNIX epoch NANOSECONDS int64 (`ts_event`/`ts_init`);
  converted to epoch-ms by exact digit truncation with a 1990..2100 sanity
  window — a milliseconds/microseconds/seconds value in an ns field lands
  below the floor and is rejected with the raw value in the detail text.
- **int64 precision honesty (disclosed, never hidden)**: epoch ns exceeds
  IEEE-754 safe-integer range. The converter accepts STRING digits
  (full int64 fidelity — the preferred export form) and integer-valued
  numbers; JSON number parsing may round an int64 ns value before this
  adapter sees it (undetectable) — the fidelity declaration says so.
- `ts_event` is the dtype's event time (bars: the interval start — the
  exchange-kline wrangler convention; ticks: the tick time).
- `ts_init` (object initialization) maps to `availableAt` — availability is
  part of the record (A7), boundary-checked to never precede the event-time
  basis.
- Bar interval end is DERIVED from the `bar_type` step+aggregation
  (SECOND/MINUTE/HOUR/DAY); irregular aggregations (TICK/VOLUME/NOTIONAL/
  DOLLAR/OPEN_INTEREST) REQUIRE a declared `granularityMs` — never invented.
- `bar_type` parses from the RIGHT (the `instrument_id` itself contains a
  dash: `<SYMBOL>-<VENUE>`).
- float64 columns convert to canonical decimal text via the shortest
  round-trip decimal representation (deterministic); exponent forms and
  >12 fraction digits are rejected loudly — never silently rounded.
- `aggressor_side` "BUY"/"SELL" maps to buy/sell; `trade_id` (int64 catalog
  form; the legacy string export form accepted verbatim) becomes the W020
  `tradeId`.
- Catalog partitions are ascending by event time and are NEVER re-sorted;
  residual order garbage surfaces as the W020 typed `out-of-order-records`
  rejection at import.

## Honest dataset descriptors (the fidelity declarations)

`buildNautilusDatasetDescriptor` derives the range from the records
(computed, never claimed), DETECTS bar-sequence holes and declares them as
known gaps, and carries the limitations channel: the ns→ms truncation, the
int64/JSON precision reality, the no-`last` QuoteTick gap, the irregular-
aggregation gap, the unmappable OrderBookDelta declaration, and the
baseline's own disclosure (fixture batch, no parquet IO).

## No new dependencies (the lockfile is a TL action item)

This baseline is fixture-based: dtype shapes are transcribed from the
published NautilusTrader documentation (snapshot `2026-10-07`, labeled in
every fixture's provenance) and hand-authored into labeled fixtures. The
real `nautilus_trader`/parquet catalog reader is a disclosed TL action item
per `spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md` — never silently claimed (the
catalog descriptor's `acquisition.parquetCatalog` is enforced to stay
`"not-implemented"`).

Like W026/W027, this package is not yet in `pnpm-lock.yaml` (the lockfile
is a frozen root file — a TL action item); tests/typecheck run against
package-local `node_modules` hardlink shims of the workspace packages
(`tradrl-world-contracts`, `tradrl-data`, `tradrl-world-sim`,
`tradrl-information`, and `tradrl-world-cli` for the CLI end-to-end test).

## Invocations (disclosed)

```bash
cd packages/tradrl-adapters/nautilus
../../../node_modules/.bin/tsx --test test/*.test.ts   # 88 tests
../../../node_modules/.bin/tsc -p .                    # EXIT 0
```
