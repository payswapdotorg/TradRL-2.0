# tradrl-adapters-arena (W057)

The Arena capability-provider adapter: the FIRST CONCRETE provider over
the W056 provider-neutral `capability-provider` interface (the W024
abides clean-room adapter precedent, the `packages/tradrl-adapters/*`
flat source-exported layout). Spec: REQUIREMENTS.md R055 — "Arena is
optional": the Arena is ONE optional provider, an equal member of the
pluggable provider class; the arena-specific vocabulary (venue kinds,
round kinds, measurement regimes, leaderboard styles) is declared HERE
and ONLY HERE, as closed sets with fail-closed validation — that is the
point of provider-neutrality.

## Clean-room provenance (the license law)

`spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md` carries **NO Arena entry**:
the Arena is this repository's own venue concept, and this adapter
invents no third-party dependency. It is a clean-room, original
TypeScript implementation of the documented public semantics of a
capability arena — a venue that schedules rounds of MEASUREMENT over
measured-evidence citations (W037/W038 artifacts, re-proved at the W040
gate), under declared measurement regimes, with leaderboard-style
rankings carried as data. No upstream arena code exists to copy; nothing
external was fetched, read, or ported. **Zero third-party code; zero
register obligations triggered.**

## What this package OWNS

- The arena closed vocabularies, declared here and only here: venue
  kinds (`continuous-session` / `periodic-batch` / `staged-elimination`),
  round kinds (`screening` / `trial` / `final`), measurement regimes
  (`single-evaluation` / `consensus-of-evaluations`), leaderboard styles
  (`full-roster` / `top-k`) — closed sets, fail-closed at every seam.
- `registerArenaProvider` — the adapter's registration gate: the arena
  structure and closed-set laws first (round sequences strictly
  increasing, round citations real, the regime-vs-evidence law, the
  top-k laws), then W056's `registerProvider` run VERBATIM over the
  projected provider-neutral declaration (identity/scope/lineage/offers
  — the neutral vocabulary ONLY), its errors carried verbatim. R052 is
  enforced at THAT gate and never bypassed or weakened here.
- The identity family: the opaque content-addressed arena id
  (`arena-<digest>` over the recorded provider id + the canonical venue
  + the per-offer regimes) and round ids (`arena-round-<digest>`).
- `arenaCapabilityProvider` — the concrete `CapabilityProviderPort`:
  `listOffers` in canonical offer-id order, `describeOffer` by exact id,
  `provenanceOf` (the measured citations), all fail-closed, in-memory,
  pure (A9).
- `adjudicateArenaOffers` — W056's `matchProviderOffers` delegated
  VERBATIM (W040's evidence lines and refusal reasons carried, the
  content-addressed adjudication id untouched).
- `projectArenaLeaderboard` — the arena ranking projection: carried data
  ordered by CANONICAL OFFER IDS, never a re-scored statistic; a top-k
  leaderboard keeps the first k entries of the canonical order.
- `validateArenaRegistration` — the whole registration re-proved from
  its recorded data (closed sets, round laws, citations, canonical
  order, both id derivations) with W056's
  `validateProviderRegistration` carried verbatim.

## What this package does NOT own

- NO marketplace, entitlements, pricing or access semantics — W058's
  lane, on the same provider seam.
- NO arena round EXECUTION: the adapter composes typed data (A14); it
  never runs a round, never scores, never calls a network, no I/O, no
  clocks, no randomness, no env reads (A9).
- NO neutral-interface changes: `packages/capability-provider` and
  `contracts/capability` are frozen to this package — imported, never
  modified, never re-declared. The projected provider declaration
  carries the neutral vocabulary only; the arena vocabulary never leaks
  into the neutral layer (the forbidden-key laws, test-pinned).
- NO re-scoring, ever: rankings order carried data by canonical ids;
  deprecated/revoked offers fail loudly through W040's own refusal
  reasons, carried verbatim.
- NO reference journey / endowment execution — W064's lane builds on
  the provider seam this adapter demonstrates.

## Layout (the W024 abides / W041 template)

`arena-identity.ts` (the closed vocabularies + the opaque id family + the
canonical derivations), `arena-registration.ts` (the DATA + typed error
family + the gate), `arena-provider.ts` (the concrete neutral port),
`arena-adjudication.ts` (the verbatim delegation + the ranking
projection), `validate.ts` (whole-registration re-validation),
`index.ts`, `test/` (node:test + node:assert/strict over REAL imports —
real W040 registrations, real W056 gate runs, real W037/W038 evidence
chains; no shims).
