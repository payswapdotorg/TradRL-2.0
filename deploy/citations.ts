/**
 * The deployment CITATION PROOFS (W062) — every component citation proven
 * against a REAL exported surface of the merged deps, as pure functions.
 *
 * Each proof re-derives the real surface at proof time (deterministic — the
 * same surface always re-derives) and compares the citation against it:
 * - `proveApiCitation` — against W059's real default World-Alpha route table
 *   (`services/api` routes + point-in-time declarations, assembled through
 *   W059's own `buildRouteTable` gate);
 * - `proveSdkCitation` — against W059's real typed client built over the real
 *   table (`packages/sdk` `buildSdkClient`, the drift-guarded projection);
 * - `proveOperationsCitation` — against W061's real operations route
 *   declarations (`packages/observability` `operationsRouteDeclarations`,
 *   re-proven through W061's own `validateOperationsRoutes` gate);
 * - `proveSecurityPosture` — through W060's own validators
 *   (`validateSecurityPolicy` / `validateSecretReference` / the structural
 *   REDACTION LAW scan) + W060's pure machinery (`enforceSecretPolicy`,
 *   `proveIsolation`), re-minting the enforcement + isolation records so the
 *   gate can seal them and the re-validator can compare them.
 *
 * Fail-closed, ALL violations collected (never short-circuit). Pure: no I/O,
 * no clocks, no randomness, no env reads (A9). A14: proofs compose typed
 * records — nothing here executes anything.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { worldAlphaApiV1 } from "../services/api/index.js";
import { buildSdkClient } from "../packages/sdk/index.js";
import {
  operationsRouteDeclarations,
  validateOperationsRoutes,
} from "../packages/observability/index.js";
import {
  validateSecretReference,
  validateSecurityPolicy,
} from "../packages/security/index.js";
import type { SecurityScope, SecretReference } from "../packages/security/index.js";
import { secretValueViolations } from "../packages/security/index.js";
import type { SecurityPolicy } from "../packages/security/index.js";
import { enforceSecretPolicy, proveIsolation } from "../services/security/index.js";
import type { SecretEnforcement } from "../services/security/index.js";
import type { IsolationProof } from "../packages/security/index.js";
import {
  canonicalNames,
  canonicalReferences,
  canonicalScopeTuple,
  type DeploymentApiCitation,
  type DeploymentOperationsCitation,
  type DeploymentSdkCitation,
} from "./plan.js";

/** Every law a deployment declaration/record can violate (closed set). */
export type DeploymentViolationKind =
  | "malformed-input"
  | "blank-scope-member"
  | "scope-mismatch"
  | "unknown-mode"
  | "unknown-component"
  | "duplicate-component"
  | "component-citation-missing"
  | "citation-without-component"
  | "api-table-unlawful"
  | "api-table-mismatch"
  | "unknown-api-route"
  | "sdk-surface-drift"
  | "sdk-table-mismatch"
  | "ops-route-drift"
  | "unknown-ops-route"
  | "security-policy-unlawful"
  | "secret-reference-unlawful"
  | "secret-value-refused"
  | "empty-secret-surface"
  | "security-posture-required"
  | "custody-noncompliant"
  | "isolation-unlawful"
  | "isolation-not-proven"
  | "isolation-mismatch"
  | "enforcement-mismatch"
  | "mode-posture-violated"
  | "lineage-unlawful"
  | "parent-unknown"
  | "parent-scope-mismatch"
  | "lineage-non-contiguous"
  | "non-canonical-record"
  | "id-mismatch"
  | "provenance-unlawful";

/** One typed deployment violation (fail-closed; the law named in the detail). */
export interface DeploymentViolation {
  readonly kind: DeploymentViolationKind;
  readonly detail: string;
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const sameScope = (left: SecurityScope, right: SecurityScope): boolean =>
  canonicalScopeTuple(left).join("|") === canonicalScopeTuple(right).join("|");

const carried = (errors: readonly { code?: unknown; message?: unknown }[]): string =>
  errors
    .map((error) => `${String(error.code)}: ${String(error.message)}`)
    .join("; ");

/** The security posture as the proofs see it (input or carried record). */
export interface SecurityPostureLike {
  readonly policy: SecurityPolicy;
  readonly references: readonly SecretReference[];
  readonly isolation?: IsolationProof;
}

/** The re-minted W060 records a posture proof yields (seal + compare). */
export interface SecurityPostureProof {
  readonly violations: readonly DeploymentViolation[];
  readonly enforcement: SecretEnforcement | null;
  readonly isolation: IsolationProof | null;
}

// ---------------------------------------------------------------------------
// The API citation (W059 services/api — the REAL route surface)
// ---------------------------------------------------------------------------

/**
 * Prove the API-service citation against the REAL default World-Alpha table:
 * the cited table id must equal the real table's content-addressed id, and
 * every cited route lineage name must exist in the real table (unknown names
 * refused loudly). The citation's declared order is CANONICALIZED (A9 — the
 * declarer's order never leaks); only its CONTENT is proven here.
 */
export function proveApiCitation(
  citation: DeploymentApiCitation | null | undefined,
): readonly DeploymentViolation[] {
  const table = worldAlphaApiV1();
  if (!table.ok) {
    return [
      {
        kind: "api-table-unlawful",
        detail: `the real World-Alpha route table failed its own construction gate (W059): ${carried(table.violations as unknown as { code?: unknown; message?: unknown }[])}`,
      },
    ];
  }
  if (citation === null || citation === undefined) {
    return [];
  }
  const violations: DeploymentViolation[] = [];
  if (
    !isRecordLike(citation) ||
    typeof citation.routeTableId !== "string" ||
    citation.routeTableId.length === 0
  ) {
    return [
      {
        kind: "component-citation-missing",
        detail: "the api-service component citation carries no route table id — the deployed table is explicit, never blank",
      },
    ];
  }
  if (citation.routeTableId !== table.table.tableId) {
    violations.push({
      kind: "api-table-mismatch",
      detail: `the cited route table id '${citation.routeTableId}' is not the real World-Alpha table id '${table.table.tableId}' — the deployment cites the surface it actually deploys (W059)`,
    });
  }
  const names = Array.isArray(citation.routeNames) ? citation.routeNames : [];
  if (names.length === 0) {
    violations.push({
      kind: "component-citation-missing",
      detail: "the api-service component citation declares no route names — a deployment declares the routes it serves, never none",
    });
  }
  const real = new Set(table.table.routes.map((route) => route.name));
  for (const name of canonicalNames(names)) {
    if (!real.has(name)) {
      violations.push({
        kind: "unknown-api-route",
        detail: `the cited route name '${name}' is not a route of the real World-Alpha table — API citations are proven against services/api's own surface, never assumed`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The SDK citation (W059 packages/sdk — the REAL typed client)
// ---------------------------------------------------------------------------

/**
 * Prove the SDK-client citation against the REAL typed client: W059's
 * `buildSdkClient` must accept the real table (the drift guard — the SDK
 * surface mirrors the table exactly) and the cited bound table id must equal
 * the built client's table id.
 */
export function proveSdkCitation(
  citation: DeploymentSdkCitation | null | undefined,
): readonly DeploymentViolation[] {
  const table = worldAlphaApiV1();
  if (!table.ok) {
    return [
      {
        kind: "sdk-surface-drift",
        detail: "the real World-Alpha route table is unlawful — the SDK surface cannot be proven over it",
      },
    ];
  }
  const client = buildSdkClient(table.table);
  if (!client.ok) {
    return [
      {
        kind: "sdk-surface-drift",
        detail: `the real SDK surface does not cover the real route table (W059 drift guard): ${carried(client.errors as unknown as { code?: unknown; message?: unknown }[])}`,
      },
    ];
  }
  if (citation === null || citation === undefined) {
    return [];
  }
  if (
    !isRecordLike(citation) ||
    typeof citation.boundTableId !== "string" ||
    citation.boundTableId.length === 0
  ) {
    return [
      {
        kind: "component-citation-missing",
        detail: "the sdk-client component citation carries no bound table id — the SDK binding is explicit, never blank",
      },
    ];
  }
  if (citation.boundTableId !== client.client.tableId) {
    return [
      {
        kind: "sdk-table-mismatch",
        detail: `the cited SDK bound table id '${citation.boundTableId}' is not the real client's table id '${client.client.tableId}' — the deployment cites the binding it actually ships (W059)`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The operations citation (W061 packages/observability — the REAL ops routes)
// ---------------------------------------------------------------------------

/**
 * Prove the operations-service citation against W061's REAL operations route
 * declarations: the declarations themselves must pass W061's own ops-route
 * gate (drift anchor), and every cited ops route name must be one of them.
 */
export function proveOperationsCitation(
  citation: DeploymentOperationsCitation | null | undefined,
): readonly DeploymentViolation[] {
  const declarations = operationsRouteDeclarations();
  const routeLaws = validateOperationsRoutes(declarations);
  const violations: DeploymentViolation[] = routeLaws.map((violation) => ({
    kind: "ops-route-drift" as const,
    detail: `W061's own operations-route gate refused the real declarations: ${violation.kind} — ${violation.detail}`,
  }));
  if (citation === null || citation === undefined) {
    return violations;
  }
  if (!isRecordLike(citation) || !Array.isArray(citation.opsRouteNames)) {
    return [
      ...violations,
      {
        kind: "component-citation-missing",
        detail: "the operations-service component citation carries no ops route names — the served ops surface is explicit, never blank",
      },
    ];
  }
  if (citation.opsRouteNames.length === 0) {
    violations.push({
      kind: "component-citation-missing",
      detail: "the operations-service component citation declares no ops route names — a deployment declares the ops routes it serves, never none",
    });
  }
  const real = new Set(declarations.map((route) => route.name));
  for (const name of canonicalNames(citation.opsRouteNames)) {
    if (!real.has(name)) {
      violations.push({
        kind: "unknown-ops-route",
        detail: `the cited ops route name '${name}' is not one of W061's declared operations routes — ops citations are proven against operationsRouteDeclarations(), never assumed`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The security posture (W060 — the REAL validators + pure machinery)
// ---------------------------------------------------------------------------

/**
 * Prove the SECURITY POSTURE through W060's own laws, re-minting the
 * enforcement + isolation records: the carried policy + every secret HANDLE
 * re-validated through W060's own validators (errors carried VERBATIM), THE
 * REDACTION LAW re-scanned over every posture byte (a secret-shaped VALUE is
 * the LOUD `secret-value-refused`), the §14 scope agreement (one plan, one
 * scope), the custody enforcement re-run through `enforceSecretPolicy`
 * (non-compliance carried verbatim), and the tenant-boundary isolation proof
 * re-minted through `proveIsolation` over the handles' own scopes (findings
 * carried verbatim; a carried proof that disagrees with the re-mint is a
 * loud mismatch). A6: no number is invented here — every count is a carried
 * record's own.
 */
export function proveSecurityPosture(
  scope: SecurityScope,
  posture: SecurityPostureLike,
): SecurityPostureProof {
  const violations: DeploymentViolation[] = [];
  if (!isRecordLike(posture) || !isRecordLike(posture.policy)) {
    return {
      violations: [
        {
          kind: "malformed-input",
          detail: "the security posture is not typed data — a policy, secret handles, and an isolation proof are required",
        },
      ],
      enforcement: null,
      isolation: null,
    };
  }
  const policy = posture.policy;
  const references = Array.isArray(posture.references)
    ? posture.references
    : [];
  if (references.length === 0) {
    violations.push({
      kind: "empty-secret-surface",
      detail: "the plan names no secret handles — a production deployment's secret surface is explicit typed handles, never empty (THE REDACTION LAW: handles only, values never)",
    });
  }
  if (!sameScope(policy.scope, scope)) {
    violations.push({
      kind: "scope-mismatch",
      detail: "the security policy's §14 scope disagrees with the plan's scope — one plan, one explicit tenant/project/world scope (spec/ARCHITECTURE-LOCK.md §14)",
    });
  }
  const policyValidation = validateSecurityPolicy(policy);
  if (!policyValidation.ok) {
    violations.push({
      kind: "security-policy-unlawful",
      detail: `the carried security policy fails W060's own whole-record re-validation: ${carried(policyValidation.errors as unknown as { code?: unknown; message?: unknown }[])}`,
    });
  }
  const ordered = canonicalReferences(references as SecretReference[]);
  for (const reference of ordered) {
    const validation = validateSecretReference(reference);
    if (!validation.ok) {
      violations.push({
        kind: "secret-reference-unlawful",
        detail: `the secret handle '${String(reference?.secretId ?? "?")}' fails W060's own whole-record re-validation: ${carried(validation.errors as unknown as { code?: unknown; message?: unknown }[])}`,
      });
      continue;
    }
    if (!sameScope(reference.scope, scope)) {
      violations.push({
        kind: "scope-mismatch",
        detail: `the secret handle '${String(reference.secretId)}' sits outside the plan's §14 scope — secrets are tenant isolated (R056) and one plan is one scope`,
      });
    }
  }
  // THE REDACTION LAW — structural, over every posture byte.
  for (const refusal of secretValueViolations(
    { policy, references },
    "the security posture",
  )) {
    violations.push({
      kind: "secret-value-refused",
      detail: refusal.message,
    });
  }
  // The custody enforcement, re-run through W060's pure machinery.
  let enforcement: SecretEnforcement | null = null;
  const enforcementOutcome = enforceSecretPolicy(policy, ordered);
  if (!enforcementOutcome.ok) {
    violations.push({
      kind: "custody-noncompliant",
      detail: `W060's custody enforcement refused the input: ${carried(enforcementOutcome.errors as unknown as { code?: unknown; message?: unknown }[])}`,
    });
  } else {
    enforcement = enforcementOutcome.enforcement;
    if (!enforcement.compliant) {
      violations.push({
        kind: "custody-noncompliant",
        detail: `the secret handles do not satisfy the carried policy's custody requirements (W060 enforceSecretPolicy, violations verbatim): ${carried(enforcement.violations as unknown as { code?: unknown; message?: unknown }[])}`,
      });
    }
  }
  // The tenant-boundary isolation proof, re-minted through W060's vocabulary.
  let isolation: IsolationProof | null = null;
  const evidence = ordered.map((reference) => ({
    recordId: String(reference?.secretId ?? "?"),
    scope: reference?.scope,
    kind: "secret-reference",
  }));
  const isolationOutcome = proveIsolation(evidence);
  if (!isolationOutcome.ok) {
    violations.push({
      kind: "isolation-unlawful",
      detail: `W060's isolation proof mint refused the handles: ${carried(isolationOutcome.errors as unknown as { code?: unknown; message?: unknown }[])}`,
    });
  } else {
    isolation = isolationOutcome.proof;
    if (!isolation.isolated) {
      violations.push({
        kind: "isolation-not-proven",
        detail: `the tenant boundary is NOT proven — W060's isolation proof carries findings (R056/§14, verbatim): ${isolation.findings
          .map((finding) => `${finding.code}@${finding.recordId}: ${finding.message}`)
          .join("; ")}`,
      });
    }
    const carriedProof = posture.isolation;
    if (carriedProof !== undefined) {
      if (String(carriedProof?.proofId) !== String(isolation.proofId)) {
        violations.push({
          kind: "isolation-mismatch",
          detail: `the carried isolation proof '${String(carriedProof?.proofId)}' does not match the proof re-minted from the carried handles '${String(isolation.proofId)}' — the tenant-boundary proof is composed through W060's isolation vocabulary, never asserted`,
        });
      }
    }
  }
  return { violations, enforcement, isolation };
}

/**
 * Prove the carried enforcement record equals the one re-minted from the
 * carried policy + handles (whole-record re-validation's compare law).
 */
export function enforcementMatches(
  carriedEnforcement: SecretEnforcement,
  reMinted: SecretEnforcement,
): boolean {
  return (
    String(carriedEnforcement.enforcementId) ===
      String(reMinted.enforcementId) &&
    carriedEnforcement.checked === reMinted.checked &&
    carriedEnforcement.compliant === reMinted.compliant
  );
}
