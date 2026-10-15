/**
 * Public surface of the W061 `observability` package — the typed TELEMETRY +
 * AUDIT contracts, plus the OPERATIONS route declarations (the ops surface,
 * aligned with W059's route-table vocabulary).
 *
 * Modules (the package.json exports map is the authority):
 * - `./events.js` — the operational event vocabulary: closed kind sets,
 *   typed payloads, the §14 explicit scope (W059's own closed hierarchy,
 *   imported), DECLARED timestamps, health/traffic descriptors AS DATA;
 * - `./audit.js` — the AuditRecord contract: immutable append-only records
 *   citing W028 provenance (a record without provenance is refused),
 *   hash-chained trail digests as data, the append-only gate;
 * - `./validate.js` — whole-record re-validation (ids re-derived — a
 *   rewrite is caught loudly);
 * - THIS module — the operations ROUTE declarations: every ops route as
 *   typed data, aligned with W059's `services/api` route-table vocabulary
 *   (its closed method set, its closed §14 scope hierarchy, its
 *   provenance-citation response law, its path-pattern parser).
 *
 * DEVIATION (disclosed): W059's `RoutePayloadTypeName` is a CLOSED set owned
 * by `services/api` (frozen to W061). The operations surface therefore
 * carries its own closed payload-type names over the SAME route shape —
 * method/scope/visibility/provenance vocabularies are W059's, imported.
 *
 * A14: CONTRACTS ONLY — no scraping, no serving (W062), no alerting, no I/O.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  API_METHODS,
  parsePathPattern,
  SCOPE_MEMBERS_OF,
  type ApiMethod,
  type ApiRouteScopeKind,
  type ApiRouteVisibility,
  type ResponseProvenanceCitation,
} from "api";

export * from "./events.js";
export * from "./audit.js";
export * from "./validate.js";

// The W028 provenance citation vocabulary this contract carries — re-exported
// so consumers (services/operations and beyond) need only this surface.
export type { SourceCitation } from "tradrl-evidence";

// ---------------------------------------------------------------------------
// The operations route declarations (the ops surface — typed DATA)
// ---------------------------------------------------------------------------

/** The closed payload-type vocabulary of the operations surface. */
export type OpsRoutePayloadTypeName =
  | "AuditTrail" // this contract's own `AuditTrail`
  | "AuditVerification" // services/operations trail verification outcome
  | "OperationsReport"; // services/operations deterministic report

/** The closed payload-type vocabulary, canonical order. */
export const OPS_ROUTE_PAYLOAD_TYPE_NAMES: readonly OpsRoutePayloadTypeName[] = [
  "AuditTrail",
  "AuditVerification",
  "OperationsReport",
];

/** One declared request field (mirrors W059's shape). */
export interface OpsRouteRequestField {
  readonly name: string;
  readonly kind: "string" | "record-id" | "json";
  readonly required: boolean;
  readonly description: string;
}

/** One declared response field (mirrors W059's shape + provenance law). */
export interface OpsRouteResponseField {
  readonly name: string;
  readonly kind: "integer" | "json" | "provenance-citation" | "record-id" | "string";
  readonly required: boolean;
  readonly description: string;
}

/**
 * ONE operations route: the stable lineage `name`, the explicit scope (§14),
 * the closed request/response contracts (every data-carrying response cites
 * provenance through W059's vocabulary) — typed DATA, never served here.
 */
export interface OpsRouteDeclaration {
  readonly name: string;
  readonly family: "operations";
  readonly visibility: ApiRouteVisibility;
  readonly version: "v1";
  readonly method: ApiMethod;
  readonly path: string;
  readonly scope: ApiRouteScopeKind;
  readonly request: { readonly fields: readonly OpsRouteRequestField[] };
  readonly response: {
    readonly payloadType: OpsRoutePayloadTypeName;
    readonly fields: readonly OpsRouteResponseField[];
    readonly provenance: ResponseProvenanceCitation;
  };
  readonly description: string;
}

const WORLD = "/v1/tenants/:tenantId/projects/:projectId/worlds/:worldId";

/**
 * The operations route DECLARATIONS — the surface W062 (serving) will render
 * and W064's journey cites. Aligned with W059's route table: same method
 * set, same scope hierarchy, same provenance-citation response law, the
 * scope members materialized as path parameters.
 */
export function operationsRouteDeclarations(): readonly OpsRouteDeclaration[] {
  return [
    {
      name: "audit-trail",
      family: "operations",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/audit`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "AuditTrail",
        fields: [
          { name: "trailId", kind: "record-id", required: true, description: "The trail's content-addressed id." },
          { name: "records", kind: "json", required: true, description: "The immutable append-only audit records (each citing W028 provenance)." },
          { name: "head", kind: "string", required: true, description: "The hash-chained head digest." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: the trail is composed records, not an evidence projection." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "The audit trail of one world: immutable, append-only, provenance-cited (§14).",
    },
    {
      name: "audit-verify",
      family: "operations",
      visibility: "private",
      version: "v1",
      method: "POST",
      path: `${WORLD}/audit/verify`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "AuditVerification",
        fields: [
          { name: "ok", kind: "string", required: true, description: "Whether the trail re-verified end-to-end." },
          { name: "recordCount", kind: "integer", required: true, description: "The verified record count." },
          { name: "head", kind: "string", required: true, description: "The verified chain head." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: a verification outcome, not an evidence projection." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "Re-verify one world's audit trail end-to-end: ordering, chain digests, provenance citations, scope laws.",
    },
    {
      name: "operations-report",
      family: "operations",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/operations/report`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "OperationsReport",
        fields: [
          { name: "reportId", kind: "record-id", required: true, description: "The report's content-addressed id." },
          { name: "eventCounts", kind: "json", required: true, description: "The carried operational event counts by kind." },
          { name: "auditCounts", kind: "json", required: true, description: "The carried audit counts by action." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: a deterministic composition over cited records." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "The deterministic operational report over one world's trail + event stream (A9).",
    },
  ];
}

// ---------------------------------------------------------------------------
// The ops-route construction laws (fail-closed — W059's own gates carried)
// ---------------------------------------------------------------------------

/** Every law an operations route declaration can violate (closed set). */
export type OpsRouteViolation =
  | {
      readonly kind:
        | "duplicate-route-name"
        | "duplicate-method-path"
        | "unknown-method"
        | "scope-param-missing"
        | "extra-scope-param"
        | "unknown-payload-type"
        | "provenance-missing"
        | "blank-route-name"
        | "blank-path";
      readonly detail: string;
    };

/**
 * The fail-closed ops-route gate: unique lineage names, unique method+path,
 * W059's closed method set, the §14 scope members materialized as path
 * parameters (through W059's own `parsePathPattern`), the closed payload
 * types and the mandatory provenance citation on every response.
 */
export function validateOperationsRoutes(
  declarations: readonly OpsRouteDeclaration[],
): readonly OpsRouteViolation[] {
  const violations: OpsRouteViolation[] = [];
  const names = new Set<string>();
  const methodPaths = new Set<string>();
  for (const route of declarations) {
    if (typeof route.name !== "string" || route.name.length === 0) {
      violations.push({ kind: "blank-route-name", detail: "route name is blank" });
      continue;
    }
    if (names.has(route.name)) {
      violations.push({ kind: "duplicate-route-name", detail: `route name ${route.name} declared twice` });
    }
    names.add(route.name);
    const methodPath = `${route.method} ${route.path}`;
    if (methodPaths.has(methodPath)) {
      violations.push({ kind: "duplicate-method-path", detail: `${methodPath} declared twice` });
    }
    methodPaths.add(methodPath);
    if (!(API_METHODS as readonly string[]).includes(route.method)) {
      violations.push({ kind: "unknown-method", detail: `method ${String(route.method)} is outside W059's closed set` });
    }
    if (typeof route.path !== "string" || route.path.length === 0) {
      violations.push({ kind: "blank-path", detail: `route ${route.name} has a blank path` });
      continue;
    }
    const { params } = parsePathPattern(route.path);
    for (const member of SCOPE_MEMBERS_OF[route.scope]) {
      if (!params.includes(member)) {
        violations.push({
          kind: "scope-param-missing",
          detail: `route ${route.name}: §14 scope member :${member} is not a path parameter`,
        });
      }
    }
    for (const param of params) {
      if (!(SCOPE_MEMBERS_OF[route.scope] as readonly string[]).includes(param)) {
        violations.push({
          kind: "extra-scope-param",
          detail: `route ${route.name}: path parameter :${param} is not a member of the route's scope`,
        });
      }
    }
    if (!(OPS_ROUTE_PAYLOAD_TYPE_NAMES as readonly string[]).includes(route.response?.payloadType)) {
      violations.push({
        kind: "unknown-payload-type",
        detail: `route ${route.name}: payload type ${String(route.response?.payloadType)} is outside the closed set`,
      });
    }
    const provenance = route.response?.provenance as { kind?: unknown } | undefined;
    if (
      provenance === undefined ||
      provenance === null ||
      (provenance.kind !== "evidence-projection" && provenance.kind !== "no-declared-source")
    ) {
      violations.push({
        kind: "provenance-missing",
        detail: `route ${route.name}: response does not carry a W059 provenance citation`,
      });
    }
  }
  return violations;
}

const OPERATIONS_ROUTE_LAWS = validateOperationsRoutes(operationsRouteDeclarations());
if (OPERATIONS_ROUTE_LAWS.length > 0) {
  throw new Error(
    `the default operations route declarations are unlawful: ${JSON.stringify(OPERATIONS_ROUTE_LAWS)}`,
  );
}

/** The stable lineage names of the operations surface, canonical order. */
export const OPERATIONS_ROUTE_NAMES = [
  "audit-trail",
  "audit-verify",
  "operations-report",
] as const;

/** The route-name type of the operations surface (literal union — the drift anchor). */
export type OperationsRouteName = (typeof OPERATIONS_ROUTE_NAMES)[number];
