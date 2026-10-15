/**
 * The capability registry public surface (W040) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the identity family
 * (identity.ts), the descriptor contracts + closed vocabularies
 * (descriptor.ts), the registration gate (register.ts), the registry
 * re-validation gate (validate.ts), the lifecycle transitions
 * (lifecycle.ts), and the deterministic queries + the W039 demand seam
 * (query.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./descriptor.js";
export * from "./register.js";
export * from "./validate.js";
export * from "./lifecycle.js";
export * from "./query.js";
