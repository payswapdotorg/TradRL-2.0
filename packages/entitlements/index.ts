/**
 * The entitlements public surface (W058) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the entitlement
 * contract + THE GRANT GATE (grant.ts), the PURE grant-check
 * (verify.ts), and the whole-record re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./grant.js";
export * from "./verify.js";
export * from "./validate.js";
