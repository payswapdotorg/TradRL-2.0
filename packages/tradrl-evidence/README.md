# tradrl-evidence — evidence/provenance projection (W028)

The auditability spine of Trader World Alpha: **pure projections** over a
world's journal and its imported sources that yield the **EVIDENCE VIEW** —
which facts (journal events) cite which sources (artifact/dataset/record
identities), the deterministic digest chain linking projections to their
inputs, and a typed query surface for provenance lookups.

This package NEVER mints facts and NEVER invents citations. Every link comes
from a surface the inputs already declare; an event with no declared source
carries the honest `no-declared-source` marker, never a fabricated one.

## Where the citation link comes from (honesty first)

- **W027 information events** (`information.*.published`, producer
  `information-data-import`) carry the stable typed
  `InformationArtifactIdentity` — artifact id, dataset id, record digest —
  ON THE PAYLOAD (the W028 seam W027 declared), identical across the
  definition-artifact channel and the journal-event channel. That payload
  identity IS the citation (basis `payload-identity`), with the payload's
  declared source/credibility carried along verbatim.
- **W020 historical-import events** (`market.quote.updated`,
  `market.trade.printed`, `market.bar.closed`, producer
  `historical-data-import`) carry NO per-record identity on the payload (the
  W004 canonical payloads). The dataset identity is declared by the import
  CAUSATION `import:<datasetId>` that the W020 adapter stamps on every
  imported event — an honest **dataset-level** citation (basis
  `import-causation`). The current W020 surface exposes no per-event record
  digest, so none is invented.
- **Everything else** (engine core, matching, generator, clock …) declares
  no imported source: the honest `no-declared-source` marker. The envelope's
  own causation (command or import) is carried verbatim on the evidence
  record, never interpreted into a citation.

## The projection

`projectEvidence({ worldId, records, artifacts?, datasets?, asOf? })` → the
evidence view (plain frozen data; `structuredClone` survives — the W018
transport discipline):

- `events` — one `EventEvidence` per journaled event, sequence order: the
  sealed envelope verbatim, its citation, its content digests and its chain
  link;
- `artifacts` — the artifact identity registry (provided ∪ cited),
  deterministic (datasetId, artifactId) order, each with its citing events
  (empty = honestly uncited) and the verbatim artifact record when provided;
- `datasets` — the dataset registry (provided ∪ cited), each echoing its
  descriptor (when given), its artifacts and its citing events;
- `chain` — the digest chain (below);
- `summary` — honest counts, including events withheld by the A7 firewall.

**A7**: when `asOf` is given, the information firewall applies to evidence
reads exactly as it applies to the W016 EvidencePort — events before their
observation time and artifacts before their `availableAt` are withheld and
counted (`withheldEventCount`), never partially leaked. Without `asOf` the
projection is the full-audit view.

**Violations are loud and complete** (`EvidenceProjectionError` with EVERY
violation, never a partial projection): world mismatches, W004 stream-law
violations, malformed/missing W027 identities, unresolvable W020 import
causations, ambiguous artifact ids, duplicate dataset ids.

## The digest chain

`chain.inventoryDigest` commits to the declared source inventory (world,
`asOf`, descriptors, artifacts — canonical, deterministic order);
`chain.links[i]` commits to the previous link, the WHOLE event envelope and
its citation; `chain.head` is the content address of the view (A9: same
inputs ⇒ same chain, bit-for-bit — the W016 hashing family, so digests agree
with the engine's own content addressing).

`verifyEvidenceChain(view)` recomputes everything locally — tamper evidence:
a rewritten envelope, an edited citation (even with a consistently updated
digest — the envelope is the truth and the citation is re-resolved from it),
a swapped link, a forged head or a truncated list is caught at the exact
index. Only rewriting the frozen journal itself (A8) changes the head — and
that is detectable against any recorded head.

## The typed query surface

`createEvidenceQuery(projection)`:

- `getEventEvidence(eventId)` / `getArtifactEvidence(artifactId)` /
  `getDatasetEvidence(datasetId)` — lookups by event, by artifact, by
  dataset; **unknown ids throw `UnknownEvidenceEntityError`**, never an
  undefined, never an empty list that looks like "cited by nothing"
  (known-but-uncited is a different, honest state);
- `getUncitedEvents()` — the no-declared-source audit channel;
- `listEvents({ citationKind, producer, types })`;
- `getChain()` / `verifyChain()` / `getSummary()`;
- `toProvenanceRecord(eventId)` — the W003 `ProvenanceRecord` projection
  (the shape the W016 EvidencePort's `getProvenance` returns), extended with
  the artifact input imported information events declare. The engine-port
  agreement is proven by tests; wiring it INTO the port is a
  contracts/sim change that stays TL-owned.

## Modules

- `citations.ts` — the pure citation law (envelope → citation or violation);
- `chain.ts` — the digest chain + local verification;
- `projection.ts` — `projectEvidence` (the evidence view);
- `query.ts` — the typed lookup surface + the provenance bridge;
- `errors.ts` — `EvidenceProjectionError` / `UnknownEvidenceEntityError`.

The identity/descriptor/payload contracts live in `tradrl-world-contracts`
(`./data`, `./information-data`); the journal records and the hashing family
live in `tradrl-world-sim`. Runtime dependencies: those two packages only
(`tradrl-data` / `tradrl-information` are test-only dependencies — the test
suites import the REAL loaders so every citation in the happy path comes
from genuinely imported events and artifacts).

## Honest limitations

- Dataset-level citations for W020 events (no per-record digest on that
  surface — never invented; a future contracts change could add record
  identities to W020 payloads and the citation law would extend).
- Hand-authored W004 news artifacts (no payload identity) are world-authored
  content, not imported sources: they do not enter the artifact registry.
- Engine-level REPLAY of imported events is W021's surface (the reducers
  fail closed on foreign producers by design); this package projects the
  journal — the authoritative history — which the loaders, journals,
  snapshots and the engine surface all expose as records.
- The projection is a pure function: it is NOT wired into the engine's
  `EvidencePort` here (that integration is a contracts/sim change — TL
  action item; the bridge shape is proven by tests).

No network IO, no clock reads, no RNG (A9). Everything is a deterministic
transform over already-journaled/declared data.
