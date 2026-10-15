/**
 * The model-selection public surface (W042) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the identity family
 * (identity.ts), the demand + benchmark-surface contracts + the typed
 * error/rejection families (demand.ts), the selection walk (select.ts),
 * and the load-time validation gates (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./demand.js";
export * from "./validate.js";
export * from "./select.js";
