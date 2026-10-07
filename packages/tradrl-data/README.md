# tradrl-data — historical dataset/event import (W020)

Typed interfaces for importing **historical** market data (bars, trades,
quotes) into a world's journal as first-class events, plus the pure,
deterministic transforms and validation that turn typed historical records
into journal-ready event records.

**No fetching.** This package defines the import surfaces only — no network
IO anywhere. Real external datasets arrive through later adapters (W021
Nautilus catalogs, W026 crypto providers).

The record/descriptor/payload contracts live in the
`tradrl-world-contracts/data` export (`packages/tradrl-world-contracts/src/data.ts`
— W020's `contracts/data` surface); this package owns the import logic.

## Modules

| Module | Owns |
| --- | --- |
| `descriptor.ts` | dataset fidelity-declaration laws (source, range, known gaps, limitations, determinism) |
| `records.ts` | pure record helpers: event-time basis, extent, canonical-decimal law (parity-tested against the W014 kernel), exact decimal comparison, explicit deterministic sort |
| `validate.ts` | the complete import validator — every violation collected, typed, never silently dropped |
| `adapters.ts` | record → W004-envelope event draft mapping (symbol map, deterministic import identity) |
| `loader.ts` | `loadHistoricalDataset` — the deterministic loader (drafts + sealed records + W004 digest) |
| `errors.ts` | the typed `DatasetImportError` taxonomy (11 violation kinds) |

## Laws

- **A7 (information boundary):** `occurredAt` is the record's event-time
  basis (trade/quote `timestamp`; bar `closeTime` — an interval fact is
  complete when it closes). `availableAt` is carried **verbatim from the
  record** or omitted entirely — never invented, never defaulted. A declared
  `availableAt` before the basis is the typed
  `available-before-occurred` violation.
- **A9 (determinism):** the transform is pure — no IO, no clock reads, no
  RNG. Same input ⇒ bit-identical events (event/entry ids are the journal's
  deterministic functions of `(worldId, sequence)`; `recordedAt` is each
  event's own domain time; the import identity is derived from the dataset
  id). The W004 `eventStreamDigest` over the sealed envelopes is the
  machine-verifiable evidence.
- **Loud validation:** out-of-order records, overlapping same-symbol bars,
  unknown symbol mappings, malformed records (non-canonical decimals, bad
  bar interval/OHLC), missing trade aggressor side, duplicate source trade
  ids, records outside the declared range, records inside declared gaps,
  undeclared record kinds — every violation is collected and thrown as one
  typed `DatasetImportError`; nothing is ever silently dropped or reordered
  (`sortHistoricalRecords` exists for importers that must repair provider
  order — it is never applied implicitly).
- **Honest fidelity declarations:** a dataset descriptor declares its
  source, range, granularity, known gaps (half-open `[from, to)`),
  limitations and determinism declaration — and the loader validates the
  records against the declaration (coverage + gap honesty). Claims beyond
  the data are the descriptor author's responsibility; the mechanical
  contradictions are rejected.
- **A8/W016 discipline:** sealed records (envelope + payload + record) are
  frozen plain data — a record that entered any journal/snapshot prefix can
  never be mutated in place; `structuredClone` survives the import (the
  W018 transport discipline).

## Journal readiness (what "import into the journal" means here)

`loadHistoricalDataset` produces two journal-ready surfaces per import:

- `drafts` — `PendingEventDraft[]` (the `tradrl-world-sim` journal's append
  input): a world appends them through its journal, sequences continuing
  from the cursor. Proven by tests: a real `createEventJournal().append(...)`
  seals envelopes bit-identical to the records path, and the journal's own
  stream laws keep governing imported data.
- `records` — sealed `JournalRecord[]` (dense sequences from 1, deterministic
  `eventIdFor`/`entryIdFor` ids): directly restorable through
  `createEventJournalFromRecords` (the W016 restore path) and storable as a
  snapshot's journal prefix (proven by tests against a real
  `buildWorldSnapshot`/`verifyWorldSnapshot`).

**Engine-boundary honesty:** the `tradrl-world-sim` reducers verify event
producers per their own laws (matching/generator market facts fail closed on
foreign producers — by design since W017). Imported events carry the
`historical-data-import` producer, so ENGINE-level replay of imported market
events is the W021 adapter surface's concern (its worlds own how historical
facts reduce). W020 delivers journal-level readiness — the W013 journal and
W016 snapshot/restore surfaces above — which is exactly what this work order
owns. The imported event taxonomy rides the W004 canonical types for quotes
and trades (`market.quote.updated`, `market.trade.printed`) plus the
W020-owned `market.bar.closed` extension declared in `contracts/data`.

## Environment note (worktree shim)

`packages/tradrl-data/node_modules/` is an UNTRACKED worktree stand-in (the
W008/W011 pattern): `tradrl-world-contracts` is a shim re-exporting the real
worktree sources (it adds the `./data` subpath the real exports map does not
carry yet) and `tradrl-world-sim` is a hardlink copy. Neither is committed.
Registering the real `"./data": "./src/data.ts"` exports entry and the
`tradrl-data` importer in `pnpm-lock.yaml` are TL action items (the W013
precedent).
