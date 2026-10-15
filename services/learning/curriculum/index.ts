/**
 * The learning-curriculum public surface (W046) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the curriculum record +
 * founding gate (curriculum.ts), the progression gate (progression.ts),
 * and the shared law surface + whole-record re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./curriculum.js";
export * from "./progression.js";
export * from "./validate.js";
