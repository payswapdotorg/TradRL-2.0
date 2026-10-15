/**
 * The learning-populations public surface (W046) — the "." entry of the
 * package.json exports map. The public modules are exactly the
 * exports-map entries (the map is the authority): the self-play
 * composition op (selfplay.ts), the adversarial composition op
 * (adversarial.ts), and the whole-record re-validation (validate.ts).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./selfplay.js";
export * from "./adversarial.js";
export * from "./validate.js";
