/**
 * The typed API error families (W059 `services/api`) — closed sets, stable
 * codes, fail-closed.
 *
 * Two families live here:
 * - the WIRE family (`ApiErrorCode` / `ApiErrorEnvelope`): the stable error
 *   codes every route may answer with — the vocabulary W062 (serving) will
 *   render and W060 (security) will gate. Contracts only: this module never
 *   serves, never executes authn/authz (A14).
 * - the TABLE family (`RouteTableErrorCode` / `RouteTableViolation`): every
 *   law a route declaration can violate when the route table is built or
 *   re-validated (unique ids, closed methods, §14 scope presence, W028
 *   provenance citations, R016 explicit cutoffs …).
 *
 * Spec: spec/REQUIREMENTS.md R071 (typed API/SDK);
 * spec/ARCHITECTURE-LOCK.md §14 (tenant/project/world identity explicit in
 * transport), A9 (determinism), A14 (contracts only).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

// ---------------------------------------------------------------------------
// The wire error family (closed set — stable codes, never renamed)
// ---------------------------------------------------------------------------

/**
 * The closed wire-error vocabulary. Codes are STABLE CONTRACT: once shipped
 * they are never renamed (clients — including `packages/sdk` — match on
 * them); additions go through a table version bump.
 */
export type ApiErrorCode =
  | "route-not-found" // no route at the materialized path/method
  | "method-not-allowed" // the path exists, the method does not
  | "scope-required" // the explicit identity scope is absent (§14)
  | "scope-member-blank" // a scope member is present but blank
  | "cutoff-required" // a point-in-time call without its explicit cutoff (R016)
  | "request-invalid" // the request failed schema validation
  | "response-invalid" // the response failed schema validation
  | "unknown-entity" // the addressed entity id does not exist
  | "version-mismatch" // the route table version is not the client's
  | "conflict"; // immutable lineage violation (e.g. redefining a sealed id)

/** The closed vocabulary in canonical (lexicographic) order. */
export const API_ERROR_CODES: readonly ApiErrorCode[] = [
  "conflict",
  "cutoff-required",
  "method-not-allowed",
  "request-invalid",
  "response-invalid",
  "route-not-found",
  "scope-member-blank",
  "scope-required",
  "unknown-entity",
  "version-mismatch",
];

/** Type guard: is this value one of the closed wire-error codes? */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" && API_ERROR_CODES.includes(value as ApiErrorCode)
  );
}

/**
 * The typed error envelope every route answers failures with — plain frozen
 * data (`code` + human `message` + optional machine `details`), the shape
 * `packages/sdk` re-validates on the wire.
 */
export interface ApiErrorEnvelope {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Construct one error envelope, fail-closed: an unknown code is refused
 * loudly (a RangeError naming the offender), never silently coerced.
 */
export function apiErrorOf(
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ApiErrorEnvelope {
  if (!isApiErrorCode(code)) {
    throw new RangeError(
      `unknown ApiErrorCode ${JSON.stringify(String(code))} — the vocabulary is closed`,
    );
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new RangeError("ApiErrorEnvelope requires a non-blank message");
  }
  return Object.freeze({
    code,
    message,
    ...(details === undefined ? {} : { details }),
  }) as ApiErrorEnvelope;
}

// ---------------------------------------------------------------------------
// The route-table violation family (closed set — every law named)
// ---------------------------------------------------------------------------

/**
 * Everything that can be wrong with a route declaration or a whole route
 * table (fail-closed construction + whole-record re-validation).
 */
export type RouteTableErrorCode =
  | "blank-route-name" // the route's stable name is blank
  | "duplicate-route-name" // the same lineage declared twice
  | "duplicate-route-id" // two declarations mint the same content id
  | "duplicate-method-path" // the same (method, path) claimed twice
  | "unknown-method" // method outside the closed HTTP method set
  | "invalid-path" // path pattern law violated (shape/version/params)
  | "scope-missing" // no explicit scope on the route (§14)
  | "scope-mismatch" // scope members ≠ path params (§14 transport law)
  | "version-mismatch" // route version ≠ table version
  | "unknown-family" // route family outside the closed set
  | "unknown-payload-type" // response payload type outside the closed set
  | "unknown-field-kind" // field kind outside the closed set
  | "duplicate-field-name" // the same field declared twice in one schema
  | "provenance-missing" // data-carrying response without a citation (W028)
  | "provenance-entities-empty" // an evidence citation citing nothing
  | "provenance-field-missing" // no wire field carries the citation (W028)
  | "provenance-field-in-request" // requests never carry provenance fields
  | "implicit-latest-cutoff" // a time-machine route without an explicit
  // cutoff — R016: never an implicit "latest"
  | "blank-description" // the route's summary is blank
  | "route-id-mismatch" // whole-record re-proof: the id does not re-derive
  | "table-id-mismatch" // whole-record re-proof: the table id does not re-derive
  | "non-canonical-order"; // routes not carried in canonical (name) order

/** One typed route-table violation (fail-closed, collected — never just the first). */
export interface RouteTableViolation {
  readonly code: RouteTableErrorCode;
  readonly message: string;
  /** The offending route's stable name, when the violation is per-route. */
  readonly routeName?: string;
}

/** Construct one violation (internal helper shape — plain frozen data). */
export function routeTableViolation(
  code: RouteTableErrorCode,
  message: string,
  routeName?: string,
): RouteTableViolation {
  return Object.freeze({
    code,
    message,
    ...(routeName === undefined ? {} : { routeName }),
  }) as RouteTableViolation;
}
