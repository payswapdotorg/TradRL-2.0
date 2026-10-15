/**
 * Whole-record re-validation (W060) — every security contract record proven
 * AGAIN from its own carried bytes alone: the content-addressed ids
 * re-derived (A9), the closed vocabularies re-enforced, THE REDACTION LAW
 * re-scanned (a record that carries a secret-shaped string is INVALID,
 * loudly), the canonical orders re-proven, the deterministic provenance
 * re-derived. Fail-closed: every violation collected, none silently
 * repaired. Pure — no I/O, no clocks, no env reads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError, SecurityScope } from "./isolation.js";
import {
  SECURITY_PROVENANCE_LAWS,
  blankSecurityScopeMembers,
  canonicalIsolationFindings,
  isolationInputDigestOf,
  isolationProofDigestOf,
} from "./isolation.js";
import type { IsolationProof } from "./isolation.js";
import type { SecretReference } from "./secrets.js";
import {
  SECRET_KINDS,
  canonicalSecretViolations,
  secretCustodyPolicyErrors,
  secretInputDigestOf,
  secretReferenceDigestOf,
  secretValueViolations,
} from "./secrets.js";
import type { SecurityPolicy } from "./policy.js";
import {
  AUTHORIZATION_MODELS,
  securityPolicyDigestOf,
  securityPolicyInputDigestOf,
} from "./policy.js";
import { SECRET_ACCESS_SCOPES } from "./secrets.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type SecurityValidationErrorCode =
  | "malformed-record" // not lawful typed data
  | "proof-id-mismatch" // the iso-<digest> does not re-derive (A9)
  | "secret-id-mismatch" // the sec-<digest> does not re-derive (A9)
  | "policy-id-mismatch" // the pol-<digest> does not re-derive (A9)
  | "invalid-scope" // a §14 scope member is blank
  | "invalid-custody" // the custody policy fails its own laws
  | "invalid-record" // a record-law violation (kind/scope-kind/model/checked/verdict/order)
  | "secret-value-refused" // THE REDACTION LAW (re-scanned on the record)
  | "provenance-mismatch"; // the provenance does not re-derive (A9)

export type SecurityValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SecurityError<SecurityValidationErrorCode>[] };

function scopeErrors(scope: unknown, what: string): SecurityError<SecurityValidationErrorCode>[] {
  if (!isRecordLike(scope)) {
    return [{ code: "invalid-scope", message: `the ${what} carries no explicit §14 scope` }];
  }
  return blankSecurityScopeMembers(scope as unknown as SecurityScope).map((member) => ({
    code: "invalid-scope",
    message: `the ${what}'s scope member '${member}' is blank — tenant/project/world identity is explicit, never blank`,
  }));
}
function provenanceErrors(
  provenance: unknown,
  deriver: string,
  expectedInputDigest: string,
): SecurityError<SecurityValidationErrorCode>[] {
  if (!isRecordLike(provenance)) {
    return [{ code: "provenance-mismatch", message: "the record carries no provenance — security records are deterministic data (A9)" }];
  }
  const errors: SecurityError<SecurityValidationErrorCode>[] = [];
  if (provenance.deriver !== deriver) {
    errors.push({ code: "provenance-mismatch", message: `the provenance's deriver '${String(provenance.deriver)}' is not '${deriver}' — the closed deriver vocabulary is loudly enforced` });
  }
  if (String(provenance.inputDigest) !== expectedInputDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the record's own carried bytes (A9)" });
  }
  const laws = provenance.laws;
  if (
    !Array.isArray(laws) ||
    laws.length !== SECURITY_PROVENANCE_LAWS.length ||
    laws.some((law, index) => String(law) !== String(SECURITY_PROVENANCE_LAWS[index]))
  ) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not carry the security layer's canonical laws" });
  }
  return errors;
}

/** Re-validate an isolation proof from its carried bytes alone. */
export function validateIsolationProof(proof: unknown): SecurityValidationOutcome {
  const errors: SecurityError<SecurityValidationErrorCode>[] = [];
  if (!isRecordLike(proof)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the isolation proof is not typed data — a proof record is required" }] };
  }
  const record = proof as unknown as IsolationProof;
  if (record.scope === undefined) {
    // LAWFUL only when the findings say no checked record carried a scope.
    if (record.isolated === true) {
      errors.push({ code: "invalid-record", message: "the proof declares itself isolated while carrying no reference scope — an isolated proof proves an explicit §14 scope" });
    }
  } else {
    errors.push(...scopeErrors(record.scope, "isolation proof"));
  }
  if (typeof record.checked !== "number" || !Number.isSafeInteger(record.checked) || record.checked < 1) {
    errors.push({ code: "invalid-record", message: `the proof's checked count '${String(record.checked)}' is not a safe positive integer — an isolation proof checks at least one record, loudly (fail-closed)` });
  }
  if (!Array.isArray(record.findings)) {
    errors.push({ code: "malformed-record", message: "the proof's findings are not an array — typed findings are carried data" });
  } else {
    const canonical = canonicalIsolationFindings(record.findings);
    if (record.findings.some((finding, index) => canonical[index] !== finding)) {
      errors.push({ code: "invalid-record", message: "the findings are not in canonical (recordId, code, message) order — the proof's bytes never depend on input order (A9)" });
    }
    if (record.isolated !== (record.findings.length === 0)) {
      errors.push({ code: "invalid-record", message: `the proof's isolated verdict '${String(record.isolated)}' disagrees with its ${String(record.findings.length)} findings — the verdict is derived data, never asserted` });
    }
    if (record.scope === undefined && record.isolated) {
      errors.push({ code: "invalid-record", message: "the proof's verdict disagrees with its absent reference scope — an isolated proof proves an explicit scope (§14)" });
    }
  }
  if (record.proofId !== undefined && String(record.proofId) !== String(isolationProofDigestOf(record))) {
    errors.push({ code: "proof-id-mismatch", message: "the proof's iso-<digest> id does not re-derive from its own carried bytes — the proof is content-addressed data (A9)" });
  }
  errors.push(...provenanceErrors(record.provenance, "prove-isolation", isolationInputDigestOf(record.scope, record.checked)));
  errors.push(...secretValueViolations(record, "the proof record"));
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Re-validate a secret reference (the typed handle) from its carried
 * bytes alone — THE REDACTION LAW re-scanned: a reference carrying a
 * secret-shaped string ANYWHERE is invalid, loudly. */
export function validateSecretReference(reference: unknown): SecurityValidationOutcome {
  const errors: SecurityError<SecurityValidationErrorCode>[] = [];
  if (!isRecordLike(reference)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the secret reference is not typed data — a handle record is required" }] };
  }
  const record = reference as unknown as SecretReference;
  errors.push(...scopeErrors(record.scope, "secret reference"));
  if (!SECRET_KINDS.includes(record.kind as SecretReference["kind"])) {
    errors.push({ code: "invalid-record", message: `the secret kind '${String(record.kind)}' is outside the closed vocabulary — secrets are ${SECRET_KINDS.join(", ")} only` });
  }
  if (typeof record.displayName !== "string" || record.displayName.trim().length === 0) {
    errors.push({ code: "invalid-record", message: "the handle's display name is blank — a handle names its secret, never blankly" });
  }
  for (const custodyError of secretCustodyPolicyErrors(record.custody)) {
    errors.push({ code: "invalid-custody", message: `the handle's custody policy fails its own laws: ${custodyError.message}` });
  }
  if (record.secretId !== undefined && String(record.secretId) !== String(secretReferenceDigestOf(record))) {
    errors.push({ code: "secret-id-mismatch", message: "the handle's sec-<digest> id does not re-derive from its own carried bytes — the handle is content-addressed data (A9)" });
  }
  errors.push(...provenanceErrors(record.provenance, "seal-secret-reference", secretInputDigestOf(record)));
  errors.push(...secretValueViolations(record, "the reference record"));
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Re-validate a security policy from its carried bytes alone. */
export function validateSecurityPolicy(policy: unknown): SecurityValidationOutcome {
  const errors: SecurityError<SecurityValidationErrorCode>[] = [];
  if (!isRecordLike(policy)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the security policy is not typed data — a policy record is required" }] };
  }
  const record = policy as unknown as SecurityPolicy;
  errors.push(...scopeErrors(record.scope, "security policy"));
  if (!isRecordLike(record.declaredBy) || String(record.declaredBy.tenantId).trim().length === 0 || String(record.declaredBy.principalId).trim().length === 0) {
    errors.push({ code: "invalid-record", message: "the declaring principal is blank or malformed — the principal is the W058 grantee vocabulary, explicit, never blank" });
  }
  if (!SECRET_ACCESS_SCOPES.includes(record.requiredScopeKind as SecurityPolicy["requiredScopeKind"])) {
    errors.push({ code: "invalid-record", message: `the required scope kind '${String(record.requiredScopeKind)}' is outside W059's closed §14 route-scope hierarchy` });
  }
  for (const custodyError of secretCustodyPolicyErrors(record.secretCustody)) {
    errors.push({ code: "invalid-custody", message: `the policy's secret-custody requirement fails its own laws: ${custodyError.message}` });
  }
  if (!AUTHORIZATION_MODELS.includes(record.authorizationModel as SecurityPolicy["authorizationModel"])) {
    errors.push({ code: "invalid-record", message: `the authorization model '${String(record.authorizationModel)}' is outside the closed vocabulary — access is decided by entitlement grants (A14), never by the security layer itself` });
  }
  if (record.policyId !== undefined && String(record.policyId) !== String(securityPolicyDigestOf(record))) {
    errors.push({ code: "policy-id-mismatch", message: "the policy's pol-<digest> id does not re-derive from its own carried bytes — the policy is content-addressed data (A9)" });
  }
  errors.push(...provenanceErrors(record.provenance, "declare-security-policy", securityPolicyInputDigestOf(record)));
  errors.push(...secretValueViolations(record, "the policy record"));
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** The canonical secret-policy violations (re-exported so consumers of the
 * validation surface share ONE canonical order). */
export { canonicalSecretViolations };
