/**
 * Fail-closed validation (W059) — the route-table construction laws + the
 * whole-record re-validation.
 *
 * Two gates live here:
 * - `buildRouteTable`: fail-closed CONSTRUCTION — every law checked, every
 *   violation collected (the W004 `validateEventStream` discipline: the
 *   declarer sees ALL problems, never just the first). Unique route ids,
 *   closed methods, §14 scope presence/coherence, W028 provenance
 *   citations on data-carrying responses, R016 explicit cutoffs, canonical
 *   order, content-addressed ids minted on success.
 * - `validateRouteTable`: whole-record RE-VALIDATION of a table whose ids
 *   were minted elsewhere — each route id RE-DERIVED from its own recorded
 *   content, the table id re-derived, every law re-proven (the W050
 *   `validatePointInTimeView` pattern).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  API_METHODS,
  API_ROUTE_SCOPE_KINDS,
  API_VERSIONS,
  PROVENANCE_ENTITY_KINDS,
  REQUEST_FIELD_KINDS,
  RESPONSE_FIELD_KINDS,
  ROUTE_PAYLOAD_TYPE_NAMES,
  SCOPE_MEMBERS_OF,
  API_ROUTE_TABLE_ID_PREFIX,
  compareRoutes,
  parsePathPattern,
  routeIdOf,
  tableIdOf,
  type ApiRoute,
  type ApiRouteTable,
  type ApiVersion,
} from "./routes.js";
import {
  routeTableViolation,
  type RouteTableViolation,
} from "./errors.js";
import { requireExplicitCutoff } from "./point-in-time.js";

/** The whole-record re-validation outcome. */
export type RouteTableValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly RouteTableViolation[] };

/** The construction outcome: the lawful table, or every law violated. */
export type RouteTableOutcome =
  | { readonly ok: true; readonly table: ApiRouteTable }
  | { readonly ok: false; readonly violations: readonly RouteTableViolation[] };

/** Every per-route law (used by construction AND whole-record re-validation). */
function validateDeclaration(
  route: Omit<ApiRoute, "routeId">,
): readonly RouteTableViolation[] {
  const violations: RouteTableViolation[] = [];
  if (
    typeof route?.name !== "string" ||
    route.name.trim().length === 0
  ) {
    violations.push(
      routeTableViolation("blank-route-name", "route name is blank"),
    );
    return violations;
  }
  const routeName = route.name;
  const bad = (code: RouteTableViolation["code"], message: string): void => {
    violations.push(routeTableViolation(code, message, routeName));
  };
  if (
    typeof route.description !== "string" ||
    route.description.trim().length === 0
  ) {
    bad("blank-description", "route description is blank");
  }
  if (!API_METHODS.includes(route.method)) {
    bad("unknown-method", `method ${JSON.stringify(String(route.method))} is outside the closed set`);
  }
  if (!API_VERSIONS.includes(route.version)) {
    bad("version-mismatch", `route version ${JSON.stringify(String(route.version))} is outside the closed set`);
  }
  if (
    route.family !== "platform" &&
    route.family !== "evidence" &&
    route.family !== "time-machine" &&
    route.family !== "organization"
  ) {
    bad("unknown-family", `route family ${JSON.stringify(String(route.family))} is outside the closed set`);
  }
  // §14: the scope is explicit AND the scope members ARE the path params.
  if (!API_ROUTE_SCOPE_KINDS.includes(route.scope)) {
    bad("scope-missing", `scope kind ${JSON.stringify(String(route.scope))} is outside the closed hierarchy`);
  }
  if (
    typeof route.path !== "string" ||
    !route.path.startsWith("/") ||
    route.path.endsWith("/") ||
    route.path.includes("//") ||
    route.path
      .split("/")
      .slice(1)
      .some((segment) => segment.trim().length === 0)
  ) {
    bad("invalid-path", `path ${JSON.stringify(String(route.path))} violates the pattern law (leading /, no trailing /, no blank segments)`);
  } else {
    const { params } = parsePathPattern(route.path);
    const members = API_ROUTE_SCOPE_KINDS.includes(route.scope)
      ? SCOPE_MEMBERS_OF[route.scope]
      : [];
    const explicit = members.every(
      (member) =>
        params.filter((param) => param === member).length === 1,
    );
    if (!explicit) {
      bad("scope-mismatch", `every scope member [${members.join(", ")}] must appear exactly once among the path params [${params.join(", ")}] (§14: identity explicit in transport)`);
    }
    if (new Set(params).size !== params.length) {
      bad("invalid-path", `path declares a parameter twice: ${route.path}`);
    }
    if (route.path.split("/")[1] !== route.version) {
      bad("invalid-path", `path ${route.path} does not start with the version segment /${route.version}`);
    }
  }
  // Request schema laws.
  const requestFields = Array.isArray(route.request?.fields)
    ? route.request.fields
    : [];
  const seenReq = new Set<string>();
  for (const field of requestFields) {
    if (typeof field?.name !== "string" || field.name.trim().length === 0) {
      bad("blank-route-name", "a request field name is blank");
      continue;
    }
    if (seenReq.has(field.name)) {
      bad("duplicate-field-name", `request field ${JSON.stringify(field.name)} is declared twice`);
    }
    seenReq.add(field.name);
    if (!REQUEST_FIELD_KINDS.includes(field.kind)) {
      bad("unknown-field-kind", `request field ${JSON.stringify(field.name)} kind ${JSON.stringify(String(field.kind))} is outside the closed set`);
    }
  }
  // Response schema laws (the W028 provenance citation).
  const response = route.response;
  if (response === null || typeof response !== "object") {
    bad("provenance-missing", "response schema is absent");
    return violations;
  }
  if (!ROUTE_PAYLOAD_TYPE_NAMES.includes(response.payloadType)) {
    bad("unknown-payload-type", `payload type ${JSON.stringify(String(response.payloadType))} is outside the closed set`);
  }
  const responseFields = Array.isArray(response.fields)
    ? response.fields
    : [];
  const dataCarrying = responseFields.length > 0;
  const citation = response.provenance;
  if (dataCarrying && (citation === null || typeof citation !== "object")) {
    bad("provenance-missing", "data-carrying response without a provenance citation (W028)");
  } else if (
    citation !== null &&
    typeof citation === "object" &&
    citation.kind === "evidence-projection"
  ) {
    if (!Array.isArray(citation.entities) || citation.entities.length === 0) {
      bad("provenance-entities-empty", "an evidence-projection citation must name at least one W028 entity");
    } else if (
      citation.entities.some(
        (entity) => !PROVENANCE_ENTITY_KINDS.includes(entity),
      )
    ) {
      bad("provenance-entities-empty", `citation entity outside W028's closed vocabulary: ${citation.entities.map(String).join(", ")}`);
    }
  } else if (dataCarrying && citation?.kind !== "no-declared-source") {
    bad("provenance-missing", "data-carrying response without a provenance citation (W028)");
  }
  const seenRes = new Set<string>();
  let carriesProvenanceField = false;
  for (const field of responseFields) {
    if (typeof field?.name !== "string" || field.name.trim().length === 0) {
      bad("blank-route-name", "a response field name is blank");
      continue;
    }
    if (seenRes.has(field.name)) {
      bad("duplicate-field-name", `response field ${JSON.stringify(field.name)} is declared twice`);
    }
    seenRes.add(field.name);
    if (!RESPONSE_FIELD_KINDS.includes(field.kind)) {
      bad("unknown-field-kind", `response field ${JSON.stringify(field.name)} kind ${JSON.stringify(String(field.kind))} is outside the closed set`);
    }
    if (field.kind === "provenance-citation") {
      carriesProvenanceField = true;
    }
  }
  if (dataCarrying && !carriesProvenanceField) {
    bad("provenance-field-missing", "no response field of kind provenance-citation carries the W028 citation on the wire");
  }
  if (!dataCarrying && carriesProvenanceField) {
    bad("provenance-field-missing", "a no-payload response may not declare a provenance-citation field");
  }
  // The R016 law (owned by ./point-in-time.ts).
  violations.push(...requireExplicitCutoff(route));
  return violations;
}

/**
 * Build the route table, fail-closed: every law checked, every violation
 * collected. On success the routes are frozen, carried in canonical (name)
 * order, each with its content-derived versioned route id, and the table
 * carries its content-addressed id (A9: same declarations ⇒ same ids).
 */
export function buildRouteTable(
  declarations: readonly Omit<ApiRoute, "routeId">[],
  apiVersion: ApiVersion = "v1",
): RouteTableOutcome {
  if (!API_VERSIONS.includes(apiVersion)) {
    return {
      ok: false,
      violations: [
        routeTableViolation("version-mismatch", `table version ${JSON.stringify(String(apiVersion))} is outside the closed set`),
      ],
    };
  }
  const violations: RouteTableViolation[] = [];
  const names = new Set<string>();
  const methodPaths = new Set<string>();
  const idCounts = new Map<string, string>();
  for (const declaration of declarations) {
    violations.push(...validateDeclaration(declaration));
    if (
      typeof declaration?.name === "string" &&
      declaration.name.trim().length > 0
    ) {
      if (names.has(declaration.name)) {
        violations.push(
          routeTableViolation("duplicate-route-name", `route name ${JSON.stringify(declaration.name)} is declared twice — the lineage is immutable, one version per table`, declaration.name),
        );
      }
      names.add(declaration.name);
      const id = routeIdOf(declaration);
      const firstNamed = idCounts.get(id);
      if (firstNamed !== undefined) {
        violations.push(
          routeTableViolation("duplicate-route-id", `route id ${id} minted twice (byte-identical content: ${JSON.stringify(firstNamed)} and ${JSON.stringify(declaration.name)})`, declaration.name),
        );
      } else {
        idCounts.set(id, declaration.name);
      }
    }
    if (
      typeof declaration?.method === "string" &&
      typeof declaration?.path === "string"
    ) {
      const key = `${declaration.method} ${declaration.path}`;
      if (methodPaths.has(key)) {
        violations.push(
          routeTableViolation("duplicate-method-path", `the (method, path) ${key} is claimed twice`, typeof declaration.name === "string" ? declaration.name : undefined),
        );
      }
      methodPaths.add(key);
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const routes: ApiRoute[] = declarations.map((declaration) =>
    Object.freeze({ ...declaration, routeId: routeIdOf(declaration) }),
  );
  const sorted = [...routes].sort(compareRoutes);
  const table: ApiRouteTable = Object.freeze({
    tableId: tableIdOf(apiVersion, sorted),
    apiVersion,
    routes: Object.freeze(sorted),
  });
  return { ok: true, table };
}

/**
 * Whole-record re-validation: every law re-proven against the RECORDED
 * data, every id RE-DERIVED (a table whose recorded route id does not
 * re-derive from its own content is a tampered record — refused loudly),
 * the canonical order and the table id re-derived, the version law held.
 */
export function validateRouteTable(
  table: ApiRouteTable,
): RouteTableValidation {
  const violations: RouteTableViolation[] = [];
  if (!API_VERSIONS.includes(table?.apiVersion)) {
    violations.push(
      routeTableViolation("version-mismatch", `table version ${JSON.stringify(String(table?.apiVersion))} is outside the closed set`),
    );
    return { ok: false, violations };
  }
  const routes = Array.isArray(table?.routes) ? table.routes : [];
  const names = new Set<string>();
  const methodPaths = new Set<string>();
  for (const route of routes) {
    violations.push(...validateDeclaration(route));
    // The id re-derivation (the whole-record re-proof).
    if (typeof route?.routeId === "string" && route.routeId !== routeIdOf(route)) {
      violations.push(
        routeTableViolation("route-id-mismatch", `route ${JSON.stringify(String(route?.name))} recorded id ${JSON.stringify(String(route.routeId))} does not re-derive from its own content`, typeof route?.name === "string" ? route.name : undefined),
      );
    }
    if (route.version !== table.apiVersion) {
      violations.push(
        routeTableViolation("version-mismatch", `route ${JSON.stringify(String(route?.name))} version ${JSON.stringify(String(route?.version))} ≠ table version ${table.apiVersion}`, typeof route?.name === "string" ? route.name : undefined),
      );
    }
    if (typeof route?.name === "string") {
      if (names.has(route.name)) {
        violations.push(
          routeTableViolation("duplicate-route-name", `route name ${JSON.stringify(route.name)} appears twice`, route.name),
        );
      }
      names.add(route.name);
    }
    if (typeof route?.method === "string" && typeof route?.path === "string") {
      const key = `${route.method} ${route.path}`;
      if (methodPaths.has(key)) {
        violations.push(
          routeTableViolation("duplicate-method-path", `the (method, path) ${key} is claimed twice`, typeof route?.name === "string" ? route.name : undefined),
        );
      }
      methodPaths.add(key);
    }
  }
  // The canonical order + the table-id re-derivation.
  const canonical = [...routes].sort(compareRoutes);
  if (
    routes.length === canonical.length &&
    routes.some((route, index) => route !== canonical[index])
  ) {
    violations.push(
      routeTableViolation("non-canonical-order", "routes are not carried in canonical (name) order"),
    );
  }
  if (typeof table?.tableId === "string") {
    const derived = tableIdOf(table.apiVersion, canonical);
    if (table.tableId !== derived) {
      violations.push(
        routeTableViolation("table-id-mismatch", `recorded table id ${JSON.stringify(table.tableId)} does not re-derive (expected ${API_ROUTE_TABLE_ID_PREFIX}<digest> over the canonical route ids)`),
      );
    }
  } else {
    violations.push(
      routeTableViolation("table-id-mismatch", "table id is absent"),
    );
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
