/**
 * Public surface of the W059 `packages/sdk` — the typed client.
 *
 * Modules (the package.json exports map is the authority):
 * - `./client.js` — the SDK method surface: the deterministic projection of
 *   the route table (one method per route, derived camelCase names, drift
 *   guarded BOTH ways — compile-time over the default table's literal
 *   names, run-time over any table);
 * - `./builders.js` — the request builders + response validators (the SDK
 *   re-validates every response against the route's schema — it never
 *   trusts the wire) + the typed `SdkError` family;
 * - `./validate.js` — whole-record re-validation (the client surface and
 *   the prepared request re-derived from their own recorded data).
 *
 * A14: no network I/O — the SDK prepares requests and validates responses;
 * the transport is W062's. A9: same table ⇒ deep-equal SDK surface, same
 * canonical ids.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export {
  SDK_DRIFT_GUARD,
  SDK_SURFACE_ROUTE_NAMES,
  assertSdkSurfaceCoversRouteTable,
  buildSdkClient,
  sdkMethodNameOf,
  type SdkClient,
  type SdkClientOutcome,
  type SdkDriftGuard,
  type SdkDriftMissingRoute,
  type SdkMethodBinding,
  type SdkSurfaceRouteName,
} from "./client.js";
export {
  SDK_PREPARED_REQUEST_ID_PREFIX,
  buildSdkRequest,
  sdkPreparedRequestIdOf,
  validateSdkResponse,
  type SdkError,
  type SdkErrorCode,
  type SdkPreparedRequest,
  type SdkPreparedRequestId,
  type SdkRequestInput,
  type SdkRequestOutcome,
  type SdkResponseOutcome,
  type SdkScope,
  type SdkValidatedResponse,
} from "./builders.js";
export {
  validateSdkClient,
  validateSdkPreparedRequest,
  type SdkValidation,
} from "./validate.js";
