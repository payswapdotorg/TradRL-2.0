# `packages/sdk` — the typed client surface (W059)

The deterministic projection of `services/api`'s route table: **one method
per route**, compile-time typed, drift-guarded both ways.

## What this package OWNS

- **The method surface** (`client.ts`): `buildSdkClient(table)` derives the
  bindings — deterministic camelCase method names from the stable route
  lineage names (`evidence-view` → `evidenceView`), carried in the table's
  canonical order. The **drift guard** runs both ways:
  - *compile time*: `SDK_SURFACE_ROUTE_NAMES satisfies readonly
    WorldAlphaRouteName[]` (every SDK name is a real default-table route)
    and `SdkDriftGuard` = `Exclude<WorldAlphaRouteName, SdkSurfaceRouteName>
    extends never ? true : drift-string` — a route added to the api table
    without an SDK method **stops this package from type-checking**;
  - *run time*: `assertSdkSurfaceCoversRouteTable(table)` refuses any table
    whose route names are not exactly the surface (both directions).
- **Request builders + response validators** (`builders.ts`):
  - `buildSdkRequest` enforces the §14 scope law (the explicit
    tenant/project/world members the route demands — exactly those, none
    blank; an undeclared member is refused too), the path law (scope
    members + record ids materialized, nothing unknown) and the closed
    field schemas (W050's own `isLegalCutoff` + `TIME_MACHINE_FAMILIES`
    gates). The prepared request is content-addressed (`sdkreq-<digest>`).
  - `validateSdkResponse` **re-validates every response** against the
    route's response schema: required fields present, kinds held, the W028
    provenance citation on the wire matching the route's declared citation
    entity-for-entity, and nothing undeclared riding along. The SDK never
    trusts the wire.
- **Whole-record re-validation** (`validate.ts`): `validateSdkClient`
  re-derives the surface from the table; `validateSdkPreparedRequest`
  re-resolves the route, re-checks every law, and RE-DERIVES the
  content-addressed prepared-request id (tampered records do not
  re-derive).
- **The typed error family** (`SdkError`, in `builders.ts`): every refusal
  law named — closed set, collected, fail-closed.

## What this package does NOT own (deliberately)

- **No network I/O** — A14: the SDK prepares requests and validates
  responses; the HTTP transport is W062's serving engine.
- **No authn/authz execution** — W060 owns the security gate; the SDK
  carries the declared `visibility` only through the route contracts.
- **No route contracts** — `services/api` owns the route table; this
  package only projects and enforces it.
- **No response construction** — responses come from the wire (W062) and
  are validated here, never fabricated.

## The A9 twin

Same route table ⇒ deep-equal SDK surface (method names, order, route
bindings); same input ⇒ same content-addressed prepared-request id; the
drift guard is the twin of the api table's own coverage test.
