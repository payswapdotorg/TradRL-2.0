/**
 * The readiness gate + whole-record re-validation (W062 `ops/`) —
 * `composeReadinessChecklist` (fail-closed, ALL violations collected) and
 * `validateReadinessChecklist` (re-validation from the recorded data alone:
 * the id RE-DERIVED, every gate law re-proven, the canonical carriage + the
 * deterministic provenance re-derived).
 *
 * A6: no number is ever invented, inferred or re-measured here — the
 * recorded measurements are CARRIED, and the laws only REFUSE unlawful
 * carriage. A9: canonical order, content-addressed ids. A13/A14: the gate
 * composes typed records — it never runs a battery.
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  READINESS_PROVENANCE_LAWS,
  canonicalGates,
  duplicateGateViolations,
  coverageViolations,
  gateViolations,
  readinessChecklistIdOf,
  readinessInputDigestOf,
  type ReadinessChecklist,
  type ReadinessChecklistInput,
  type ReadinessViolation,
} from "./readiness.js";

/** The gate's outcome: the sealed checklist, or every law violated. */
export type ReadinessChecklistOutcome =
  | { readonly ok: true; readonly checklist: ReadinessChecklist }
  | { readonly ok: false; readonly violations: readonly ReadinessViolation[] };

/** The whole-record re-validation outcome. */
export type ReadinessChecklistValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly ReadinessViolation[] };

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Compose ONE production-readiness checklist — THE GATE. Fail-closed, all
 * violations collected: every gate's vocabularies, derived command, green
 * exit code and CARRIED measured numbers; no duplicates; the WHOLE closed
 * package × battery surface covered; then the seal — the gates carried in
 * canonical order (A9: input order never leaks) under the content-addressed
 * `rcl-<digest>` id with the deterministic provenance.
 */
export function composeReadinessChecklist(
  input: ReadinessChecklistInput,
): ReadinessChecklistOutcome {
  if (!isRecordLike(input) || !Array.isArray(input.gates)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail: "the readiness declaration is not typed data — an array of measured gates is required",
        },
      ],
    };
  }
  const gates = input.gates;
  const violations: ReadinessViolation[] = [];
  for (const gate of gates) {
    violations.push(...gateViolations(gate));
  }
  violations.push(...duplicateGateViolations(gates));
  violations.push(...coverageViolations(gates));
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const content: Omit<ReadinessChecklist, "checklistId"> = {
    gates: canonicalGates(gates),
    provenance: {
      deriver: "compose-readiness-checklist",
      inputDigest: readinessInputDigestOf({ gates }),
      laws: READINESS_PROVENANCE_LAWS,
    },
  };
  return {
    ok: true,
    checklist: Object.freeze({
      ...content,
      checklistId: readinessChecklistIdOf(content),
    }),
  };
}

/**
 * Re-validate one readiness checklist END-TO-END from its recorded data
 * alone: every gate law re-proven (a red gate recorded as ready is refused
 * at re-validation exactly as at composition), the duplicate + coverage laws
 * re-run, the canonical carriage proven (a record IS canonical data), the id
 * RE-DERIVED from the carried bytes, and the deterministic provenance
 * re-derived. A tampered checklist is refused loudly.
 */
export function validateReadinessChecklist(
  checklist: unknown,
): ReadinessChecklistValidation {
  if (!isRecordLike(checklist) || !Array.isArray(checklist.gates)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail: "the checklist is not typed data — canonically ordered gates, a checklist id and a provenance record are required",
        },
      ],
    };
  }
  const record = checklist as unknown as ReadinessChecklist;
  const violations: ReadinessViolation[] = [];
  for (const gate of record.gates) {
    violations.push(...gateViolations(gate));
  }
  violations.push(...duplicateGateViolations(record.gates));
  violations.push(...coverageViolations(record.gates));
  const carried = record.gates.map(
    (gate) => `${String(gate?.packageId)}|${String(gate?.battery)}`,
  );
  const canonical = canonicalGates(record.gates).map(
    (gate) => `${String(gate?.packageId)}|${String(gate?.battery)}`,
  );
  if (carried.join("|") !== canonical.join("|")) {
    violations.push({
      kind: "non-canonical-record",
      detail: "the gates are not carried in canonical (package, battery) order — a recorded checklist IS canonical data (A9)",
    });
  }
  const { checklistId: _checklistId, ...content } = record;
  const derivedId = readinessChecklistIdOf(content);
  if (String(record.checklistId) !== String(derivedId)) {
    violations.push({
      kind: "id-mismatch",
      detail: `the recorded checklist id '${String(record.checklistId)}' does not re-derive from its own carried gates '${String(derivedId)}' — a rewritten checklist (an edited exit code, count or head) is a loud violation, never a silent pass`,
    });
  }
  const provenance = record.provenance;
  if (!isRecordLike(provenance)) {
    violations.push({
      kind: "provenance-unlawful",
      detail: "the checklist carries no provenance record — deterministic provenance travels with every sealed record",
    });
  } else {
    if (provenance.deriver !== "compose-readiness-checklist") {
      violations.push({
        kind: "provenance-unlawful",
        detail: `the provenance deriver '${String(provenance.deriver)}' is not the readiness gate — records name their deriver honestly`,
      });
    }
    if (
      JSON.stringify(provenance.laws) !==
      JSON.stringify(READINESS_PROVENANCE_LAWS)
    ) {
      violations.push({
        kind: "provenance-unlawful",
        detail: "the provenance law list does not match the readiness contract's own — the laws are carried verbatim, never edited",
      });
    }
    const expectedDigest = readinessInputDigestOf({ gates: record.gates });
    if (String(provenance.inputDigest) !== String(expectedDigest)) {
      violations.push({
        kind: "provenance-unlawful",
        detail: `the provenance input digest '${String(provenance.inputDigest)}' does not re-derive from the carried gates '${String(expectedDigest)}' — the provenance is deterministic data`,
      });
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
