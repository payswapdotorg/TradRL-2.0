# tradrl-information (W027)

Research/news/event information import — the W020 `tradrl-data` pattern
applied to the information world.

## What this package owns

- **Typed information datasets** (`tradrl-world-contracts/information-data`):
  dataset descriptors with honest fidelity declarations (source, range,
  publication cadence, known gaps, limitations, determinism — A9), record
  shapes for research reports, news items, events and analyst notes whose
  `publishedAt`/`availableAt` come from the record (A7), source credibility
  classes + record confidence levels (declared by the importer, never
  fabricated), the imported-artifact payload taxonomy, and the
  `InformationArtifactIdentity` seam (artifact id, dataset id, record
  digest) the W028 evidence/provenance projection cites.
- **The import logic** (this package):
  - `descriptor.ts` — descriptor fidelity-declaration laws;
  - `records.ts` — pure record helpers (kind guards, the event-time basis,
    the canonical decimal text law, the deterministic sort helper);
  - `validate.ts` — the complete validator: every violation collected
    loudly (unknown source, unknown symbol, malformed record,
    `availableAt` before `publishedAt`, out-of-order records, declared
    range/gap contradictions, duplicate record ids) — never a silent drop;
  - `adapters.ts` — one pure record → artifact + journal-draft mapping:
    the PUBLICATION-TIME LAW (`availableAt` = the record's declared delay,
    or its `publishedAt` when undelayed — never invented), credibility
    resolved from the declared source map, one shared frozen payload across
    both channels, and `toDefinitionInformationArtifacts` (the
    identity-preserving view onto `WorldDefinition.informationArtifacts`);
  - `loader.ts` — the deterministic loader: world information artifacts +
    engine-appendable drafts + sealed journal records (W016 restore path)
    + the W004 stream digest;
  - `errors.ts` — the typed error taxonomy.

## Laws (mirrored from the W020 surface, applied to information)

- **A7**: availability is part of the record. `availableAt` is carried
  verbatim on journal events and mapped onto artifacts by the
  publication-time law; an artifact is observable exactly from its
  `availableAt` (the W004 firewall governs the imported set unchanged).
- **A9**: the import is a pure function of (world id, descriptor, records,
  source declarations, symbol map) — same input ⇒ bit-identical artifacts,
  events and digest.
- **Honesty**: credibility/confidence are declared, never assigned; unknown
  sources, unresolvable symbols and contradictory declarations are typed
  violations, never silent defaults.
- **Provenance**: every imported event's producer is
  `information-data-import`; every payload carries the stable identity W028
  will cite (that projection itself is W028's surface, not built here).

## No fetching

This package performs zero network IO. Real research/news feeds arrive
through future provider adapters; everything here is a deterministic
transform over already-obtained records.
