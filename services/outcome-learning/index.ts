/**
 * Public surface of the W053 `outcome-learning` package — the OUTCOME /
 * POST-MORTEM layer over completed evaluations.
 *
 * Modules (the package.json exports map is the authority):
 * - `./postmortem.js` — the PostMortem record as typed DATA: the
 *   content-addressed `pm-<digest>` id, the predicted-vs-happened
 *   comparison CARRIED from the evaluation's own holdout aggregations
 *   (never re-scored), the evaluation/family/history citations, the
 *   explicit scope, the immutable lineage, the deterministic provenance,
 *   and THE GATE `derivePostMortem` (W038's evaluation + findings
 *   re-proven through their own laws, the family through W052's, the
 *   history through W051's — errors carried verbatim — scope agreement
 *   proven across all three, the family proven to have judged the
 *   outcome);
 * - `./lessons.js` — the typed LESSON derivation (`deriveLessons`): the
 *   closed failure-mode taxonomy, the capability deltas, the
 *   held-out-vs-train divergence signals — ALL carried statistics of the
 *   evaluation's own data, canonical-id ordered; an uncited lesson is a
 *   loud typed refusal naming A6/R052;
 * - `./validate.js` — whole-record re-validation (`validatePostMortem`,
 *   `validateLessonSet`) from recorded data: identity re-derivations,
 *   canonical-order proofs, lineage/provenance re-proofs, the A9 lesson
 *   twin.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./postmortem.js";
export * from "./lessons.js";
export * from "./validate.js";
