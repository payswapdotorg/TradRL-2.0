/**
 * The world-agent-runtime public surface (W044) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the binding contracts
 * (contracts.ts — the typed wiring records + the error family), the
 * binding gates (binding.ts — bindAgent + bindOrganization), the pure
 * routing wiring (routing.ts — routeObservationEvent +
 * routeActionIntent), and the whole-record re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./contracts.js";
export * from "./gates.js";
export * from "./binding.js";
export * from "./routing.js";
export * from "./validate.js";
