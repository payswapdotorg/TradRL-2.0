/**
 * The tradrl-adapters-arena public surface (W057) — the "." entry of the
 * packages.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the arena identity
 * family + closed vocabularies (arena-identity.ts), the arena registration
 * DATA + the registration gate (arena-registration.ts), the concrete
 * neutral-port implementation (arena-provider.ts), the adjudication
 * delegation + the ranking projection (arena-adjudication.ts), and the
 * whole-registration re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./arena-identity.js";
export * from "./arena-registration.js";
export * from "./arena-provider.js";
export * from "./arena-adjudication.js";
export * from "./validate.js";
