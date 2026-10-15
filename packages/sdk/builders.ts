/**
 * The typed request/response laws (W059 `packages/sdk`) — request builders
 * + response validators. The SDK RE-VALIDATES: it never trusts the wire.
 * `buildSdkRequest`: the §14 scope law (the demanded members, exactly those,
 * none blank), the path law (scope members + record ids substituted, nothing
 * unknown), the closed field-schema law (W050's own `isLegalCutoff` +
 * `TIME_MACHINE_FAMILIES` gates) + the content-addressed prepared id.
 * `validateSdkResponse`: every response re-validated against the route's
 * schema — fields present, kinds held, the W028 citation on the wire
 * MATCHING the declared one — unknown fields refused, fail-closed.
 * A14: no network I/O — the transport is W062's; the typed `SdkError`
 * family lives here (no separate errors module in the SDK's file set).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  PROVENANCE_ENTITY_KINDS,
  SCOPE_MEMBERS_OF,
  type ApiMethod,
  type ApiRoute,
  type ApiRouteId,
  type ApiRouteTableId,
  type ApiVersion,
  type RouteRequestField,
  type RouteResponseField,
} from "api";
import { isLegalCutoff, TIME_MACHINE_FAMILIES } from "tradrl-time-machine";
import { canonicalDigestHex } from "trajectory";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every refusal law named)
// ---------------------------------------------------------------------------

/** Everything the SDK refuses, loudly. */
export type SdkErrorCode =
  | "unknown-route" // no route of that name/id in the bound table
  | "scope-member-blank" // a demanded scope member is blank (§14)
  | "scope-member-unexpected" // an undeclared scope member was supplied
  | "path-param-missing" // a path parameter has no value
  | "path-param-blank" // a path parameter value is blank
  | "path-param-unknown" // a supplied parameter is not on the route's path
  | "field-missing" // a required request field is absent
  | "field-unknown" // a field outside the closed schema was supplied
  | "field-kind" // a request field value violates its declared kind
  | "response-not-object" // the response payload is not an object
  | "response-field-missing" // a required response field is absent
  | "response-field-unknown" // the response carries an undeclared field
  | "response-field-kind" // a response field value violates its declared kind
  | "response-provenance-mismatch"; // the wire citation ≠ the route's declared citation

/** One typed SDK refusal (fail-closed, collected — never just the first). */
export interface SdkError {
  readonly code: SdkErrorCode;
  readonly message: string;
}

const err = (code: SdkErrorCode, message: string): SdkError => ({ code, message });

// ---------------------------------------------------------------------------
// The request input shapes (§14 explicit identity on every call)
// ---------------------------------------------------------------------------

/** The explicit identity scope an SDK call carries. */
export interface SdkScope {
  readonly tenantId: string;
  readonly projectId?: string;
  readonly worldId?: string;
}

/** One SDK call's input: the scope, the record-id path params, the fields. */
export interface SdkRequestInput {
  readonly scope: SdkScope;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly fields?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// The prepared request (deterministic, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const sdkPreparedRequestIdBrand: unique symbol;

/** An OPAQUE prepared-request id: `sdkreq-<digest>` (never parsed). */
export type SdkPreparedRequestId = string & {
  readonly [sdkPreparedRequestIdBrand]: true;
};

/** The prepared-request id prefix (a rendering convention). */
export const SDK_PREPARED_REQUEST_ID_PREFIX = "sdkreq-";

/** One materialized route invocation — the data W062's transport will carry. */
export interface SdkPreparedRequest {
  readonly preparedRequestId: SdkPreparedRequestId;
  readonly tableId: ApiRouteTableId;
  readonly apiVersion: ApiVersion;
  readonly routeId: ApiRouteId;
  readonly routeName: string;
  readonly method: ApiMethod;
  readonly path: string;
  readonly scope: Readonly<Record<string, string>>;
  /** The record-id path parameters (carried explicitly — re-validation data). */
  readonly pathParams: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The request outcome: the prepared request, or every law violated. */
export type SdkRequestOutcome =
  | { readonly ok: true; readonly request: SdkPreparedRequest }
  | { readonly ok: false; readonly errors: readonly SdkError[] };

/** The validated response (the payload, re-proven against the contract). */
export interface SdkValidatedResponse {
  readonly routeId: ApiRouteId;
  readonly routeName: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The response outcome: the validated payload, or every law violated. */
export type SdkResponseOutcome =
  | { readonly ok: true; readonly response: SdkValidatedResponse }
  | { readonly ok: false; readonly errors: readonly SdkError[] };

// ---------------------------------------------------------------------------
// Field-kind laws (the closed sets, gated by the vocabulary owners)
// ---------------------------------------------------------------------------

function checkFieldKind(
  value: unknown,
  kind: RouteRequestField["kind"],
): string | undefined {
  switch (kind) {
    case "string":
    case "record-id":
      return typeof value === "string" && value.trim().length > 0
        ? undefined
        : "a non-empty string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? undefined
        : "an integer";
    case "simulation-time":
      return typeof value === "number" && isLegalCutoff(value)
        ? undefined
        : "a legal simulation-axis timestamp (finite non-negative integer)";
    case "record-family-set":
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (family) =>
            typeof family === "string" &&
            (TIME_MACHINE_FAMILIES as readonly string[]).includes(family),
        )
        ? undefined
        : `a non-empty subset of W050's closed family set [${TIME_MACHINE_FAMILIES.join(", ")}]`;
    case "json":
      return value !== undefined && value !== null
        ? undefined
        : "a defined JSON value";
    default:
      return `kind ${String(kind)} is not a request-field kind`;
  }
}

function checkResponseFieldKind(
  value: unknown,
  kind: RouteResponseField["kind"],
): string | undefined {
  if (kind === "provenance-citation") {
    return undefined; // the citation law is checked structurally below
  }
  return checkFieldKind(value, kind);
}

// ---------------------------------------------------------------------------
// The request builder
// ---------------------------------------------------------------------------

/**
 * Build one prepared request, fail-closed: the §14 scope law (the route's
 * demanded members, EXACTLY those, none blank — an undeclared member is a
 * violation too, never silently dropped), the path law (every parameter
 * materialized, nothing unknown), the field law (the closed schema), then
 * the content-addressed prepared-request id (A9: same input ⇒ same id).
 */
export function buildSdkRequest(
  tableId: ApiRouteTableId,
  route: ApiRoute,
  input: SdkRequestInput,
): SdkRequestOutcome {
  const errors: SdkError[] = [];
  const members = SCOPE_MEMBERS_OF[route.scope];
  const scope: Record<string, string> = {};
  const supplied = input?.scope ?? {};
  if (typeof supplied.tenantId !== "string" || supplied.tenantId.trim().length === 0) {
    errors.push(err("scope-member-blank", "tenantId is blank — the scope must be explicit (§14)"));
  } else {
    scope.tenantId = supplied.tenantId;
  }
  if (members.includes("projectId")) {
    if (typeof supplied.projectId !== "string" || supplied.projectId.trim().length === 0) {
      errors.push(err("scope-member-blank", "projectId is blank — the route demands it (§14)"));
    } else {
      scope.projectId = supplied.projectId;
    }
  } else if (supplied.projectId !== undefined) {
    errors.push(err("scope-member-unexpected", "projectId supplied but the route does not demand it"));
  }
  if (members.includes("worldId")) {
    if (typeof supplied.worldId !== "string" || supplied.worldId.trim().length === 0) {
      errors.push(err("scope-member-blank", "worldId is blank — the route demands it (§14)"));
    } else {
      scope.worldId = supplied.worldId;
    }
  } else if (supplied.worldId !== undefined) {
    errors.push(err("scope-member-unexpected", "worldId supplied but the route does not demand it"));
  }
  // The path law: scope members + record-id params materialize the path.
  const pathParams: Record<string, string> = { ...scope };
  const suppliedParams = input?.pathParams ?? {};
  for (const [name, value] of Object.entries(suppliedParams)) {
    if (pathParams[name] !== undefined) {
      errors.push(err("path-param-unknown", `path parameter ${JSON.stringify(name)} is a scope member — supply it on the scope, not the params`));
      continue;
    }
    if (!route.path.includes(`:${name}`)) {
      errors.push(err("path-param-unknown", `path parameter ${JSON.stringify(name)} is not on route ${JSON.stringify(route.name)}'s path`));
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(err("path-param-blank", `path parameter ${JSON.stringify(name)} is blank`));
      continue;
    }
    pathParams[name] = value;
  }
  let path = route.path;
  for (const parameter of route.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    const name = parameter[1]!;
    const value = pathParams[name];
    if (value === undefined) {
      errors.push(err("path-param-missing", `path parameter ${JSON.stringify(name)} has no value`));
      continue;
    }
    path = path.replace(`:${name}`, value);
  }
  // The field law: the closed request schema.
  const fields: Record<string, unknown> = {};
  const suppliedFields = input?.fields ?? {};
  for (const field of route.request.fields) {
    const value = suppliedFields[field.name];
    if (value === undefined) {
      if (field.required) {
        errors.push(err("field-missing", `required field ${JSON.stringify(field.name)} is absent`));
      }
      continue;
    }
    const expected = checkFieldKind(value, field.kind);
    if (expected !== undefined) {
      errors.push(err("field-kind", `field ${JSON.stringify(field.name)} must be ${expected}`));
      continue;
    }
    fields[field.name] = value;
  }
  for (const name of Object.keys(suppliedFields)) {
    if (!route.request.fields.some((field) => field.name === name)) {
      errors.push(err("field-unknown", `field ${JSON.stringify(name)} is outside route ${JSON.stringify(route.name)}'s closed request schema`));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const recordParams: Record<string, string> = {};
  for (const [name, value] of Object.entries(pathParams)) {
    if (scope[name] === undefined) {
      recordParams[name] = value;
    }
  }
  const prepared: SdkPreparedRequest = Object.freeze({
    preparedRequestId: sdkPreparedRequestIdOf(tableId, route, path, scope, fields),
    tableId,
    apiVersion: route.version,
    routeId: route.routeId,
    routeName: route.name,
    method: route.method,
    path,
    scope: Object.freeze({ ...scope }),
    pathParams: Object.freeze({ ...recordParams }),
    fields: Object.freeze({ ...fields }),
  });
  return { ok: true, request: prepared };
}

/** The content-addressed prepared-request id (pure — A9). */
export function sdkPreparedRequestIdOf(
  tableId: ApiRouteTableId,
  route: ApiRoute,
  path: string,
  scope: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, unknown>>,
): SdkPreparedRequestId {
  const digest = canonicalDigestHex({
    fields,
    path,
    routeId: route.routeId,
    scope,
    tableId,
  });
  return `${SDK_PREPARED_REQUEST_ID_PREFIX}${digest}` as SdkPreparedRequestId;
}

// ---------------------------------------------------------------------------
// The response validator (the SDK never trusts the wire)
// ---------------------------------------------------------------------------

/**
 * Re-validate one response payload against the route's response schema:
 * every declared field present and kind-held, the W028 provenance citation
 * on the wire MATCHING the route's declared citation (entity-for-entity),
 * and NOTHING undeclared riding along. Fail-closed, errors collected.
 */
export function validateSdkResponse(
  route: ApiRoute,
  payload: unknown,
): SdkResponseOutcome {
  const errors: SdkError[] = [];
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {
      ok: false,
      errors: [err("response-not-object", "the response payload is not an object")],
    };
  }
  const record = payload as Record<string, unknown>;
  for (const field of route.response.fields) {
    const value = record[field.name];
    if (value === undefined) {
      if (field.required) {
        errors.push(err("response-field-missing", `required response field ${JSON.stringify(field.name)} is absent`));
      }
      continue;
    }
    if (field.kind === "provenance-citation") {
      const mismatch = provenanceMismatch(route, value);
      if (mismatch !== undefined) {
        errors.push(err("response-provenance-mismatch", mismatch));
      }
      continue;
    }
    const expected = checkResponseFieldKind(value, field.kind);
    if (expected !== undefined) {
      errors.push(err("response-field-kind", `response field ${JSON.stringify(field.name)} must be ${expected}`));
    }
  }
  for (const name of Object.keys(record)) {
    if (!route.response.fields.some((field) => field.name === name)) {
      errors.push(err("response-field-unknown", `response field ${JSON.stringify(name)} is outside route ${JSON.stringify(route.name)}'s closed response schema`));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    response: Object.freeze({
      routeId: route.routeId,
      routeName: route.name,
      payload: Object.freeze({ ...record }),
    }),
  };
}

/** The W028 citation law: the wire citation must match the declared one. */
function provenanceMismatch(route: ApiRoute, value: unknown): string | undefined {
  const declared = route.response.provenance;
  if (typeof value !== "object" || value === null) {
    return "the provenance citation is not an object";
  }
  const citation = value as Record<string, unknown>;
  if (citation.kind !== declared.kind) {
    return `citation kind ${JSON.stringify(String(citation.kind))} ≠ the declared ${JSON.stringify(declared.kind)}`;
  }
  if (declared.kind === "evidence-projection") {
    const entities = citation.entities;
    if (!Array.isArray(entities)) {
      return "the evidence-projection citation carries no entities array";
    }
    for (const entity of entities) {
      if (!PROVENANCE_ENTITY_KINDS.includes(entity as never)) {
        return `citation entity ${JSON.stringify(String(entity))} is outside W028's closed vocabulary`;
      }
    }
    if (
      entities.length !== declared.entities.length ||
      [...entities].sort().join(",") !== [...declared.entities].sort().join(",")
    ) {
      return `cited entities [${entities.map(String).join(", ")}] ≠ the declared [${declared.entities.join(", ")}]`;
    }
  }
  return undefined;
}
