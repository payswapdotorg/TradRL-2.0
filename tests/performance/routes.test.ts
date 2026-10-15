/**
 * The W062 route-validation + deployment-seal PERFORMANCE EVIDENCE suite —
 * REAL imports only (the no-shim law): the W061 operations route surface is
 * exercised through its own `validateOperationsRoutes` gate over declarations
 * derived from its own real `operationsRouteDeclarations()`; the W059 route
 * table through its own `buildRouteTable` over its own real core +
 * point-in-time declarations; the W062 deployment seal through this work
 * item's own `composeDeploymentPlan` + `validateDeploymentPlan` gates over
 * the REAL merged-dep citation set (the deploy/plan.test.ts fixture lineage:
 * W059's `worldAlphaApiV1()` table, W059's `buildSdkClient`, W060's
 * `declareSecurityPolicy` + `sealSecretReference`, W061's own declarations).
 *
 * The discipline (tests/performance/measurements.ts): this suite REPORTS one
 * live PinnedMeasurement per exercised scale (the `PERF-EVIDENCE` lines)
 * BESIDE the pinned baseline — PINNED_BASELINE ships EMPTY at this head (it
 * is filled by a pinning run; the prior session died before pinning), so the
 * baseline-relative 10x law below engages only when a matching entry exists,
 * and the shipped CEILING_* constants govern meanwhile (disclosed here and in
 * the PR body). The ASSERTIONS are over DETERMINISTIC LAWS only — the real
 * surfaces are lawful (exactly zero violations), the duplicate + mixed-error
 * violation counts are DERIVED from the composed declaration arrays (A6:
 * every expected count is carried by the composed records), the violation
 * multiset is order-invariant (A9 — declaration order never leaks), and the
 * deployment seal is idempotent with a deep-equal A9 twin. NEVER wall-clock
 * equality (A9 has no clocks; a measurement here is evidence, not a law).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_MS_PER_OPS_ROUTE_DECLARATION,
  CEILING_MS_PER_ROUTE_DECLARATION,
  CEILING_MS_PER_SEAL,
  PINNED_BASELINE,
  measurementOf,
  report,
  type PinnedMeasurement,
} from "./measurements.js";
import {
  OPERATIONS_ROUTE_NAMES,
  OPS_ROUTE_PAYLOAD_TYPE_NAMES,
  operationsRouteDeclarations,
  validateOperationsRoutes,
  type OpsRouteDeclaration,
} from "../../packages/observability/index.js";
import {
  buildRouteTable,
  coreRouteDeclarations,
  pointInTimeRouteDeclarations,
  worldAlphaApiV1,
  type ApiRouteDeclaration,
} from "../../services/api/index.js";
import { buildSdkClient } from "../../packages/sdk/index.js";
import {
  declareSecurityPolicy,
  sealSecretReference,
} from "../../packages/security/index.js";
import type {
  SecurityPolicy,
  SecurityScope,
  SecretCustodyPolicy,
  SecretReference,
} from "../../packages/security/index.js";
import {
  DEPLOYMENT_COMPONENT_KINDS,
  composeDeploymentPlan,
  validateDeploymentPlan,
  type DeploymentComponentKind,
  type DeploymentMode,
  type DeploymentPlan,
  type DeploymentPlanInput,
} from "../../deploy/index.js";

// ---------------------------------------------------------------------------
// The measurement discipline (REPORT beside the baseline; assert only laws +
// generous ceilings — never wall-clock equality)
// ---------------------------------------------------------------------------

/** The generous baseline tolerance: a live run may be this much slower than a
 * pinned baseline entry before the suite calls it an environment pathology. */
const BASELINE_TOLERANCE = 10;

function measureMs<T>(run: () => T): { readonly measuredMs: number; readonly value: T } {
  const started = process.hrtime.bigint();
  const value = run();
  const measuredMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { measuredMs, value };
}

function reportBesideBaseline(live: PinnedMeasurement, ceilingMs: number): void {
  report(live);
  const pinned = PINNED_BASELINE.find(
    (entry) =>
      entry.law === live.law &&
      entry.subject === live.subject &&
      entry.inputCount === live.inputCount,
  );
  if (pinned === undefined) {
    console.log(
      `PERF-BASELINE ${live.law} | ${live.subject} | input=${String(live.inputCount)} | no pinned entry (PINNED_BASELINE carries ${String(PINNED_BASELINE.length)} entries at this head) — the shipped ceiling ${String(ceilingMs)}ms governs this run (disclosed)`,
    );
  } else {
    console.log(
      `PERF-BASELINE ${live.law} | ${live.subject} | input=${String(live.inputCount)} | pinned ${String(pinned.measuredMs)}ms at head ${pinned.measuredAtHead}`,
    );
    assert.ok(
      live.measuredMs <= BASELINE_TOLERANCE * pinned.measuredMs,
      `${live.law} at input=${String(live.inputCount)}: live ${String(live.measuredMs)}ms exceeds ${String(BASELINE_TOLERANCE)}x the pinned ${String(pinned.measuredMs)}ms — an environment pathology, not a law`,
    );
  }
  assert.ok(
    live.measuredMs <= ceilingMs,
    `${live.law} at input=${String(live.inputCount)}: live ${String(live.measuredMs)}ms exceeds the shipped reliability ceiling ${String(ceilingMs)}ms — a broken build/environment, not a slow machine`,
  );
}

/** A deterministic shuffle (a fixed-seed LCG — no randomness, A9). */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    const swap = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = swap;
  }
  return shuffled;
}

// ---------------------------------------------------------------------------
// The W061 operations-route validation at scale (error collection
// completeness — every violation collected, never short-circuited)
// ---------------------------------------------------------------------------

test("the REAL operations declarations are lawful (exactly zero violations)", () => {
  const declarations = operationsRouteDeclarations();
  assert.deepEqual([...validateOperationsRoutes(declarations)], []);
  assert.equal(declarations.length, OPERATIONS_ROUTE_NAMES.length, "the surface count is carried by its own constant");
  assert.ok(
    declarations.every((route) =>
      (OPS_ROUTE_PAYLOAD_TYPE_NAMES as readonly string[]).includes(route.response.payloadType),
    ),
  );
});

test("duplicate declarations are collected COMPLETELY at scale (derived counts, never invented)", () => {
  const real = operationsRouteDeclarations();
  for (const copies of [4, 40, 400]) {
    const replicated: OpsRouteDeclaration[] = [];
    for (let copy = 0; copy < copies; copy += 1) {
      replicated.push(...real);
    }
    const extras = replicated.length - OPERATIONS_ROUTE_NAMES.length;
    assert.ok(extras > 0, "the scale axis genuinely duplicates (derived from the composed array)");
    const violations = [...validateOperationsRoutes(replicated)];
    const duplicateNames = violations.filter((violation) => violation.kind === "duplicate-route-name");
    const duplicateMethodPaths = violations.filter((violation) => violation.kind === "duplicate-method-path");
    assert.equal(duplicateNames.length, extras, "one duplicate-route-name per extra declaration (carried by the input)");
    assert.equal(duplicateMethodPaths.length, extras, "one duplicate-method-path per extra declaration (carried by the input)");
    assert.equal(violations.length, duplicateNames.length + duplicateMethodPaths.length, "no other law is violated by replication");
  }
});

test("A9: declaration order never leaks into the violation multiset", () => {
  const real = operationsRouteDeclarations();
  const replicated: OpsRouteDeclaration[] = [];
  for (let copy = 0; copy < 40; copy += 1) {
    replicated.push(...real);
  }
  const ordered = [...validateOperationsRoutes(replicated)];
  const shuffled = [...validateOperationsRoutes(seededShuffle(replicated, 0x5eed063))];
  const byKey = (
    left: { readonly kind: string; readonly detail: string },
    right: { readonly kind: string; readonly detail: string },
  ): number => `${left.kind}::${left.detail}`.localeCompare(`${right.kind}::${right.detail}`);
  assert.deepEqual([...shuffled].sort(byKey), [...ordered].sort(byKey), "the violation multiset is order-invariant");
});

test("mixed error kinds are collected COMPLETELY at scale (each injected defect counted from its own array)", () => {
  const real = operationsRouteDeclarations();
  const worldScope = "/v1/tenants/:tenantId/projects/:projectId/worlds/:worldId";
  const injectedPerKind = 40;
  const blankNames: OpsRouteDeclaration[] = [];
  const unknownMethods: OpsRouteDeclaration[] = [];
  const unknownPayloadTypes: OpsRouteDeclaration[] = [];
  const missingProvenance: OpsRouteDeclaration[] = [];
  for (let index = 0; index < injectedPerKind; index += 1) {
    blankNames.push({ ...real[0]!, name: "" });
    unknownMethods.push({
      ...real[0]!,
      name: `ops-perf-method-${String(index)}`,
      method: "TRACE" as unknown as OpsRouteDeclaration["method"],
      path: `${worldScope}/perf/method/${String(index)}`,
    });
    unknownPayloadTypes.push({
      ...real[1]!,
      name: `ops-perf-payload-${String(index)}`,
      path: `${worldScope}/perf/payload/${String(index)}`,
      response: { ...real[1]!.response, payloadType: "Bogus" as unknown as OpsRouteDeclaration["response"]["payloadType"] },
    });
    missingProvenance.push({
      ...real[2]!,
      name: `ops-perf-provenance-${String(index)}`,
      path: `${worldScope}/perf/provenance/${String(index)}`,
      response: { ...real[2]!.response, provenance: undefined as unknown as OpsRouteDeclaration["response"]["provenance"] },
    });
  }
  const declarations = [
    ...real,
    ...blankNames,
    ...unknownMethods,
    ...unknownPayloadTypes,
    ...missingProvenance,
  ];
  const violations = [...validateOperationsRoutes(declarations)];
  assert.equal(
    violations.filter((violation) => violation.kind === "blank-route-name").length,
    blankNames.length,
  );
  assert.equal(
    violations.filter((violation) => violation.kind === "unknown-method").length,
    unknownMethods.length,
  );
  assert.equal(
    violations.filter((violation) => violation.kind === "unknown-payload-type").length,
    unknownPayloadTypes.length,
  );
  assert.equal(
    violations.filter((violation) => violation.kind === "provenance-missing").length,
    missingProvenance.length,
  );
  assert.equal(
    violations.length,
    blankNames.length + unknownMethods.length + unknownPayloadTypes.length + missingProvenance.length,
    "exactly the injected defects, all collected (never short-circuited)",
  );
});

// ---------------------------------------------------------------------------
// The W059 route table at scale (the REAL table + derived declarations)
// ---------------------------------------------------------------------------

test("the W059 table builds lawfully at scale over derived declarations (idempotent ids)", () => {
  const real = [...coreRouteDeclarations(), ...pointInTimeRouteDeclarations()];
  const tableOutcome = worldAlphaApiV1();
  assert.ok(tableOutcome.ok, "the real World-Alpha table is lawful");
  assert.equal(tableOutcome.table.routes.length, real.length, "the table carries every declared route");
  const derived: ApiRouteDeclaration[] = [];
  for (let copy = 0; copy < 10; copy += 1) {
    for (const route of real) {
      derived.push({
        ...route,
        name: `${route.name}-scale-${String(copy)}`,
        path: `${route.path}/scale/${String(copy)}`,
      });
    }
  }
  const { value: built } = measureMs(() => buildRouteTable(derived));
  assert.ok(built.ok, "the derived table is lawful (unique names, unique method+path)");
  assert.equal(built.table.routes.length, derived.length, "the built table carries every derived declaration");
  const rebuilt = buildRouteTable(seededShuffle(derived, 0x5eed064));
  assert.ok(rebuilt.ok);
  assert.equal(rebuilt.table.tableId, built.table.tableId, "A9: the declaration order never leaks into the table id");
});

// ---------------------------------------------------------------------------
// The W062 deployment seal (compose + re-validate over the REAL citations —
// the deploy/plan.test.ts fixture lineage, mirrored here)
// ---------------------------------------------------------------------------

const SCOPE: SecurityScope = {
  tenantId: "tenant-w062",
  projectId: "project-w062",
  worldId: "world-w062-perf",
};
const CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};
const HANDLE_CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-every-use" },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};

function mintPolicy(): SecurityPolicy {
  const outcome = declareSecurityPolicy({
    scope: SCOPE,
    declaredBy: { tenantId: SCOPE.tenantId, principalId: "principal-ops-w062" },
    requiredScopeKind: "tenant-project-world",
    secretCustody: CUSTODY,
    authorizationModel: "entitlement-grants",
  });
  if (!outcome.ok) {
    throw new Error(`fixture policy is unlawful: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.policy;
}

function mintHandle(displayName: string): SecretReference {
  const outcome = sealSecretReference({
    scope: SCOPE,
    kind: "api-key",
    displayName,
    custody: HANDLE_CUSTODY,
  });
  if (!outcome.ok) {
    throw new Error(`fixture handle is unlawful: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.reference;
}

const POLICY = mintPolicy();
const HANDLES: readonly SecretReference[] = [
  mintHandle("venue-rest-handle"),
  mintHandle("request-signing-handle"),
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

test("the deployment seal composes + re-validates over the REAL citations (idempotent, A9 twin)", () => {
  const base = composeDeploymentPlan(aDeclaration());
  assert.ok(base.ok, JSON.stringify(base.ok ? null : base.violations));
  const plan: DeploymentPlan = base.plan;
  assert.equal(String(plan.planId).slice(0, 7), "deploy-");
  const again = composeDeploymentPlan(aDeclaration());
  assert.ok(again.ok);
  assert.equal(again.plan.planId, plan.planId, "A9: the same declaration always mints the same plan");
  const twin = composeDeploymentPlan(
    aDeclaration({
      components: [...DEPLOYMENT_COMPONENT_KINDS].reverse() as unknown as readonly DeploymentComponentKind[],
      api: { routeTableId: ROUTE_TABLE.tableId, routeNames: [...ROUTE_NAMES].reverse() },
      operations: { opsRouteNames: [...OPS_ROUTE_NAMES].reverse() },
      security: { policy: POLICY, references: [...HANDLES].reverse() },
    }),
  );
  assert.ok(twin.ok);
  assert.equal(twin.plan.planId, plan.planId, "A9: the declarer's input order never leaks");
  assert.deepEqual(twin.plan, plan);
  const revalidated = validateDeploymentPlan(plan);
  assert.ok(revalidated.ok, JSON.stringify(revalidated.ok ? null : revalidated.violations));
});

// ---------------------------------------------------------------------------
// The measurements (REPORT beside the pinned baseline — never asserted equal)
// ---------------------------------------------------------------------------

test("the ops-route validation measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  const real = operationsRouteDeclarations();
  for (const copies of [4, 40, 400]) {
    const replicated: OpsRouteDeclaration[] = [];
    for (let copy = 0; copy < copies; copy += 1) {
      replicated.push(...real);
    }
    const { measuredMs, value: violations } = measureMs(() =>
      validateOperationsRoutes(replicated),
    );
    const duplicateNames = violations.filter((violation) => violation.kind === "duplicate-route-name");
    assert.equal(duplicateNames.length, replicated.length - OPERATIONS_ROUTE_NAMES.length);
    assert.equal(
      violations.length,
      2 * (replicated.length - OPERATIONS_ROUTE_NAMES.length),
      "the measured run is the complete collection run",
    );
    reportBesideBaseline(
      measurementOf(
        "W061-ops-route-validation",
        "validateOperationsRoutes over replicated real declarations (duplicates collected completely)",
        replicated.length,
        violations.length,
        measuredMs,
      ),
      CEILING_MS_PER_OPS_ROUTE_DECLARATION * replicated.length,
    );
  }
});

test("the W059 table-build measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  const real = [...coreRouteDeclarations(), ...pointInTimeRouteDeclarations()];
  const derived: ApiRouteDeclaration[] = [];
  for (let copy = 0; copy < 10; copy += 1) {
    for (const route of real) {
      derived.push({
        ...route,
        name: `${route.name}-scale-${String(copy)}`,
        path: `${route.path}/scale/${String(copy)}`,
      });
    }
  }
  const { measuredMs, value: outcome } = measureMs(() => buildRouteTable(derived));
  assert.ok(outcome.ok);
  assert.equal(outcome.table.routes.length, derived.length);
  reportBesideBaseline(
    measurementOf(
      "W059-route-table-build",
      "buildRouteTable over derived real route declarations (ids minted, every law enforced)",
      derived.length,
      outcome.table.routes.length,
      measuredMs,
    ),
    CEILING_MS_PER_ROUTE_DECLARATION * derived.length,
  );
});

test("the deployment-seal measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  const citationSurface =
    ROUTE_TABLE.routes.length + operationsRouteDeclarations().length + HANDLES.length;
  const declaration = aDeclaration();
  const { measuredMs, value: composed } = measureMs(() => composeDeploymentPlan(declaration));
  assert.ok(composed.ok);
  const plan = composed.plan;
  const carried =
    (plan.api?.routeNames.length ?? 0) + (plan.operations?.opsRouteNames.length ?? 0);
  assert.ok(carried > 0, "the carried count rides the sealed plan itself");
  reportBesideBaseline(
    measurementOf(
      "W062-deployment-plan-seal",
      "composeDeploymentPlan over the REAL merged-dep citations (every citation re-proven, proofs minted)",
      citationSurface,
      carried,
      measuredMs,
    ),
    CEILING_MS_PER_SEAL,
  );
  const revalidation = measureMs(() => validateDeploymentPlan(plan));
  assert.ok(revalidation.value.ok, JSON.stringify(revalidation.value.ok ? null : revalidation.value.violations));
  reportBesideBaseline(
    measurementOf(
      "W062-deployment-plan-revalidation",
      "validateDeploymentPlan whole-record re-validation (ids re-derived, posture re-proven)",
      citationSurface,
      carried,
      revalidation.measuredMs,
    ),
    CEILING_MS_PER_SEAL,
  );
});
