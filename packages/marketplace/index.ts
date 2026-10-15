/**
 * The marketplace public surface (W058) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the listing contract +
 * THE GATE (listing.ts), the typed catalogue surface (catalogue.ts), and
 * the whole-record re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./listing.js";
export * from "./catalogue.js";
export * from "./validate.js";
