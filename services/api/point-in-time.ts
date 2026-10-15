/**
 * The time-machine route family (W059) — point-in-time views exposed ONLY
 * with EXPLICIT cutoff parameters.
 *
 * Spec: spec/REQUIREMENTS.md R016 — "Runtime point-in-time information
 * firewall": a point-in-time route NEVER implies "latest". The cutoff is a
 * REQUIRED, EXPLICIT request field (`cutoff`, kind `simulation-time`) on
 * EVERY route of this family — an implicit-latest route is a LOUD typed
 * violation (`implicit-latest-cutoff`), refused at table construction.
 *
 * The family surfaces W050's own contract vocabulary:
 * - `PointInTimeQuery` / `PointInTimeView` (the `tradrl-time-machine`
 *   contract package) — the view-retrieval route's payload;
 * - `AssembledPointInTimeView` (the `services/time-machine` pure query
 *   engine) — the view-creation route's payload;
 * - `TIME_MACHINE_FAMILIES` — the closed record-family vocabulary the
 *   `record-family-set` request field kind validates against.
 *
 * A14: contracts only — the routes are DATA; the serving engine (W062)
 * executes them, the security gate (W060) governs their visibility.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ApiRouteDeclaration } from "./routes.js";
import { routeTableViolation, type RouteTableViolation } from "./errors.js";

/** The family tag every time-machine route carries. */
export const TIME_MACHINE_ROUTE_FAMILY = "time-machine" as const;

/** The requirement this family's law enforces (carried in every refusal). */
export const POINT_IN_TIME_LAW = "R016" as const;

/** The REQUIRED explicit cutoff request field's name. */
export const POINT_IN_TIME_CUTOFF_FIELD = "cutoff" as const;

/**
 * THE POINT-IN-TIME LAW (R016): every time-machine route MUST declare an
 * explicit, required `cutoff` request field of kind `simulation-time`.
 * A route of this family without it is an implicit-latest route — refused
 * loudly, never silently repaired.
 */
export function requireExplicitCutoff(
  route: ApiRouteDeclaration,
): readonly RouteTableViolation[] {
  if (route.family !== TIME_MACHINE_ROUTE_FAMILY) {
    return [];
  }
  const fields = Array.isArray(route.request?.fields)
    ? route.request.fields
    : [];
  const cutoffField = fields.find(
    (field) => field.name === POINT_IN_TIME_CUTOFF_FIELD,
  );
  if (cutoffField === undefined) {
    return [
      routeTableViolation(
        "implicit-latest-cutoff",
        `time-machine route ${JSON.stringify(route.name)} declares no cutoff field — point-in-time views are NEVER implicit-latest (${POINT_IN_TIME_LAW})`,
        route.name,
      ),
    ];
  }
  if (!cutoffField.required || cutoffField.kind !== "simulation-time") {
    return [
      routeTableViolation(
        "implicit-latest-cutoff",
        `time-machine route ${JSON.stringify(route.name)} field ${JSON.stringify(POINT_IN_TIME_CUTOFF_FIELD)} must be required and of kind simulation-time — the cutoff is an explicit declared point on the simulation axis (${POINT_IN_TIME_LAW})`,
        route.name,
      ),
    ];
  }
  return [];
}

/**
 * The time-machine family's route DECLARATIONS (typed data — the table
 * mints the content-addressed ids at construction):
 * - `time-machine-view-create` — seal one point-in-time view: the explicit
 *   `cutoff` + the declared record `families` (W050's closed set) go on the
 *   request; the response is the engine's `AssembledPointInTimeView`;
 * - `time-machine-view-get` — retrieve one sealed view BY its opaque id at
 *   an explicit declared cutoff (the declared retrieval point; the view's
 *   own sealed cutoff never exceeds it) — the response is W050's
 *   `PointInTimeView` contract datum.
 */
export function pointInTimeRouteDeclarations(): readonly ApiRouteDeclaration[] {
  const worldScope = "/v1/tenants/:tenantId/projects/:projectId/worlds/:worldId";
  return [
    {
      name: "time-machine-view-create",
      family: TIME_MACHINE_ROUTE_FAMILY,
      visibility: "private",
      version: "v1",
      method: "POST",
      path: `${worldScope}/time-machine/views`,
      scope: "tenant-project-world",
      request: {
        fields: [
          {
            name: "cutoff",
            kind: "simulation-time",
            required: true,
            description: "The explicit point-in-time cutoff on the simulation axis at which the view is sealed (R016 — never implicit-latest).",
          },
          {
            name: "families",
            kind: "record-family-set",
            required: true,
            description: "The declared record families the view may contain (W050's closed family vocabulary).",
          },
        ],
      },
      response: {
        payloadType: "AssembledPointInTimeView",
        fields: [
          { name: "viewId", kind: "record-id", required: true, description: "The sealed view's opaque content-addressed id." },
          { name: "cutoff", kind: "simulation-time", required: true, description: "The cutoff the view was sealed at." },
          { name: "records", kind: "json", required: true, description: "The sealed view records in canonical order." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 evidence citation for the view's records." },
        ],
        provenance: { kind: "evidence-projection", entities: ["event"] },
      },
      description: "Seal one point-in-time view (W050): every knowable record at the explicit declared cutoff.",
    },
    {
      name: "time-machine-view-get",
      family: TIME_MACHINE_ROUTE_FAMILY,
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${worldScope}/time-machine/views/:viewId`,
      scope: "tenant-project-world",
      request: {
        fields: [
          {
            name: "cutoff",
            kind: "simulation-time",
            required: true,
            description: "The explicit declared retrieval cutoff — the view is returned only as sealed at or before this point (R016 — never implicit-latest).",
          },
        ],
      },
      response: {
        payloadType: "PointInTimeView",
        fields: [
          { name: "viewId", kind: "record-id", required: true, description: "The sealed view's opaque content-addressed id." },
          { name: "cutoff", kind: "simulation-time", required: true, description: "The cutoff the view was sealed at." },
          { name: "records", kind: "json", required: true, description: "The sealed view records in canonical order." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 evidence citation for the view's records." },
        ],
        provenance: { kind: "evidence-projection", entities: ["event"] },
      },
      description: "Retrieve one sealed point-in-time view (W050) by its opaque id at an explicit declared cutoff.",
    },
  ];
}
