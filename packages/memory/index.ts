/**
 * Public surface of the W054 `memory` package — the MEMORY CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./record.js` — the KnowledgeRecord as typed DATA: the typed
 *   source-citation union (post-mortem/lesson-set/capability/search-history
 *   — A6 evidence linkage), the carried payload (A14 — never re-scored),
 *   the explicit §14 scope with the TENANT as part of the canonical
 *   identity (R056 ENFORCED STRUCTURALLY — a cross-tenant record is a loud
 *   typed violation naming R056), the content-addressed `mem-<digest>` id
 *   (A9), the immutable lineage, the deterministic provenance, and THE
 *   SEAL GATE `sealKnowledgeRecord`;
 * - `./store.js` — the append-only knowledge-memory store CONTRACT (laws
 *   M1–M6, the W037 precedent): typed interface only, NO engine, NO I/O;
 * - `./validate.js` — whole-record re-validation
 *   (`validateKnowledgeRecord`): identity re-derivations, citation↔payload
 *   coherence, scope + tenant-isolation re-proofs, lineage and provenance
 *   re-proofs.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./record.js";
export * from "./store.js";
export * from "./validate.js";
