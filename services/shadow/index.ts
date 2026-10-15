/**
 * Public surface of the W065 `shadow` service — the LIVE-MIRROR SERVICE.
 *
 * Modules (the package.json exports map is the authority):
 * - `./session.js` — `openLiveMirrorSession`: THE MIRROR COMPOSITION GATE
 *   (the sealed W050 view re-proven through W050's own validator; every
 *   observation/order re-proven through the W065 broker adapter's own
 *   validators; the point-in-time laws — R016; R056 cross-tenant refusals);
 * - `./projection.js` — `composeMirrorProjection`: the deterministic
 *   simulation (fills composed through the adapter's REAL composition
 *   gate; positions derived decimal-exact; never live execution);
 * - `./audit.js` — `mirrorSessionAudit`: every auditable step as TYPED
 *   W061 audit records + the session-recorded event, the trail assembled
 *   and verified through services/operations' own trail laws;
 * - `./validate.js` — whole-record re-validation (ids re-derived, the view
 *   and every carried record re-proven, positions re-derived).
 *
 * A13/A14: the service composes PROJECTION records — it does not transmit
 * anything; there is no network code at all.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./session.js";
export * from "./projection.js";
export * from "./audit.js";
export * from "./validate.js";
