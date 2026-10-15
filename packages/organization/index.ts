/**
 * The organization package public surface (W039) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): identity (canonical JSON + FNV-1a + the opaque id family),
 * definition (the declarative model), validate (the fail-closed laws),
 * and ablation (the typed pure derivation operations).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./definition.js";
export * from "./validate.js";
export * from "./ablation.js";
