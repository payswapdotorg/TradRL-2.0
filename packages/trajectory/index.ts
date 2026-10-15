/**
 * The trajectory package public surface (W037) — the "." entry of the
 * package.json exports map.
 *
 * The public modules are exactly the exports-map entries (the map is the
 * authority): identity (the canonical scope encoding + the opaque
 * trajectory id), record (the capture protocol: the typed record, the
 * capture gate, the re-validation gate), and store (the append-only store
 * CONTRACT — typed, implemented elsewhere).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./record.js";
export * from "./store.js";
