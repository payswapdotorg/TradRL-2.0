/**
 * Public surface of the W055 `autonomous-learning` service — the
 * IMPROVEMENT CYCLE CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./steps.js` — the closed step vocabulary (observe / post-mortem /
 *   brain-update / curriculum-adjustment / re-selection /
 *   re-commissioning) + the per-step EVIDENCE LAWS (A6: a step without
 *   its required citations refused loudly);
 * - `./cycle.js` — THE COMPOSITION GATE `composeImprovementCycle(inputs)`
 *   + the ImprovementCycle record (content-addressed `impcycle-<digest>`
 *   id, canonical loop order, immutable lineage, deterministic
 *   provenance): every cited record re-proven through its source
 *   package's own validators (W053/W054/W046/W041 — errors carried
 *   VERBATIM), the cited brain's tenant scope proven against the cycle's
 *   (R056 named loudly), every citation proven coherent;
 * - `./validate.js` — whole-cycle re-validation
 *   (`validateImprovementCycle`) from recorded data alone.
 *
 * A13/A14 (BINDING): this service composes PROPOSAL records — it never
 * executes, never trains, never improves anything itself, and authority
 * never moves into the loop (it stays with possession grants).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./steps.js";
export * from "./cycle.js";
export * from "./validate.js";
