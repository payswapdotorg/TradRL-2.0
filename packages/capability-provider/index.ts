/**
 * The capability-provider public surface (W056) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the identity family
 * (identity.ts), the registration contracts + typed error family
 * (registration.ts), the registration gate (register.ts), the neutral
 * port + the deterministic reference adapter (port.ts), the demand
 * adjudication (match.ts), and the whole-registration re-validation
 * (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./registration.js";
export * from "./register.js";
export * from "./port.js";
export * from "./match.js";
export * from "./validate.js";
