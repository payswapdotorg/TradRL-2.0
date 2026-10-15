/**
 * The SDK method surface (W059) — a DETERMINISTIC PROJECTION of the route
 * table: one method per route, compile-time typed, drift-guarded.
 *
 * The drift guard runs BOTH ways:
 * - compile time: `SDK_SURFACE_ROUTE_NAMES satisfies readonly
 *   WorldAlphaRouteName[]` (every SDK name is a real route name) and
 *   `SdkDriftGuard` (every default-table route name has an SDK method —
 *   `Exclude<WorldAlphaRouteName, SdkSurfaceRouteName> extends never`);
 *   a drifted table STOPS TYPE-CHECKING this package;
 * - run time: `assertSdkSurfaceCoversRouteTable` refuses any table whose
 *   route names are not exactly the SDK surface (both directions) — the
 *   A9 twin for arbitrary tables.
 *
 * The method surface mirrors the route table data: the bindings are
 * DERIVED (deterministic camelCase names from the stable route lineage
 * names, carried in the table's canonical order), never hand-written; the
 * per-method request builder + response validator are the route's own
 * contracts (`builders.ts`). A14: no network I/O — W062 owns the transport.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  type ApiRoute,
  type ApiRouteTable,
  type ApiRouteScopeKind,
  type ApiMethod,
  type WorldAlphaRouteName,
} from "api";
import {
  buildSdkRequest,
  validateSdkResponse,
  type SdkError,
  type SdkRequestInput,
  type SdkRequestOutcome,
  type SdkResponseOutcome,
} from "./builders.js";

// ---------------------------------------------------------------------------
// The compile-time drift guard (the anchor the surface binds to)
// ---------------------------------------------------------------------------

/**
 * The route names this SDK version mirrors — one method per route, exactly
 * the default table's names. `satisfies` proves every name is a REAL route
 * name; `SdkDriftGuard` below proves the table has no route without a
 * method. BOTH directions are compile-time: drift breaks the typecheck.
 */
export const SDK_SURFACE_ROUTE_NAMES = [
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
] as const satisfies readonly WorldAlphaRouteName[];

/** The SDK surface's route-name type (the literal union). */
export type SdkSurfaceRouteName = (typeof SDK_SURFACE_ROUTE_NAMES)[number];

/** The default-table routes missing from this SDK surface (must be never). */
export type SdkDriftMissingRoute = Exclude<WorldAlphaRouteName, SdkSurfaceRouteName>;

/**
 * The compile-time drift guard: `true` iff the surface mirrors the default
 * table exactly. If a route is added to the api table without this SDK
 * gaining its method, this type stops being `true` and `SDK_DRIFT_GUARD`
 * below stops compiling (the typecheck fails — drift is never silent).
 */
export type SdkDriftGuard = [SdkDriftMissingRoute] extends [never]
  ? true
  : "SDK surface drifted from the route table — mirror the missing route";

/** The drift guard value (compile-time proof carried as data). */
export const SDK_DRIFT_GUARD: SdkDriftGuard = true;

// ---------------------------------------------------------------------------
// The method bindings (the deterministic projection)
// ---------------------------------------------------------------------------

/**
 * The deterministic method-name derivation: a route's stable kebab-case
 * lineage name → its camelCase method name (`evidence-view` →
 * `evidenceView`). Pure: the same route name always yields the same method
 * name.
 */
export function sdkMethodNameOf(routeName: string): string {
  return routeName
    .split("-")
    .map((segment, index) =>
      index === 0
        ? segment
        : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
    )
    .join("");
}

/** One route's SDK method: the binding that mirrors the route contract. */
export interface SdkMethodBinding {
  readonly methodName: string;
  readonly routeName: string;
  readonly routeId: string;
  readonly method: ApiMethod;
  readonly pathPattern: string;
  readonly scope: ApiRouteScopeKind;
  /** Build (and validate) one request for this route — fail-closed. */
  buildRequest(input: SdkRequestInput): SdkRequestOutcome;
  /** Re-validate one response for this route — never trusts the wire. */
  validateResponse(payload: unknown): SdkResponseOutcome;
}

/** The typed client surface: one method per route, canonical order. */
export interface SdkClient {
  readonly tableId: string;
  readonly apiVersion: string;
  readonly methods: readonly SdkMethodBinding[];
  readonly byMethodName: Readonly<Record<string, SdkMethodBinding>>;
  readonly byRouteName: Readonly<Record<string, SdkMethodBinding>>;
  /** Build one request by route name (delegates to the method binding). */
  invoke(routeName: string, input: SdkRequestInput): SdkRequestOutcome;
  /** Re-validate one response by route name (delegates to the binding). */
  receive(routeName: string, payload: unknown): SdkResponseOutcome;
}

/** The client construction outcome: the client, or every law violated. */
export type SdkClientOutcome =
  | { readonly ok: true; readonly client: SdkClient }
  | { readonly ok: false; readonly errors: readonly SdkError[] };

const UNKNOWN_ROUTE: SdkError = {
  code: "unknown-route",
  message: "no route of that name in the bound table",
};

// ---------------------------------------------------------------------------
// The runtime drift guard (the A9 twin for arbitrary tables)
// ---------------------------------------------------------------------------

/**
 * Assert the SDK surface covers a route table EXACTLY — both directions:
 * a table route without an SDK method is drift (`unknown-route`), an SDK
 * method without a table route is drift too. Fail-closed, collected.
 */
export function assertSdkSurfaceCoversRouteTable(
  table: ApiRouteTable,
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly SdkError[] } {
  const surface = new Set<string>(SDK_SURFACE_ROUTE_NAMES);
  const tableNames = new Set<string>(
    (table?.routes ?? []).map((route) => route?.name),
  );
  const errors: SdkError[] = [];
  for (const name of tableNames) {
    if (!surface.has(name)) {
      errors.push({
        code: "unknown-route",
        message: `table route ${JSON.stringify(name)} has no SDK method — the surface drifted`,
      });
    }
  }
  for (const name of surface) {
    if (!tableNames.has(name)) {
      errors.push({
        code: "unknown-route",
        message: `SDK method ${JSON.stringify(sdkMethodNameOf(name))} has no table route — the surface drifted`,
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// The client construction (deterministic projection of the table)
// ---------------------------------------------------------------------------

/**
 * Build the typed client for one route table, fail-closed: the drift guard
 * first (the surface must mirror the table exactly), then the deterministic
 * projection — one method binding per route, derived camelCase names
 * (collisions refused loudly), carried in the table's canonical order.
 */
export function buildSdkClient(table: ApiRouteTable): SdkClientOutcome {
  const coverage = assertSdkSurfaceCoversRouteTable(table);
  if (!coverage.ok) {
    return { ok: false, errors: coverage.errors };
  }
  const errors: SdkError[] = [];
  const bindings = new Map<string, SdkMethodBinding>();
  const byMethodName: Record<string, SdkMethodBinding> = {};
  const byRouteName: Record<string, SdkMethodBinding> = {};
  const methods: SdkMethodBinding[] = [];
  for (const route of table.routes) {
    const methodName = sdkMethodNameOf(route.name);
    if (bindings.has(methodName)) {
      errors.push({
        code: "unknown-route",
        message: `method name ${JSON.stringify(methodName)} collides between routes (the camelCase projection must be injective)`,
      });
      continue;
    }
    const binding = methodBindingOf(table, route, methodName);
    bindings.set(methodName, binding);
    byMethodName[methodName] = binding;
    byRouteName[route.name] = binding;
    methods.push(binding);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const client: SdkClient = Object.freeze({
    tableId: table.tableId,
    apiVersion: table.apiVersion,
    methods: Object.freeze(methods),
    byMethodName: Object.freeze(byMethodName),
    byRouteName: Object.freeze(byRouteName),
    invoke(routeName: string, input: SdkRequestInput): SdkRequestOutcome {
      const route = table.routes.find((candidate) => candidate.name === routeName);
      if (route === undefined) {
        return { ok: false, errors: [UNKNOWN_ROUTE] };
      }
      return buildSdkRequest(table.tableId, route, input);
    },
    receive(routeName: string, payload: unknown): SdkResponseOutcome {
      const route = table.routes.find((candidate) => candidate.name === routeName);
      if (route === undefined) {
        return { ok: false, errors: [UNKNOWN_ROUTE] };
      }
      return validateSdkResponse(route, payload);
    },
  });
  return { ok: true, client };
}

function methodBindingOf(
  table: ApiRouteTable,
  route: ApiRoute,
  methodName: string,
): SdkMethodBinding {
  return Object.freeze({
    methodName,
    routeName: route.name,
    routeId: route.routeId,
    method: route.method,
    pathPattern: route.path,
    scope: route.scope,
    buildRequest(input: SdkRequestInput): SdkRequestOutcome {
      return buildSdkRequest(table.tableId, route, input);
    },
    validateResponse(payload: unknown): SdkResponseOutcome {
      return validateSdkResponse(route, payload);
    },
  });
}
