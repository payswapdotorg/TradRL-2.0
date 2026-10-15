/**
 * The body-forge service public surface (W041) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the forge contracts
 * (contracts.ts — the component input, the ForgedBodyPlan, and the typed
 * error family) and the forge gate (forge.ts — forgeBody and the
 * deterministic id seams).
 *
 * W043 will LATER add ./commissioning — that directory is reserved and
 * deliberately does not exist yet.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./contracts.js";
export * from "./forge.js";
