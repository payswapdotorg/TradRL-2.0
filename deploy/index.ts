/**
 * Public surface of the W062 `deploy` directory — the typed DEPLOYMENT
 * CONTRACT (a plain directory, deliberately NOT a workspace package — the
 * docs/benchmarks + research/benchmarks W063 precedent: no package.json, no
 * lockfile change, no dependencies of its own; the gate re-proves every
 * citation through the consumed packages' own validators via relative source
 * imports).
 *
 * Modules:
 * - `./plan.js` — the `DeploymentPlan` record vocabulary: the closed mode +
 *   component vocabularies, the citations, the immutable lineage, the
 *   deterministic provenance, the content-addressed `deploy-<digest>` id,
 *   the canonicalization laws (A9);
 * - `./citations.js` — the four REAL-surface citation proofs (W059 api +
 *   sdk, W061 observability, W060 security) + the closed violation
 *   vocabulary;
 * - `./compose.js` — `composeDeploymentPlan`, THE GATE;
 * - `./validate.js` — `validateDeploymentPlan`, whole-record re-validation
 *   from recorded data alone (ids re-derived — a rewrite is caught loudly).
 *
 * A13/A14: CONTRACTS ONLY — this surface never executes a deployment, never
 * binds a port, never starts a server, never provisions infrastructure,
 * never supervises a process. License: Apache-2.0 (the repository LICENSE).
 */

export * from "./plan.js";
export * from "./citations.js";
export * from "./compose.js";
export * from "./validate.js";
