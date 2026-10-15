/**
 * The learning-objectives public surface (W036) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): decimal, evidence, reward (+ its component evaluators),
 * constraints (+ the composed evaluation), and the §13 policy descriptor.
 * `money.ts` (the money-reading discipline) and `constraintCheckers.ts` (the
 * per-kind checkers) are deliberately package-INTERNAL — their surfaces are
 * consumed through the public evaluation seams; their error families surface
 * through the public typed error codes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./decimal.js";
export * from "./evidence.js";
export * from "./reward.js";
export * from "./components.js";
export * from "./constraints.js";
export * from "./constraintEvaluation.js";
export * from "./policy.js";
