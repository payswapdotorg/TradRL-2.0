/**
 * The organization-compiler public surface (W039) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): registry (the typed component registry input + its own
 * fail-closed validation) and compile (compileOrganization and the
 * CompiledOrganization shapes).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./registry.js";
export * from "./compile.js";
