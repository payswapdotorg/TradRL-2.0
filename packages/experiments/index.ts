/**
 * The experiments package public surface (W037) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): descriptor (the declarative experiment descriptor + the
 * deterministic identity + the construction gate) and manifest (the
 * membership + holdout-split + integrity manifest + the manifest gate).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./descriptor.js";
export * from "./manifest.js";
