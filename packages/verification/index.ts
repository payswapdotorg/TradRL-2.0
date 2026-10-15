/**
 * The verification public surface (W038) — the "." entry of the package.json
 * exports map. The public modules are exactly the exports-map entries (the
 * map is the authority): the claim registry (claims.ts), the typed verdict
 * records (findings.ts), the checks (checks.ts), and the assembled harness
 * (harness.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./claims.js";
export * from "./findings.js";
export * from "./checks.js";
export * from "./harness.js";
