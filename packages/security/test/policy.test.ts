/**
 * The security-policy vocabulary (W060) — the laws as executable tests: the
 * declaration gate's closed sets (§14 scope, the W058 declaring principal,
 * W059's required scope kind, the custody requirement, the authorization
 * model), THE REDACTION LAW over the policy's own input, the
 * `validateSecurityPolicy` re-derivations, and the REAL cross-package
 * vocabulary pins (the R056 generalization proven against the memory
 * contract's own member list; the declarer pinned against the
 * entitlements contract's own member list; the required scope kind drawn
 * from the api contract's own closed hierarchy).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { API_ROUTE_SCOPE_KINDS } from "api";
import { blankEntitlementScopeMembers } from "entitlements";
import { declareSecurityPolicy } from "../policy.js";
import { validateSecurityPolicy } from "../validate.js";
import { SECURITY_SCOPE_MEMBERS } from "../isolation.js";
import type { SecurityPolicyInput } from "../policy.js";
import type { SecretAccessScope } from "../secrets.js";
import {
  CUSTODY,
  DECLARER,
  MEMORY_SCOPE_MEMBERS,
  PRINCIPAL_MEMBERS,
  RUNTIME_TOKEN,
  RUNTIME_VALUE_MEMBER,
  SCOPE,
} from "./fixtures.js";

const REQUIRED_SCOPE_KIND = API_ROUTE_SCOPE_KINDS[1] as SecretAccessScope;

function policyInputFixture(
  overrides: Partial<SecurityPolicyInput> = {},
): SecurityPolicyInput {
  return {
    scope: { ...SCOPE },
    declaredBy: { ...DECLARER },
    requiredScopeKind: REQUIRED_SCOPE_KIND,
    secretCustody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
    authorizationModel: "entitlement-grants",
    ...overrides,
  };
}

test("the R056 generalization: SecurityScope's members ARE the memory contract's own (the law's first instance, cited not re-declared)", () => {
  assert.deepEqual(SECURITY_SCOPE_MEMBERS, MEMORY_SCOPE_MEMBERS);
});

test("the declarer is pinned to the W058 grantee vocabulary's own member list", () => {
  assert.deepEqual(PRINCIPAL_MEMBERS, ["tenantId", "principalId"]);
  assert.deepEqual(blankEntitlementScopeMembers(DECLARER), []);
});

test("the happy path: a policy declares over the real api scope hierarchy and re-validates", () => {
  const outcome = declareSecurityPolicy(policyInputFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a declared policy");
  }
  assert.match(outcome.policy.policyId, /^pol-/);
  assert.equal(outcome.policy.requiredScopeKind, "tenant-project");
  assert.equal(outcome.policy.authorizationModel, "entitlement-grants");
  assert.deepEqual(outcome.policy.declaredBy, DECLARER);
  assert.equal(validateSecurityPolicy(outcome.policy).ok, true);
});

test("malformed input (not typed data) is refused loudly", () => {
  const outcome = declareSecurityPolicy(undefined as unknown as SecurityPolicyInput);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-input");
});

test("a blank §14 scope member is refused (invalid-scope)", () => {
  const outcome = declareSecurityPolicy(
    policyInputFixture({ scope: { tenantId: "t", projectId: "", worldId: "w" } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-scope"), true);
});

test("a blank declaring principal is refused through the ENTITLEMENTS contract's own law (imported, not re-declared)", () => {
  const blankDeclarer = { tenantId: "tenant-security-tests", principalId: "" };
  assert.deepEqual(blankEntitlementScopeMembers(blankDeclarer), ["principalId"]);
  const outcome = declareSecurityPolicy(policyInputFixture({ declaredBy: blankDeclarer }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-declarer"), true);
});

test("a required scope kind outside W059's closed §14 hierarchy is refused loudly", () => {
  const outcome = declareSecurityPolicy(
    policyInputFixture({ requiredScopeKind: "galaxy" as SecretAccessScope }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "unknown-required-scope-kind"), true);
});

test("an authorization model outside the closed vocabulary is refused — the security layer never decides access itself", () => {
  const outcome = declareSecurityPolicy(
    policyInputFixture({ authorizationModel: "security-layer-decides" as never }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((error) => error.code === "unknown-authorization-model");
  assert.notEqual(refusal, undefined);
  assert.match(refusal?.message ?? "", /A14|entitlement/);
});

test("an invalid custody requirement is carried into the policy refusal (invalid-custody)", () => {
  const outcome = declareSecurityPolicy(
    policyInputFixture({
      secretCustody: { ...CUSTODY, rotation: { kind: "on-schedule", maxAgeTicks: -5 } },
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-custody"), true);
});

test("THE REDACTION LAW over the policy's own input: a forbidden VALUE member is refused loudly", () => {
  const tainted: Record<string, unknown> = { ...policyInputFixture() };
  tainted[RUNTIME_VALUE_MEMBER] = RUNTIME_TOKEN;
  const outcome = declareSecurityPolicy(tainted as unknown as SecurityPolicyInput);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "secret-value-refused"), true);
});

test("validateSecurityPolicy: a tampered id does not re-derive (A9)", () => {
  const outcome = declareSecurityPolicy(policyInputFixture());
  if (!outcome.ok) {
    assert.fail("expected a declared policy");
  }
  const tampered = { ...outcome.policy, policyId: "pol-00000000" as typeof outcome.policy.policyId };
  const validation = validateSecurityPolicy(tampered);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "policy-id-mismatch"), true);
});

test("validateSecurityPolicy: a tampered custody requirement is refused, and so is a tampered provenance", () => {
  const outcome = declareSecurityPolicy(policyInputFixture());
  if (!outcome.ok) {
    assert.fail("expected a declared policy");
  }
  const badCustody = {
    ...outcome.policy,
    secretCustody: { ...outcome.policy.secretCustody, redaction: "sometimes" as never },
  };
  assert.equal(validateSecurityPolicy(badCustody).ok, false);
  const badProvenance = {
    ...outcome.policy,
    provenance: { ...outcome.policy.provenance, deriver: "prove-isolation" as never },
  };
  const validation = validateSecurityPolicy(badProvenance);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "provenance-mismatch"), true);
});
