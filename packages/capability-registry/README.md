# capability-registry (W040)

The empirical capability registry contract. REQUIREMENTS.md R052 —
"Capability discovery is EMPIRICAL" — enforced **structurally**: a
capability enters the registry only through a registration gate that
demands **measured provenance**, and the provenance must be real as far as
a pure registry can prove it (W037 experiment descriptors re-identified
through `experimentIdOf`; W038 findings digests re-derived through
`findingsDigestOf`; the findings' subject must be the cited evaluation;
the cited measurement must have PASSED). A label-only entry is the typed,
loud error `unmeasured-capability` naming the law — never silent
acceptance.

## What this package OWNS

- **The capability DATA** (`descriptor.ts`): opaque canonical id
  (`cap-<digest>`, `identity.ts`), the closed kind/domain vocabularies,
  the bearer dimension (which W033 substrate or body class demonstrated
  it), explicit tenant/project/world scope, versioned immutable lineage
  (genesis at version 1; successors cite a real parent at exactly
  parent.version + 1), and the provenance — evidence-linked citations of
  the canonical W037 experiment ids, W038 evaluation ids and W038 findings
  digests that empirically established the capability (A6).
- **The registration gate** (`register.ts`): `registerCapability` —
  pure, fail-closed, every law a named typed error (R052 headline,
  closed vocabularies, scope laws, citation bindings, digest
  re-derivation, verdict law, lineage continuity, duplicate identity).
  Returns a NEW registry with the entry in canonical id order (A9: same
  inputs ⇒ deep-equal registry).
- **Re-validation** (`validate.ts`): `validateCapabilityRegistry` —
  re-proves the registry's own recorded laws (identity, vocabulary,
  scope, lineage chains, lifecycle records, canonical order).
- **Lifecycle** (`lifecycle.ts`): registered / deprecated / revoked as
  typed data with immutable transitions; a deprecated capability still
  resolves for lineage but fails demand-matching loudly.
- **Queries** (`query.ts`): by exact id, by closed kind, by closed
  domain — all fail-closed; `matchCapabilityDemand` — the W039 seam
  (typed yes/no with reasons, in W039's own imported vocabulary);
  `organizationOfferingsOf` — the projection the W039 compiler's
  `providesCapabilities` input builds from.
- **Tests**: node:test + node:assert/strict over REAL imports (W037/W038
  fixtures built through the REAL W036 spec data, `experimentIdOf`,
  `assembleFindingsReport`); the A9 twin law pinned (same registrations ⇒
  deep-equal registry + same ids; registration order never leaks).

## What this package does NOT own

- **Measurement execution** — no experiment is run, no evaluation walked,
  no model called, no I/O, no clocks, no randomness, no env reads. The
  measuring happened in the W037/W038 artifacts; the registry RECORDS
  their canonical citations and verifies the records' internal bindings.
- **The W032/W033 component descriptors** — the offering projection names
  the bearer and the organization capabilities it provides; the body /
  substrate descriptors the W039 compiler resolves against come from
  their own packages.
- **The organization model / compiler** (W039) — this package ANSWERS
  demands in W039's vocabulary; it never defines organizations, positions
  or compositions.
- **The capability-provider interface** (W056, later) — it will be built
  ON this registry; nothing here anticipates its shape.
- **Persistence and distribution** — the registry is an immutable value;
  stores are another package's law.

## Conventions

Flat source-exported package (the W035–W039 pattern): the package.json
`exports` map points at TypeScript sources; `index.ts` re-exports the
public modules; tests import the real sources; every file ≤ 400 lines;
Apache-2.0 headers; the canonical hashing family (canonical JSON +
FNV-1a 32-bit) re-implemented in-package, byte-compatible with the
W004/W016 family (the W037/W039 precedent).

Run: `pnpm --filter capability-registry test` · `pnpm --filter
capability-registry typecheck` · `npx oxlint packages/capability-registry`
