/**
 * Public surface of the W062 `ops` directory — the OPERATIONAL SURFACE (a
 * plain directory, deliberately NOT a workspace package — the W063
 * docs/benchmarks + research/benchmarks precedent: no package.json, no
 * lockfile change, no dependencies of its own).
 *
 * Modules:
 * - `./readiness.js` — the production-readiness CHECKLIST CONTRACT: the
 *   closed package vocabulary (each id bound to a REAL exported const of the
 *   consumed package — the compile-time drift guard), the closed battery
 *   vocabulary, the DERIVED battery command law, the gate record (measured
 *   exit code + test count + measured head, CARRIED as data — A6), the
 *   coverage law, the canonicalization laws;
 * - `./validate.js` — `composeReadinessChecklist` (THE GATE) +
 *   `validateReadinessChecklist` (whole-record re-validation, ids
 *   re-derived).
 *
 * The operational RUNBOOKS live in `ops/runbooks/` (canonical markdown, one
 * per procedure — numbers live ONLY on the typed records, never in the
 * docs).
 *
 * A13/A14: CONTRACTS + DOCS ONLY — this surface never runs a battery, never
 * scrapes, never serves, never alerts. License: Apache-2.0 (the repository
 * LICENSE).
 */

export * from "./readiness.js";
export * from "./validate.js";
