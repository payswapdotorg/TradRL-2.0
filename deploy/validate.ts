/**
 * `validateDeploymentPlan` — whole-record RE-VALIDATION of a deployment plan
 * from its RECORDED data alone (W062).
 *
 * Every law re-proven against the record's own bytes: the closed
 * vocabularies, the §14 scope, the component/citation coherence, every
 * citation RE-proven against the REAL merged-dep surfaces (the same proofs
 * the gate ran), the security posture re-proven through W060's own
 * validators with the CARRIED enforcement + isolation records compared
 * against the ones re-minted from the carried policy + handles (a forged
 * verdict is a loud mismatch), the lineage + posture laws, the canonical
 * carriage (the record IS canonical data — non-canonical carriage is a
 * rewrite), the id RE-DERIVED from the record's own content, and the
 * deterministic provenance re-derived. A tampered plan is refused loudly,
 * naming the exact break — never silently repaired.
 *
 * Pure (A9). A13/A14: re-validation composes typed records — nothing
 * executes. License: Apache-2.0 (the repository LICENSE).
 */

import { secretValueViolations } from "../packages/security/index.js";
import {
  DEPLOYMENT_PROVENANCE_LAWS,
  canonicalComponents,
  canonicalNames,
  canonicalReferences,
  deploymentInputDigestOf,
  deploymentPlanIdOf,
  type DeploymentPlan,
} from "./plan.js";
import {
  enforcementMatches,
  proveApiCitation,
  proveOperationsCitation,
  proveSdkCitation,
  proveSecurityPosture,
  type DeploymentViolation,
} from "./citations.js";
import { lineageViolations } from "./compose.js";

/** The whole-record re-validation outcome. */
export type DeploymentPlanValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly DeploymentViolation[] };

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Re-validate one deployment plan end-to-end from its recorded data alone.
 * `known` (when supplied) is the live lineage the parent laws are proven
 * against — the re-validator never invents a parent record.
 */
export function validateDeploymentPlan(
  plan: unknown,
  known?: readonly DeploymentPlan[],
): DeploymentPlanValidation {
  if (!isRecordLike(plan) || !isRecordLike(plan.scope)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail: "the plan is not typed data — a recorded deployment plan carries its scope, mode, components, citations, posture, lineage and provenance",
        },
      ],
    };
  }
  const violations: DeploymentViolation[] = [];
  const record = plan as unknown as DeploymentPlan;
  const declared = Array.isArray(record.components) ? record.components : [];
  const componentSet = new Set(declared.map((kind) => String(kind)));
  for (const kind of declared) {
    if (!canonicalComponents(declared).some((entry) => entry === kind)) {
      violations.push({
        kind: "non-canonical-record",
        detail: "the components are not carried in the closed vocabulary's canonical order — a recorded plan IS canonical data (A9)",
      });
      break;
    }
  }
  if (componentSet.size !== declared.length) {
    violations.push({
      kind: "duplicate-component",
      detail: "the same component is recorded twice — component declarations are a set",
    });
  }
  if (!componentSet.has("security-layer")) {
    violations.push({
      kind: "security-posture-required",
      detail: "the security-layer component is MANDATORY in every recorded plan — the posture (policy, handles, enforcement, isolation) always travels with the plan",
    });
  }
  const citations: readonly [string, unknown][] = [
    ["api-service", record.api],
    ["sdk-client", record.sdk],
    ["operations-service", record.operations],
  ];
  for (const [kind, citation] of citations) {
    if (componentSet.has(kind) && (citation === null || citation === undefined)) {
      violations.push({
        kind: "component-citation-missing",
        detail: `the '${kind}' component is recorded without its citation`,
      });
    }
    if (!componentSet.has(kind) && citation !== null && citation !== undefined) {
      violations.push({
        kind: "citation-without-component",
        detail: `a citation is recorded for '${kind}' but the component is not declared`,
      });
    }
  }
  violations.push(...proveApiCitation(record.api ?? null));
  violations.push(...proveSdkCitation(record.sdk ?? null));
  violations.push(...proveOperationsCitation(record.operations ?? null));
  // The posture: re-proven, with the CARRIED verdicts compared to the re-mints.
  const posture = proveSecurityPosture(record.scope, {
    policy: record.security?.policy,
    references: record.security?.references,
    isolation: record.security?.isolation,
  });
  violations.push(...posture.violations);
  if (posture.enforcement !== null && record.security?.enforcement !== undefined) {
    if (!enforcementMatches(record.security.enforcement, posture.enforcement)) {
      violations.push({
        kind: "enforcement-mismatch",
        detail: `the recorded custody enforcement '${String(record.security.enforcement.enforcementId)}' does not match the verdict re-derived from the recorded policy + handles '${String(posture.enforcement.enforcementId)}' — the enforcement record is minted through W060's own machinery, never asserted`,
      });
    }
  }
  // THE REDACTION LAW over the ENTIRE record.
  for (const refusal of secretValueViolations(plan, "the recorded plan")) {
    violations.push({ kind: "secret-value-refused", detail: refusal.message });
  }
  violations.push(...lineageViolations(record.lineage, record.mode, record.scope, known));
  // The canonical-carriage laws (a recorded plan IS canonical data).
  if (record.api !== null && record.api !== undefined) {
    if (canonicalNames(record.api.routeNames).join("|") !== record.api.routeNames.join("|")) {
      violations.push({
        kind: "non-canonical-record",
        detail: "the recorded api citation's route names are not in canonical order (sorted, unique) — input order never leaks into a record (A9)",
      });
    }
  }
  if (record.operations !== null && record.operations !== undefined) {
    if (
      canonicalNames(record.operations.opsRouteNames).join("|") !==
      record.operations.opsRouteNames.join("|")
    ) {
      violations.push({
        kind: "non-canonical-record",
        detail: "the recorded operations citation's route names are not in canonical order — input order never leaks into a record (A9)",
      });
    }
  }
  const recordedReferences = Array.isArray(record.security?.references)
    ? record.security.references
    : [];
  if (
    canonicalReferences(recordedReferences)
      .map((reference) => String(reference.secretId))
      .join("|") !==
    recordedReferences.map((reference) => String(reference?.secretId)).join("|")
  ) {
    violations.push({
      kind: "non-canonical-record",
      detail: "the recorded secret handles are not in canonical (secret id) order — input order never leaks into a record (A9)",
    });
  }
  // The id re-derivation (the whole-record re-proof).
  const { planId: _planId, ...content } = record;
  const derivedId = deploymentPlanIdOf(content);
  if (String(record.planId) !== String(derivedId)) {
    violations.push({
      kind: "id-mismatch",
      detail: `the recorded plan id '${String(record.planId)}' does not re-derive from its own content '${String(derivedId)}' — a rewritten plan is a loud violation, never a silent pass`,
    });
  }
  // The deterministic provenance re-derivation.
  const provenance = record.provenance;
  if (!isRecordLike(provenance)) {
    violations.push({
      kind: "provenance-unlawful",
      detail: "the plan carries no provenance record — deterministic provenance travels with every sealed record",
    });
  } else {
    if (provenance.deriver !== "compose-deployment-plan") {
      violations.push({
        kind: "provenance-unlawful",
        detail: `the provenance deriver '${String(provenance.deriver)}' is not the deployment gate — records name their deriver honestly`,
      });
    }
    if (
      JSON.stringify(provenance.laws) !== JSON.stringify(DEPLOYMENT_PROVENANCE_LAWS)
    ) {
      violations.push({
        kind: "provenance-unlawful",
        detail: "the provenance law list does not match the deployment contract's own — the laws are carried verbatim, never edited",
      });
    }
    const expectedInputDigest = deploymentInputDigestOf({
      scope: record.scope,
      mode: record.mode,
      components: record.components,
      api: record.api ?? undefined,
      sdk: record.sdk ?? undefined,
      operations: record.operations ?? undefined,
      security: {
        policy: record.security?.policy,
        references: recordedReferences,
      },
      lineage: record.lineage,
    });
    if (String(provenance.inputDigest) !== String(expectedInputDigest)) {
      violations.push({
        kind: "provenance-unlawful",
        detail: `the provenance input digest '${String(provenance.inputDigest)}' does not re-derive from the recorded declaration '${String(expectedInputDigest)}' — the provenance is deterministic data`,
      });
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
