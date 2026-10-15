/**
 * Whole-record re-validation of the SERVICE's records (W060): the secret
 * enforcement record proven again from its own carried bytes alone (the
 * `enf-<digest>` id re-derived, the violations re-proven in canonical
 * order, the compliance verdict re-derived from the violations, the
 * checked count coherent), plus the contract validators re-exported so
 * consumers of the service surface share ONE validation entry. Fail-closed
 * — every violation collected, none silently repaired.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecretPolicyViolation } from "security";
import { canonicalSecretViolations } from "security";
import {
  validateIsolationProof as contractValidateIsolationProof,
  validateSecretReference as contractValidateSecretReference,
  validateSecurityPolicy as contractValidateSecurityPolicy,
} from "security";
import type { SecretEnforcement } from "./secrets.js";
import { secretEnforcementDigestOf } from "./secrets.js";

export type SecurityServiceValidationCode =
  | "malformed-record" // not lawful typed data
  | "enforcement-id-mismatch" // the enf-<digest> does not re-derive (A9)
  | "invalid-record" // the checked count / verdict is incoherent
  | "non-canonical-order" // the violations are not in canonical order
  | "blank-policy-id"; // the enforced policy's id is blank

export interface SecurityServiceValidationError {
  readonly code: SecurityServiceValidationCode;
  readonly message: string;
}
export type SecretEnforcementValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SecurityServiceValidationError[] };

/** Re-validate a secret enforcement record from its carried bytes alone. */
export function validateSecretEnforcement(
  enforcement: unknown,
): SecretEnforcementValidationOutcome {
  const errors: SecurityServiceValidationError[] = [];
  if (
    enforcement === null ||
    typeof enforcement !== "object" ||
    Array.isArray(enforcement)
  ) {
    return {
      ok: false,
      errors: [{ code: "malformed-record", message: "the enforcement record is not typed data — an enforcement record is required" }],
    };
  }
  const record = enforcement as unknown as SecretEnforcement;
  if (typeof record.policyId !== "string" || record.policyId.trim().length === 0) {
    errors.push({ code: "blank-policy-id", message: "the enforcement's policy id is blank — the enforced policy's own id is carried, never blank" });
  }
  if (typeof record.checked !== "number" || !Number.isSafeInteger(record.checked) || record.checked < 0) {
    errors.push({ code: "invalid-record", message: `the enforcement's checked count '${String(record.checked)}' is not a safe non-negative integer — a policy may govern zero handles, but the count is exact` });
  }
  if (!Array.isArray(record.violations)) {
    errors.push({ code: "malformed-record", message: "the enforcement's violations are not an array — typed violations are carried data" });
  } else {
    const canonical: readonly SecretPolicyViolation[] = canonicalSecretViolations(record.violations);
    if (record.violations.some((violation, index) => canonical[index] !== violation)) {
      errors.push({ code: "non-canonical-order", message: "the violations are not in canonical (secretId, code, message) order — the enforcement's bytes never depend on the references' input order (A9)" });
    }
    if (record.compliant !== (record.violations.length === 0)) {
      errors.push({ code: "invalid-record", message: `the enforcement's compliant verdict '${String(record.compliant)}' disagrees with its ${String(record.violations.length)} violations — the verdict is derived data, never asserted` });
    }
  }
  if (record.enforcementId !== undefined) {
    const expected = secretEnforcementDigestOf({
      policyId: typeof record.policyId === "string" ? record.policyId : "",
      checked: typeof record.checked === "number" && Number.isSafeInteger(record.checked) ? record.checked : 0,
      violations: Array.isArray(record.violations) ? record.violations : [],
    });
    if (String(record.enforcementId) !== String(expected)) {
      errors.push({ code: "enforcement-id-mismatch", message: "the enforcement's enf-<digest> id does not re-derive from its own carried bytes — the enforcement is content-addressed data (A9)" });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** The contract validators, re-exported through the service surface (ONE
 * validation entry for W062/W065 consumers). */
export const validateIsolationProof = contractValidateIsolationProof;
export const validateSecretReference = contractValidateSecretReference;
export const validateSecurityPolicy = contractValidateSecurityPolicy;
