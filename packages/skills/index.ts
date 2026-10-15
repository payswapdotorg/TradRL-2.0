/**
 * The skills package public surface (W041) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the identity family
 * (identity.ts), the skill record contracts + typed error/refusal
 * families (record.ts), the extraction gate (extract.ts), and the
 * re-validation gates (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./record.js";
export * from "./extract.js";
export * from "./validate.js";
