/**
 * Whole-cycle re-validation (W055) — re-proving a sealed improvement cycle
 * from its own recorded data ALONE (the W053 `validatePostMortem` / W054
 * `validateFirmBrain` precedent): the content-addressed identity
 * re-derivation (A9 — a rewritten cycle is caught loudly), the closed
 * step-kind vocabulary + the per-step evidence laws (A6 — through
 * ./steps.ts's own gate, errors carried verbatim), the canonical loop
 * order (A9 — the recorded steps are the sealed canonical order), the
 * explicit §14 scope, the immutable lineage, and the deterministic
 * provenance re-derivation (the citation digest over the cycle's OWN
 * carried citations). The DEEP source re-proofs (W053/W054/W046/W041's
 * own validators over the cited records) run at COMPOSITION, where the
 * records are given — the division of labor every sealed-record package
 * in this repository carries.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalString } from "trajectory";
import { blankKnowledgeScopeMembers, EXPLICIT_SCOPE_LAW } from "memory";
import { cycleCitationDigestOf, IMPROVEMENT_CYCLE_PROVENANCE_LAWS, improvementCycleDigestOf, IMPROVEMENT_CYCLE_ID_PREFIX } from "./cycle.js";
import type { ImprovementCycle } from "./cycle.js";
import { canonicalSteps, stepEvidenceErrors } from "./steps.js";
import type { ImprovementStep, StepError } from "./steps.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The whole-cycle invariant error family (closed set — every law named). */
export type CycleValidationErrorCode =
  | "malformed-record" // the cycle is not typed data
  | "invalid-kind" // the record is not an improvement cycle
  | "cycle-id-mismatch" // the id does not re-derive from its own carried bytes (A9)
  | "invalid-scope" // a §14 scope member is blank
  | "invalid-step" // the per-step evidence laws (carried verbatim, A6)
  | "non-canonical-order" // the recorded steps are not in canonical loop order (A9)
  | "lineage-break" // the immutable lineage is incoherent
  | "provenance-mismatch"; // the provenance does not re-derive (A9)

/** One typed cycle-invariant error (fail-closed; the law named). */
export interface CycleValidationError {
  readonly code: CycleValidationErrorCode;
  readonly message: string;
  readonly entryId?: string;
  /** `invalid-step` only: ./steps.ts's own errors, carried VERBATIM. */
  readonly stepErrors?: readonly StepError[];
}

/** The re-validation outcome. */
export type CycleValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly CycleValidationError[] };

/** Re-prove one improvement cycle whole, from its own recorded data:
 * identity (A9), kind, scope (§14), the per-step evidence laws (A6),
 * canonical loop order (A9), lineage, provenance. Pure and total:
 * malformed input is refused with named errors, never thrown at. */
export function validateImprovementCycle(cycle: ImprovementCycle): CycleValidation {
  if (!isRecordLike(cycle) || !isRecordLike(cycle.scope) || !isRecordLike(cycle.lineage) || !isRecordLike(cycle.provenance) || !Array.isArray(cycle.steps)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the improvement cycle is not typed data — a scope, a lineage, a provenance and a step list are required" }] };
  }
  const errors: CycleValidationError[] = [];
  if (String(cycle.kind) !== "improvement-cycle") {
    errors.push({ code: "invalid-kind", message: `the record's kind '${String(cycle.kind)}' is not 'improvement-cycle' — the closed record vocabulary is enforced loudly` });
  }
  const recordedId = String(cycle.cycleId);
  if (!recordedId.startsWith(IMPROVEMENT_CYCLE_ID_PREFIX) || recordedId.trim().length === String(IMPROVEMENT_CYCLE_ID_PREFIX).length) {
    errors.push({ code: "cycle-id-mismatch", message: `the cycle id '${recordedId}' is not a '${IMPROVEMENT_CYCLE_ID_PREFIX}<digest>' rendering — ids are explicit, never blank` });
  }
  if (improvementCycleDigestOf(cycle as ImprovementCycle) !== recordedId) {
    errors.push({ code: "cycle-id-mismatch", message: `the cycle id '${recordedId}' does not re-derive from its own carried bytes — recorded data is re-proven, never trusted (A9)` });
  }
  for (const member of blankKnowledgeScopeMembers(cycle.scope as ImprovementCycle["scope"])) {
    errors.push({ code: "invalid-scope", message: `the improvement cycle's scope '${member}' is blank — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank` });
  }
  const steps = cycle.steps as readonly ImprovementStep[];
  const stepErrors = stepEvidenceErrors(steps);
  if (stepErrors.length > 0) {
    errors.push({ code: "invalid-step", message: `the recorded steps violate ${String(stepErrors.length)} step law(s) — errors carried verbatim`, stepErrors });
  }
  const canonical = canonicalSteps(steps);
  for (let index = 0; index < canonical.length; index += 1) {
    if (String(canonical[index]?.kind) !== String(steps[index]?.kind)) {
      errors.push({ code: "non-canonical-order", message: `the recorded steps are not in the canonical loop order at index ${String(index)} — the sealed cycle's step order is canonical (A9)`, entryId: String(steps[index]?.kind) });
    }
  }
  const lineage = cycle.lineage as ImprovementCycle["lineage"];
  const ordinal = lineage.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) {
    errors.push({ code: "lineage-break", message: `the cycle's lineage ordinal '${String(ordinal)}' is not a non-negative integer — one link per cycle, starting at 0` });
  } else if (ordinal === 0) {
    if (lineage.parent !== undefined) {
      errors.push({ code: "lineage-break", message: "the root improvement cycle declares a parent — ordinal 0 has no ancestor" });
    }
    if (String(lineage.root) !== recordedId) {
      errors.push({ code: "lineage-break", message: `the root improvement cycle's lineage root must be its own id — it carries '${String(lineage.root)}'` });
    }
  } else {
    if (String(lineage.parent ?? "").trim().length === 0 || String(lineage.root).trim().length === 0) {
      errors.push({ code: "lineage-break", message: `the continuation (ordinal '${String(ordinal)}') declares no parent/root — a continuation carries the chain verbatim` });
    }
  }
  const provenance = cycle.provenance as ImprovementCycle["provenance"];
  if (provenance.deriver !== "compose-improvement-cycle") {
    errors.push({ code: "provenance-mismatch", message: `the provenance names deriver '${String(provenance.deriver)}' — the closed deriver vocabulary is 'compose-improvement-cycle'` });
  }
  if (canonicalString([...provenance.laws]) !== canonicalString([...IMPROVEMENT_CYCLE_PROVENANCE_LAWS])) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not match the canonical cycle law list — the laws are carried verbatim" });
  }
  if (String(provenance.inputDigest) !== cycleCitationDigestOf(cycle as ImprovementCycle)) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the cycle's own carried citations — deterministic provenance is re-proven (A9)" });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
