# `services/api` — the typed API contract service (W059)

The route table **AS DATA**: every public/private route of the World-Alpha
surface as a typed, frozen, content-addressed record.

## What this service OWNS

- **The RouteTable type system** (`routes.ts`): the closed vocabularies
  (methods, families, visibility, the §14 scope hierarchy, request/response
  field kinds, W028 provenance entities, payload types), the schemas, the
  versioned content-addressed route ids (`rt-<version>-<digest>`) and table
  ids (`rtt-<digest>`), and `WORLD_ALPHA_ROUTE_NAMES` — the compile-time
  drift anchor `packages/sdk` binds its method surface to.
- **The point-in-time route family + R016** (`point-in-time.ts`): every
  time-machine route declares an explicit, REQUIRED `cutoff` request field
  (kind `simulation-time`). An implicit-latest route is a loud typed
  violation (`implicit-latest-cutoff`) — never silently repaired.
- **The typed error families** (`errors.ts`): the stable wire-error codes
  (`ApiErrorCode` / `ApiErrorEnvelope`) and every route-table law violation
  (`RouteTableViolation`).
- **Fail-closed construction + whole-record re-validation** (`validate.ts`):
  `buildRouteTable` collects EVERY violation (unique route ids, unique
  (method, path), closed methods, §14 scope presence AND scope⇔path-param
  coherence, W028 provenance citations on data-carrying responses or the
  honest `no-declared-source` marker, canonical order);
  `validateRouteTable` re-proves a recorded table — each route id
  RE-DERIVED from its own content, the table id re-derived.
- **The default World-Alpha table** (`index.ts`): 10 routes — platform
  (health, route-table — public), evidence (view + per-event/artifact/dataset
  lookups — private, W028 citations), time-machine (view-create/view-get —
  private, explicit cutoffs), organization (get/compile — private, W039).

## What this service does NOT own (deliberately)

- **No HTTP serving** — W062 owns the deployment/serving engine; this
  service is the contract the server will enforce (A14).
- **No authn/authz execution** — W060 owns the security gate; `visibility`
  (`public`/`private`) is declared data, never enforced here.
- **No observability** — W061 owns it.
- **No network I/O, no clock, no randomness** — pure data + laws (A9/A14).
- **No client surface** — `packages/sdk` owns the typed client.

## The laws carried

- **R071** (typed end-to-end): every route and field schema is a closed
  typed set; additions are contract changes (table version bumps).
- **§14**: tenant/project/world identity is EXPLICIT on every route — the
  scope members are exactly the path parameters; an unscoped route is a
  loud typed violation.
- **W028 provenance**: every data-carrying response schema cites its
  evidence/provenance projection (`evidence-projection` over W028's
  `EvidenceEntityKind` vocabulary) or carries the honest
  `no-declared-source` marker; every such response declares a wire field of
  kind `provenance-citation` that carries it.
- **R016** (via W050): point-in-time views are NEVER implicit-latest — the
  cutoff is a required explicit parameter on every time-machine route.
- **A9**: same declarations ⇒ same route ids ⇒ same table id (deterministic,
  content-addressed; input order never matters — canonical name order).
- **A14**: contracts only — no serving, no auth execution, no I/O.

## Package layout

Flat source-exported (the W035–W052 pattern): `package.json` `"exports"`
point at TypeScript sources; `pnpm --filter api typecheck` / `test` run from
the repository root.
