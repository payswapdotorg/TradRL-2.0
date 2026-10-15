/**
 * The W066 product-identity-contract tests — REAL citations only (the
 * no-shim law): the shipped identity declaration cites the repository's
 * REAL surfaces and is proven through the REAL surface probe (anchored at
 * the repository root); the deployment-component citation is proven against
 * deploy/plan.ts's REAL vocabulary through W062's own gates; the branding
 * law is proven against AGENTS.md's real bytes. The gates under test are
 * this directory's own `composeProductIdentity` + `validateProductIdentity`.
 * The content refusal laws use BOTH real surfaces (files that factually
 * lack the name) and an injected in-memory probe — never a mutation of the
 * live tree.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEPLOYMENT_COMPONENT_KINDS } from "../deploy/plan.js";
import {
  BRANDING_LAW,
  TRADRL_IDENTITY_SURFACES,
  composeProductIdentity,
  memorySurfaceProbe,
  proveBrandingLaw,
  proveDeploymentComponents,
  realSurfaceProbe,
  tradrlProductIdentityDeclaration,
  validateProductIdentity,
  type IdentitySurfaceDeclaration,
  type ProductIdentity,
  type ProductIdentityInput,
  type IdentityViolation,
} from "./index.js";

// ---------------------------------------------------------------------------
// The REAL fixture chain (the repository's own identity surfaces)
// ---------------------------------------------------------------------------

function aDeclaration(
  overrides: Partial<ProductIdentityInput> = {},
): ProductIdentityInput {
  return {
    ...tradrlProductIdentityDeclaration(),
    ...overrides,
  };
}

const kindsOf = (violations: readonly IdentityViolation[]): readonly string[] =>
  violations.map((violation) => violation.kind);

const BASE_OUTCOME = composeProductIdentity(aDeclaration());
if (!BASE_OUTCOME.ok) {
  throw new Error(
    `the shipped product identity is unlawful: ${JSON.stringify(BASE_OUTCOME.violations)}`,
  );
}
const BASE: ProductIdentity = BASE_OUTCOME.identity;

// ---------------------------------------------------------------------------
// The gate: the happy paths + the A9 twins
// ---------------------------------------------------------------------------

test("the shipped identity composes over the REAL repository surfaces and re-validates", () => {
  assert.equal(String(BASE.identityId).slice(0, 9), "identity-");
  assert.equal(BASE.productName, "TradRL");
  assert.equal(BASE.brandingLaw, BRANDING_LAW);
  // Canonical carriage: surfaces sorted by path, scopes in vocabulary order.
  const paths = BASE.surfaces.map((surface) => surface.path);
  assert.deepEqual(paths, [...paths].sort());
  const readme = BASE.surfaces.find((surface) => surface.path === "README.md");
  assert.deepEqual(readme?.scopes, ["product-name-bearing", "workbench-inherited"]);
  const deploy = BASE.surfaces.find((surface) => surface.path === "deploy/plan.ts");
  assert.deepEqual(deploy?.components, [...DEPLOYMENT_COMPONENT_KINDS]);
  const revalidated = validateProductIdentity(BASE);
  assert.ok(revalidated.ok, JSON.stringify(revalidated.ok ? null : revalidated.violations));
});

test("A9 twin: the declarer's input order never leaks (ids, records)", () => {
  const twin = composeProductIdentity({
    ...aDeclaration(),
    surfaces: [...TRADRL_IDENTITY_SURFACES].reverse().map((surface) => ({
      components:
        surface.components === null ? null : [...surface.components].reverse(),
      path: surface.path,
      scopes: [...surface.scopes].reverse(),
    })),
  });
  assert.ok(twin.ok);
  assert.equal(twin.identity.identityId, BASE.identityId);
  assert.deepEqual(twin.identity, BASE);
});

test("A9: the same declaration always mints the same identity (idempotent gate)", () => {
  const again = composeProductIdentity(aDeclaration());
  assert.ok(again.ok);
  assert.equal(again.identity.identityId, BASE.identityId);
});

test("a continuation is a new identity generation (the lineage weighs, mirroring deploy/plan.ts)", () => {
  const continuation = composeProductIdentity(
    aDeclaration({ lineage: { parent: BASE.identityId, sequence: 2 } }),
    realSurfaceProbe(),
    [BASE],
  );
  assert.ok(continuation.ok, JSON.stringify(continuation.ok ? null : continuation.violations));
  assert.notEqual(continuation.identity.identityId, BASE.identityId);
  const revalidated = validateProductIdentity(continuation.identity, realSurfaceProbe(), [BASE]);
  assert.ok(revalidated.ok);
});

// ---------------------------------------------------------------------------
// The gate: every refusal law (fail-closed, all violations collected)
// ---------------------------------------------------------------------------

test("malformed input is refused loudly", () => {
  const outcome = composeProductIdentity(null as unknown as ProductIdentityInput);
  assert.ok(!outcome.ok);
  assert.deepEqual(kindsOf(outcome.violations), ["malformed-input"]);
});

test("a renamed product is refused (the identity is TradRL's own, never free text)", () => {
  const outcome = composeProductIdentity(
    aDeclaration({ productName: "ZTrad" }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("unknown-product-name"));
});

test("an edited branding law is refused (carried verbatim, never edited)", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      brandingLaw: "TradRL replaces the ZCode workbench entirely.",
    }),
  );
  assert.ok(!outcome.ok);
  const kinds = kindsOf(outcome.violations);
  assert.ok(kinds.includes("branding-law-mismatch"));
  assert.ok(kinds.includes("branding-law-unproven"));
});

test("the branding law is proven against the REAL AGENTS.md bytes", () => {
  assert.deepEqual(proveBrandingLaw(BRANDING_LAW, realSurfaceProbe()), []);
  const probe = memorySurfaceProbe(
    new Map([["AGENTS.md", "# TradRL Engineering Contract\n\n(no product boundary here)"]]),
  );
  const outcome = composeProductIdentity(aDeclaration(), probe);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("branding-law-unproven"));
});

test("an unknown identity scope is refused (closed vocabulary)", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        { path: "README.md", scopes: ["marketing" as unknown as "product-name-bearing"], components: null },
      ],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("unknown-scope"));
});

test("a duplicate surface declaration is refused (declarations are a set)", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [...TRADRL_IDENTITY_SURFACES, TRADRL_IDENTITY_SURFACES[0] as IdentitySurfaceDeclaration],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("duplicate-surface"));
});

test("an identity with no product-name-bearing surface is refused", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [{ path: "LICENSE", scopes: ["license-notice"], components: null }],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("name-surface-required"));
});

test("an unknown surface is refused fail-closed (the REAL probe)", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        { path: "does/not/exist.md", scopes: ["product-name-bearing"], components: null },
      ],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("surface-absent"));
});

test("a product-name-bearing surface that does not carry the name is refused (REAL bytes)", () => {
  // mise.toml exists and factually carries no product name — the byte-proof
  // fires over the real repository tree, never a stub.
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [{ path: "mise.toml", scopes: ["product-name-bearing"], components: null }],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("product-name-absent"));
});

test("a workbench-inherited surface that erased the workbench identity is refused (REAL bytes)", () => {
  // ops/README.md exists and factually carries no ZCode mention.
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [{ path: "ops/README.md", scopes: ["workbench-inherited"], components: null },
        ...TRADRL_IDENTITY_SURFACES.slice(0, 1)],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("workbench-identity-erased"));
});

test("the migration laws fire through an injected probe without touching the live tree", () => {
  const probe = memorySurfaceProbe(
    new Map([
      ["AGENTS.md", `${BRANDING_LAW}\n`],
      ["README.md", "# Some Other Product\n\nNo workbench provenance."],
    ]),
  );
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        { path: "README.md", scopes: ["product-name-bearing", "workbench-inherited"], components: null },
      ],
    }),
    probe,
  );
  assert.ok(!outcome.ok);
  const kinds = kindsOf(outcome.violations);
  assert.ok(kinds.includes("product-name-absent"));
  assert.ok(kinds.includes("workbench-identity-erased"));
});

test("the lineage laws: genesis shape, parent existence and contiguity", () => {
  const badGenesis = composeProductIdentity(
    aDeclaration({ lineage: { parent: null, sequence: 3 } }),
  );
  assert.ok(!badGenesis.ok);
  assert.ok(kindsOf(badGenesis.violations).includes("lineage-unlawful"));

  const unknownParent = composeProductIdentity(
    aDeclaration({ lineage: { parent: "identity-nonexistent", sequence: 2 } }),
    realSurfaceProbe(),
    [BASE],
  );
  assert.ok(!unknownParent.ok);
  assert.ok(kindsOf(unknownParent.violations).includes("parent-unknown"));

  const skipped = composeProductIdentity(
    aDeclaration({ lineage: { parent: BASE.identityId, sequence: 5 } }),
    realSurfaceProbe(),
    [BASE],
  );
  assert.ok(!skipped.ok);
  assert.ok(kindsOf(skipped.violations).includes("lineage-non-contiguous"));
});

// ---------------------------------------------------------------------------
// The W062 deployment citation (the REAL component vocabulary + gates)
// ---------------------------------------------------------------------------

test("the deployment citation is proven against deploy/plan.ts's REAL vocabulary", () => {
  assert.deepEqual(proveDeploymentComponents([...DEPLOYMENT_COMPONENT_KINDS]), []);
  assert.deepEqual(proveDeploymentComponents(["security-layer"]), []);
});

test("an unknown deployment component is refused against the real vocabulary", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        { path: "deploy/plan.ts", scopes: ["deployment-contract"], components: ["executor" as unknown as "api-service"] },
        ...TRADRL_IDENTITY_SURFACES.slice(0, 1),
      ],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("unknown-deployment-component"));
});

test("a deployment-contract surface without components is refused", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        { path: "deploy/plan.ts", scopes: ["deployment-contract"], components: null },
        ...TRADRL_IDENTITY_SURFACES.slice(0, 1),
      ],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("component-citation-missing"));
});

test("deployment components without the deployment-contract scope are refused", () => {
  const outcome = composeProductIdentity(
    aDeclaration({
      surfaces: [
        {
          path: "README.md",
          scopes: ["product-name-bearing", "workbench-inherited"],
          components: ["security-layer"],
        },
      ],
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("citation-without-scope"));
});

test("W062's own posture law applies verbatim through the real gate", () => {
  // 'api-service' without 'security-layer': the citation is inside the real
  // vocabulary, but W062's own gate refuses the real plan (the security
  // posture is mandatory) — the refusal is W062's, carried verbatim.
  const violations = proveDeploymentComponents(["api-service"]);
  assert.ok(violations.length > 0);
  assert.ok(violations.every((violation) => violation.kind === "deployment-plan-unproven"));
  assert.ok(violations[0]?.detail.includes("security-posture-required"));
});

// ---------------------------------------------------------------------------
// The whole-record re-validation (tamper gates — every rewrite is loud)
// ---------------------------------------------------------------------------

test("a rewritten identity id is refused loudly (id re-derivation)", () => {
  const tampered = { ...BASE, identityId: "identity-deadbeef" };
  const outcome = validateProductIdentity(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("id-mismatch"));
});

test("a rewritten surface citation is refused at re-validation (fail-closed)", () => {
  const tampered = {
    ...BASE,
    surfaces: BASE.surfaces.map((surface) =>
      surface.path === "README.md"
        ? { ...surface, path: "does/not/exist.md" }
        : surface,
    ),
  };
  const outcome = validateProductIdentity(tampered);
  assert.ok(!outcome.ok);
  const kinds = kindsOf(outcome.violations);
  assert.ok(kinds.includes("surface-absent"));
  assert.ok(kinds.includes("id-mismatch"));
});

test("an identity-erasing rewrite of a recorded surface is refused at re-validation", () => {
  const tampered = {
    ...BASE,
    surfaces: BASE.surfaces.map((surface) =>
      surface.path === "README.en.md"
        ? { ...surface, scopes: ["license-notice"] }
        : surface,
    ),
  };
  const outcome = validateProductIdentity(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("id-mismatch"));
});

test("non-canonical carriage is refused (a record IS canonical data)", () => {
  const tampered = {
    ...BASE,
    surfaces: [...BASE.surfaces].reverse(),
  };
  const outcome = validateProductIdentity(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("non-canonical-record"));
});

test("a dishonest provenance record is refused", () => {
  const tampered = {
    ...BASE,
    provenance: { ...BASE.provenance, deriver: "hand-written" },
  };
  const outcome = validateProductIdentity(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("provenance-unlawful"));
});
