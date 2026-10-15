/**
 * The rl-protocol public surface (W047) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): episode (the Episode contract + the construction gate),
 * trainer (the TrainerPort + the deterministic batch descriptor), and
 * validate (the whole-record re-validation).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./episode.js";
export * from "./trainer.js";
export * from "./validate.js";
