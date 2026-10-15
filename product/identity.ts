/**
 * The PRODUCT IDENTITY CONTRACT (W066) — the `ProductIdentity` record, as
 * typed DATA.
 *
 * The migration is IDENTITY, not erasure (AGENTS.md's product-boundary law:
 * "TradRL extends the ZCode workbench rather than replacing it."): the
 * product name becomes TradRL's own, while every ZCode-inherited
 * infrastructure reference that is factually architectural STAYS. This
 * contract makes that law typed data — the closed identity-scope vocabulary,
 * the per-surface identity declarations, the migration laws (what a
 * TradRL-branded surface MUST carry vs what a workbench-inherited surface
 * MUST preserve), the immutable lineage, the deterministic provenance, and
 * the content-addressed `identity-<digest>` id over canonical data (A9 —
 * the declarer's input order never leaks; pinned by twins).
 *
 * The deployment-contract scope CITES the real W062 vocabulary: every cited
 * component is proven against `deploy/plan.ts`'s own
 * `DEPLOYMENT_COMPONENT_KINDS` and a REAL plan composed + re-validated
 * through W062's own gates (`deploy/citations.ts` precedent — imported via
 * relative path, never re-declared here).
 *
 * Laws: AGENTS.md product boundary (the extends-never-replaces law, carried
 * verbatim), A9 (canonicalization), A6 (no invented numbers — every
 * citation names a real repository surface), fail-closed unknown-surface
 * refusal. License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "../packages/trajectory/index.js";
import {
  DEPLOYMENT_COMPONENT_KINDS,
  canonicalComponents as canonicalDeploymentComponents,
} from "../deploy/plan.js";
import type { DeploymentComponentKind } from "../deploy/plan.js";

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

/** The product's own name — the identity being migrated TO (closed: one). */
export const PRODUCT_NAME = "TradRL";

/** The workbench the product extends — the identity preserved (never erased). */
export const WORKBENCH_NAME = "ZCode";

/** The branding law of record, carried VERBATIM from its source surface. */
export const BRANDING_LAW =
  "TradRL extends the ZCode workbench rather than replacing it." as const;

/** The repository surface the branding law is cited from (AGENTS.md's own
 * "Product boundary" section — a real, byte-provable citation). */
export const BRANDING_LAW_SOURCE = "AGENTS.md" as const;

/** The closed identity-scope vocabulary, canonical order. Which surface
 * classes exist in the product identity — nothing outside this set may be
 * declared (fail-closed `unknown-scope`). */
export const IDENTITY_SCOPES = [
  "product-name-bearing",
  "workbench-inherited",
  "license-notice",
  "deployment-contract",
] as const;
export type IdentityScope = (typeof IDENTITY_SCOPES)[number];

/** One migration law: what a surface in this scope MUST carry (the product's
 * own name) and/or MUST preserve (the workbench identity). Fail-closed at
 * the gate; `mustCarry`/`mustPreserve` byte-proofs run against the REAL
 * surface content (`product/citations.ts`). */
export interface IdentityScopeLaw {
  readonly scope: IdentityScope;
  readonly law: string;
  readonly mustCarry: string | null;
  readonly mustPreserve: string | null;
}

/** THE MIGRATION LAWS as data (closed, immutable). */
export const IDENTITY_SCOPE_LAWS: readonly IdentityScopeLaw[] = [
  {
    scope: "product-name-bearing",
    law: "a product-name-bearing surface CARRIES the product's own name — the TradRL identity is visible on every surface that speaks for the product",
    mustCarry: PRODUCT_NAME,
    mustPreserve: null,
  },
  {
    scope: "workbench-inherited",
    law: "a workbench-inherited surface PRESERVES the ZCode workbench identity — the extends-never-replaces law: inherited infrastructure is never re-branded away",
    mustCarry: null,
    mustPreserve: WORKBENCH_NAME,
  },
  {
    scope: "license-notice",
    law: "a license-notice surface is preserved — it exists in the repository and its notice text is never migrated away",
    mustCarry: null,
    mustPreserve: null,
  },
  {
    scope: "deployment-contract",
    law: "a deployment-contract surface is the deployment contract's own cited vocabulary — every declared component is proven against deploy/plan.ts's real DEPLOYMENT_COMPONENT_KINDS and a REAL plan composed + re-validated through W062's own gates",
    mustCarry: null,
    mustPreserve: null,
  },
];

/** The law of a scope, looked up in the closed registry. */
export function identityScopeLawOf(
  scope: IdentityScope,
): IdentityScopeLaw | undefined {
  return IDENTITY_SCOPE_LAWS.find((law) => law.scope === scope);
}

/** The laws every identity provenance record cites. The ROOT law is the
 * branding law itself — the extends-never-replaces law governs the whole
 * vocabulary (proven at the gate, `product/citations.ts`). */
export const IDENTITY_PROVENANCE_LAWS: readonly string[] = [
  BRANDING_LAW,
  `AGENTS.md product boundary — ${PRODUCT_NAME} owns the market-domain surfaces; the ${WORKBENCH_NAME} workbench infrastructure remains generic`,
  "A9 — the identity id is content-addressed over canonical data; the declarer's input order never leaks (twins)",
  "A6 — no invented numbers: every surface citation names a real repository surface (fail-closed unknown-surface refusal)",
];

// ---------------------------------------------------------------------------
// The per-surface identity declarations (typed data, cited + re-proven)
// ---------------------------------------------------------------------------

/** ONE identity-surface declaration: the repository surface (repo-relative
 * path), the identity scopes it declares (from the closed vocabulary), and —
 * for `deployment-contract` surfaces — the W062 component vocabulary the
 * citation names (proven against the real `deploy/plan.ts`). */
export interface IdentitySurfaceDeclaration {
  readonly path: string;
  readonly scopes: readonly IdentityScope[];
  readonly components: readonly DeploymentComponentKind[] | null;
}

// ---------------------------------------------------------------------------
// The lineage + the provenance (immutable, deterministic)
// ---------------------------------------------------------------------------

/** The identity lineage: the parent identity this one supersedes (null at
 * genesis) + the strictly-increasing sequence. Immutable — a rewrite is a
 * different identity (different content-addressed id). */
export interface ProductIdentityLineage {
  readonly parent: string | null;
  readonly sequence: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface ProductIdentityProvenance {
  readonly deriver: "compose-product-identity";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

// ---------------------------------------------------------------------------
// The identity record (immutable, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const productIdentityIdBrand: unique symbol;
/** An OPAQUE content-addressed identity id: `identity-<digest>` over the
 * record's canonical content. Produced only by {@link productIdentityIdOf};
 * never parsed — the name/scopes/surfaces travel explicitly on the record. */
export type ProductIdentityId = string & {
  readonly [productIdentityIdBrand]: true;
};
/** The id prefix (a rendering convention, never a parse target). */
export const PRODUCT_IDENTITY_ID_PREFIX = "identity-";

/** ONE product identity: the product's own name, the branding law of record,
 * the per-surface identity declarations (each cited + re-proven against a
 * REAL repository surface), the immutable lineage, the deterministic
 * provenance. */
export interface ProductIdentity {
  readonly identityId: ProductIdentityId;
  readonly productName: string;
  readonly brandingLaw: string;
  readonly surfaces: readonly IdentitySurfaceDeclaration[];
  readonly lineage: ProductIdentityLineage;
  readonly provenance: ProductIdentityProvenance;
}

/** The composition input (the declarer's declaration — the gate re-proves
 * every citation against the REAL repository surfaces through the probe). */
export interface ProductIdentityInput {
  readonly productName: string;
  readonly brandingLaw: string;
  readonly surfaces: readonly IdentitySurfaceDeclaration[];
  readonly lineage: ProductIdentityLineage;
}

// ---------------------------------------------------------------------------
// Canonicalization (A9 — the declarer's input order never leaks)
// ---------------------------------------------------------------------------

/** Canonical scope order: the closed vocabulary's own order. */
export function canonicalScopes(
  scopes: readonly IdentityScope[],
): readonly IdentityScope[] {
  const present = new Set(scopes.map((scope) => String(scope)));
  return IDENTITY_SCOPES.filter((scope) => present.has(scope));
}

/** Canonical component order: the W062 vocabulary's own order (deploy/plan.ts's
 * own canonicalizer, imported — never re-declared). */
export function canonicalIdentityComponents(
  components: readonly DeploymentComponentKind[],
): readonly DeploymentComponentKind[] {
  return canonicalDeploymentComponents(components);
}

/** Canonical surface order: by path (identity citations are a set keyed by
 * the surface they cite), each surface's scopes + components canonical. */
export function canonicalSurfaces(
  surfaces: readonly IdentitySurfaceDeclaration[],
): readonly IdentitySurfaceDeclaration[] {
  const byPath = new Map<string, IdentitySurfaceDeclaration>();
  for (const surface of surfaces) {
    byPath.set(String(surface.path), surface);
  }
  const ordered: IdentitySurfaceDeclaration[] = [];
  for (const path of [...byPath.keys()].sort()) {
    const surface = byPath.get(path);
    if (surface === undefined) {
      continue;
    }
    ordered.push({
      components:
        surface.components === null
          ? null
          : canonicalIdentityComponents(surface.components),
      path: surface.path,
      scopes: canonicalScopes(surface.scopes),
    });
  }
  return ordered;
}

/** The canonical content an identity id addresses — every declared byte of
 * every surface declaration weighs (the W054/W058 whole-carried-record
 * precedent). The REAL surface bytes are PROVEN at the gate, never weighed:
 * a surface edit that preserves the identity laws does not rewrite the
 * identity (disclosed in product/README.md). */
export function canonicalProductIdentityContent(
  identity: Omit<ProductIdentity, "identityId">,
): Record<string, unknown> {
  return {
    brandingLaw: identity.brandingLaw,
    lineage: [identity.lineage.parent ?? null, identity.lineage.sequence],
    productName: identity.productName,
    surfaces: canonicalSurfaces(identity.surfaces).map((surface) => ({
      components: surface.components === null ? null : [...surface.components],
      path: surface.path,
      scopes: [...surface.scopes],
    })),
  };
}

/** The content-addressed identity id: `identity-<digest>` over the canonical
 * content. Pure and deterministic (A9): the same lawful declaration always
 * mints the same id; the lineage rides BESIDE the id (the W053/W055
 * convention — a continuation of the same content carries the same id with a
 * different lineage). */
export function productIdentityIdOf(
  identity: Omit<ProductIdentity, "identityId">,
): ProductIdentityId {
  const digest = canonicalDigestHex(canonicalProductIdentityContent(identity));
  return `${PRODUCT_IDENTITY_ID_PREFIX}${digest}` as ProductIdentityId;
}

/** The input digest (the provenance member): the declaration in CANONICAL
 * form (A9 — the twin of a re-ordered declaration mints the deep-equal
 * record, inputDigest included). */
export function productIdentityInputDigestOf(
  input: ProductIdentityInput,
): string {
  return canonicalDigestHex({
    brandingLaw: input.brandingLaw,
    lineage: [input.lineage.parent ?? null, input.lineage.sequence],
    productName: input.productName,
    surfaces: canonicalSurfaces(input.surfaces).map((surface) => ({
      components:
        surface.components === null
          ? null
          : canonicalIdentityComponents(surface.components).map(String),
      path: surface.path,
      scopes: canonicalScopes(surface.scopes).map(String),
    })),
  });
}

// ---------------------------------------------------------------------------
// The shipped declaration — the repository's REAL product identity metadata
// ---------------------------------------------------------------------------

/** The repository's real identity surfaces (typed data): the root identity
 * documents (product name + preserved workbench provenance), the engineering
 * contract, the license notices, the workbench-inherited spec surfaces, and
 * the deployment contract's own component vocabulary. Minted into a record
 * through the gate (`product/compose.ts`) with the REAL surface probe. */
export const TRADRL_IDENTITY_SURFACES: readonly IdentitySurfaceDeclaration[] = [
  { path: "AGENTS.md", scopes: ["product-name-bearing"], components: null },
  { path: "LICENSE", scopes: ["license-notice"], components: null },
  {
    path: "NOTICE.md",
    scopes: ["license-notice", "workbench-inherited"],
    components: null,
  },
  {
    path: "README.md",
    scopes: ["product-name-bearing", "workbench-inherited"],
    components: null,
  },
  {
    path: "README.en.md",
    scopes: ["product-name-bearing", "workbench-inherited"],
    components: null,
  },
  {
    path: "deploy/plan.ts",
    scopes: ["deployment-contract"],
    components: [...DEPLOYMENT_COMPONENT_KINDS],
  },
  {
    path: "product/README.md",
    scopes: ["product-name-bearing"],
    components: null,
  },
  {
    path: "spec/ADR-002-ZCODE-WORKBENCH.md",
    scopes: ["workbench-inherited"],
    components: null,
  },
  {
    path: "spec/ZCODE-INTEGRATION-MAP.md",
    scopes: ["workbench-inherited"],
    components: null,
  },
];

/** The shipped product-identity declaration (genesis lineage). */
export function tradrlProductIdentityDeclaration(): ProductIdentityInput {
  return {
    productName: PRODUCT_NAME,
    brandingLaw: BRANDING_LAW,
    surfaces: [...TRADRL_IDENTITY_SURFACES],
    lineage: { parent: null, sequence: 1 },
  };
}
