/**
 * The product-identity CITATION PROOFS (W066) — every identity declaration
 * proven against a REAL repository surface, as functions.
 *
 * The proofs read the repository through an injected `SurfaceProbe` (the
 * caller-supplied-registry pattern — W062's `known` lineage sets): the REAL
 * default probe reads the live repository tree anchored at this contract's
 * own location; tests may inject an in-memory probe for the content refusal
 * laws. The proofs never feed the record id — the identity stays pure
 * content-addressed data (A9); a surface fact is a GATE LAW, never id mass
 * (disclosed in product/README.md).
 *
 * - `proveSurfaceDeclaration` — fail-closed unknown-surface refusal (the
 *   declared surface EXISTS in the repository) + the migration laws as
 *   byte-proofs: a product-name-bearing surface CARRIES "TradRL"; a
 *   workbench-inherited surface PRESERVES "ZCode";
 * - `proveDeploymentComponents` — the W062 citation: every cited component
 *   proven against `deploy/plan.ts`'s REAL `DEPLOYMENT_COMPONENT_KINDS`, and
 *   a REAL plan over exactly the cited components composed + re-validated
 *   through W062's OWN gates (`composeDeploymentPlan` +
 *   `validateDeploymentPlan` — W062's laws apply verbatim, never
 *   re-declared here);
 * - `proveBrandingLaw` — the extends-never-replaces law proven against the
 *   identity-scope vocabulary's OWN laws AND against the REAL AGENTS.md
 *   bytes (the law is carried verbatim from its source surface).
 *
 * Fail-closed, ALL violations collected (never short-circuit).
 * License: Apache-2.0 (the repository LICENSE).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_COMPONENT_KINDS,
} from "../deploy/plan.js";
import type { DeploymentComponentKind } from "../deploy/plan.js";
import { composeDeploymentPlan, validateDeploymentPlan } from "../deploy/index.js";
import { worldAlphaApiV1 } from "../services/api/index.js";
import { buildSdkClient } from "../packages/sdk/index.js";
import { operationsRouteDeclarations } from "../packages/observability/index.js";
import {
  declareSecurityPolicy,
  sealSecretReference,
} from "../packages/security/index.js";
import type { SecurityScope, SecretCustodyPolicy } from "../packages/security/index.js";
import {
  BRANDING_LAW,
  BRANDING_LAW_SOURCE,
  IDENTITY_PROVENANCE_LAWS,
  IDENTITY_SCOPES,
  IDENTITY_SCOPE_LAWS,
  PRODUCT_NAME,
  WORKBENCH_NAME,
  canonicalScopes,
  identityScopeLawOf,
} from "./identity.js";
import type { IdentityScope, IdentitySurfaceDeclaration } from "./identity.js";

/** Every law an identity declaration/record can violate (closed set). */
export type IdentityViolationKind =
  | "malformed-input"
  | "unknown-product-name"
  | "unknown-scope"
  | "duplicate-surface"
  | "name-surface-required"
  | "surface-absent"
  | "product-name-absent"
  | "workbench-identity-erased"
  | "component-citation-missing"
  | "citation-without-scope"
  | "unknown-deployment-component"
  | "deployment-plan-unproven"
  | "branding-law-mismatch"
  | "branding-law-malformed"
  | "branding-law-unproven"
  | "vocabulary-law-unlawful"
  | "lineage-unlawful"
  | "parent-unknown"
  | "lineage-non-contiguous"
  | "non-canonical-record"
  | "id-mismatch"
  | "provenance-unlawful";

/** One typed identity violation (fail-closed; the law named in the detail). */
export interface IdentityViolation {
  readonly kind: IdentityViolationKind;
  readonly detail: string;
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const carried = (errors: readonly { code?: unknown; message?: unknown }[]): string =>
  errors
    .map((error) => `${String(error.code)}: ${String(error.message)}`)
    .join("; ");

/** W062's own violation vocabulary is { kind, detail } — carried verbatim. */
const carriedViolations = (
  violations: readonly { kind?: unknown; detail?: unknown }[],
): string =>
  violations
    .map((violation) => `${String(violation.kind)} — ${String(violation.detail)}`)
    .join("; ");

// ---------------------------------------------------------------------------
// The surface probe (a repository surface IS a filesystem fact)
// ---------------------------------------------------------------------------

/** How the proofs see the repository: existence + text content of a
 * repo-relative surface path. Injected so the content refusal laws are
 * provable without mutating the live tree; the default is the REAL probe. */
export interface SurfaceProbe {
  readonly exists: (path: string) => boolean;
  readonly readText: (path: string) => string | null;
}

/** The repository root, anchored at THIS contract's own location — never
 * the caller's cwd (the probe is location-stable for a given checkout). */
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The REAL surface probe: reads the live repository tree. */
export function realSurfaceProbe(root: string = REPOSITORY_ROOT): SurfaceProbe {
  const resolve = (path: string): string =>
    `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return {
    exists: (path) => existsSync(resolve(path)),
    readText: (path) => {
      const resolved = resolve(path);
      if (!existsSync(resolved)) {
        return null;
      }
      return readFileSync(resolved, "utf8");
    },
  };
}

/** An in-memory probe over a path → content map (the refusal-law fixtures). */
export function memorySurfaceProbe(
  contents: ReadonlyMap<string, string>,
): SurfaceProbe {
  return {
    exists: (path) => contents.has(path),
    readText: (path) => contents.get(path) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The deployment citation (W062 — the REAL component vocabulary + gates)
// ---------------------------------------------------------------------------

/** The §14 scope + custody fixtures for the real W062 plan proof (built
 * through W060's own gates — the deploy/plan.test.ts fixture lineage). */
const PROOF_SCOPE: SecurityScope = {
  tenantId: "tenant-w066",
  projectId: "project-w066",
  worldId: "world-w066",
};
const PROOF_CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};
const HANDLE_CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-every-use" },
  accessScopes: ["tenant", "tenant-project", "tenant-project-world"],
  redaction: "everywhere",
};

/**
 * Prove the deployment-contract citation: every cited component must be a
 * member of `deploy/plan.ts`'s REAL component vocabulary, and a REAL W062
 * plan over exactly the cited components must compose AND re-validate
 * through W062's own gates — W062's own laws (the mandatory security
 * posture, the citation coherence, the §14 scope) apply VERBATIM through
 * its gate, never re-declared here (the deployment contract's component
 * vocabulary is a real cited surface, W066's declared dependency).
 */
export function proveDeploymentComponents(
  components: readonly DeploymentComponentKind[] | null | undefined,
): readonly IdentityViolation[] {
  if (
    components === null ||
    components === undefined ||
    !Array.isArray(components) ||
    components.length === 0
  ) {
    return [
      {
        kind: "component-citation-missing",
        detail:
          "the deployment-contract surface cites no components — the identity names the deployment vocabulary it cites, never none",
      },
    ];
  }
  const violations: IdentityViolation[] = [];
  for (const component of components) {
    if (!(DEPLOYMENT_COMPONENT_KINDS as readonly string[]).includes(String(component))) {
      violations.push({
        kind: "unknown-deployment-component",
        detail: `the cited component '${String(component)}' is outside deploy/plan.ts's real component vocabulary — deployment citations are proven against DEPLOYMENT_COMPONENT_KINDS (${DEPLOYMENT_COMPONENT_KINDS.join(" / ")}), never assumed`,
      });
    }
  }
  // The REAL plan proof: W059/W060/W061 fixtures through their own gates.
  const policyOutcome = declareSecurityPolicy({
    scope: PROOF_SCOPE,
    declaredBy: { tenantId: PROOF_SCOPE.tenantId, principalId: "principal-identity-w066" },
    requiredScopeKind: "tenant-project-world",
    secretCustody: PROOF_CUSTODY,
    authorizationModel: "entitlement-grants",
  });
  if (!policyOutcome.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: `the W060 fixture policy is unlawful — the deployment citation cannot be proven: ${carried(policyOutcome.errors as unknown as { code?: unknown; message?: unknown }[])}`,
      },
    ];
  }
  const handleOutcome = sealSecretReference({
    scope: PROOF_SCOPE,
    kind: "api-key",
    displayName: "w066-identity-proof-handle",
    custody: HANDLE_CUSTODY,
  });
  if (!handleOutcome.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: `the W060 fixture handle is unlawful — the deployment citation cannot be proven: ${carried(handleOutcome.errors as unknown as { code?: unknown; message?: unknown }[])}`,
      },
    ];
  }
  const tableOutcome = worldAlphaApiV1();
  if (!tableOutcome.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: "the real World-Alpha route table is unlawful — the deployment citation cannot be proven over it",
      },
    ];
  }
  const clientOutcome = buildSdkClient(tableOutcome.table);
  if (!clientOutcome.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: "the real SDK surface does not cover the real route table — the deployment citation cannot be proven",
      },
    ];
  }
  const declared = new Set(components.map((component) => String(component)));
  const composed = composeDeploymentPlan({
    scope: PROOF_SCOPE,
    mode: "direct",
    components: [...components],
    api: declared.has("api-service")
      ? {
          routeTableId: tableOutcome.table.tableId,
          routeNames: tableOutcome.table.routes.map((route) => route.name),
        }
      : undefined,
    sdk: declared.has("sdk-client")
      ? { boundTableId: clientOutcome.client.tableId }
      : undefined,
    operations: declared.has("operations-service")
      ? {
          opsRouteNames: operationsRouteDeclarations().map((route) => route.name),
        }
      : undefined,
    security: { policy: policyOutcome.policy, references: [handleOutcome.reference] },
    lineage: { parent: null, sequence: 1 },
  });
  if (!composed.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: `W062's own deployment gate refused the real plan over the cited components (violations verbatim): ${carriedViolations(composed.violations as unknown as { kind?: unknown; detail?: unknown }[])}`,
      },
    ];
  }
  const revalidated = validateDeploymentPlan(composed.plan);
  if (!revalidated.ok) {
    return [
      ...violations,
      {
        kind: "deployment-plan-unproven",
        detail: `W062's own whole-record re-validation refused the real plan over the cited components (violations verbatim): ${carriedViolations(revalidated.violations as unknown as { kind?: unknown; detail?: unknown }[])}`,
      },
    ];
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The per-surface proofs (fail-closed + the migration laws as byte-proofs)
// ---------------------------------------------------------------------------

/**
 * Prove ONE surface declaration: the surface EXISTS in the repository (the
 * fail-closed unknown-surface refusal), the declared scopes are inside the
 * closed vocabulary, the deployment citation belongs to the
 * deployment-contract scope (and vice versa), and every migration LAW holds
 * against the surface's REAL bytes — a product-name-bearing surface carries
 * the product's own name; a workbench-inherited surface preserves the
 * workbench identity.
 */
export function proveSurfaceDeclaration(
  surface: IdentitySurfaceDeclaration | null | undefined,
  probe: SurfaceProbe,
): readonly IdentityViolation[] {
  if (
    !isRecordLike(surface) ||
    typeof surface.path !== "string" ||
    surface.path.length === 0
  ) {
    return [
      {
        kind: "malformed-input",
        detail:
          "the surface declaration is not typed data — a repository path and identity scopes are required",
      },
    ];
  }
  const violations: IdentityViolation[] = [];
  const scopes = Array.isArray(surface.scopes) ? surface.scopes : [];
  for (const scope of scopes) {
    if (!(IDENTITY_SCOPES as readonly string[]).includes(String(scope))) {
      violations.push({
        kind: "unknown-scope",
        detail: `the identity scope '${String(scope)}' is outside the closed vocabulary — the product identity composes ${IDENTITY_SCOPES.join(" / ")} only`,
      });
    }
  }
  if (scopes.length === 0) {
    violations.push({
      kind: "malformed-input",
      detail: `the surface '${surface.path}' declares no identity scopes — every identity surface declares its scope class explicitly`,
    });
  }
  // The fail-closed unknown-surface refusal.
  if (!probe.exists(surface.path)) {
    violations.push({
      kind: "surface-absent",
      detail: `the declared identity surface '${surface.path}' does not exist in the repository — identity citations name REAL repository surfaces, never hypothetical ones (fail-closed)`,
    });
  }
  const content = probe.readText(surface.path);
  const hasDeploymentScope = (scopes as readonly string[]).includes("deployment-contract");
  const components = surface.components;
  if (hasDeploymentScope) {
    violations.push(...proveDeploymentComponents(components));
  } else if (components !== null && components !== undefined && components.length > 0) {
    violations.push({
      kind: "citation-without-scope",
      detail: `the surface '${surface.path}' cites deployment components but does not declare the deployment-contract scope — component citations belong to deployment-contract surfaces only`,
    });
  }
  // The migration laws, byte-proven against the REAL surface content.
  for (const scope of canonicalScopes(scopes as readonly IdentityScope[])) {
    const law = identityScopeLawOf(scope);
    if (law === undefined) {
      violations.push({
        kind: "vocabulary-law-unlawful",
        detail: `the identity-scope vocabulary carries no law for '${scope}' — the closed registry covers every scope (defensive-depth: cannot fire honestly while the vocabulary is well-formed)`,
      });
      continue;
    }
    if (law.mustCarry !== null && content !== null) {
      if (!content.includes(law.mustCarry)) {
        violations.push({
          kind: "product-name-absent",
          detail: `the product-name-bearing surface '${surface.path}' does not carry the product's own name '${law.mustCarry}' — a surface that speaks for the product wears the product identity`,
        });
      }
    }
    if (law.mustPreserve !== null && content !== null) {
      if (!content.includes(law.mustPreserve)) {
        violations.push({
          kind: "workbench-identity-erased",
          detail: `the workbench-inherited surface '${surface.path}' does not preserve the '${law.mustPreserve}' workbench identity — TradRL extends the workbench, never replaces it`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The branding law (proven against the vocabulary's own laws + REAL bytes)
// ---------------------------------------------------------------------------

/**
 * Prove the branding-law citation: the carried law must be the contract's
 * own law of record (carried verbatim, never edited), it must name BOTH
 * sides (the product AND the workbench — an extends law that erases either
 * side is malformed), it must be the ROOT of the identity-scope vocabulary's
 * own provenance-law list (the extends law governs the vocabulary), the
 * vocabulary's own laws must agree with it (product-name-bearing carries
 * the product name; workbench-inherited preserves the workbench name), and
 * the REAL source surface (AGENTS.md's product-boundary section) must carry
 * the law VERBATIM — the law is cited from the repository, never re-invented.
 */
export function proveBrandingLaw(
  law: unknown,
  probe: SurfaceProbe,
): readonly IdentityViolation[] {
  if (typeof law !== "string" || law.length === 0) {
    return [
      {
        kind: "malformed-input",
        detail: "the branding law is not typed data — the extends-never-replaces law is required on every identity record",
      },
    ];
  }
  const violations: IdentityViolation[] = [];
  if (law !== BRANDING_LAW) {
    violations.push({
      kind: "branding-law-mismatch",
      detail: `the carried branding law is not the law of record — the extends-never-replaces law is carried verbatim from ${BRANDING_LAW_SOURCE}, never edited`,
    });
  }
  if (!law.includes(PRODUCT_NAME) || !law.includes(WORKBENCH_NAME)) {
    violations.push({
      kind: "branding-law-malformed",
      detail: `the branding law must name both sides — the product ('${PRODUCT_NAME}') and the workbench ('${WORKBENCH_NAME}') it extends; an extends law that erases either side is no extends law`,
    });
  }
  // The law is the vocabulary's own ROOT law.
  const rootLaw = IDENTITY_PROVENANCE_LAWS.find((entry) => entry === BRANDING_LAW);
  if (rootLaw === undefined) {
    violations.push({
      kind: "vocabulary-law-unlawful",
      detail: "the identity-scope vocabulary's provenance-law list does not carry the branding law as its root — the extends-never-replaces law governs the whole vocabulary (defensive-depth: cannot fire honestly while the list is well-formed)",
    });
  }
  // The vocabulary's own laws must agree with the branding law's two sides.
  const carrying = identityScopeLawOf("product-name-bearing");
  if (carrying === undefined || carrying.mustCarry !== PRODUCT_NAME) {
    violations.push({
      kind: "vocabulary-law-unlawful",
      detail: `the product-name-bearing scope's own law does not require carrying the product's name '${PRODUCT_NAME}' — the vocabulary's laws must agree with the branding law (defensive-depth)`,
    });
  }
  const preserving = identityScopeLawOf("workbench-inherited");
  if (preserving === undefined || preserving.mustPreserve !== WORKBENCH_NAME) {
    violations.push({
      kind: "vocabulary-law-unlawful",
      detail: `the workbench-inherited scope's own law does not require preserving the '${WORKBENCH_NAME}' workbench identity — the vocabulary's laws must agree with the branding law (defensive-depth)`,
    });
  }
  if (IDENTITY_SCOPE_LAWS.length !== IDENTITY_SCOPES.length) {
    violations.push({
      kind: "vocabulary-law-unlawful",
      detail: "the identity-scope law registry does not cover the closed scope vocabulary exactly — every scope carries its migration law (defensive-depth)",
    });
  }
  // The REAL repository citation: AGENTS.md carries the law VERBATIM.
  const source = probe.readText(BRANDING_LAW_SOURCE);
  if (source === null) {
    violations.push({
      kind: "branding-law-unproven",
      detail: `the branding-law source surface '${BRANDING_LAW_SOURCE}' is absent from the repository — the extends-never-replaces law is cited from a real surface, never invented`,
    });
  } else if (!source.includes(law)) {
    violations.push({
      kind: "branding-law-unproven",
      detail: `the branding law is not carried verbatim by '${BRANDING_LAW_SOURCE}' — the extends-never-replaces law is AGENTS.md's own product-boundary law, cited from the repository's bytes`,
    });
  }
  return violations;
}
