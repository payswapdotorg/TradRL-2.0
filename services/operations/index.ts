/**
 * Public surface of the W061 `services/operations` package — the pure
 * ops-record machinery over the W061 `observability` contracts.
 *
 * Modules (the package.json exports map is the authority):
 * - `./trail.js` — `assembleTrail` (deterministic canonical assembly) +
 *   `verifyTrail` (the end-to-end tamper gate: ids re-derived, chain
 *   recomputed, provenance re-guarded, scope re-proven);
 * - `./reports.js` — `composeOperationsReport` (deterministic, carried
 *   counts as data, canonical order, content-addressed `opr-<digest>` ids);
 * - `./validate.js` — whole-report re-validation (id re-derivation + count
 *   coherence + window + provenance laws).
 *
 * A14: PURE RECORDS ONLY — no scraping, no serving (W062 renders the
 * operations routes declared in `observability`), no alerting, no I/O.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./trail.js";
export * from "./reports.js";
export * from "./validate.js";
