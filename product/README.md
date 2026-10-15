# product/ — the typed PRODUCT IDENTITY CONTRACT (W066)

One plain directory (deliberately NOT a workspace package — the `deploy/`
W062 + `research/benchmarks` W063 precedent): no `package.json`, no lockfile
entry, no dependencies of its own. Every citation is re-proven against a
REAL repository surface via relative source imports.

The migration this contract governs is IDENTITY, not erasure — the law of
record is AGENTS.md's own product-boundary sentence, carried verbatim:
**TradRL extends the ZCode workbench rather than replacing it.**

## What this directory OWNS

- **The `ProductIdentity` record** (`identity.ts`) — the product identity as
  typed DATA: the product name (`TradRL`, a closed one-member vocabulary),
  the branding law of record, the closed identity-scope vocabulary
  (`product-name-bearing` / `workbench-inherited` / `license-notice` /
  `deployment-contract`), THE MIGRATION LAWS as data (what a
  TradRL-branded surface MUST carry vs what a workbench-inherited surface
  MUST preserve), the per-surface identity declarations (incl. the shipped
  `TRADRL_IDENTITY_SURFACES` — this repository's real identity metadata),
  the immutable lineage, the deterministic provenance, and the
  content-addressed `identity-<digest>` id over canonical data (A9 — the
  declarer's input order never leaks; pinned by twins).
- **The citation proofs** (`citations.ts`) — every identity declaration
  proven against a REAL repository surface through an injectable
  `SurfaceProbe` (REAL default: the live repository tree):
  - the fail-closed **unknown-surface refusal** — a declared surface that
    does not exist in the repository is refused loudly;
  - the migration laws as **byte-proofs** — a product-name-bearing surface
    CARRIES `TradRL`; a workbench-inherited surface PRESERVES `ZCode`;
  - the **W062 deployment citation** — every cited component is proven
    against `deploy/plan.ts`'s real `DEPLOYMENT_COMPONENT_KINDS`, and a REAL
    plan over exactly the cited components is composed + re-validated
    through W062's OWN gates (`composeDeploymentPlan` +
    `validateDeploymentPlan`); W062's laws (the mandatory security posture,
    the citation coherence) apply VERBATIM through its gate, never
    re-declared here;
  - the **branding-law proof** — the extends-never-replaces law must agree
    with the identity-scope vocabulary's own laws AND be carried VERBATIM
    by the real `AGENTS.md` (its product-boundary section).
- **THE GATE** (`compose.ts`) — `composeProductIdentity(input, probe?,
  known?)`: fail-closed, ALL violations collected (never short-circuit);
  the closed vocabularies; the duplicate-surface set law; the
  name-surface-required law; the lineage laws; then the seal.
- **Whole-record re-validation** (`validate.ts`) —
  `validateProductIdentity(record, probe?, known?)`: re-proves every law
  from the RECORDED data alone. The id is RE-DERIVED (a rewritten record is
  refused loudly); the canonical-carriage laws (a record IS canonical
  data); the deterministic provenance re-derived.

## What this directory does NOT own (the disclosed boundary)

- **The root `package.json`** — a TL-serialized shared surface. Its
  `name`/`version` metadata (`zcode`, the upstream workbench release) is a
  TL registration decision, deliberately NOT touched by this migration;
  this contract's identity declarations do not cite it.
- **Any surface rewrite machinery** — the gate DECLARES and PROVES identity
  laws; it never edits a file. The README migrations themselves are this
  work item's own surgical edits, outside the contract's runtime.
- **Any execution, rendering, or branding asset** — no logos, no themes, no
  generated banners, no process, no server.
- **Workbench infrastructure identity** — ZCode-inherited infrastructure
  references that are factually architectural STAY (the extends law); this
  contract proves their preservation, it never erases them.

## Disclosed design decisions

1. **The proofs read the filesystem through an injected `SurfaceProbe`**
   with the REAL repository tree as the default (anchored at this
   contract's own location, never the caller's cwd) — a repository surface
   IS a filesystem fact. This mirrors the W056/W058 caller-supplied-registry
   disclosure: the record id remains PURE content-addressed data (A9); a
   surface fact is a GATE LAW, never id mass.
2. **Identity laws are semantic (name-bearing / preservation), not
   byte-pinning** — the id addresses the DECLARED identity metadata; the
   real surface bytes are PROVEN at the gate but never digested into the
   id. A surface edit that preserves the identity laws does not rewrite the
   identity record; one that violates a law fails the gate loudly. (The
   W062 precedent: citations carry names, proven against live surfaces.)
3. **The product-name vocabulary is closed (one member: `TradRL`)** — the
   product identity is declared data, never free text; a renamed product is
   a different contract (a future work item's surface).
4. **The W062 citation inherits W062's laws verbatim** — a component
   citation without `security-layer` is refused by W062's own mandatory
   posture law, carried verbatim as `deployment-plan-unproven` (never
   re-declared here); the citation's fixture chain (W059 table + SDK, W060
   policy + handle, W061 ops routes) is built through the consumed
   packages' own gates, the `deploy/plan.test.ts` fixture lineage.
5. **`vocabulary-law-unlawful` / parts of `branding-law-mismatch` are
   defensive-depth paths** — the vocabulary constants are well-formed, so
   they cannot fire honestly today; they exist so the gate fails loudly if
   the contract's own vocabulary ever drifts.
6. **The lineage WEIGHS into the id** (mirroring `deploy/plan.ts`'s
   `canonicalDeploymentContent` exactly): a continuation is a new identity
   generation with a different content-addressed id.
7. **`branding-law-unproven` is honestly reachable only through an injected
   probe** (the real AGENTS.md carries the law verbatim) — pinned by the
   injected-probe test.
8. **Run the tests** (repo root): `npx tsx --test product/*.test.ts` — REAL
   citations only; the content refusal laws use both real surfaces (files
   that factually lack a name) and the injected in-memory probe, never a
   mutation of the live tree.

License: Apache-2.0 (the repository LICENSE).
