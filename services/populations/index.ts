/**
 * The populations public surface (W045) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the population record
 * + founding gate (population.ts), the transition gates
 * (transitions.ts — addMembers / retireMembers / ablateMembers), the
 * pure aggregate projection (view.ts), and the whole-record
 * re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./population.js";
export * from "./transitions.js";
export * from "./view.js";
export * from "./validate.js";
