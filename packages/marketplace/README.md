# marketplace (W058) — the marketplace contract

A provider's measured offers surfaced commercially, as typed DATA. This
package COMPOSES the empirical chain's records into the commercial layer:
**listings** and the deterministic **catalogue** over them.

## The chain it builds on (imported, never modified)

- **capability-provider (W056)** — the provider-neutral registration:
  `ProviderRegistration` (offers carrying the W040 descriptor vocabulary
  + the measured provenance the W040 gate re-proves). The listing cites
  the registration VERBATIM and re-proves it through W056's own
  `validateProviderRegistration`.
- **capability-registry (W040)** — the descriptor vocabularies, the
  lifecycle (`registered`/`deprecated`/`revoked`), `resolveCapability`,
  and the house `stableDigest` content-addressing family.

## What it OWNS

- **The Listing record** — the cited W056 registration carried VERBATIM
  (its offers ARE the listing's commercial surface — never re-declared),
  the licensing terms as data, the §14 scope carried from the
  registration, the immutable lineage, the deterministic provenance, the
  content-addressed `mkt-<digest>` id (weighing the WHOLE carried
  registration + terms + scope + lineage — any differing byte is a
  different listing, A9).
- **`listOffer(registry, declaration, known?)` — THE GATE.** The
  registration re-proven through W056's own validator with the registry
  supplied (errors carried VERBATIM — **R052 carried, never bypassed**:
  an unmeasured offer surfaces as W056's own `unmeasured-offer` inside
  `provider-registration-invalid`); every offered capability proven LIVE
  in the registry (**the W040 lifecycle carried verbatim —
  deprecated/revoked refused loudly**); the terms validated (the closed
  `LICENSING_MODELS` / `BILLING_PERIODS` vocabularies + the structural
  price laws — declared HERE and only here, the W057 arena-identity
  precedent); the lineage laws (shape, parent existence, version
  continuity, duplicates).
- **The catalogue** — `assembleCatalogue` (whole-record re-validation,
  duplicate refusal, canonical listing-id order — input order never
  leaks) + the deterministic queries (`listingsByProvider`,
  `listingsByOffer`, `listingsByScope`, fail-closed `resolveListing`).
  Answers are CARRIED listing records, never re-scored statistics.
- **`validateListing(listing, registry?)`** — the whole-record
  re-validation: id + provenance re-derived from the record's own bytes,
  terms/scope/lineage laws re-proved, W056 re-proof carried verbatim;
  with a registry supplied, the W040 liveness law is re-proved too.

## What it does NOT own (A14 — composes typed records, no execution)

- **NO commerce execution** — no charging, no checkout, no order
  records. The terms are DATA the runtime consumes.
- **NO payment** — the price is a declared member of the terms, never
  executed.
- **NO metering** — no usage counting, no consumption records.
- **NO entitlements** — who may use a listed capability is the
  `entitlements` package (W058's sibling contract).
- **NO security** — access control, authentication, authorization are
  W060's lane.
- **NO provider execution, NO I/O, NO clocks** — pure typed-data
  composition only.

## Disclosed design decisions

- `listOffer` takes `(registry, declaration, known?)` rather than the
  order's literal `(registration, terms)`: the W040 lifecycle law needs
  the caller's CURRENT registry (the W056 `registerProvider` positional
  precedent), and the immutable lineage must be declarable (the
  `ListingDeclaration` object, defaulting to genesis).
- The listing id weighs the WHOLE carried registration verbatim (the
  W054 whole-payload precedent), making the record self-contained
  tamper-evident; W056's own re-proof remains the deeper structural
  layer.
- `validateListing` without a registry re-proves every record law except
  liveness (the W056 disclosure pattern: a later deprecated/revoked
  state is a legitimate LATER registry state — the seams that hold the
  current registry re-prove it loudly).
- The lineage parent-existence law needs the caller's known listings, so
  shape laws only are re-proved in `validateListing` (the W056
  provider-lineage disclosure, verbatim).

License: Apache-2.0 (the repository LICENSE).
