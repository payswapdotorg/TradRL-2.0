/**
 * Shared fixtures of the W060 `security-service` tests. REAL imports only:
 * policies and handles built through the contract's OWN gates
 * (`declareSecurityPolicy` / `sealSecretReference`), brain generations
 * founded through W054's OWN `foundBrain` gate at real §14 scopes, the
 * declaring principal shaped by the W058 grantee vocabulary, and the
 * access scopes drawn from W059's own closed hierarchy. NO secret-shaped
 * literals anywhere (THE REDACTION LAW applies to this suite itself).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { API_ROUTE_SCOPE_KINDS } from "api";
import { ENTITLEMENT_SCOPE_MEMBERS } from "entitlements";
import { foundBrain } from "firm-brain";
import { declareSecurityPolicy, sealSecretReference } from "security";
import type { SecurityPolicyInput, SecurityPolicy } from "security";
import type { SecretAccessScope, SecretCustodyPolicy, SecretReference, SecretReferenceInput } from "security";
import type { FirmBrain } from "firm-brain";

/** The §14 scope of the default fixtures (tenant explicit — R056). */
export const TENANT = "tenant-security-service-tests";
export const PROJECT = "project-security";
export const WORLD = "world-security-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
/** The declaring principal (the W058 grantee vocabulary, real member list). */
export const DECLARER = { tenantId: TENANT, principalId: "principal-security-officer" };
export const PRINCIPAL_MEMBERS = ENTITLEMENT_SCOPE_MEMBERS;
/** The default required scope kind — drawn from W059's own closed hierarchy. */
export const REQUIRED_SCOPE_KIND = API_ROUTE_SCOPE_KINDS[1] as SecretAccessScope;

/** The default custody requirement: 1000-tick scheduled rotation, tenant
 * access only, redaction everywhere. */
export const CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant"],
  redaction: "everywhere",
};

export function policyFixture(overrides: Partial<SecurityPolicyInput> = {}): SecurityPolicy {
  const outcome = declareSecurityPolicy({
    scope: { ...SCOPE },
    declaredBy: { ...DECLARER },
    requiredScopeKind: REQUIRED_SCOPE_KIND,
    secretCustody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
    authorizationModel: "entitlement-grants",
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`policy fixture failed its own gate: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.policy;
}

export function handleFixture(
  overrides: Partial<SecretReferenceInput> = {},
): SecretReference {
  const outcome = sealSecretReference({
    scope: { ...SCOPE },
    kind: "api-key",
    displayName: "upstream exchange handle",
    custody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`handle fixture failed its own gate: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.reference;
}

/** A REAL W054 brain generation, founded through W054's own gate. */
export function brainFixture(scope: { tenantId: string; projectId: string; worldId: string } = SCOPE): FirmBrain {
  const outcome = foundBrain(scope);
  if (!outcome.ok) {
    throw new Error(`brain fixture failed its own gate: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.brain;
}
