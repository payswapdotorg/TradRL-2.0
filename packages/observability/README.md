# observability (W061)

The typed TELEMETRY + AUDIT contracts — the observability/audit vocabulary of
TradRL 2.0 as **pure data contracts** (the W035–W059 flat source-exported
package pattern).

## What this package OWNS

- **`events.ts`** — the operational event vocabulary: the closed event-kind
  set with TYPED payloads (one payload shape per kind), the closed actor
  vocabulary, the **§14 explicit scope** (W059's own closed route-scope
  hierarchy, imported from `api` — never re-declared), DECLARED timestamps
  (`declaredAt` is data the caller carries — never a clock read, A9),
  content-addressed event ids (`oev-<digest>`), the fail-closed construction
  gate, and the operational **health/traffic descriptors as data** (declared
  statuses and counts — no probing, no thresholding).
- **`audit.ts`** — the `AuditRecord` contract: immutable, append-only records
  citing **W028 provenance** (`tradrl-evidence`'s `SourceCitation` — an
  artifact identity, a dataset identity, or the honest `no-declared-source`
  marker; **a record without provenance is refused**), content-addressed
  record ids (`aud-<digest>`), and the audit-trail lineage laws: the
  append-only gate (`appendToTrail` — duplicate ids and non-successive
  sequences are loud typed violations) and the hash-chained digests **as
  data** (`auditLinkOf` commits to the previous link, the record's content
  digest and the record's citation digest through W028's own
  `citationDigestOf`).
- **`validate.ts`** — whole-record re-validation: every shipped record's id
  is **re-derived** from its own content — a rewrite (§14's loud violation)
  is caught here — and every construction law re-proven, provenance
  included.
- **`index.ts`** — the public surface + the **operations route declarations**
  (the ops surface): every ops route as typed data, aligned with W059's
  route-table vocabulary (its closed method set, its §14 scope hierarchy
  materialized as path parameters through its own `parsePathPattern`, its
  provenance-citation response law) with a fail-closed route gate.

## What this package does NOT own (by law)

- **No scraping, no serving, no alerting** (A14): it composes typed records.
  No metrics collection, no dashboards, no notifications, no HTTP.
- **No production deployment** — W062 owns serving/transport; W060 owns
  authn/authz execution; W063 owns benchmark publication.
- **No trail assembly engine, no report composition** —
  `services/operations` (W061's sibling) owns the pure record machinery.
- **No provenance resolution** — W028 (`tradrl-evidence`) owns the citation
  law; this package only CARRIES and guards its vocabulary.
- **No route serving** — W059 (`services/api`) owns the route table; the ops
  routes here are declarations that align with it (W059's
  `RoutePayloadTypeName` is closed and frozen — the ops surface carries its
  own closed payload names over the same route shape; disclosed deviation).

## Determinism (A9)

Same declaration ⇒ same id, always. Same records ⇒ same chain, always. No
clocks, no randomness, no environment reads — every timestamp is DECLARED
data. Canonical orders are code-unit comparisons, never locale-sensitive.

## Consumers

- `services/operations` (W061) — the trail assembly/verification + report
  composition machinery over these contracts.
- W062 (production deployment) renders the ops routes; W063 (benchmark
  publication) builds on the reports; W064's journey + W065's shadow adapter
  cite the audit surface.

License: Apache-2.0 (the repository LICENSE).
