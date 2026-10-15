/**
 * THE REDACTION LAW (W060) — the laws as executable tests: every refusal of
 * `sealSecretReference` pinned (malformed input, blank scope, unknown kind,
 * blank display name, every custody closed-set law, and the REDACTION LAW
 * refusals — forbidden VALUE members + secret-shaped strings, ALL fixtures
 * constructed at runtime from non-secret fragments so no secret-shaped
 * literal ever appears in this suite), plus the custody-policy closed-set
 * laws and `validateSecretReference`'s whole-record re-derivations.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sealSecretReference } from "../secrets.js";
import { isSecretShaped, secretCustodyPolicyErrors } from "../secrets.js";
import { validateSecretReference } from "../validate.js";
import type { SecretReferenceInput } from "../secrets.js";
import {
  CUSTODY,
  PROJECT,
  RUNTIME_BEARER,
  RUNTIME_ENTROPIC,
  RUNTIME_JWT,
  RUNTIME_PEM,
  RUNTIME_TOKEN,
  RUNTIME_VALUE_MEMBER,
  SCOPE,
  WORLD,
} from "./fixtures.js";

function inputFixture(overrides: Partial<SecretReferenceInput> = {}): SecretReferenceInput {
  return {
    scope: { ...SCOPE },
    kind: "api-key",
    displayName: "upstream exchange signing handle",
    custody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
    ...overrides,
  };
}

test("the happy path: a typed handle seals — identity + custody only, no value member anywhere", () => {
  const outcome = sealSecretReference(inputFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a sealed handle");
  }
  assert.match(outcome.reference.secretId, /^sec-/);
  assert.equal(outcome.reference.kind, "api-key");
  assert.deepEqual(outcome.reference.scope, SCOPE);
  assert.equal(outcome.reference.displayName, "upstream exchange signing handle");
  assert.deepEqual(outcome.reference.custody, CUSTODY);
  assert.equal(Object.keys(outcome.reference).includes("value"), false);
  assert.equal(validateSecretReference(outcome.reference).ok, true);
});

test("malformed input (not typed data) is refused loudly", () => {
  const outcome = sealSecretReference(null as unknown as SecretReferenceInput);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "malformed-input");
});

test("a blank §14 scope member is refused (invalid-scope)", () => {
  const outcome = sealSecretReference(
    inputFixture({ scope: { tenantId: "", projectId: PROJECT, worldId: WORLD } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-scope"), true);
});

test("an unknown secret kind is refused (the closed vocabulary)", () => {
  const outcome = sealSecretReference(inputFixture({ kind: "password" as SecretReferenceInput["kind"] }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "unknown-secret-kind");
});

test("a blank display name is refused", () => {
  const outcome = sealSecretReference(inputFixture({ displayName: "   " }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors[0]?.code, "blank-display-name");
});

test("the custody laws: an unknown rotation cadence is refused", () => {
  const outcome = sealSecretReference(
    inputFixture({ custody: { ...CUSTODY, rotation: { kind: "hourly" } as never } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-custody"), true);
});

test("the custody laws: a non-positive scheduled max age is refused (declared time is explicit)", () => {
  const errors = secretCustodyPolicyErrors({ ...CUSTODY, rotation: { kind: "on-schedule", maxAgeTicks: 0 } });
  assert.equal(errors.length > 0, true);
  const outcome = sealSecretReference(
    inputFixture({ custody: { ...CUSTODY, rotation: { kind: "on-schedule", maxAgeTicks: 0 } } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "invalid-custody"), true);
});

test("the custody laws: empty, unknown, duplicate, or non-canonical access scopes are refused", () => {
  assert.equal(secretCustodyPolicyErrors({ ...CUSTODY, accessScopes: [] }).length > 0, true);
  assert.equal(
    secretCustodyPolicyErrors({ ...CUSTODY, accessScopes: ["galaxy"] as never }).length > 0,
    true,
  );
  assert.equal(
    secretCustodyPolicyErrors({ ...CUSTODY, accessScopes: ["tenant", "tenant"] as never }).length > 0,
    true,
  );
  assert.equal(
    secretCustodyPolicyErrors({
      ...CUSTODY,
      accessScopes: ["tenant-project-world", "tenant"] as never,
    }).length > 0,
    true,
  );
});

test("the custody laws: an unknown redaction level is refused", () => {
  assert.equal(secretCustodyPolicyErrors({ ...CUSTODY, redaction: "sometimes" as never }).length > 0, true);
});

test("THE REDACTION LAW: a forbidden VALUE member is the loud typed refusal naming the law", () => {
  const tainted: Record<string, unknown> = { ...inputFixture() };
  tainted[RUNTIME_VALUE_MEMBER] = RUNTIME_TOKEN;
  const outcome = sealSecretReference(tainted as unknown as SecretReferenceInput);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refusal = outcome.errors.find((error) => error.code === "secret-value-refused");
  assert.notEqual(refusal, undefined);
  assert.match(refusal?.message ?? "", /REDACTION LAW/);
  assert.match(refusal?.message ?? "", /value/i);
});

test("THE REDACTION LAW: a secret-shaped DISPLAY NAME is refused loudly", () => {
  const outcome = sealSecretReference(inputFixture({ displayName: RUNTIME_TOKEN }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "secret-value-refused"), true);
});

test("THE REDACTION LAW: a secret-shaped SCOPE MEMBER is refused loudly (§14 ids are explicit, never entropy)", () => {
  const outcome = sealSecretReference(
    inputFixture({ scope: { tenantId: RUNTIME_ENTROPIC, projectId: "p", worldId: "w" } }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(outcome.errors.some((error) => error.code === "secret-value-refused"), true);
});

test("the secret-shape detector: known token grammar, PEM blocks, bearer material, JWTs, high-entropy tokens — and ordinary repo strings are NOT", () => {
  assert.equal(isSecretShaped(RUNTIME_TOKEN), true);
  assert.equal(isSecretShaped(RUNTIME_PEM), true);
  assert.equal(isSecretShaped(RUNTIME_BEARER), true);
  assert.equal(isSecretShaped(RUNTIME_JWT), true);
  assert.equal(isSecretShaped(RUNTIME_ENTROPIC), true);
  assert.equal(isSecretShaped(`the handle leaked as ${RUNTIME_TOKEN} yesterday`), true);
  assert.equal(isSecretShaped(`rotated the key: ${RUNTIME_JWT}`), true);
  assert.equal(isSecretShaped("tenant-security-tests"), false);
  assert.equal(isSecretShaped("upstream exchange signing handle"), false);
  assert.equal(isSecretShaped("on-schedule"), false);
  assert.equal(isSecretShaped("desk-operations-primary-handle"), false);
});

test("validateSecretReference: a tampered id does not re-derive (A9)", () => {
  const outcome = sealSecretReference(inputFixture());
  if (!outcome.ok) {
    assert.fail("expected a sealed handle");
  }
  const tampered = { ...outcome.reference, secretId: "sec-00000000" as typeof outcome.reference.secretId };
  const validation = validateSecretReference(tampered);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "secret-id-mismatch"), true);
});

test("validateSecretReference: a record carrying a secret-shaped string is INVALID (the law re-scanned)", () => {
  const outcome = sealSecretReference(inputFixture());
  if (!outcome.ok) {
    assert.fail("expected a sealed handle");
  }
  const tainted = { ...outcome.reference, displayName: RUNTIME_TOKEN };
  const validation = validateSecretReference(tainted);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "secret-value-refused"), true);
});

test("validateSecretReference: a tampered provenance does not re-derive", () => {
  const outcome = sealSecretReference(inputFixture());
  if (!outcome.ok) {
    assert.fail("expected a sealed handle");
  }
  const tampered = {
    ...outcome.reference,
    provenance: { ...outcome.reference.provenance, deriver: "declare-security-policy" as never },
  };
  const validation = validateSecretReference(tampered);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "provenance-mismatch"), true);
});
