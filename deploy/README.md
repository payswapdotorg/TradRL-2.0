# deploy/ — the typed DEPLOYMENT CONTRACT (W062)

One plain directory (deliberately NOT a workspace package — the
`research/benchmarks` + `docs/benchmarks` W063 precedent): no `package.json`,
no lockfile entry, no dependencies of its own. Every citation is re-proven
through the consumed packages' own validators via relative source imports.

## What this directory OWNS

- **The `DeploymentPlan` record** (`plan.ts`) — the declarative deployment
  contract as typed DATA: the closed mode vocabulary (`blue-green` / `canary`
  / `direct` / `rolling`), the closed component vocabulary
  (`api-service` / `operations-service` / `sdk-client` / `security-layer`),
  the per-component citations, the immutable lineage, the deterministic
  provenance, and the content-addressed `deploy-<digest>` id over canonical
  data (A9 — the declarer's input order never leaks; pinned by twins).
- **The citation proofs** (`citations.ts`) — every component citation proven
  against a REAL exported surface of the merged deps:
  - `api-service` → W059 `services/api`: the cited table id + route names
    are proven against the real default World-Alpha table assembled through
    W059's own `buildRouteTable` gate (`routes.ts` + `point-in-time.ts` +
    `index.ts`);
  - `sdk-client` → W059 `packages/sdk`: the cited bound table id is proven
    by building the REAL typed client over the real table (the drift guard);
  - `operations-service` → W061 `packages/observability`: every cited ops
    route name is proven against the real `operationsRouteDeclarations()`,
    and the real declarations are re-proven through W061's own
    `validateOperationsRoutes` gate;
  - `security-layer` → W060 `packages/security` + `services/security`: the
    carried policy and every secret HANDLE are re-proven through W060's own
    validators (errors carried VERBATIM), THE REDACTION LAW is re-scanned
    over every plan byte (a secret-shaped VALUE is refused LOUDLY), the
    custody verdict is re-minted through `enforceSecretPolicy`, and the
    tenant-boundary proof is re-minted through `proveIsolation` over the
    handles' own §14 scopes.
- **THE GATE** (`compose.ts`) — `composeDeploymentPlan(input, known?)`:
  fail-closed, ALL violations collected as typed errors (never
  short-circuit); the closed vocabularies; §14 (one explicit
  tenant/project/world scope per plan); component/citation coherence; the
  mode posture laws (progression modes deploy from a live parent); the
  lineage laws (genesis shape, contiguity, parent existence + scope when the
  caller supplies the live `known` set); then the seal.
- **Whole-record re-validation** (`validate.ts`) —
  `validateDeploymentPlan(plan, known?)`: re-proves every law from the
  RECORDED data alone. Ids are RE-DERIVED (a rewritten plan is refused
  loudly); the carried custody + isolation verdicts must match the ones
  re-minted from the carried policy + handles (a forged verdict is a loud
  mismatch); the canonical-carriage laws (a record IS canonical data); the
  deterministic provenance re-derived.

## What this directory does NOT own (A13/A14)

- **Any execution.** Nothing here runs a deployment, binds a port, starts a
  server, or supervises a process. The plan is a CONTRACT; an executor would
  be a future work item's surface (and would itself consume this contract,
  never re-declare it).
- **Infrastructure provisioning** — no manifests, no containers, no
  process definitions, no capacity numbers.
- **Runtime serving, authn/authz execution, or transport** — those belong
  to the merged dep contracts (W059 routes, W060 security, W061
  observability), which this contract CITES.
- **Any measured number** — every count on a plan is CARRIED by a cited
  record (A6); this contract invents nothing.

## Disclosed design decisions

1. **The security posture is MANDATORY in every plan** — a production
   deployment always composes the security layer (`security-posture-required`
   is a posture law). Consequently a plan names at least one secret HANDLE
   (`empty-secret-surface`): the production secret surface is explicit typed
   handles, never empty, and THE REDACTION LAW keeps it handle-only.
2. **The gate MINTS the enforcement + isolation records** through W060's own
   machinery (`enforceSecretPolicy`, `proveIsolation`) from the carried
   policy + handles — the declarer never asserts a proof; the
   re-validator compares the carried verdicts against fresh re-mints.
3. **The lineage rides BESIDE the id** (the W053/W055 convention): a
   continuation of the same content carries the same content-addressed id
   with a different lineage — pinned by test.
4. **Parent-existence + contiguity need the caller's current `known` set**
   (the W056/W058 caller-supplied-registry disclosure): without it the
   lineage shape laws still hold, but existence cannot be proven from
   nothing.
5. **`api-table-unlawful` / `sdk-surface-drift` / `ops-route-drift` are
   defensive-depth paths** — the real W059/W061 surfaces are lawful, so they
   cannot fire honestly today; they exist so the gate fails loudly if a
   consumed surface ever drifts.
6. **The deployment-mode vocabulary is this contract's own closed set** —
   modes are deployment-shape declarations (how generations replace each
   other), deliberately NOT process definitions (A13/A14).
7. **Run the tests** (repo root): `npx tsx --test deploy/*.test.ts` —
   REAL imports only; fixtures build every cited record through the
   consumed packages' own gates.

License: Apache-2.0 (the repository LICENSE).
