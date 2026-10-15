/**
 * The DEPLOYMENT CONTRACT (W062) — the `DeploymentPlan` record, as typed DATA.
 *
 * A deployment plan is WHAT the platform declares it will run, PROVEN against
 * the real merged-dep surfaces at composition time:
 * - the API surface (W059 `services/api`) — the cited route table id + route
 *   names are re-proven against the REAL default World-Alpha table;
 * - the SDK surface (W059 `packages/sdk`) — the cited bound table id is
 *   re-proven by building the REAL typed client over the REAL table;
 * - the OPERATIONS surface (W061 `packages/observability`) — every cited ops
 *   route name is proven against the REAL `operationsRouteDeclarations()` and
 *   the real declarations are re-proven through their own gate;
 * - the SECURITY posture (W060 `packages/security` + `services/security`) —
 *   the carried policy, secret HANDLES (typed handles ONLY — THE REDACTION
 *   LAW is re-scanned over every plan byte), custody enforcement and tenant
 *   isolation proof are all re-proven through W060's own validators.
 *
 * A13/A14: this directory OWNS the declarative contract + its gate. It NEVER
 * executes, NEVER binds ports, NEVER starts servers, NEVER provisions
 * infrastructure, NEVER supervises processes. The plan is re-validatable from
 * its own recorded data alone (`deploy/validate.ts`).
 *
 * Laws: spec/ARCHITECTURE-LOCK.md §14 (one explicit tenant/project/world
 * scope per plan), A9 (content-addressed `deploy-<digest>` id over canonical
 * data; the declarer's input order never leaks — pinned by twins), A6 (every
 * carried number is carried by a cited record, never invented here), R056
 * (tenant isolation, structural through the W060 proof), THE REDACTION LAW.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "../packages/trajectory/index.js";
import {
  REDACTION_LAW,
  SECURITY_PROVENANCE_LAWS,
  blankSecurityScopeMembers,
} from "../packages/security/index.js";
import type {
  IsolationProof,
  SecurityPolicy,
  SecurityScope,
  SecretReference,
} from "../packages/security/index.js";
import type { SecretEnforcement } from "../services/security/index.js";

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

/** The closed deployment-mode vocabulary, canonical order. */
export const DEPLOYMENT_MODES = [
  "blue-green",
  "canary",
  "direct",
  "rolling",
] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** The modes that PROGRESS from an existing generation (posture law: a
 * progression mode never deploys from nothing — it replaces/shadows a live
 * parent plan). */
export const PROGRESSION_MODES: readonly DeploymentMode[] = [
  "blue-green",
  "canary",
  "rolling",
];

/** The closed component vocabulary, canonical order. Every member is proven
 * against a REAL exported surface of the merged deps at the gate (see
 * `deploy/citations.ts`). */
export const DEPLOYMENT_COMPONENT_KINDS = [
  "api-service",
  "operations-service",
  "sdk-client",
  "security-layer",
] as const;
export type DeploymentComponentKind =
  (typeof DEPLOYMENT_COMPONENT_KINDS)[number];

/** The A13/A14 law this contract names on every provenance record. */
export const NO_EXECUTION_LAW =
  "spec/ARCHITECTURE-LOCK.md A13/A14 — compose typed records; never execute, never bind ports, never start servers" as const;

/** The laws every deployment provenance record cites (W060's own constants,
 * imported — never re-declared — plus the A13/A14 no-execution law). */
export const DEPLOYMENT_PROVENANCE_LAWS: readonly string[] = [
  ...SECURITY_PROVENANCE_LAWS,
  NO_EXECUTION_LAW,
];

// ---------------------------------------------------------------------------
// The citations (typed data, proven at the gate against REAL surfaces)
// ---------------------------------------------------------------------------

/** The API-service citation: the route table this plan deploys (W059's own
 * content-addressed table id) + the route lineage names it declares. */
export interface DeploymentApiCitation {
  readonly routeTableId: string;
  readonly routeNames: readonly string[];
}

/** The SDK-client citation: the table id the typed client binds (W059's SDK
 * drift-guarded projection over the same table). */
export interface DeploymentSdkCitation {
  readonly boundTableId: string;
}

/** The operations-service citation: the ops route lineage names this plan
 * serves (proven against W061's own declarations). */
export interface DeploymentOperationsCitation {
  readonly opsRouteNames: readonly string[];
}

/**
 * The SECURITY POSTURE (W060, composed): the declared policy, the secret
 * HANDLES the plan names (typed handles ONLY — THE REDACTION LAW), the
 * custody enforcement verdict, and the tenant-boundary isolation proof.
 * Every member is a REAL W060 record, re-proven through W060's own gates.
 */
export interface DeploymentSecurityPosture {
  readonly policy: SecurityPolicy;
  readonly references: readonly SecretReference[];
  readonly enforcement: SecretEnforcement;
  readonly isolation: IsolationProof;
}

// ---------------------------------------------------------------------------
// The lineage + the provenance (immutable, deterministic)
// ---------------------------------------------------------------------------

/** The deployment lineage: the parent plan this one supersedes (null at
 * genesis) + the strictly-increasing sequence. Immutable — a rewrite is a
 * different plan (different content-addressed id). */
export interface DeploymentLineage {
  readonly parent: string | null;
  readonly sequence: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface DeploymentProvenance {
  readonly deriver: "compose-deployment-plan";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

// ---------------------------------------------------------------------------
// The plan (immutable, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const deploymentPlanIdBrand: unique symbol;
/** An OPAQUE content-addressed plan id: `deploy-<digest>` over the plan's
 * canonical content. Produced only by {@link deploymentPlanIdOf}; never
 * parsed — the mode/scope/components travel explicitly on the record. */
export type DeploymentPlanId = string & {
  readonly [deploymentPlanIdBrand]: true;
};
/** The id prefix (a rendering convention, never a parse target). */
export const DEPLOYMENT_PLAN_ID_PREFIX = "deploy-";

/** ONE deployment plan: the §14 scope it deploys at, the mode, the declared
 * components (each with its citation, proven against a REAL surface), the
 * security posture, the immutable lineage, the deterministic provenance. */
export interface DeploymentPlan {
  readonly planId: DeploymentPlanId;
  readonly scope: SecurityScope;
  readonly mode: DeploymentMode;
  readonly components: readonly DeploymentComponentKind[];
  readonly api: DeploymentApiCitation | null;
  readonly sdk: DeploymentSdkCitation | null;
  readonly operations: DeploymentOperationsCitation | null;
  readonly security: DeploymentSecurityPosture;
  readonly lineage: DeploymentLineage;
  readonly provenance: DeploymentProvenance;
}

/** The composition input (already-real W060 records — the gate RE-proves the
 * policy + every handle and MINTS the enforcement + isolation proofs through
 * W060's own machinery; the declarer never asserts a proof). */
export interface DeploymentPlanInput {
  readonly scope: SecurityScope;
  readonly mode: DeploymentMode;
  readonly components: readonly DeploymentComponentKind[];
  readonly api?: DeploymentApiCitation;
  readonly sdk?: DeploymentSdkCitation;
  readonly operations?: DeploymentOperationsCitation;
  readonly security: {
    readonly policy: SecurityPolicy;
    readonly references: readonly SecretReference[];
  };
  readonly lineage: DeploymentLineage;
}

// ---------------------------------------------------------------------------
// Canonicalization (A9 — the declarer's input order never leaks)
// ---------------------------------------------------------------------------

/** Canonical string-list order: sorted, de-duplicated (citations are sets). */
export function canonicalNames(names: readonly string[]): readonly string[] {
  return [...new Set(names.map((name) => String(name)))].sort();
}

/** Canonical component order: the closed vocabulary's own order. */
export function canonicalComponents(
  components: readonly DeploymentComponentKind[],
): readonly DeploymentComponentKind[] {
  const present = new Set(components.map((kind) => String(kind)));
  return DEPLOYMENT_COMPONENT_KINDS.filter((kind) => present.has(kind));
}

/** Canonical secret-handle order: by opaque secret id (the handle's own
 * content-addressed identity — deterministic, never the input's order). */
export function canonicalReferences(
  references: readonly SecretReference[],
): readonly SecretReference[] {
  return [...references].sort(
    (left, right) =>
      String(left.secretId) < String(right.secretId)
        ? -1
        : String(left.secretId) > String(right.secretId)
          ? 1
          : 0,
  );
}

/** The canonical scope tuple (the TENANT FIRST — R056 structural). */
export function canonicalScopeTuple(scope: SecurityScope): readonly string[] {
  return [scope.tenantId, scope.projectId, scope.worldId];
}

/** The canonical content a plan id addresses — EVERY carried byte of every
 * carried record weighs (the W054/W058 whole-carried-record precedent). */
export function canonicalDeploymentContent(
  plan: Omit<DeploymentPlan, "planId">,
): Record<string, unknown> {
  return {
    api:
      plan.api === null
        ? null
        : {
            routeNames: canonicalNames(plan.api.routeNames),
            routeTableId: plan.api.routeTableId,
          },
    components: canonicalComponents(plan.components),
    lineage: [plan.lineage.parent ?? null, plan.lineage.sequence],
    mode: plan.mode,
    operations:
      plan.operations === null
        ? null
        : { opsRouteNames: canonicalNames(plan.operations.opsRouteNames) },
    scope: canonicalScopeTuple(plan.scope),
    sdk: plan.sdk === null ? null : { boundTableId: plan.sdk.boundTableId },
    security: {
      enforcement: plan.security.enforcement,
      isolation: plan.security.isolation,
      policy: plan.security.policy,
      references: canonicalReferences(plan.security.references),
    },
  };
}

/** The content-addressed plan id: `deploy-<digest>` over the canonical
 * content. Pure and deterministic (A9): the same lawful declaration always
 * mints the same id; the lineage rides BESIDE the id (the W053/W055
 * convention — a continuation of the same content carries the same id with a
 * different lineage). */
export function deploymentPlanIdOf(
  plan: Omit<DeploymentPlan, "planId">,
): DeploymentPlanId {
  const digest = canonicalDigestHex(canonicalDeploymentContent(plan));
  return `${DEPLOYMENT_PLAN_ID_PREFIX}${digest}` as DeploymentPlanId;
}

/** The input digest (the provenance member): the law-bearing declaration
 * members in CANONICAL form (A9 — the declarer's input order never leaks
 * into the provenance either; the twin of a re-ordered declaration mints
 * the deep-equal plan, inputDigest included). */
export function deploymentInputDigestOf(input: DeploymentPlanInput): string {
  return canonicalDigestHex({
    api:
      input.api === undefined
        ? null
        : {
            routeNames: canonicalNames(input.api.routeNames),
            routeTableId: input.api.routeTableId,
          },
    components: canonicalComponents(input.components),
    mode: input.mode,
    operations:
      input.operations === undefined
        ? null
        : { opsRouteNames: canonicalNames(input.operations.opsRouteNames) },
    scope: canonicalScopeTuple(input.scope),
    sdk: input.sdk === undefined ? null : { boundTableId: input.sdk.boundTableId },
    security: {
      policyId: String(input.security.policy.policyId),
      referenceIds: canonicalReferences(input.security.references).map(
        (reference) => String(reference.secretId),
      ),
    },
  });
}

/** The plan's blank-scope offender list (§14 — explicit, never blank). */
export function blankDeploymentScopeMembers(
  scope: SecurityScope,
): readonly string[] {
  return blankSecurityScopeMembers(scope).map(String);
}

/** THE REDACTION LAW citation this contract carries (W060's own constant). */
export const DEPLOYMENT_REDACTION_LAW = REDACTION_LAW;
