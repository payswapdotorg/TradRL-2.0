/**
 * Public surface of the W052 `evaluation-splits` package — the SPLIT
 * FAMILY CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./families.js` — the SplitFamily record as typed DATA (the closed
 *   §13 kind set, the input range + atom universe + policy declarations,
 *   the walk-forward fold with its sealed W050 cutoff, the immutable
 *   lineage, the deterministic provenance, the content-addressed
 *   `fam-<digest>` id, THE CONSTRUCTION GATE `buildSplitFamily`, the
 *   per-side vocabulary `atomSideOf`, and the W051 citation seam
 *   `splitFamilyCitationOf`);
 * - `./generate.js` — THE GENERATORS (pure, deterministic):
 *   `generateWalkForward` (the rolling train/evaluation window sequence)
 *   and `generateRegimePartitions` / `generateAssetPartitions` /
 *   `generateVenuePartitions` (the deterministic id-based partitions),
 *   emitting W037's own HoldoutSplitDescriptor shapes;
 * - `./validate.js` — whole-family re-validation (identity
 *   re-derivations, disjointness/coverage proofs, the R016 no-leakage law
 *   re-proven, the W037 split-shape laws re-proven with W037's own error
 *   codes).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./families.js";
export * from "./generate.js";
export * from "./validate.js";
