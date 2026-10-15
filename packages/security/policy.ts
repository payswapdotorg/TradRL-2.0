/**
 * The security-policy vocabulary (W060) — the typed contracts of WHAT THE
 * SECURITY LAYER REQUIRES, as closed sets of data.
 *
 * ONE `SecurityPolicy` is the §14-scoped record that binds the layer's
 * requirements together: the explicit tenant/project/world scope it
 * governs; the declaring PRINCIPAL (W058's grantee vocabulary —
 * tenant + principal, imported from the entitlements contract); the
 * MINIMUM §14 explicitness every record under the policy must carry
 * (W059's closed route-scope hierarchy, imported through the secret
 * contract); the SECRET CUSTODY policy (rotation cadence, access scopes,
 * redaction level — the `SecretCustodyPolicy` of ./secrets.ts); and the
 * AUTHORIZATION MODEL — closed to `entitlement-grants`: access decisions
 * defer to W058's pure grant-check, ALWAYS. The security layer composes
 * typed requirements; it NEVER authenticates, NEVER authorizes by itself
 * (A14) — the model member cites the surface that does.
 *
 * Fail-closed at construction: closed sets validated loudly, the §14 scope
 * explicit, the declaring principal explicit (the entitlements contract's
 * own blank-member law, imported and re-run), the custody policy validated
 * through its own laws, THE REDACTION LAW scan over the entire input (a
 * policy never carries a secret value either), then the seal: the
 * content-addressed `pol-<digest>` id (the TENANT weighed first — R056
 * structural), the deterministic provenance.
 *
 * Laws: R056 + §14; THE REDACTION LAW; A9 (same input ⇒ deep-equal policy,
 * same id); A14 (typed contracts — no authentication execution, no
 * decryption, no deployment). License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import { blankEntitlementScopeMembers, ENTITLEMENT_SCOPE_MEMBERS } from "entitlements";
import type { EntitlementScope } from "entitlements";
import type { SecurityError, SecurityProvenance, SecurityScope } from "./isolation.js";
import { SECURITY_PROVENANCE_LAWS, blankSecurityScopeMembers } from "./isolation.js";
import type { SecretAccessScope, SecretCustodyPolicy } from "./secrets.js";
import { SECRET_ACCESS_SCOPES, secretCustodyPolicyErrors, secretValueViolations } from "./secrets.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The closed authorization-model vocabulary: access is decided by W058's
 * entitlement GRANTS (the pure grant-check) — the security layer composes
 * the requirements, never the decision. */
export const AUTHORIZATION_MODELS = ["entitlement-grants"] as const;
export type AuthorizationModel = (typeof AUTHORIZATION_MODELS)[number];

export type SecurityPolicyErrorCode =
  | "malformed-input" // not lawful typed data
  | "invalid-scope" // a §14 scope member is blank
  | "invalid-declarer" // the declaring principal is blank or malformed
  | "unknown-required-scope-kind" // the closed §14 hierarchy, loudly enforced
  | "invalid-custody" // the custody policy fails its own laws
  | "unknown-authorization-model" // the closed vocabulary, loudly enforced
  | "secret-value-refused"; // THE REDACTION LAW

declare const securityPolicyIdBrand: unique symbol;
/** An OPAQUE security-policy id (a canonical digest rendering). Produced
 * only by the declaration gate / {@link securityPolicyDigestOf}; never parsed. */
export type SecurityPolicyId = string & {
  readonly [securityPolicyIdBrand]: true;
};
/** The id prefix (a rendering convention, never a parse target). */
export const SECURITY_POLICY_ID_PREFIX = "pol-";

/** ONE security policy — the typed requirements record (ALL data). */
export interface SecurityPolicy {
  readonly policyId: SecurityPolicyId;
  /** The §14 scope this policy governs. */
  readonly scope: SecurityScope;
  /** The declaring principal — W058's grantee vocabulary (tenant + principal). */
  readonly declaredBy: EntitlementScope;
  /** The minimum §14 explicitness every record under this policy must carry
   * (W059's closed route-scope hierarchy, imported). */
  readonly requiredScopeKind: SecretAccessScope;
  /** The secret-custody policy every secret handle under this policy must satisfy. */
  readonly secretCustody: SecretCustodyPolicy;
  /** HOW access is decided — W058's entitlement grants, always (A14). */
  readonly authorizationModel: AuthorizationModel;
  readonly provenance: SecurityProvenance;
}
/** The declaration input (never a value member — the scan enforces it). */
export interface SecurityPolicyInput {
  readonly scope: SecurityScope;
  readonly declaredBy: EntitlementScope;
  readonly requiredScopeKind: SecretAccessScope;
  readonly secretCustody: SecretCustodyPolicy;
  readonly authorizationModel: AuthorizationModel;
}
export type SecurityPolicyOutcome =
  | { readonly ok: true; readonly policy: SecurityPolicy }
  | { readonly ok: false; readonly errors: readonly SecurityError<SecurityPolicyErrorCode>[] };

/** The canonical content a policy id addresses (the TENANT FIRST — R056
 * structural; the declaring principal's tenant before its principal). */
export function securityPolicyCanonicalContent(
  scope: SecurityScope,
  declaredBy: EntitlementScope,
  requiredScopeKind: SecretAccessScope,
  secretCustody: SecretCustodyPolicy,
  authorizationModel: AuthorizationModel,
): unknown {
  const rotation: unknown[] =
    secretCustody.rotation.kind === "on-schedule"
      ? [secretCustody.rotation.kind, secretCustody.rotation.maxAgeTicks]
      : [secretCustody.rotation.kind];
  return {
    authorizationModel,
    declaredBy: [declaredBy.tenantId, declaredBy.principalId],
    requiredScopeKind,
    scope: [scope.tenantId, scope.projectId, scope.worldId],
    secretCustody: [rotation, secretCustody.accessScopes.map(String), secretCustody.redaction],
  };
}
/** The policy id: `pol-<digest>` over the canonical content. Pure and
 * deterministic (A9). */
export function securityPolicyDigestOf(
  policy: Pick<SecurityPolicy, "scope" | "declaredBy" | "requiredScopeKind" | "secretCustody" | "authorizationModel">,
): SecurityPolicyId {
  const digest = canonicalDigestHex(
    securityPolicyCanonicalContent(
      policy.scope,
      policy.declaredBy,
      policy.requiredScopeKind,
      policy.secretCustody,
      policy.authorizationModel,
    ),
  );
  return `${SECURITY_POLICY_ID_PREFIX}${digest}` as SecurityPolicyId;
}
/** The policy's input digest (the provenance member). */
export function securityPolicyInputDigestOf(input: SecurityPolicyInput): string {
  return canonicalDigestHex({
    authorizationModel: input.authorizationModel,
    declaredBy: [input.declaredBy.tenantId, input.declaredBy.principalId],
    requiredScopeKind: input.requiredScopeKind,
    scope: [input.scope.tenantId, input.scope.projectId, input.scope.worldId],
  });
}

/** Declare ONE security policy — THE POLICY GATE. Fail-closed, all
 * violations collected: lawful typed input, explicit §14 scope, explicit
 * declaring principal (the entitlements contract's own blank-member law,
 * imported and re-run — the W058 grantee vocabulary cited, not
 * re-declared), the required scope kind proven inside W059's closed §14
 * hierarchy, the secret-custody policy validated through its own laws, the
 * authorization model proven inside the closed vocabulary, and THE
 * REDACTION LAW scan over the ENTIRE input — then the seal. */
export function declareSecurityPolicy(input: SecurityPolicyInput): SecurityPolicyOutcome {
  if (
    !isRecordLike(input) ||
    !isRecordLike(input.scope) ||
    !isRecordLike(input.declaredBy) ||
    !isRecordLike(input.secretCustody)
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message: "the declaration input is not typed data — a scope, a declaring principal, a required scope kind, a custody policy, and an authorization model are required",
        },
      ],
    };
  }
  const errors: SecurityError<SecurityPolicyErrorCode>[] = [];
  for (const member of blankSecurityScopeMembers(input.scope)) {
    errors.push({
      code: "invalid-scope",
      message: `the security policy's scope '${member}' is blank — tenant/project/world identity is explicit, never blank`,
    });
  }
  const declarer = input.declaredBy as EntitlementScope;
  const blankDeclarers = blankEntitlementScopeMembers(declarer);
  if (blankDeclarers.length > 0) {
    errors.push({
      code: "invalid-declarer",
      message: `the declaring principal's ${blankDeclarers.join(" and ")} ${blankDeclarers.length === 1 ? "is" : "are"} blank — the principal is the W058 grantee vocabulary (tenant + principal), explicit, never blank`,
    });
  }
  if (!SECRET_ACCESS_SCOPES.includes(input.requiredScopeKind as SecretAccessScope)) {
    errors.push({
      code: "unknown-required-scope-kind",
      message: `the required scope kind '${String(input.requiredScopeKind)}' is outside W059's closed §14 route-scope hierarchy — records are scoped at ${SECRET_ACCESS_SCOPES.join(" / ")} at minimum`,
    });
  }
  for (const custodyError of secretCustodyPolicyErrors(input.secretCustody)) {
    errors.push({
      code: "invalid-custody",
      message: `the policy's secret-custody requirement fails its own laws: ${custodyError.message}`,
    });
  }
  if (!AUTHORIZATION_MODELS.includes(input.authorizationModel as AuthorizationModel)) {
    errors.push({
      code: "unknown-authorization-model",
      message: `the authorization model '${String(input.authorizationModel)}' is outside the closed vocabulary — access is decided by ${AUTHORIZATION_MODELS.join(" / ")} (W058's pure grant-check), never by the security layer itself`,
    });
  }
  errors.push(...secretValueViolations(input, "the declaration input"));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const scopedInput = input;
  const policy: SecurityPolicy = {
    policyId: securityPolicyDigestOf({
      scope: scopedInput.scope,
      declaredBy: scopedInput.declaredBy,
      requiredScopeKind: scopedInput.requiredScopeKind,
      secretCustody: scopedInput.secretCustody,
      authorizationModel: scopedInput.authorizationModel,
    }),
    scope: {
      tenantId: scopedInput.scope.tenantId,
      projectId: scopedInput.scope.projectId,
      worldId: scopedInput.scope.worldId,
    },
    declaredBy: {
      tenantId: scopedInput.declaredBy.tenantId,
      principalId: scopedInput.declaredBy.principalId,
    },
    requiredScopeKind: scopedInput.requiredScopeKind,
    secretCustody: scopedInput.secretCustody,
    authorizationModel: scopedInput.authorizationModel,
    provenance: {
      deriver: "declare-security-policy",
      inputDigest: securityPolicyInputDigestOf(scopedInput),
      laws: SECURITY_PROVENANCE_LAWS,
    },
  };
  return { ok: true, policy: Object.freeze(policy) };
}

/** The entitlements scope members (re-exported for consumers that cite the
 * W058 grantee vocabulary beside the §14 members — the principal scope's
 * own canonical order). */
export const PRINCIPAL_SCOPE_MEMBERS: readonly string[] = ENTITLEMENT_SCOPE_MEMBERS;
