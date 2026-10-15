/**
 * The pure custody check (W060) — the laws as executable tests: every
 * violation of `enforceSecretPolicy` pinned over handles + policies built
 * through the contract's OWN gates — THE REDACTION LAW re-scanned
 * (runtime-constructed secret-shaped bytes, never a literal), the
 * invalid-policy / invalid-reference carries, the R056 cross-tenant
 * violation, the §14 scope-mismatch, rotation compliance (laxer cadence
 * refused, stricter cadence accepted), access-scope agreement,
 * redaction sufficiency, duplicate handles, the canonical violation
 * order, and `validateSecretEnforcement`'s whole-record re-derivations.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_ISOLATION_LAW } from "security";
import type { SecretReference } from "security";
import { enforceSecretPolicy, rotationIsCompliant } from "../secrets.js";
import { validateSecretEnforcement } from "../validate.js";
import type { SecretEnforcement } from "../secrets.js";
import { CUSTODY, handleFixture, policyFixture, SCOPE } from "./fixtures.js";

const RUNTIME_TOKEN = ["gh", "p_", "A".repeat(36)].join("");

test("the happy path: every handle satisfies the policy — compliant, zero violations, the enforcement re-validates", () => {
  const policy = policyFixture();
  const handles = [handleFixture(), handleFixture({ displayName: "second desk handle" })];
  const outcome = enforceSecretPolicy(policy, handles);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(outcome.enforcement.compliant, true);
  assert.deepEqual(outcome.enforcement.violations, []);
  assert.equal(outcome.enforcement.checked, 2);
  assert.match(outcome.enforcement.enforcementId, /^enf-/);
  assert.equal(validateSecretEnforcement(outcome.enforcement).ok, true);
});

test("fail-closed: malformed input (not typed data) is refused loudly", () => {
  const malformed = enforceSecretPolicy(null as never, null as never);
  assert.equal(malformed.ok, false);
  if (malformed.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(malformed.errors[0]?.code, "malformed-input");
});

test("R056: a CROSS-TENANT handle is the LOUD typed violation naming the law", () => {
  const policy = policyFixture();
  const otherTenantHandle = handleFixture({
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  const outcome = enforceSecretPolicy(policy, [otherTenantHandle]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  const violation = outcome.enforcement.violations.find((candidate) => candidate.code === "cross-tenant");
  assert.notEqual(violation, undefined);
  assert.ok((violation?.message ?? "").includes(TENANT_ISOLATION_LAW));
  assert.equal(outcome.enforcement.compliant, false);
});

test("§14: same tenant, ANOTHER PROJECT — a typed scope-mismatch violation", () => {
  const policy = policyFixture();
  const handle = handleFixture({ scope: { ...SCOPE, projectId: "project-OTHER" } });
  const outcome = enforceSecretPolicy(policy, [handle]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(
    outcome.enforcement.violations.some((violation) => violation.code === "scope-mismatch"),
    true,
  );
});

test("rotation compliance: a LAXER cadence is refused; a STRICTER cadence satisfies", () => {
  const policy = policyFixture();
  const laxer = handleFixture({
    custody: { ...CUSTODY, rotation: { kind: "on-schedule", maxAgeTicks: 2000 } },
  });
  const laxest = handleFixture({ custody: { ...CUSTODY, rotation: { kind: "never" } } });
  const stricter = handleFixture({
    custody: { ...CUSTODY, rotation: { kind: "on-schedule", maxAgeTicks: 500 } },
  });
  const strictest = handleFixture({ custody: { ...CUSTODY, rotation: { kind: "on-every-use" } } });
  const laxOutcome = enforceSecretPolicy(policy, [laxer, laxest]);
  assert.equal(laxOutcome.ok, true);
  if (!laxOutcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(
    laxOutcome.enforcement.violations.filter((violation) => violation.code === "rotation-noncompliant").length,
    2,
  );
  const strictOutcome = enforceSecretPolicy(policy, [stricter, strictest]);
  assert.equal(strictOutcome.ok, true);
  if (!strictOutcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(strictOutcome.enforcement.compliant, true);
});

test("the rotation lattice is exact data (on-every-use strictest, never laxest)", () => {
  assert.equal(rotationIsCompliant({ kind: "never" }, { kind: "never" }), true);
  assert.equal(rotationIsCompliant({ kind: "on-schedule", maxAgeTicks: 1000 }, { kind: "never" }), false);
  assert.equal(rotationIsCompliant({ kind: "on-schedule", maxAgeTicks: 1000 }, { kind: "on-every-use" }), true);
  assert.equal(rotationIsCompliant({ kind: "on-every-use" }, { kind: "on-schedule", maxAgeTicks: 1 }), false);
  assert.equal(
    rotationIsCompliant({ kind: "on-schedule", maxAgeTicks: 1000 }, { kind: "on-schedule", maxAgeTicks: 1000 }),
    true,
  );
});

test("access-scope agreement: a handle granting access OUTSIDE the policy's allowed scopes is refused", () => {
  const policy = policyFixture();
  const broadHandle = handleFixture({
    custody: { ...CUSTODY, accessScopes: ["tenant", "tenant-project-world"] },
  });
  const outcome = enforceSecretPolicy(policy, [broadHandle]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  const violation = outcome.enforcement.violations.find(
    (candidate) => candidate.code === "access-scope-violation",
  );
  assert.notEqual(violation, undefined);
  assert.match(violation?.message ?? "", /tenant-project-world/);
});

test("redaction sufficiency: a handle below the policy's required level is refused", () => {
  const policy = policyFixture();
  const shallowHandle = handleFixture({
    custody: { ...CUSTODY, redaction: "records-only" },
  });
  const outcome = enforceSecretPolicy(policy, [shallowHandle]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(
    outcome.enforcement.violations.some((violation) => violation.code === "redaction-insufficient"),
    true,
  );
});

test("THE REDACTION LAW re-scanned: a reference carrying secret-shaped bytes is the loud typed violation", () => {
  const policy = policyFixture();
  const tainted: Record<string, unknown> = { ...handleFixture() };
  tainted.displayName = RUNTIME_TOKEN;
  const outcome = enforceSecretPolicy(policy, [tainted as unknown as SecretReference]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(
    outcome.enforcement.violations.some((violation) => violation.code === "secret-value-detected"),
    true,
  );
  assert.equal(outcome.enforcement.compliant, false);
});

test("an INVALID handle is carried as the typed invalid-reference violation (its own laws, verbatim)", () => {
  const policy = policyFixture();
  const tampered = { ...handleFixture(), secretId: "sec-00000000" as SecretReference["secretId"] };
  const outcome = enforceSecretPolicy(policy, [tampered]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  const violation = outcome.enforcement.violations.find(
    (candidate) => candidate.code === "invalid-reference",
  );
  assert.notEqual(violation, undefined);
  assert.match(violation?.message ?? "", /secret-id-mismatch/);
});

test("an INVALID policy is carried as the typed invalid-policy violation — and the custody checks do not run against a broken law", () => {
  const tamperedPolicy = { ...policyFixture(), authorizationModel: "security-layer-decides" as never };
  const outcome = enforceSecretPolicy(tamperedPolicy, [handleFixture()]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  const violation = outcome.enforcement.violations.find(
    (candidate) => candidate.code === "invalid-policy",
  );
  assert.notEqual(violation, undefined);
  assert.match(violation?.message ?? "", /authorization model/);
  assert.equal(
    outcome.enforcement.violations.some((candidate) => candidate.code === "rotation-noncompliant"),
    false,
  );
});

test("a DUPLICATE handle is the typed duplicate-reference violation (identity is exact)", () => {
  const policy = policyFixture();
  const handle = handleFixture();
  const outcome = enforceSecretPolicy(policy, [handle, handle]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(
    outcome.enforcement.violations.some((violation) => violation.code === "duplicate-reference"),
    true,
  );
  assert.equal(outcome.enforcement.checked, 2);
});

test("A9: the violation order is canonical — the references' input order never leaks into the enforcement id", () => {
  const policy = policyFixture();
  const good = handleFixture();
  const crossTenant = handleFixture({
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  const lax = handleFixture({ custody: { ...CUSTODY, rotation: { kind: "never" } } });
  const first = enforceSecretPolicy(policy, [good, crossTenant, lax]);
  const second = enforceSecretPolicy(policy, [lax, good, crossTenant]);
  if (!first.ok || !second.ok) {
    assert.fail("expected enforcements");
  }
  assert.deepEqual(first.enforcement, second.enforcement);
  assert.equal(first.enforcement.enforcementId, second.enforcement.enforcementId);
});

test("validateSecretEnforcement: tampered ids, orders, verdicts, and counts do not re-derive", () => {
  const policy = policyFixture();
  const lax = handleFixture({ displayName: "lax desk handle", custody: { ...CUSTODY, rotation: { kind: "never" } } });
  const broad = handleFixture({ displayName: "broad desk handle", custody: { ...CUSTODY, accessScopes: ["tenant", "tenant-project-world"] } });
  const outcome = enforceSecretPolicy(policy, [lax, broad]);
  if (!outcome.ok) {
    assert.fail("expected an enforcement");
  }
  assert.equal(outcome.enforcement.violations.length >= 2, true);
  const tamperedId: SecretEnforcement = {
    ...outcome.enforcement,
    enforcementId: "enf-00000000" as SecretEnforcement["enforcementId"],
  };
  assert.equal(validateSecretEnforcement(tamperedId).ok, false);
  const lying: SecretEnforcement = { ...outcome.enforcement, compliant: true };
  assert.equal(validateSecretEnforcement(lying).ok, false);
  const swapped: SecretEnforcement = {
    ...outcome.enforcement,
    violations: [...outcome.enforcement.violations].reverse(),
  };
  assert.equal(validateSecretEnforcement(swapped).ok, false);
  const badCount: SecretEnforcement = { ...outcome.enforcement, checked: -1 };
  assert.equal(validateSecretEnforcement(badCount).ok, false);
});
