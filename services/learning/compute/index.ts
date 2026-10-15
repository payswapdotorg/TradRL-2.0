/**
 * The learning-compute public surface (W048) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): plan (THE generation-plan gate: planGeneration + the typed
 * plan/unit/sharding vocabulary + the content-addressed id derivations),
 * port (the GenerationWorkerPort — the pure worker-facing contract), and
 * validate (the whole-plan re-validation).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./plan.js";
export * from "./port.js";
export * from "./validate.js";
