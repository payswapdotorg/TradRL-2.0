/**
 * The W062 deployment-contract tests — REAL imports only (the no-shim law):
 * the security posture is built through W060's OWN gates (`declareSecurityPolicy`
 * + `sealSecretReference` — typed handles, values never), the API citation
 * through W059's own `worldAlphaApiV1()` table, the SDK citation through
 * W059's own `buildSdkClient`, the operations citation through W061's own
 * `operationsRouteDeclarations()`. The gates under test are this directory's
 * own `composeDeploymentPlan` + `validateDeploymentPlan`. Zero fixture drift;
 * only opaque-id leaf values are cast (the W050 precedent).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { worldAlphaApiV1 } from "../services/api/index.js";
import { buildSdkClient } from "../packages/sdk/index.js";
import { operationsRouteDeclarations } from "../packages/observability/index.js";
import {
  declareSecurityPolicy,
  sealSecretReference,
} from "../packages/security/index.js";
import type {
  SecurityPolicy,
  SecurityScope,
  SecretCustodyPolicy,
  SecretReference,
} from "../packages/security/index.js";
import {
  DEPLOYMENT_COMPONENT_KINDS,
  composeDeploymentPlan,
  validateDeploymentPlan,
  type DeploymentComponentKind,
  type DeploymentMode,
  type DeploymentPlan,
  type DeploymentPlanInput,
  type DeploymentViolation,
} from "./index.js";

// ---------------------------------------------------------------------------
// The REAL fixture chain (every record through its own source gate)
// ---------------------------------------------------------------------------

const SCOPE: SecurityScope = {
  tenantId: "tenant-w062",
  projectId: "project-w062",
  worldId: "world-w062",
};
const OTHER_WORLD: SecurityScope = {
  tenantId: "tenant-w062",
  projectId: "project-w062",
  worldId: "world-w062-other",
};

const CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};
const STRICT_HANDLE_CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-every-use" },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};
const LAX_HANDLE_CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "never" },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};

function mintPolicy(scope: SecurityScope = SCOPE): SecurityPolicy {
  const outcome = declareSecurityPolicy({
    scope,
    declaredBy: { tenantId: scope.tenantId, principalId: "principal-ops-w062" },
    requiredScopeKind: "tenant-project-world",
    secretCustody: CUSTODY,
    authorizationModel: "entitlement-grants",
  });
  if (!outcome.ok) {
    throw new Error(`fixture policy is unlawful: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.policy;
}

function mintReference(
  displayName: string,
  custody: SecretCustodyPolicy = STRICT_HANDLE_CUSTODY,
  scope: SecurityScope = SCOPE,
): SecretReference {
  const outcome = sealSecretReference({
    scope,
    kind: "api-key",
    displayName,
    custody,
  });
  if (!outcome.ok) {
    throw new Error(`fixture handle is unlawful: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.reference;
}

const POLICY = mintPolicy();
const HANDLES: readonly SecretReference[] = [
  mintReference("venue-rest-handle"),
  mintReference("request-signing-handle"),
];

const TABLE_OUTCOME = worldAlphaApiV1();
if (!TABLE_OUTCOME.ok) {
  throw new Error("the real World-Alpha table is unlawful");
}
const ROUTE_TABLE = TABLE_OUTCOME.table;
const ROUTE_NAMES = ROUTE_TABLE.routes.map((route) => route.name);
const SDK_OUTCOME = buildSdkClient(ROUTE_TABLE);
if (!SDK_OUTCOME.ok) {
  throw new Error("the real SDK surface does not cover the real table");
}
const SDK_CLIENT = SDK_OUTCOME.client;
const OPS_ROUTE_NAMES = operationsRouteDeclarations().map((route) => route.name);

function aDeclaration(overrides: Partial<DeploymentPlanInput> = {}): DeploymentPlanInput {
  return {
    scope: SCOPE,
    mode: "direct" as DeploymentMode,
    components: [...DEPLOYMENT_COMPONENT_KINDS],
    api: { routeTableId: ROUTE_TABLE.tableId, routeNames: [...ROUTE_NAMES] },
    sdk: { boundTableId: SDK_CLIENT.tableId },
    operations: { opsRouteNames: [...OPS_ROUTE_NAMES] },
    security: { policy: POLICY, references: [...HANDLES] },
    lineage: { parent: null, sequence: 1 },
    ...overrides,
  };
}

const kindsOf = (violations: readonly DeploymentViolation[]): readonly string[] =>
  violations.map((violation) => violation.kind);

const BASE_OUTCOME = composeDeploymentPlan(aDeclaration());
if (!BASE_OUTCOME.ok) {
  throw new Error(`the fixture plan is unlawful: ${JSON.stringify(BASE_OUTCOME.violations)}`);
}
const BASE: DeploymentPlan = BASE_OUTCOME.plan;

// ---------------------------------------------------------------------------
// The gate: the happy paths + the A9 twins
// ---------------------------------------------------------------------------

test("a plan over the REAL merged-dep surfaces composes and re-validates", () => {
  const plan = BASE;
  assert.equal(String(plan.planId).slice(0, 7), "deploy-");
  assert.deepEqual(plan.components, [...DEPLOYMENT_COMPONENT_KINDS]);
  assert.equal(plan.security.enforcement.compliant, true);
  assert.equal(plan.security.enforcement.checked, 2);
  assert.equal(plan.security.isolation.isolated, true);
  assert.equal(plan.security.isolation.checked, 2);
  const revalidated = validateDeploymentPlan(plan);
  assert.ok(revalidated.ok, JSON.stringify(revalidated.ok ? null : revalidated.violations));
});

test("A9 twin: the declarer's input order never leaks (ids, records, refusals)", () => {
  const twin = composeDeploymentPlan(
    aDeclaration({
      components: ["sdk-client", "security-layer", "operations-service", "api-service"] as unknown as readonly DeploymentComponentKind[],
      api: { routeTableId: ROUTE_TABLE.tableId, routeNames: [...ROUTE_NAMES].reverse() },
      operations: { opsRouteNames: [...OPS_ROUTE_NAMES].reverse() },
      security: { policy: POLICY, references: [...HANDLES].reverse() },
    }),
  );
  assert.ok(twin.ok);
  assert.equal(twin.plan.planId, BASE.planId);
  assert.deepEqual(twin.plan, BASE);
});

test("A9: the same declaration always mints the same plan (idempotent gate)", () => {
  const again = composeDeploymentPlan(aDeclaration());
  assert.ok(again.ok);
  assert.equal(again.plan.planId, BASE.planId);
});

test("the lineage rides BESIDE the id (the W053/W055 convention)", () => {
  const continuation = composeDeploymentPlan(
    aDeclaration({ lineage: { parent: BASE.planId, sequence: 2 } }),
    [BASE],
  );
  assert.ok(continuation.ok, JSON.stringify(continuation.ok ? null : continuation.violations));
  assert.notEqual(continuation.plan.planId, BASE.planId);
  const revalidated = validateDeploymentPlan(continuation.plan, [BASE]);
  assert.ok(revalidated.ok);
});

test("progression modes deploy from a live parent (blue-green over the genesis)", () => {
  const green = composeDeploymentPlan(
    aDeclaration({
      mode: "blue-green" as DeploymentMode,
      lineage: { parent: BASE.planId, sequence: 2 },
    }),
    [BASE],
  );
  assert.ok(green.ok, JSON.stringify(green.ok ? null : green.violations));
});

// ---------------------------------------------------------------------------
// The gate: every refusal law (fail-closed, all violations collected)
// ---------------------------------------------------------------------------

test("malformed input is refused loudly", () => {
  const outcome = composeDeploymentPlan(null as unknown as DeploymentPlanInput);
  assert.ok(!outcome.ok);
  assert.deepEqual(kindsOf(outcome.violations), ["malformed-input"]);
});

test("a blank scope member is refused (§14 never defaults)", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({ scope: { tenantId: "", projectId: "p", worldId: "w" } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("blank-scope-member"));
  assert.ok(
    outcome.violations.every(
      (violation) =>
        violation.kind === "blank-scope-member" ||
        violation.kind === "scope-mismatch" ||
        violation.kind === "custody-noncompliant" ||
        violation.kind === "isolation-not-proven" ||
        violation.kind === "secret-value-refused",
    ),
  );
});

test("an unknown mode is refused (closed vocabulary)", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({ mode: "instant" as unknown as DeploymentMode }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("unknown-mode"));
});

test("unknown, duplicate, missing and undeclared components are all refused", () => {
  const unknown = composeDeploymentPlan(
    aDeclaration({ components: ["security-layer", "executor"] as unknown as readonly DeploymentComponentKind[] }),
  );
  assert.ok(!unknown.ok);
  assert.ok(kindsOf(unknown.violations).includes("unknown-component"));

  const duplicate = composeDeploymentPlan(
    aDeclaration({
      components: ["security-layer", "security-layer", "api-service"] as unknown as readonly DeploymentComponentKind[],
    }),
  );
  assert.ok(!duplicate.ok);
  assert.ok(kindsOf(duplicate.violations).includes("duplicate-component"));

  const missingCitation = composeDeploymentPlan(
    aDeclaration({
      components: ["api-service", "security-layer"] as unknown as readonly DeploymentComponentKind[],
      api: undefined,
    }),
  );
  assert.ok(!missingCitation.ok);
  assert.ok(kindsOf(missingCitation.violations).includes("component-citation-missing"));

  const undeclared = composeDeploymentPlan(
    aDeclaration({ components: ["security-layer"] as unknown as readonly DeploymentComponentKind[] }),
  );
  assert.ok(!undeclared.ok);
  assert.ok(kindsOf(undeclared.violations).includes("citation-without-component"));
});

test("the security posture is mandatory in every plan", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({ components: ["api-service", "sdk-client", "operations-service"] as unknown as readonly DeploymentComponentKind[] }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("security-posture-required"));
});

test("API citations are proven against the REAL W059 table", () => {
  const mismatch = composeDeploymentPlan(
    aDeclaration({ api: { routeTableId: "rtt-deadbeef", routeNames: [...ROUTE_NAMES] } }),
  );
  assert.ok(!mismatch.ok);
  assert.ok(kindsOf(mismatch.violations).includes("api-table-mismatch"));

  const unknownRoute = composeDeploymentPlan(
    aDeclaration({
      api: { routeTableId: ROUTE_TABLE.tableId, routeNames: [...ROUTE_NAMES, "nonexistent-route"] },
    }),
  );
  assert.ok(!unknownRoute.ok);
  assert.ok(kindsOf(unknownRoute.violations).includes("unknown-api-route"));
});

test("SDK citations are proven against the REAL W059 typed client", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({ sdk: { boundTableId: "rtt-deadbeef" } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("sdk-table-mismatch"));
});

test("ops citations are proven against W061's REAL operations declarations", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({
      operations: { opsRouteNames: [...OPS_ROUTE_NAMES, "nonexistent-ops-route"] },
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("unknown-ops-route"));
});

test("a tampered W060 policy is refused with W060's own errors carried verbatim", () => {
  const tampered = { ...POLICY, policyId: "pol-deadbeef" } as SecurityPolicy;
  const outcome = composeDeploymentPlan(
    aDeclaration({ security: { policy: tampered, references: [...HANDLES] } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("security-policy-unlawful"));
});

test("a tampered secret handle is refused with W060's own errors carried verbatim", () => {
  const tampered = {
    ...HANDLES[0]!,
    secretId: "sec-deadbeef",
  } as SecretReference;
  const outcome = composeDeploymentPlan(
    aDeclaration({ security: { policy: POLICY, references: [tampered, HANDLES[1]!] } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("secret-reference-unlawful"));
});

test("THE REDACTION LAW: a secret-shaped VALUE anywhere is refused LOUDLY", () => {
  const secretShapedHandle = {
    ...HANDLES[0]!,
    displayName: "sk-ant-fixture",
  } as unknown as SecretReference;
  const outcome = composeDeploymentPlan(
    aDeclaration({
      security: { policy: POLICY, references: [secretShapedHandle, HANDLES[1]!] },
    }),
  );
  assert.ok(!outcome.ok);
  const kinds = kindsOf(outcome.violations);
  assert.ok(kinds.includes("secret-value-refused"));
  assert.ok(
    outcome.violations.some(
      (violation) =>
        violation.kind === "secret-value-refused" &&
        violation.detail.includes("THE REDACTION LAW refuses it"),
    ),
  );
});

test("an empty secret surface is refused (the posture is explicit handles)", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({ security: { policy: POLICY, references: [] } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("empty-secret-surface"));
});

test("custody non-compliance is carried verbatim from W060's own enforcement", () => {
  const lax = mintReference("lax-rotation-handle", LAX_HANDLE_CUSTODY);
  const outcome = composeDeploymentPlan(
    aDeclaration({ security: { policy: POLICY, references: [...HANDLES, lax] } }),
  );
  assert.ok(!outcome.ok);
  const custody = outcome.violations.find(
    (violation) => violation.kind === "custody-noncompliant",
  );
  assert.ok(custody !== undefined);
  assert.ok(custody.detail.includes("rotation-noncompliant"));
});

test("an out-of-scope handle refuses the plan AND the tenant boundary proof", () => {
  const stranger = mintReference(
    "stranger-world-handle",
    STRICT_HANDLE_CUSTODY,
    OTHER_WORLD,
  );
  const outcome = composeDeploymentPlan(
    aDeclaration({ security: { policy: POLICY, references: [...HANDLES, stranger] } }),
  );
  assert.ok(!outcome.ok);
  const kinds = kindsOf(outcome.violations);
  assert.ok(kinds.includes("scope-mismatch"));
  assert.ok(kinds.includes("isolation-not-proven"));
  assert.ok(
    outcome.violations.some(
      (violation) =>
        violation.kind === "isolation-not-proven" &&
        violation.detail.includes("scope-mismatch"),
    ),
  );
});

test("progression modes never deploy from nothing (posture law)", () => {
  const outcome = composeDeploymentPlan(
    aDeclaration({
      mode: "canary" as DeploymentMode,
      lineage: { parent: null, sequence: 1 },
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("mode-posture-violated"));
});

test("the lineage laws: genesis shape, contiguity, parent existence and scope", () => {
  const badGenesis = composeDeploymentPlan(
    aDeclaration({ lineage: { parent: null, sequence: 3 } }),
  );
  assert.ok(!badGenesis.ok);
  assert.ok(kindsOf(badGenesis.violations).includes("lineage-unlawful"));

  const unknownParent = composeDeploymentPlan(
    aDeclaration({ lineage: { parent: "deploy-nonexistent", sequence: 2 } }),
    [BASE],
  );
  assert.ok(!unknownParent.ok);
  assert.ok(kindsOf(unknownParent.violations).includes("parent-unknown"));

  const strangerPolicy = mintPolicy(OTHER_WORLD);
  const strangerHandles = [mintReference("stranger-handle", STRICT_HANDLE_CUSTODY, OTHER_WORLD)];
  const strangerOutcome = composeDeploymentPlan(
    aDeclaration({
      scope: OTHER_WORLD,
      security: { policy: strangerPolicy, references: strangerHandles },
    }),
  );
  if (!strangerOutcome.ok) {
    throw new Error(`the stranger-scope fixture plan is unlawful: ${JSON.stringify(strangerOutcome.violations)}`);
  }
  const strangerPlan: DeploymentPlan = strangerOutcome.plan;
  const crossTenant = composeDeploymentPlan(
    aDeclaration({ lineage: { parent: strangerPlan.planId, sequence: 2 } }),
    [strangerPlan],
  );
  assert.ok(!crossTenant.ok);
  assert.ok(kindsOf(crossTenant.violations).includes("parent-scope-mismatch"));

  const skipped = composeDeploymentPlan(
    aDeclaration({ lineage: { parent: BASE.planId, sequence: 5 } }),
    [BASE],
  );
  assert.ok(!skipped.ok);
  assert.ok(kindsOf(skipped.violations).includes("lineage-non-contiguous"));
});

// ---------------------------------------------------------------------------
// The whole-record re-validation (tamper gates — every rewrite is loud)
// ---------------------------------------------------------------------------

test("a rewritten plan id is refused loudly (id re-derivation)", () => {
  const tampered = { ...BASE, planId: "deploy-deadbeef" };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("id-mismatch"));
});

test("a rewritten API citation is refused at re-validation", () => {
  const tampered = {
    ...BASE,
    api: { ...BASE.api!, routeTableId: "rtt-deadbeef" },
  };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("api-table-mismatch"));
});

test("a forged custody verdict is refused (the re-minted verdict must match)", () => {
  const tampered = {
    ...BASE,
    security: {
      ...BASE.security,
      enforcement: { ...BASE.security.enforcement, checked: 7 },
    },
  };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("enforcement-mismatch"));
});

test("a forged isolation proof is refused (the re-minted proof must match)", () => {
  const tampered = {
    ...BASE,
    security: {
      ...BASE.security,
      isolation: { ...BASE.security.isolation, proofId: "iso-deadbeef" },
    },
  };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("isolation-mismatch"));
});

test("non-canonical carriage is refused (a record IS canonical data)", () => {
  const tampered = {
    ...BASE,
    api: { ...BASE.api!, routeNames: [...BASE.api!.routeNames].reverse() },
  };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("non-canonical-record"));
});

test("a dishonest provenance record is refused", () => {
  const tampered = {
    ...BASE,
    provenance: { ...BASE.provenance, deriver: "hand-written" },
  };
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("provenance-unlawful"));
});

test("THE REDACTION LAW re-scans the whole RECORD at re-validation", () => {
  const tampered = {
    ...BASE,
    operations: { ...BASE.operations!, opsRouteNames: [...OPS_ROUTE_NAMES] },
    api: { ...BASE.api!, routeNames: [...ROUTE_NAMES] },
    sdk: { ...BASE.sdk!, boundTableId: `${SDK_CLIENT.tableId}` },
    description: "sk-ant-record-level-leak",
  } as unknown as DeploymentPlan;
  const outcome = validateDeploymentPlan(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("secret-value-refused"));
});
