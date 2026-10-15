# contracts/capability — the provider-neutral capability-provider contract

This directory is the canonical contracts surface for the
provider-neutral capability-provider interface (W056; the contracts/ui
convention, W005). It is type-only and dependency-free: no runtime, no
framework imports, no package manifest, no workspace membership. The
implementation package `packages/capability-provider` satisfies it;
`packages/capability-provider/test/contract.test.ts` guards drift against
the real package types and functions.

## Files

- `src/capability-provider-contract.ts` — the provider-neutral seam:
  - The closed vocabularies carried VERBATIM from the W040 descriptor
    vocabulary (`CapabilityProviderOfferKind`, `...Domain`, the bearer
    dimension, the lifecycle states) — every provider's offers answer in
    these sets, which is exactly what makes the interface neutral.
  - `CapabilityProviderOfferDescriptor` — the offer descriptor shape:
    opaque offer id, the W040 capability id it registers as, the neutral
    vocabulary, explicit scope, the W039 organization capabilities it
    provides, the measured provenance citations (REQUIRED — R052), the
    W041 endowment citations, and the per-offer lifecycle carried from
    W040.
  - `CapabilityProviderPort` — the ONLY surface a concrete provider
    implements: `listOffers` (canonical order), `describeOffer`
    (fail-closed by exact id), `provenanceOf` (the A6 evidence accessor).
  - `CapabilityProviderAdjudication` — the demand-adjudication result
    shape: typed yes/no with W040's evidence lines and refusal reasons
    carried verbatim and a content-addressed adjudication id.

## Laws encoded here

1. Provider-NEUTRALITY (REQUIREMENTS.md R055 "Arena is optional"):
   providers are a PLUGGABLE class; this contract knows zero
   concrete-provider specifics. The forbidden-key assertions in
   `test/capabilityProviderContract.test.ts` make importing
   concrete-provider concepts into this contract a compile failure.
2. Empiricism (R052): the offer's measured provenance is required data —
   an offer without citations is not an offer shape consumers ever read.
3. Opaque identity (DOMAIN-MODEL identity laws): every id is an opaque
   string here — consumers compare, never parse; canonical ordering and
   id derivation belong to the implementation package.
4. Carry, never re-score (A6): the adjudication shape carries W040's own
   reasons and evidence lines verbatim; the contract never re-declares
   the matching laws.

## Verification

```sh
node_modules/.bin/tsc -p contracts/capability        # typecheck (includes test/)
node_modules/.bin/tsx --test contracts/capability/test/*.test.ts   # contract tests
```

See the W056 PR for the implementation-side behavioral drift guard
(`packages/capability-provider/test/contract.test.ts`).
