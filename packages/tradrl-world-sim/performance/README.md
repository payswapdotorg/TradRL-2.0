# W030 `performance` — streaming projection coalescing

The projection coalescer for high-frequency world event streams: **N journal
events between two observation points ⇒ ONE coalesced projection per surface**
— semantically identical to reading the last state (spec/WORLD-PROTOCOL.md
"UI projection law": projections may batch/conflate/drop stale display frames,
never fabricate financial facts).

## The law this package implements

The coalescer tracks DIRTINESS (which (surface, key) pairs changed and how
many events piled up) and WINDOW BOUNDS (how stale a key may get before a
drain is forced). It never holds, merges or fabricates projection values: at
every observation point (`drain`) the refreshed view IS the latest projection
— a fresh port read through the same QueryPort every other consumer uses
(A6/A7 hold by construction). A blend of intermediate states would be a BUG,
and the equivalence property tests catch it.

## Modules

| Module | What it owns |
| --- | --- |
| `surfaces.ts` | The coalescable surface table (quote/orderbook/trades/orders/positions/portfolio/risk/news/timeline), the key kind per surface, and the event→surface dirty mapping over the alpha engine's CLOSED event taxonomies. Every journaled event extends the timeline (the journal's own projection). Unknown event types FAIL-SAFE: every configured/observed surface is dirtied (never stale). |
| `coalescer.ts` | The pure, deterministic state machine: typed config (windows/keys per surface) with LOUD validation (every issue, typed, all at once), `ingestEvent`/`ingestPublication`/`ingestClock`, window-overflow hints, `drain()`/`drain({force})` with canonical order (surface table order, keys in first-touch order). |
| `reads.ts` | The drain read binder: ONE port read per drain entry, sequential awaits in drain order, fresh values. Fail-closed typed errors carrying the entry. |

## Config (typed, loud)

```ts
createProjectionCoalescer({
  surfaces: {
    quote:      { window: { maxEvents: 64, maxSimMs: 5_000 }, keys: ["instrument-es-x"] },
    orderbook:  { window: { maxEvents: 64, maxSimMs: 5_000 }, keys: ["instrument-es-x"] },
    orders:     { window: { maxEvents: 32 }, keys: ["account-trader-x"] },
    timeline:   { window: { maxEvents: 256 } },
  },
});
```

- `window.maxEvents` (integer ≥ 1; 1 = the degenerate no-coalescing config)
  forces a drain once that many events touched one key since its last
  refresh; `window.maxSimMs` (finite > 0) bounds the `occurredAt` span.
  At least one bound is required — an unbounded window is a config bug.
- `keys` restricts a surface to declared ids (the pane's instruments/accounts).
  Undefined = every key the stream produces (first-touch discovery).
- Declared keys (and world-keyed surfaces) start dirty: the first drain is
  the initial refresh (the W009 feed's attach fetch).
- A settled clock observation (`ingestClock`) dirties every existing key of
  every configured surface: clock motion changes asOf-stamped and
  availableAt-gated projections (conservative, honest).

## Honest limitations (disclosed)

- The dirty mapping is precise over the alpha engine's closed taxonomies
  (world core + matching + generator). An UNKNOWN event type dirties every
  configured surface — correct but uncoalesced for future producers until
  they are mapped.
- Venue-scoped halts/reopens dirty every SEEN instrument key (the coalescer
  cannot see world definitions; the alpha generator emits instrument-scoped
  halts).
- The overflow hint (`ingestEvent`'s return) is a HINT for the host to
  schedule a drain; the coalescer is pure and never drains implicitly.

## Tests (`test/`, run from `packages/tradrl-world-sim`)

```
../../node_modules/.bin/tsx --test performance/test/*.test.ts
```

- `coalescer.test.ts` — loud validation (every issue kind), the dirty-mapping
  pins per event type, window laws (overflow exactly once, reset on drain),
  clock observations, canonical drain order, key filtering/discovery, the
  fail-safe unknown-type law.
- `equivalence.test.ts` — the product law, on LIVE streams over the real W017
  generated market: at every observation point each dirty entry's value
  deep-equals the raw consumer's current value; the final forced drain covers
  every key and deep-equals the raw final state. A7: the coalesced tape is
  exactly the observable prints at the observation point.
- `compression.test.ts` — honest COUNTS (never wall-clock): strictly fewer
  port reads and intermediate states; one read per key per drain; the read
  count scales with the observation window, not the signal rate; lossless at
  the observation points; the per-signal degenerate policy refreshes only
  what the signals dirtied.
- `determinism.test.ts` — A9: twin runs produce identical drain batches AND
  values; wall axes a day apart coalesce identically (wall time never
  enters); the published channel stays lossless through the coalescer's
  inputs (ingested events == journal events).
