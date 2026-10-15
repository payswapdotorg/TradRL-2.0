/**
 * The RouteTable (W059) — every public/private route as TYPED DATA.
 *
 * Spec: spec/REQUIREMENTS.md R071 — "Typed API/SDK."
 * Spec: spec/ARCHITECTURE-LOCK.md §14 — "Tenant/project/world identity is
 * explicit in persistence and transport": every route carries its explicit
 * scope requirement, and the scope members MUST appear as path parameters —
 * an unscoped (or scope/path-incoherent) route is a LOUD typed violation.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — deterministic, content-addressed: the
 * same route declaration always mints the same versioned route id; the same
 * routes always mint the same content-addressed table id.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — contracts only: the route table is
 * DATA; no HTTP serving (W062), no authn/authz execution (W060), no I/O.
 *
 * The provenance law (W028 carried): every DATA-CARRYING response schema
 * cites its evidence/provenance projection — an `evidence-projection`
 * citation over W028's own `EvidenceEntityKind` vocabulary, or the HONEST
 * `no-declared-source` marker for declared (non-evidence-projected) data.
 * Never fabricated, never silently omitted — omission is a violation.
 *
 * The point-in-time law (R016, W050 carried) is owned by `./point-in-time.ts`;
 * the fail-closed construction laws live in `./validate.ts`; the core route
 * declarations + the default table are assembled in `./index.ts`.
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceEntityKind } from "tradrl-evidence";
import type {
  ArtifactEvidence,
  DatasetEvidence,
  EventEvidence,
  EvidenceProjection,
} from "tradrl-evidence";
import { TIME_MACHINE_FAMILIES } from "tradrl-time-machine";
import type { PointInTimeQuery, PointInTimeView } from "tradrl-time-machine";
import type { AssembledPointInTimeView } from "time-machine";
import type { OrganizationDefinition } from "organization";
import type { CompiledOrganization } from "organization-compiler";
import { canonicalDigestHex } from "trajectory";

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

/** The API version family (closed: additions are new table versions). */
export type ApiVersion = "v1";
/** The closed version vocabulary. */
export const API_VERSIONS: readonly ApiVersion[] = ["v1"];

/** The closed HTTP method set. */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** The closed method vocabulary in canonical order. */
export const API_METHODS: readonly ApiMethod[] = [
  "DELETE",
  "GET",
  "PATCH",
  "POST",
  "PUT",
];

/** Route visibility: public (no credential demanded) vs private (W060 gates execution). */
export type ApiRouteVisibility = "public" | "private";

/** The closed route-family set (one entry per contract surface this table exposes). */
export type ApiRouteFamily =
  | "platform"
  | "evidence"
  | "time-machine"
  | "organization";

// §14 — the explicit identity scope every route requires (closed hierarchy).
/** The scope members in canonical order (outermost identity first). */
export type ApiScopeMember = "tenantId" | "projectId" | "worldId";
/** The closed scope-kind vocabulary: a prefix of the identity hierarchy. */
export type ApiRouteScopeKind =
  | "tenant"
  | "tenant-project"
  | "tenant-project-world";
/** The members each scope kind requires (derived data — the single source). */
export const SCOPE_MEMBERS_OF: Record<
  ApiRouteScopeKind,
  readonly ApiScopeMember[]
> = {
  tenant: ["tenantId"],
  "tenant-project": ["tenantId", "projectId"],
  "tenant-project-world": ["tenantId", "projectId", "worldId"],
};
/** The closed scope-kind vocabulary in canonical order. */
export const API_ROUTE_SCOPE_KINDS: readonly ApiRouteScopeKind[] = [
  "tenant",
  "tenant-project",
  "tenant-project-world",
];

/** The closed request-field kind set. */
export type RouteRequestFieldKind =
  | "string" // non-empty string
  | "record-id" // opaque record id (non-empty string)
  | "integer" // integer number
  | "simulation-time" // W004 simulation-axis ms (a legal declared cutoff)
  | "record-family-set" // W050's closed record-family set
  | "json"; // arbitrary JSON (deep-validated by the owning contract)

/** The closed response-field kind set (adds the provenance carriage). */
export type RouteResponseFieldKind =
  | RouteRequestFieldKind
  | "provenance-citation"; // the W028 citation carried on the wire

/** The closed request-field kind vocabulary, canonical order. */
export const REQUEST_FIELD_KINDS: readonly RouteRequestFieldKind[] = [
  "integer",
  "json",
  "record-family-set",
  "record-id",
  "simulation-time",
  "string",
];

/** The closed response-field kind vocabulary, canonical order. */
export const RESPONSE_FIELD_KINDS: readonly RouteResponseFieldKind[] = [
  "integer",
  "json",
  "provenance-citation",
  "record-family-set",
  "record-id",
  "simulation-time",
  "string",
];

/** The record-family-set field kind's vocabulary — W050's own closed set. */
export const RECORD_FAMILY_VOCABULARY: readonly string[] = TIME_MACHINE_FAMILIES;

/** The provenance entities a citation may name — W028's own closed kind set. */
export const PROVENANCE_ENTITY_KINDS: readonly EvidenceEntityKind[] = [
  "event",
  "artifact",
  "dataset",
];

// ---------------------------------------------------------------------------
// The provenance citation (W028's vocabulary, carried into transport)
// ---------------------------------------------------------------------------

/**
 * The citation every data-carrying response schema MUST carry: which W028
 * evidence entities the response's provenance projects, or the HONEST
 * `no-declared-source` marker (declared data that is not evidence-projected).
 * Never fabricated; never silently omitted.
 */
export type ResponseProvenanceCitation =
  | {
      readonly kind: "evidence-projection";
      readonly entities: readonly EvidenceEntityKind[];
    }
  | { readonly kind: "no-declared-source" };

// ---------------------------------------------------------------------------
// The schemas (closed typed sets)
// ---------------------------------------------------------------------------

/** One declared request field. */
export interface RouteRequestField {
  readonly name: string;
  readonly kind: RouteRequestFieldKind;
  readonly required: boolean;
  readonly description: string;
}

/** One declared response field. */
export interface RouteResponseField {
  readonly name: string;
  readonly kind: RouteResponseFieldKind;
  readonly required: boolean;
  readonly description: string;
}

/** The request schema (closed field set — the request side of the contract). */
export interface RouteRequestSchema {
  readonly fields: readonly RouteRequestField[];
}

/** The response schema (closed field set + the mandatory provenance citation). */
export interface RouteResponseSchema {
  readonly payloadType: RoutePayloadTypeName;
  readonly fields: readonly RouteResponseField[];
  readonly provenance: ResponseProvenanceCitation;
}

/**
 * The closed payload-type vocabulary. Each name binds to a REAL imported
 * contract type through `ROUTE_PAYLOAD_TYPES` (a compile-time drift guard:
 * if a consumed package renames its type, this table stops type-checking).
 */
export type RoutePayloadTypeName =
  | "Unit" // no payload (acknowledgement)
  | "HealthReport" // this service's own health datum
  | "ApiRouteTable" // this service's own self-description
  | "EvidenceProjection" // W028 `tradrl-evidence`
  | "EventEvidence" // W028 `tradrl-evidence`
  | "ArtifactEvidence" // W028 `tradrl-evidence`
  | "DatasetEvidence" // W028 `tradrl-evidence`
  | "PointInTimeQuery" // W050 `tradrl-time-machine`
  | "PointInTimeView" // W050 `tradrl-time-machine`
  | "AssembledPointInTimeView" // W050 `services/time-machine`
  | "OrganizationDefinition" // W039 `organization`
  | "CompiledOrganization"; // W039 `services/organization-compiler`

/**
 * The payload-type registry: each closed name bound to its imported contract
 * TYPE (values are never read — the binding is the compile-time guard).
 */
export const ROUTE_PAYLOAD_TYPES: Readonly<
  Record<RoutePayloadTypeName, unknown>
> = {
  "Unit": null,
  "HealthReport": null,
  "ApiRouteTable": null as unknown as ApiRouteTable,
  "EvidenceProjection": null as unknown as EvidenceProjection,
  "EventEvidence": null as unknown as EventEvidence,
  "ArtifactEvidence": null as unknown as ArtifactEvidence,
  "DatasetEvidence": null as unknown as DatasetEvidence,
  "PointInTimeQuery": null as unknown as PointInTimeQuery,
  "PointInTimeView": null as unknown as PointInTimeView,
  "AssembledPointInTimeView": null as unknown as AssembledPointInTimeView,
  "OrganizationDefinition": null as unknown as OrganizationDefinition,
  "CompiledOrganization": null as unknown as CompiledOrganization,
};

/** The closed payload-type vocabulary, canonical order. */
export const ROUTE_PAYLOAD_TYPE_NAMES: readonly RoutePayloadTypeName[] = [
  "ApiRouteTable",
  "ArtifactEvidence",
  "AssembledPointInTimeView",
  "CompiledOrganization",
  "DatasetEvidence",
  "EventEvidence",
  "EvidenceProjection",
  "HealthReport",
  "OrganizationDefinition",
  "PointInTimeQuery",
  "PointInTimeView",
  "Unit",
];

// ---------------------------------------------------------------------------
// The route + the table (typed DATA, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const apiRouteIdBrand: unique symbol;

/**
 * An OPAQUE versioned route id: `rt-<version>-<digest>` over the route's own
 * canonical content. Produced only by {@link routeIdOf}; never parsed — the
 * name/scope/contract travel explicitly on the route.
 */
export type ApiRouteId = string & { readonly [apiRouteIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const API_ROUTE_ID_PREFIX = "rt-";

declare const apiRouteTableIdBrand: unique symbol;

/** An OPAQUE content-addressed route-table id: `rtt-<digest>`. */
export type ApiRouteTableId = string & {
  readonly [apiRouteTableIdBrand]: true;
};

/** The table-id prefix (a rendering convention, never a parse target). */
export const API_ROUTE_TABLE_ID_PREFIX = "rtt-";

/**
 * ONE route: the stable lineage `name` (immutable across versions — a v2
 * route REPLACES its v1 lineage, never co-exists in one table), the explicit
 * scope (§14), the closed request/response contracts, and the content-derived
 * versioned route id.
 */
export interface ApiRoute {
  readonly routeId: ApiRouteId;
  readonly name: string;
  readonly family: ApiRouteFamily;
  readonly visibility: ApiRouteVisibility;
  readonly version: ApiVersion;
  readonly method: ApiMethod;
  readonly path: string;
  readonly scope: ApiRouteScopeKind;
  readonly request: RouteRequestSchema;
  readonly response: RouteResponseSchema;
  readonly description: string;
}

/** A route DECLARATION (before the table mints the content-addressed id). */
export type ApiRouteDeclaration = Omit<ApiRoute, "routeId">;

/** The route table: the version + the canonically ordered routes + its id. */
export interface ApiRouteTable {
  readonly tableId: ApiRouteTableId;
  readonly apiVersion: ApiVersion;
  readonly routes: readonly ApiRoute[];
}

// ---------------------------------------------------------------------------
// Id derivation (pure, deterministic — A9)
// ---------------------------------------------------------------------------

/** The canonical content a route id addresses (every law-bearing member). */
export function canonicalRouteContent(
  route: Omit<ApiRoute, "routeId">,
): Record<string, unknown> {
  return {
    family: route.family,
    method: route.method,
    name: route.name,
    path: route.path,
    request: route.request,
    response: route.response,
    scope: route.scope,
    version: route.version,
    visibility: route.visibility,
  };
}

/**
 * The versioned route id: `rt-<version>-<digest>` over the route's canonical
 * content. Pure and deterministic: the same declaration always mints the
 * same id; a declaration differing in ANY law-bearing member mints another.
 */
export function routeIdOf(route: Omit<ApiRoute, "routeId">): ApiRouteId {
  const digest = canonicalDigestHex(canonicalRouteContent(route));
  return `${API_ROUTE_ID_PREFIX}${route.version}-${digest}` as ApiRouteId;
}

/**
 * The content-addressed table id: `rtt-<digest>` over the version + the
 * route ids in canonical (name) order. Same routes ⇒ same id (A9).
 */
export function tableIdOf(
  apiVersion: ApiVersion,
  routes: readonly ApiRoute[],
): ApiRouteTableId {
  const digest = canonicalDigestHex({
    apiVersion,
    routeIds: routes.map((route) => route.routeId),
  });
  return `${API_ROUTE_TABLE_ID_PREFIX}${digest}` as ApiRouteTableId;
}

/** Canonical route order: lexicographic by stable lineage name. */
export function compareRoutes(left: ApiRoute, right: ApiRoute): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Path patterns (the transport half of §14)
// ---------------------------------------------------------------------------

/** Parse one path pattern: segments + the declared `:params` (in order). */
export function parsePathPattern(pattern: string): {
  segments: readonly string[];
  params: readonly string[];
} {
  const parts = pattern.split("/").filter((segment) => segment.length > 0);
  const params: string[] = [];
  const segments: string[] = [];
  for (const part of parts) {
    if (part.startsWith(":")) {
      params.push(part.slice(1));
      segments.push(part);
    } else {
      segments.push(part);
    }
  }
  return { segments, params };
}

// ---------------------------------------------------------------------------
// The default table's drift anchor (the SDK binds to this at compile time)
// ---------------------------------------------------------------------------

/**
 * The stable lineage names of the default table's routes, in canonical
 * order. This const is the COMPILE-TIME drift anchor `packages/sdk` binds
 * its method surface to (`satisfies` + `Exclude` guards — see
 * `packages/sdk/client.ts`); the default table's own test proves the runtime
 * twin (the table's names deep-equal this list).
 */
export const WORLD_ALPHA_ROUTE_NAMES = [
  "evidence-artifact",
  "evidence-dataset",
  "evidence-event",
  "evidence-view",
  "health",
  "organization-compile",
  "organization-get",
  "route-table",
  "time-machine-view-create",
  "time-machine-view-get",
] as const;

/** The route-name type of the default table (literal union — the drift anchor). */
export type WorldAlphaRouteName = (typeof WORLD_ALPHA_ROUTE_NAMES)[number];
