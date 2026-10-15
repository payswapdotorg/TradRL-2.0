/**
 * `composeDeploymentPlan` — THE DEPLOYMENT GATE (W062).
 *
 * Fail-closed, ALL violations collected (never short-circuit — the declarer
 * sees every problem, the W004 `validateEventStream` discipline):
 * 1. lawful typed input + the explicit §14 scope (one plan, one scope);
 * 2. the closed mode + component vocabularies (duplicates refused loudly);
 * 3. component/citation coherence — every declared component carries its
 *    citation, every citation belongs to a declared component, and the
 *    security posture is MANDATORY in every plan (a production deployment
 *    always composes the security layer);
 * 4. every citation PROVEN against a REAL merged-dep surface (deploy/
 *    citations.ts): the API table id + route names against W059's real
 *    World-Alpha table; the SDK binding against W059's real typed client;
 *    every ops route name against W061's real operations declarations; the
 *    security posture through W060's own validators + machinery;
 * 5. THE REDACTION LAW re-scanned over the ENTIRE declaration (a
 *    secret-shaped VALUE anywhere is the LOUD `secret-value-refused`);
 * 6. the lineage + mode posture laws (progression modes deploy from a live
 *    parent; the lineage is contiguous; a parent is at the same scope);
 * 7. the seal: the enforcement + isolation records MINTED through W060's own
 *    machinery (the declarer never asserts a proof), everything carried in
 *    canonical order (A9 — the declarer's input order never leaks), and the
 *    content-addressed `deploy-<digest>` id + deterministic provenance.
 *
 * Pure (A9): no I/O, no clocks, no randomness, no env reads. A13/A14: the
 * gate composes typed records — it NEVER executes, binds, or serves anything.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { secretValueViolations } from "../packages/security/index.js";
import type { SecurityScope } from "../packages/security/index.js";
import {
  DEPLOYMENT_COMPONENT_KINDS,
  DEPLOYMENT_MODES,
  DEPLOYMENT_PROVENANCE_LAWS,
  PROGRESSION_MODES,
  blankDeploymentScopeMembers,
  canonicalComponents,
  canonicalNames,
  canonicalReferences,
  canonicalScopeTuple,
  deploymentInputDigestOf,
  deploymentPlanIdOf,
  type DeploymentApiCitation,
  type DeploymentMode,
  type DeploymentOperationsCitation,
  type DeploymentPlan,
  type DeploymentPlanId,
  type DeploymentPlanInput,
  type DeploymentSdkCitation,
} from "./plan.js";
import {
  proveApiCitation,
  proveOperationsCitation,
  proveSdkCitation,
  proveSecurityPosture,
  type DeploymentViolation,
} from "./citations.js";

/** The gate's outcome: the sealed plan, or every law violated. */
export type DeploymentPlanOutcome =
  | { readonly ok: true; readonly plan: DeploymentPlan }
  | { readonly ok: false; readonly violations: readonly DeploymentViolation[] };

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The lineage + mode posture laws (shared with the re-validator's caller
 * through this module's `lineageViolations` export). */
export function lineageViolations(
  lineage: unknown,
  mode: DeploymentMode,
  scope: SecurityScope,
  known: readonly DeploymentPlan[] | undefined,
): readonly DeploymentViolation[] {
  const violations: DeploymentViolation[] = [];
  if (!isRecordLike(lineage)) {
    return [
      {
        kind: "lineage-unlawful",
        detail: "the lineage is not typed data — a parent plan id (or null at genesis) and a sequence are required",
      },
    ];
  }
  const parent = lineage.parent;
  const sequence = lineage.sequence;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    violations.push({
      kind: "lineage-unlawful",
      detail: `the lineage sequence '${String(sequence)}' is not a safe positive integer — generations are explicit declared data (A9 has no clocks)`,
    });
  }
  if (parent !== null && (typeof parent !== "string" || parent.length === 0)) {
    violations.push({
      kind: "lineage-unlawful",
      detail: "the lineage parent is neither a plan id nor null — the superseded generation is explicit, never blank",
    });
  }
  if (parent === null && sequence !== 1) {
    violations.push({
      kind: "lineage-unlawful",
      detail: `a genesis plan (no parent) carries sequence 1, not '${String(sequence)}' — the lineage is contiguous from genesis`,
    });
  }
  if (parent !== null && typeof sequence === "number" && sequence < 2) {
    violations.push({
      kind: "lineage-unlawful",
      detail: `a continuation (parent present) carries sequence ≥ 2, not '${String(sequence)}' — the lineage is contiguous`,
    });
  }
  if (PROGRESSION_MODES.includes(mode) && parent === null) {
    violations.push({
      kind: "mode-posture-violated",
      detail: `the '${mode}' deployment mode PROGRESSES from a live parent generation — it never deploys from nothing (posture law); declare the parent plan id in the lineage`,
    });
  }
  if (parent !== null && typeof parent === "string" && known !== undefined) {
    const parentPlan = known.find((plan) => String(plan.planId) === parent);
    if (parentPlan === undefined) {
      violations.push({
        kind: "parent-unknown",
        detail: `the parent plan '${parent}' is not in the supplied known set — a lineage continuation is proven against the parent record, never assumed`,
      });
    } else {
      if (
        canonicalScopeTuple(parentPlan.scope).join("|") !==
        canonicalScopeTuple(scope).join("|")
      ) {
        violations.push({
          kind: "parent-scope-mismatch",
          detail: `the parent plan '${parent}' is at another §14 scope — a deployment lineage never crosses tenants (R056 + §14)`,
        });
      }
      if (parentPlan.lineage.sequence + 1 !== sequence) {
        violations.push({
          kind: "lineage-non-contiguous",
          detail: `the sequence '${String(sequence)}' does not succeed the parent's '${String(parentPlan.lineage.sequence)}' — the lineage is contiguous, a skipped generation is a loud violation`,
        });
      }
    }
  }
  return violations;
}

/** The component/citation coherence laws (shared shape for both gates). */
function componentCoherenceViolations(
  components: readonly unknown[],
  api: DeploymentApiCitation | undefined,
  sdk: DeploymentSdkCitation | undefined,
  operations: DeploymentOperationsCitation | undefined,
): readonly DeploymentViolation[] {
  const violations: DeploymentViolation[] = [];
  const declared = new Set<string>();
  for (const kind of components) {
    const name = String(kind);
    if (!(DEPLOYMENT_COMPONENT_KINDS as readonly string[]).includes(name)) {
      violations.push({
        kind: "unknown-component",
        detail: `the component '${name}' is outside the closed vocabulary — a deployment plan composes ${DEPLOYMENT_COMPONENT_KINDS.join(" / ")} only`,
      });
      continue;
    }
    if (declared.has(name)) {
      violations.push({
        kind: "duplicate-component",
        detail: `the component '${name}' is declared twice — component declarations are a set, never a list`,
      });
    }
    declared.add(name);
  }
  if (components.length === 0) {
    violations.push({
      kind: "malformed-input",
      detail: "the plan declares no components — a deployment plan composes at least the security posture",
    });
  }
  if (!declared.has("security-layer")) {
    violations.push({
      kind: "security-posture-required",
      detail: "the security-layer component is MANDATORY in every deployment plan — a production deployment always composes the security posture (policy, typed secret handles, custody enforcement, tenant isolation)",
    });
  }
  const citations: readonly [string, unknown][] = [
    ["api-service", api],
    ["sdk-client", sdk],
    ["operations-service", operations],
  ];
  for (const [kind, citation] of citations) {
    if (declared.has(kind) && (citation === undefined || citation === null)) {
      violations.push({
        kind: "component-citation-missing",
        detail: `the '${kind}' component is declared but carries no citation — every declared component cites the real surface it deploys`,
      });
    }
    if (!declared.has(kind) && citation !== undefined && citation !== null) {
      violations.push({
        kind: "citation-without-component",
        detail: `a citation is present for '${kind}' but the component is not declared — citations belong to declared components only`,
      });
    }
  }
  return violations;
}

/**
 * Compose ONE deployment plan — THE GATE. The declarer supplies already-real
 * W059/W060/W061 records; the gate re-proves every one through its own
 * source law, mints the W060 enforcement + isolation proofs, canonicalizes
 * (A9), and seals the content-addressed id. `known` (when supplied) is the
 * live lineage the parent-existence + contiguity laws are proven against
 * (the W056/W058 caller-supplied-registry disclosure).
 */
export function composeDeploymentPlan(
  input: DeploymentPlanInput,
  known?: readonly DeploymentPlan[],
): DeploymentPlanOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.scope) || !isRecordLike(input.security)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail: "the declaration is not typed data — a §14 scope, a mode, components, a security posture, and a lineage are required",
        },
      ],
    };
  }
  const violations: DeploymentViolation[] = [];
  for (const member of blankDeploymentScopeMembers(input.scope)) {
    violations.push({
      kind: "blank-scope-member",
      detail: `the plan's scope member '${member}' is blank — tenant/project/world identity is explicit (§14), never blank`,
    });
  }
  const mode = input.mode;
  if (!(DEPLOYMENT_MODES as readonly string[]).includes(String(mode))) {
    violations.push({
      kind: "unknown-mode",
      detail: `the deployment mode '${String(mode)}' is outside the closed vocabulary — deployments are ${DEPLOYMENT_MODES.join(" / ")} only`,
    });
  }
  const components = Array.isArray(input.components) ? input.components : [];
  violations.push(
    ...componentCoherenceViolations(
      components,
      input.api,
      input.sdk,
      input.operations,
    ),
  );
  // Every citation, proven against its REAL merged-dep surface.
  violations.push(...proveApiCitation(input.api ?? null));
  violations.push(...proveSdkCitation(input.sdk ?? null));
  violations.push(...proveOperationsCitation(input.operations ?? null));
  const posture = proveSecurityPosture(input.scope, {
    policy: input.security.policy,
    references: input.security.references,
  });
  violations.push(...posture.violations);
  // THE REDACTION LAW over the ENTIRE declaration (defense in depth beyond
  // the posture scan: citations can carry text too).
  for (const refusal of secretValueViolations(input, "the deployment declaration")) {
    violations.push({
      kind: "secret-value-refused",
      detail: refusal.message,
    });
  }
  violations.push(
    ...lineageViolations(input.lineage, mode, input.scope, known),
  );
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const scoped = input as DeploymentPlanInput;
  const canonicalApi: DeploymentApiCitation | null =
    scoped.api === undefined
      ? null
      : {
          routeTableId: scoped.api.routeTableId,
          routeNames: canonicalNames(scoped.api.routeNames),
        };
  const canonicalSdk: DeploymentSdkCitation | null =
    scoped.sdk === undefined ? null : { boundTableId: scoped.sdk.boundTableId };
  const canonicalOps: DeploymentOperationsCitation | null =
    scoped.operations === undefined
      ? null
      : { opsRouteNames: canonicalNames(scoped.operations.opsRouteNames) };
  const content: Omit<DeploymentPlan, "planId"> = {
    scope: {
      tenantId: scoped.scope.tenantId,
      projectId: scoped.scope.projectId,
      worldId: scoped.scope.worldId,
    },
    mode: scoped.mode,
    components: canonicalComponents(scoped.components),
    api: canonicalApi,
    sdk: canonicalSdk,
    operations: canonicalOps,
    security: {
      policy: scoped.security.policy,
      references: canonicalReferences(scoped.security.references),
      enforcement: posture.enforcement as NonNullable<typeof posture.enforcement>,
      isolation: posture.isolation as NonNullable<typeof posture.isolation>,
    },
    lineage: {
      parent: scoped.lineage.parent,
      sequence: scoped.lineage.sequence,
    },
    provenance: {
      deriver: "compose-deployment-plan",
      inputDigest: deploymentInputDigestOf(scoped),
      laws: DEPLOYMENT_PROVENANCE_LAWS,
    },
  };
  const planId: DeploymentPlanId = deploymentPlanIdOf(content);
  return {
    ok: true,
    plan: Object.freeze({ ...content, planId }),
  };
}
