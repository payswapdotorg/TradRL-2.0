/**
 * Whole-brain re-validation (W054) — a firm brain re-proven from its OWN
 * carried data, never trusted (A9).
 *
 * The `brain-<digest>` id must re-derive from the carried scope +
 * generation + canonical record ids; the §14 scope must be explicit; the
 * generation and lineage must agree (one lineage link per generation; the
 * founding generation is empty with no parent); the records must be in
 * canonical record-id order with no duplicates; every record must pass the
 * MEMORY contract's own whole-record re-validation (errors carried
 * VERBATIM); every record's scope must be ISOLATED to the brain's tenant —
 * a cross-tenant record makes the whole brain invalid, loudly naming R056
 * — and the deterministic provenance must re-derive. Never re-scores one
 * carried number (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { brainInvariantsOf } from "./brain.js";
import type { BrainValidationError, FirmBrain } from "./brain.js";

export { brainDigestOf } from "./brain.js";

/** The whole-brain re-validation outcome. */
export type BrainValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly BrainValidationError[] };

/**
 * Re-validate one firm brain whole, from its own recorded data: id
 * re-derivation (A9), explicit scope (§14), generation↔lineage coherence,
 * canonical order + identity uniqueness (A9), per-record re-validation
 * through the memory contract's own laws (errors carried VERBATIM),
 * per-record tenant isolation (R056 — a cross-tenant record invalidates
 * the whole brain), and deterministic provenance re-derivation. Pure and
 * total: malformed input is refused with named errors, never thrown at.
 */
export function validateFirmBrain(brain: FirmBrain): BrainValidation {
  if (brain === null || typeof brain !== "object" || Array.isArray(brain)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the firm brain is not typed data — a founded brain value is required" }] };
  }
  if (String((brain as FirmBrain).brainId ?? "").trim().length === 0) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the firm brain carries a blank id — ids are explicit, never blank" }] };
  }
  const errors = brainInvariantsOf(brain);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
