# capability-provider (W056)

The provider-neutral capability-provider interface — the seam through
which EXTERNAL capability providers plug into the empirical chain (the
W035–W041 flat source-exported pattern). REQUIREMENTS.md R055 — "Arena
is optional": providers are a PLUGGABLE class, every member of which is
EQUAL at this surface; REQUIREMENTS.md R052 — offers carry MEASURED
provenance re-proved the way W040 proves its own; REQUIREMENTS.md R053 —
offers feed the W039 demand-matching seam through deterministic
adjudication. The canonical type-only contract surface this package
satisfies lives in `contracts/capability/` (the contracts/ui precedent);
`test/contract.test.ts` guards the drift.

## What this package OWNS

- **The registration DATA** (`identity.ts`, `registration.ts`): the
  opaque canonical provider id (`provider-<digest>`,
  content-addressed over display identity + scope + lineage + the
  offers' canonical inputs), the opaque offer id (`offer-<digest>` — the
  W040 capability digest in the offer namespace, plus the endowment
  skill ids), the content-addressed adjudication id, and the recorded
  `ProviderRegistration`: display identity, explicit scope, the offers
  in canonical offer-id order (each: the W040 descriptor vocabulary
  typed VERBATIM — kind/domain/bearer — the measured provenance carried
  from the W040 descriptor, the W041 endowment citations, the per-offer
  lifecycle carried from W040), versioned immutable lineage.
- **The registration gate** (`register.ts`): `registerProvider` — every
  offer's evidence re-proved THE WAY W040 proves its own (`registerCapability`
  carried verbatim: experimentIdOf binding, findings digest
  re-derivation, verdict law, closed vocabularies, scope agreement,
  lineage continuity, duplicates), R052 refused HERE first (the typed
  loud `unmeasured-offer` naming the law), the endowment laws (W041's
  `validateSkillRecord` carried verbatim; scope/capability/bearer
  agreement; duplicates), provider lineage laws, duplicate provider ids.
- **The neutral port** (`port.ts`): `CapabilityProviderPort` — the
  minimal typed surface a CONCRETE provider implements
  (listOffers / describeOffer / provenanceOf), satisfied by the
  deterministic in-memory `referenceProviderAdapter` (the ONLY
  implementation this package ships).
- **Demand adjudication** (`match.ts`): `matchProviderOffers(demand,
  registration, registry)` — W040's `matchCapabilityDemand` carried
  VERBATIM against each offer in canonical offer-id order (the tiebreak
  law), reasons/evidence carried verbatim, the content-addressed
  adjudication id over provider + demand + registry fingerprint.
- **Re-validation** (`validate.ts`): `validateProviderRegistration` —
  the whole registration re-proved from its recorded data (identity
  re-derivation, canonical order, endowment laws, structure), plus the
  optional registry descriptor cross-check.

## What this package does NOT own

- NO concrete provider adapter: the external-source adapters are LATER
  lanes' packages built ON the port (this package ships only the
  deterministic in-memory reference adapter).
- NO entitlement, listing, billing, or any concrete-provider semantics —
  provider-neutral by law (R055), test-pinned by the source scan in
  `test/contract.test.ts`.
- NO provider EXECUTION (A14: the interface composes and adjudicates
  typed data; it never runs a provider, never performs I/O).
- NO re-scoring: every measured summary, refusal reason, and evidence
  line is CARRIED verbatim from W040/W041 — never recomputed here.
- NO provider store: callers carry the accepted registrations (the
  registry-value-carrying pattern) the way W040's callers carry the
  registry value.

## Dependencies

`capability-registry` (W040 — the gate, the vocabulary, the demand seam,
the canonical seams), `skills` (W041 — `validateSkillRecord`,
`registryFingerprintOf`, `SkillRecord`), `organization` (W039 — the
capability-id/demand types). `experiments`/`evaluation`/`verification`/
`cognitive-substrate` are consumed by the REAL no-shim test fixtures
(the W040/W041 fixture precedent).

## Verification

```sh
pnpm --filter capability-provider typecheck   # tsc -p . (includes the contract drift guard)
pnpm --filter capability-provider test        # tsx --test test/*.test.ts
npx oxlint packages/capability-provider contracts/capability
```
