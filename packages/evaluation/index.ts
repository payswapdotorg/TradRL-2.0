/**
 * The evaluation public surface (W038) — the "." entry of the package.json
 * exports map. The public modules are exactly the exports-map entries (the
 * map is the authority): the trajectory outcome summaries + holdout
 * membership derivation (summary.ts) and the experiment walker (walker.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./summary.js";
export * from "./walker.js";
