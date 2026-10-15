/**
 * Public surface of the W054 `firm-brain` service — the pure composition
 * service over the memory contract.
 *
 * Modules (the package.json exports map is the authority):
 * - `./brain.js` — `foundBrain(scope)` + `ingest(brain, records)` — THE
 *   INGESTION GATES: every record re-proven through its source package's
 *   own validators (W053/W040/W051 — errors carried VERBATIM), scope
 *   isolation proven per record (R056 named loudly on cross-tenant), the
 *   new generation sealed (append-only lineage extended, canonical record
 *   order, content-addressed `brain-<digest>` id);
 * - `./recall.js` — the deterministic recall surface: typed
 *   by-kind/by-source/by-citation queries (each carrying its explicit §14
 *   scope in transport) over canonically ordered, CARRIED results;
 *   cross-tenant queries refused loudly naming R056;
 * - `./validate.js` — whole-brain re-validation (`validateFirmBrain`):
 *   id/lineage/order re-derivations, per-record re-validation through the
 *   memory contract's own laws, per-record tenant isolation.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./brain.js";
export * from "./recall.js";
export * from "./validate.js";
