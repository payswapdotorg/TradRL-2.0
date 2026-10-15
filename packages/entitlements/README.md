# entitlements (W058) — the entitlement contract

Who — tenant/principal scope — may use which listed capability, under
which terms, for which declared period, as typed DATA. This package
COMPOSES the marketplace's listings into typed grant records and the
PURE grant-check over them.

## The chain it builds on (imported, never modified)

- **marketplace (W058 sibling)** — the Listing + the licensing terms.
  The grant re-proves the cited listing through the marketplace's OWN
  `validateListing` (errors carried verbatim — R052 rides there, never
  bypassed) and re-proves the terms through the marketplace's OWN
  `validateLicensingTerms`.
- **capability-provider (W056)** — the `ProviderOffer` carried verbatim
  by every grant (A6: the grant cites the commercial surface it answers).
- **capability-registry (W040)** — the house `stableDigest`
  content-addressing family (the ent-<digest> id and the canonical terms
  comparison).

## What it OWNS

- **The Entitlement record** — the content-addressed `ent-<digest>` id,
  the cited listing id, the granted offer carried VERBATIM, the grantee
  principal scope, the grant's terms, the declared period, the immutable
  versioned lineage, the deterministic provenance.
- **R056 enforced STRUCTURALLY** — the TENANT is part of the
  entitlement's canonical identity: the id is minted over a canonical
  form whose grantee tuple is `[tenantId, principalId]` with the TENANT
  FIRST. Identical grants under different tenants are DIFFERENT
  entitlements. A cross-tenant USE is the loud typed `cross-tenant`
  refusal naming R056 — never a silent denial.
- **`grantEntitlement(input, known?)` — THE GATE.** The listing
  re-proven through the marketplace validator (errors carried
  verbatim); the granted offer resolved by EXACT id from the listing's
  own recorded offers (fail-closed `unknown-offer`); the terms validated
  (closed vocabularies) and proven in agreement with the listing's own
  (loud `terms-mismatch` — a grant is UNDER the listing's terms, never
  beside them); the principal scope typed (tenant explicit — §14, never
  blank); the period validated (the closed declared-time vocabulary:
  `fixed-window` over safe non-negative integer ticks with a non-empty
  window, or `perpetual`); the lineage laws (shape, parent existence,
  version continuity, duplicates).
- **`verifyEntitlement(entitlement, use)` — the PURE grant-check.**
  Scope match (cross-tenant → R056 loudly), capability match, period
  coverage (inclusive bounds over declared ticks), terms agreement —
  every mismatch a typed reason, all collected, none dropped. The
  record's own identity is re-proved first (a rewritten record is
  refused loudly).
- **`validateEntitlement(entitlement)`** — the whole-record
  re-validation: id + provenance re-derived from the record's own bytes,
  scope/terms/period/lineage laws re-proved.

## What it does NOT own (A14 — composes typed records, no execution)

- **NO commerce execution** — granting a typed record is not charging.
- **NO payment** — the terms are data; no money moves here.
- **NO metering** — no usage counting; `verifyEntitlement` answers the
  pure grant-check, it does not record the use.
- **NO security** — authentication/authorization infrastructure is
  W060's lane; this contract defines the typed grant-check W060 builds on.
- **NO enforcement runtime, NO I/O, NO clocks** — the use's time is
  DECLARED data (the closed period vocabulary); pure composition only.

## Disclosed design decisions

- `grantEntitlement` takes a single `EntitlementGrantInput` (the W053
  single-input-object gate convention) + `known`, rather than the
  order's literal `(listing, principal, terms, period)`: the grant must
  name WHICH listed capability it covers (`offerId`) and must declare
  its lineage for renewals.
- The grant's terms must EQUAL the listing's terms (deep canonical
  comparison — "under which terms" means the listing's own terms,
  carried verbatim into the grant; a differing terms input is the loud
  `terms-mismatch`, never a silent re-interpretation).
- The entitlement deliberately does NOT require the grantee's tenant to
  equal the listing's (measurement) tenant: the marketplace is the
  commercial surface across tenants, while every entitlement — and
  therefore every lawful USE — stays confined to its own grantee tenant
  (R056 at the identity + verification level, exactly the law the order
  digest names).
- The carried offer's deep validity was proven at the gate through the
  cited listing; whole-record re-validation weighs the offer's bytes
  verbatim (the W054 whole-payload precedent) so any tamper is an
  `entitlement-id-mismatch`.
- The lineage parent-existence law needs the caller's known
  entitlements, so shape laws only are re-proved in
  `validateEntitlement` (the W056/marketplace disclosure pattern).

License: Apache-2.0 (the repository LICENSE).
