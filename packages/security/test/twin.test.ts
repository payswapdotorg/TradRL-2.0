/**
 * The A9 determinism twins (W060) — same inputs ⇒ deep-equal records with
 * the same canonical ids; ANY differing member ⇒ a different id (the
 * TENANT weighed first — R056 structural). The cross-package law pins:
 * this package's R056/§14 law constants are the memory contract's own
 * (the generalization cites the first instance, never a parallel law).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { EXPLICIT_SCOPE_LAW as MEMORY_SCOPE_LAW, TENANT_ISOLATION_LAW as MEMORY_TENANT_LAW } from "memory";
import { declareSecurityPolicy } from "../policy.js";
import { EXPLICIT_SCOPE_LAW, TENANT_ISOLATION_LAW } from "../isolation.js";
import { isolationProofDigestOf } from "../isolation.js";
import type { IsolationFinding } from "../isolation.js";
import { sealSecretReference } from "../secrets.js";
import type { SecretReferenceInput } from "../secrets.js";
import { CUSTODY, DECLARER, SCOPE } from "./fixtures.js";

const secretInput: SecretReferenceInput = {
  scope: { ...SCOPE },
  kind: "signing-key",
  displayName: "desk signing handle",
  custody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
};

test("the law pins: the R056 and §14 law constants ARE the memory contract's own (the generalization cites, never re-declares)", () => {
  assert.equal(TENANT_ISOLATION_LAW, MEMORY_TENANT_LAW);
  assert.equal(EXPLICIT_SCOPE_LAW, MEMORY_SCOPE_LAW);
});

test("A9 twin — the secret handle: same input seals the deep-equal handle with the same sec-<digest> id", () => {
  const first = sealSecretReference(secretInput);
  const second = sealSecretReference(
    JSON.parse(JSON.stringify(secretInput)) as SecretReferenceInput,
  );
  if (!first.ok || !second.ok) {
    assert.fail("expected two sealed handles");
  }
  assert.deepEqual(first.reference, second.reference);
  assert.equal(first.reference.secretId, second.reference.secretId);
});

test("R056 structural — the same handle under ANOTHER TENANT is a DIFFERENT secret (the tenant weighs first)", () => {
  const first = sealSecretReference(secretInput);
  const other = sealSecretReference({
    ...secretInput,
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  if (!first.ok || !other.ok) {
    assert.fail("expected two sealed handles");
  }
  assert.notEqual(first.reference.secretId, other.reference.secretId);
  assert.notDeepEqual(first.reference.scope, other.reference.scope);
  assert.equal(first.reference.kind, other.reference.kind);
  assert.equal(first.reference.displayName, other.reference.displayName);
  assert.deepEqual(first.reference.custody, other.reference.custody);
});

test("A9 twin — the security policy: same input declares the deep-equal policy with the same pol-<digest> id", () => {
  const input = {
    scope: { ...SCOPE },
    declaredBy: { ...DECLARER },
    requiredScopeKind: "tenant" as const,
    secretCustody: secretInput.custody,
    authorizationModel: "entitlement-grants" as const,
  };
  const first = declareSecurityPolicy(input);
  const second = declareSecurityPolicy(JSON.parse(JSON.stringify(input)));
  if (!first.ok || !second.ok) {
    assert.fail("expected two declared policies");
  }
  assert.deepEqual(first.policy, second.policy);
  assert.equal(first.policy.policyId, second.policy.policyId);
});

test("R056 structural — the same policy governing ANOTHER TENANT is a DIFFERENT policy", () => {
  const input = {
    scope: { ...SCOPE },
    declaredBy: { ...DECLARER },
    requiredScopeKind: "tenant" as const,
    secretCustody: secretInput.custody,
    authorizationModel: "entitlement-grants" as const,
  };
  const first = declareSecurityPolicy(input);
  const other = declareSecurityPolicy({
    ...input,
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  if (!first.ok || !other.ok) {
    assert.fail("expected two declared policies");
  }
  assert.notEqual(first.policy.policyId, other.policy.policyId);
});

test("A9 twin — the isolation proof id: the same canonical content yields the same iso-<digest>; permuted findings never leak", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "tenant differs" },
    { code: "scope-mismatch", recordId: "rec-a", message: "world differs" },
  ];
  const first = isolationProofDigestOf({ scope: SCOPE, checked: 2, findings });
  const twin = isolationProofDigestOf({
    scope: { ...SCOPE },
    checked: 2,
    findings: [findings[1]!, findings[0]!],
  });
  assert.equal(first, twin);
  assert.notEqual(first, isolationProofDigestOf({ scope: SCOPE, checked: 3, findings }));
});
