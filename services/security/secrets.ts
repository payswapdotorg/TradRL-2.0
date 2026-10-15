/**
 * The pure custody-policy check (W060) — `enforceSecretPolicy`, over the
 * SECRET-REFERENCE contract (`packages/security`): does EVERY secret
 * handle satisfy the §14-scoped security policy's custody requirements?
 *
 * Every check is named, every violation TYPED (all collected, none
 * silently dropped — never a silent pass):
 *
 * 1. **THE REDACTION LAW re-scanned** over every checked byte — a
 *    secret-shaped string anywhere in the policy or the references is the
 *    loud `secret-value-detected` violation (the push-protection lesson,
 *    structural at this seam too).
 * 2. **the records' own laws** — the policy re-validated through the
 *    contract's own `validateSecurityPolicy` (failures carried as
 *    `invalid-policy`); every handle re-validated through
 *    `validateSecretReference` (failures carried as `invalid-reference`).
 * 3. **scope agreement** — a handle whose TENANT differs from the policy's
 *    is the LOUD `cross-tenant` violation naming R056; project/world
 *    disagreements are `scope-mismatch` (§14).
 * 4. **rotation compliance** — the handle's declared cadence must be at
 *    least as strict as the policy's (`rotation-noncompliant`).
 * 5. **access-scope agreement** — the handle's declared access scopes must
 *    sit inside the policy's allowed set (`access-scope-violation`).
 * 6. **redaction sufficiency** — the handle's declared redaction level
 *    must meet the policy's required level (`redaction-insufficient`).
 * 7. **duplicate handles** — the same `sec-<digest>` twice is a
 *    `duplicate-reference` violation (identity is exact).
 *
 * The verdict is sealed as the content-addressed `enf-<digest>`
 * enforcement record (canonical violation order — A9: the references'
 * input order never leaks). Fail-closed: malformed input is refused
 * loudly, never coerced.
 *
 * A14: composes typed policies — NEVER authenticates (the authorization
 * model is W058's entitlement grants, cited by the policy as data), NEVER
 * decrypts, NEVER rotates (rotation is declared data), NEVER executes.
 * Pure: no I/O, no clocks, no env reads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { CustodyRotation, SecretPolicyViolation, SecretReference } from "security";
import {
  REDACTION_STRICTNESS,
  TENANT_ISOLATION_LAW,
  canonicalSecretViolations,
  secretValueViolations,
} from "security";
import type { SecurityPolicy } from "security";
import { validateSecurityPolicy, validateSecretReference } from "security";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The typed gate errors of the enforcement mint (fail-closed; law named). */
export type SecretEnforcementErrorCode = "malformed-input";
export interface SecretEnforcementError {
  readonly code: SecretEnforcementErrorCode;
  readonly message: string;
}
export type SecretEnforcementOutcome =
  | { readonly ok: true; readonly enforcement: SecretEnforcement }
  | { readonly ok: false; readonly errors: readonly SecretEnforcementError[] };

declare const secretEnforcementIdBrand: unique symbol;
/** An OPAQUE enforcement id (a canonical digest rendering). Produced only
 * by the enforcement mint / {@link secretEnforcementDigestOf}; never parsed. */
export type SecretEnforcementId = string & {
  readonly [secretEnforcementIdBrand]: true;
};
/** The id prefix (a rendering convention, never a parse target). */
export const SECRET_ENFORCEMENT_ID_PREFIX = "enf-";

/** ONE enforcement record: the enforced policy's own id, the checked
 * handle count, the typed violations in canonical order, the compliance
 * verdict. Typed DATA — re-validatable from its own carried bytes alone
 * (`validateSecretEnforcement`). */
export interface SecretEnforcement {
  readonly enforcementId: SecretEnforcementId;
  readonly policyId: string;
  readonly checked: number;
  readonly violations: readonly SecretPolicyViolation[];
  readonly compliant: boolean;
}

/** The canonical content an enforcement id addresses. */
export function secretEnforcementCanonicalContent(
  policyId: string,
  checked: number,
  violations: readonly SecretPolicyViolation[],
): unknown {
  return {
    checked,
    policy: policyId,
    violations: canonicalSecretViolations(violations).map((violation) => [
      violation.code,
      violation.secretId ?? "",
      violation.message,
    ]),
  };
}
/** The enforcement id: `enf-<digest>` over the canonical content (A9). */
export function secretEnforcementDigestOf(
  enforcement: Pick<SecretEnforcement, "policyId" | "checked" | "violations">,
): SecretEnforcementId {
  const digest = canonicalDigestHex(
    secretEnforcementCanonicalContent(
      enforcement.policyId,
      enforcement.checked,
      enforcement.violations,
    ),
  );
  return `${SECRET_ENFORCEMENT_ID_PREFIX}${digest}` as SecretEnforcementId;
}

/** Rotation compliance: the declared cadence must be at least as strict as
 * the required one (on-every-use strictest; never laxest). */
export function rotationIsCompliant(
  required: CustodyRotation,
  declared: CustodyRotation,
): boolean {
  if (required.kind === "never") {
    return true;
  }
  if (required.kind === "on-every-use") {
    return declared.kind === "on-every-use";
  }
  if (declared.kind === "on-every-use") {
    return true;
  }
  if (declared.kind === "never") {
    return false;
  }
  return declared.maxAgeTicks <= required.maxAgeTicks;
}

/** THE PURE CUSTODY CHECK. Deterministic (A9) and fail-closed: the same
 * policy + the same references always yield the deep-equal enforcement
 * with the same `enf-<digest>` id, whatever the references' order. */
export function enforceSecretPolicy(
  policy: SecurityPolicy,
  references: readonly SecretReference[],
): SecretEnforcementOutcome {
  if (!isRecordLike(policy) || !Array.isArray(references)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message: "the enforcement input is not typed data — a security policy record and an array of secret references are required (fail-closed)",
        },
      ],
    };
  }

  const violations: SecretPolicyViolation[] = [];
  const policyLabel = String(policy.policyId);

  // -- 1. THE REDACTION LAW, re-scanned over every checked byte ----------
  for (const redaction of secretValueViolations(policy, "the policy record")) {
    violations.push({ code: "secret-value-detected", message: `${redaction.message} (policy '${policyLabel}')` });
  }
  for (const [index, reference] of references.entries()) {
    for (const redaction of secretValueViolations(reference, `the reference entry #${String(index)}`)) {
      violations.push({
        code: "secret-value-detected",
        message: redaction.message,
        secretId: isRecordLike(reference) ? String(reference.secretId) : undefined,
      });
    }
  }

  // -- 2. the records' own laws (carried, never re-interpreted) ----------
  const policyValidation = validateSecurityPolicy(policy);
  if (!policyValidation.ok) {
    for (const error of policyValidation.errors) {
      violations.push({
        code: "invalid-policy",
        message: `the policy record fails its own laws (${error.code}): ${error.message}`,
      });
    }
  }
  const validReferences: SecretReference[] = [];
  for (const reference of references) {
    const validation = validateSecretReference(reference);
    if (!validation.ok) {
      for (const error of validation.errors) {
        violations.push({
          code: "invalid-reference",
          message: `the handle fails its own laws (${error.code}): ${error.message}`,
          secretId: isRecordLike(reference) ? String(reference.secretId) : undefined,
        });
      }
      continue;
    }
    validReferences.push(reference);
  }

  // -- 3. scope agreement (R056 named loudly on a cross-tenant handle) ---
  for (const reference of validReferences) {
    const label = { secretId: String(reference.secretId) };
    if (String(reference.scope.tenantId) !== String(policy.scope.tenantId)) {
      violations.push({
        code: "cross-tenant",
        message: `the handle's tenant '${String(reference.scope.tenantId)}' is not the policy's tenant '${String(policy.scope.tenantId)}' — secrets are tenant isolated (${TENANT_ISOLATION_LAW}); a cross-tenant handle is a loud typed violation, never a silent pass`,
        ...label,
      });
      continue;
    }
    for (const member of ["projectId", "worldId"] as const) {
      if (String(reference.scope[member]) !== String(policy.scope[member])) {
        violations.push({
          code: "scope-mismatch",
          message: `the handle's '${member}' '${String(reference.scope[member])}' disagrees with the policy's '${String(policy.scope[member])}' — tenant/project/world identity is explicit and must agree (spec/ARCHITECTURE-LOCK.md §14)`,
          ...label,
        });
      }
    }
  }

  // -- 4/5/6. the custody requirements, as declared data -----------------
  if (policyValidation.ok) {
    const required = policy.secretCustody;
    for (const reference of validReferences) {
      const label = { secretId: String(reference.secretId) };
      if (!rotationIsCompliant(required.rotation, reference.custody.rotation)) {
        violations.push({
          code: "rotation-noncompliant",
          message: `the handle's rotation cadence (${reference.custody.rotation.kind}${reference.custody.rotation.kind === "on-schedule" ? `, max age ${String(reference.custody.rotation.maxAgeTicks)}` : ""}) is laxer than the policy's (${required.rotation.kind}${required.rotation.kind === "on-schedule" ? `, max age ${String(required.rotation.maxAgeTicks)}` : ""}) — rotation cadence is declared data, compliance is exact`,
          ...label,
        });
      }
      const outside = reference.custody.accessScopes.filter(
        (scope) => !required.accessScopes.includes(scope),
      );
      if (outside.length > 0) {
        violations.push({
          code: "access-scope-violation",
          message: `the handle grants access at ${outside.map(String).join(" / ")} but the policy allows ${required.accessScopes.map(String).join(" / ")} only — access scopes are the closed §14 hierarchy, agreement is exact`,
          ...label,
        });
      }
      if (
        (REDACTION_STRICTNESS[reference.custody.redaction] ?? -1) <
        (REDACTION_STRICTNESS[required.redaction] ?? -1)
      ) {
        violations.push({
          code: "redaction-insufficient",
          message: `the handle's redaction level '${String(reference.custody.redaction)}' is below the policy's required '${String(required.redaction)}' — THE REDACTION LAW's requirements are declared data, sufficiency is exact`,
          ...label,
        });
      }
    }
  }

  // -- 7. duplicate handles (identity is exact) --------------------------
  const seen = new Set<string>();
  for (const reference of validReferences) {
    const secretId = String(reference.secretId);
    if (seen.has(secretId)) {
      violations.push({
        code: "duplicate-reference",
        message: `the handle '${secretId}' appears more than once — identity is exact, an enforcement never double-counts a handle`,
        secretId,
      });
    }
    seen.add(secretId);
  }

  const ordered = canonicalSecretViolations(violations);
  const enforcement: SecretEnforcement = {
    enforcementId: secretEnforcementDigestOf({
      policyId: policyLabel,
      checked: references.length,
      violations: ordered,
    }),
    policyId: policyLabel,
    checked: references.length,
    violations: ordered,
    compliant: ordered.length === 0,
  };
  return { ok: true, enforcement: Object.freeze(enforcement) };
}
