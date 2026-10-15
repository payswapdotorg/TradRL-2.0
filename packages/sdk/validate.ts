/**
 * Whole-record re-validation (W059 `packages/sdk`) — the SDK's own records
 * re-proven: the client surface re-derived from the table, the prepared
 * request re-derived from its recorded data.
 *
 * - `validateSdkClient`: every method binding re-derived (deterministic
 *   camelCase names, canonical order, route ids/methods/paths/scopes
 *   re-bound to the table), the table id re-asserted, the drift guard
 *   re-run — a client whose surface does not re-derive is refused loudly.
 * - `validateSdkPreparedRequest`: the route re-resolved by its recorded
 *   route id, every §14/path/field law re-checked against the recorded
 *   input, and the content-addressed prepared-request id RE-DERIVED (a
 *   tampered record does not re-derive — the W050 whole-record pattern).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  SCOPE_MEMBERS_OF,
  type ApiRouteTable,
} from "api";
import { isLegalCutoff, TIME_MACHINE_FAMILIES } from "tradrl-time-machine";
import {
  sdkPreparedRequestIdOf,
  type SdkError,
  type SdkPreparedRequest,
} from "./builders.js";
import { buildSdkClient, type SdkClient } from "./client.js";

/** The re-validation outcome: ok, or every collected violation. */
export type SdkValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SdkError[] };

/**
 * Whole-record re-validation of one SDK client against its table: the
 * surface re-derived (one binding per route, canonical order, deterministic
 * names), every binding's route contract re-bound (route id, method, path
 * pattern, scope kind), the table id re-asserted.
 */
export function validateSdkClient(
  client: SdkClient,
  table: ApiRouteTable,
): SdkValidation {
  const errors: SdkError[] = [];
  if (client?.tableId !== table?.tableId) {
    errors.push({
      code: "unknown-route",
      message: `client table id ${JSON.stringify(String(client?.tableId))} ≠ the table's ${JSON.stringify(String(table?.tableId))}`,
    });
  }
  if (client?.apiVersion !== table?.apiVersion) {
    errors.push({
      code: "unknown-route",
      message: `client api version ${JSON.stringify(String(client?.apiVersion))} ≠ the table's ${JSON.stringify(String(table?.apiVersion))}`,
    });
  }
  const expected = buildSdkClient(table);
  if (!expected.ok) {
    return { ok: false, errors: [...errors, ...expected.errors] };
  }
  const derived = expected.client;
  const methods = Array.isArray(client?.methods) ? client.methods : [];
  if (methods.length !== derived.methods.length) {
    errors.push({
      code: "unknown-route",
      message: `client carries ${methods.length} methods; the table projects ${derived.methods.length}`,
    });
  }
  for (let index = 0; index < methods.length; index += 1) {
    const recorded = methods[index];
    const projection = derived.methods[index];
    if (recorded === undefined || projection === undefined) {
      continue;
    }
    if (recorded.methodName !== projection.methodName) {
      errors.push({
        code: "unknown-route",
        message: `method ${index}: recorded name ${JSON.stringify(recorded.methodName)} ≠ the derived ${JSON.stringify(projection.methodName)}`,
      });
    }
    if (recorded.routeName !== projection.routeName) {
      errors.push({
        code: "unknown-route",
        message: `method ${JSON.stringify(recorded.methodName)}: recorded route ${JSON.stringify(recorded.routeName)} ≠ the derived ${JSON.stringify(projection.routeName)}`,
      });
    }
    if (recorded.routeId !== projection.routeId) {
      errors.push({
        code: "unknown-route",
        message: `method ${JSON.stringify(recorded.methodName)}: recorded route id does not re-derive`,
      });
    }
    if (recorded.method !== projection.method || recorded.pathPattern !== projection.pathPattern || recorded.scope !== projection.scope) {
      errors.push({
        code: "unknown-route",
        message: `method ${JSON.stringify(recorded.methodName)}: the recorded route contract (method/path/scope) does not re-derive`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * Whole-record re-validation of one prepared request: the route
 * re-resolved by its recorded route id (in the table), the §14 scope law,
 * the path law and the closed field law re-checked against the recorded
 * data, and the content-addressed prepared-request id RE-DERIVED — a
 * tampered record does not re-derive and is refused loudly.
 */
export function validateSdkPreparedRequest(
  prepared: SdkPreparedRequest,
  table: ApiRouteTable,
): SdkValidation {
  const errors: SdkError[] = [];
  const route = (table?.routes ?? []).find(
    (candidate) => candidate.routeId === prepared?.routeId,
  );
  if (route === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown-route",
          message: `prepared request's route id ${JSON.stringify(String(prepared?.routeId))} resolves to no route in the bound table`,
        },
      ],
    };
  }
  if (route.name !== prepared.routeName) {
    errors.push({
      code: "unknown-route",
      message: `prepared request's route name ${JSON.stringify(String(prepared?.routeName))} ≠ the resolved route's ${JSON.stringify(route.name)}`,
    });
  }
  if (prepared.tableId !== table.tableId) {
    errors.push({
      code: "unknown-route",
      message: "prepared request's table id ≠ the bound table's",
    });
  }
  if (prepared.apiVersion !== table.apiVersion) {
    errors.push({
      code: "unknown-route",
      message: "prepared request's api version ≠ the bound table's",
    });
  }
  // The §14 scope law, re-checked.
  const members = SCOPE_MEMBERS_OF[route.scope];
  for (const member of members) {
    const value = prepared?.scope?.[member];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push({
        code: "scope-member-blank",
        message: `recorded scope member ${JSON.stringify(member)} is blank — the scope must be explicit (§14)`,
      });
    }
  }
  for (const member of Object.keys(prepared?.scope ?? {})) {
    if (!members.includes(member as never)) {
      errors.push({
        code: "scope-member-unexpected",
        message: `recorded scope member ${JSON.stringify(member)} is not demanded by the route`,
      });
    }
  }
  // The path law, re-checked: the materialized path re-derives.
  let expectedPath = route.path;
  for (const member of members) {
    expectedPath = expectedPath.replace(`:${member}`, String(prepared?.scope?.[member] ?? ""));
  }
  for (const [name, value] of Object.entries(prepared?.pathParams ?? {})) {
    expectedPath = expectedPath.replace(`:${name}`, String(value));
  }
  if (prepared.path !== expectedPath) {
    errors.push({
      code: "path-param-missing",
      message: `recorded path ${JSON.stringify(String(prepared?.path))} does not re-derive from the route pattern and the recorded scope`,
    });
  }
  // The closed field law, re-checked.
  for (const field of route.request.fields) {
    const value = prepared?.fields?.[field.name];
    if (value === undefined) {
      if (field.required) {
        errors.push({
          code: "field-missing",
          message: `required field ${JSON.stringify(field.name)} is absent from the recorded request`,
        });
      }
      continue;
    }
    const violation = fieldKindViolation(field.kind, value);
    if (violation !== undefined) {
      errors.push({
        code: "field-kind",
        message: `recorded field ${JSON.stringify(field.name)}: ${violation}`,
      });
    }
  }
  for (const name of Object.keys(prepared?.fields ?? {})) {
    if (!route.request.fields.some((field) => field.name === name)) {
      errors.push({
        code: "field-unknown",
        message: `recorded field ${JSON.stringify(name)} is outside the route's closed request schema`,
      });
    }
  }
  // The id re-derivation (the whole-record re-proof).
  if (route.name === prepared.routeName) {
    const derivedId = sdkPreparedRequestIdOf(
      table.tableId,
      route,
      prepared.path,
      prepared.scope ?? {},
      prepared.fields ?? {},
    );
    if (prepared.preparedRequestId !== derivedId) {
      errors.push({
        code: "unknown-route",
        message: `recorded prepared-request id ${JSON.stringify(String(prepared?.preparedRequestId))} does not re-derive from its own content`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/** The field-kind law, re-checked (mirrors `builders.ts` — one closed set). */
function fieldKindViolation(
  kind: string,
  value: unknown,
): string | undefined {
  switch (kind) {
    case "string":
    case "record-id":
      return typeof value === "string" && value.trim().length > 0
        ? undefined
        : "must be a non-empty string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? undefined
        : "must be an integer";
    case "simulation-time":
      return typeof value === "number" && isLegalCutoff(value)
        ? undefined
        : "must be a legal simulation-axis timestamp";
    case "record-family-set":
      return Array.isArray(value) &&
        value.every(
          (family) =>
            typeof family === "string" &&
            (TIME_MACHINE_FAMILIES as readonly string[]).includes(family),
        )
        ? undefined
        : "must be a subset of W050's closed family set";
    case "json":
      return value !== undefined && value !== null
        ? undefined
        : "must be a defined JSON value";
    default:
      return `kind ${String(kind)} is not a request-field kind`;
  }
}
