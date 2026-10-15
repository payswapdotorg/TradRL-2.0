/**
 * The tradrl-adapters-jax-lob public surface (W049) — the "." entry of
 * the package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): vocabulary (the clean-room closed LOB training vocabulary
 * + its gates), trainer (the W047-facing episode/batch → LOB training
 * step projection), generation (the W048-facing plan → LOB environment
 * declaration projection), and validate (the whole-record re-validation
 * of both projection kinds).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./lob-vocabulary.js";
export * from "./lob-trainer.js";
export * from "./lob-generation.js";
export * from "./validate.js";
