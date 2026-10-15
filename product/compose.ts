/**
 * `composeProductIdentity` — THE PRODUCT IDENTITY GATE (W066).
 *
 * Fail-closed, ALL violations collected (never short-circuit — the W004
 * `validateEventStream` discipline):
 * 1. lawful typed input + the product's own name (the closed one-member
 *    vocabulary — the product identity is TradRL's own, declared, never
 *    free text);
 * 2. the branding-law citation proven (the extends-never-replaces law,
 *    carried verbatim from AGENTS.md, agreeing with the identity-scope
 *    vocabulary's own laws — `product/citations.ts`);
 * 3. the per-surface declarations: the closed scope vocabulary, no
 *    duplicate surfaces, at least one product-name-bearing surface (a
 *    product identity whose name appears nowhere is meaningless), and every
 *    declaration PROVEN against the REAL repository surface through the
 *    probe (fail-closed unknown-surface refusal + the migration laws as
 *    byte-proofs + the W062 deployment citation);
 * 4. the lineage laws (genesis shape, contiguity, parent existence when the
 *    caller supplies the live `known` set);
 * 5. the seal: everything carried in canonical order (A9 — the declarer's
 *    input order never leaks), the content-addressed `identity-<digest>` id,
 *    and the deterministic provenance.
 *
 * The probe is injected with the REAL repository probe as its default (the
 * W056/W058 caller-supplied-registry disclosure: a repository surface IS a
 * filesystem fact); the proofs never feed the id. License: Apache-2.0 (the
 * repository LICENSE).
 */

import {
  IDENTITY_PROVENANCE_LAWS,
  PRODUCT_NAME,
  canonicalSurfaces,
  productIdentityInputDigestOf,
  productIdentityIdOf,
  type ProductIdentity,
  type ProductIdentityId,
  type ProductIdentityInput,
} from "./identity.js";
import {
  proveBrandingLaw,
  proveSurfaceDeclaration,
  realSurfaceProbe,
  type IdentityViolation,
  type SurfaceProbe,
} from "./citations.js";

/** The gate's outcome: the sealed identity record, or every law violated. */
export type ProductIdentityOutcome =
  | { readonly ok: true; readonly identity: ProductIdentity }
  | { readonly ok: false; readonly violations: readonly IdentityViolation[] };

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The lineage laws (shared with the re-validator through this export). */
export function lineageViolations(
  lineage: unknown,
  known: readonly ProductIdentity[] | undefined,
): readonly IdentityViolation[] {
  const violations: IdentityViolation[] = [];
  if (!isRecordLike(lineage)) {
    return [
      {
        kind: "lineage-unlawful",
        detail:
          "the lineage is not typed data — a parent identity id (or null at genesis) and a sequence are required",
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
      detail: `the lineage sequence '${String(sequence)}' is not a safe positive integer — identity generations are explicit declared data (A9 has no clocks)`,
    });
  }
  if (parent !== null && (typeof parent !== "string" || parent.length === 0)) {
    violations.push({
      kind: "lineage-unlawful",
      detail:
        "the lineage parent is neither an identity id nor null — the superseded generation is explicit, never blank",
    });
  }
  if (parent === null && sequence !== 1) {
    violations.push({
      kind: "lineage-unlawful",
      detail: `a genesis identity (no parent) carries sequence 1, not '${String(sequence)}' — the lineage is contiguous from genesis`,
    });
  }
  if (parent !== null && typeof sequence === "number" && sequence < 2) {
    violations.push({
      kind: "lineage-unlawful",
      detail: `a continuation (parent present) carries sequence ≥ 2, not '${String(sequence)}' — the lineage is contiguous`,
    });
  }
  if (parent !== null && typeof parent === "string" && known !== undefined) {
    const parentIdentity = known.find(
      (identity) => String(identity.identityId) === parent,
    );
    if (parentIdentity === undefined) {
      violations.push({
        kind: "parent-unknown",
        detail: `the parent identity '${parent}' is not in the supplied known set — a lineage continuation is proven against the parent record, never assumed`,
      });
    } else if (parentIdentity.lineage.sequence + 1 !== sequence) {
      violations.push({
        kind: "lineage-non-contiguous",
        detail: `the sequence '${String(sequence)}' does not succeed the parent's '${String(parentIdentity.lineage.sequence)}' — the lineage is contiguous, a skipped generation is a loud violation`,
      });
    }
  }
  return violations;
}

/**
 * Compose ONE product identity — THE GATE. The declarer declares the
 * product name, the branding law, and the per-surface identity declarations;
 * the gate re-proves every citation against the REAL repository surfaces
 * through the probe, canonicalizes (A9), and seals the content-addressed
 * id. `known` (when supplied) is the live lineage the parent-existence +
 * contiguity laws are proven against.
 */
export function composeProductIdentity(
  input: ProductIdentityInput,
  probe: SurfaceProbe = realSurfaceProbe(),
  known?: readonly ProductIdentity[],
): ProductIdentityOutcome {
  if (!isRecordLike(input) || !Array.isArray(input.surfaces)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail:
            "the declaration is not typed data — a product name, a branding law, identity surface declarations, and a lineage are required",
        },
      ],
    };
  }
  const violations: IdentityViolation[] = [];
  if (input.productName !== PRODUCT_NAME) {
    violations.push({
      kind: "unknown-product-name",
      detail: `the product name '${String(input.productName)}' is not the product's own — the identity being migrated TO is '${PRODUCT_NAME}' (a closed one-member vocabulary, never free text)`,
    });
  }
  violations.push(...proveBrandingLaw(input.brandingLaw, probe));
  if (input.surfaces.length === 0) {
    violations.push({
      kind: "malformed-input",
      detail:
        "the declaration carries no identity surfaces — a product identity declares the surfaces that carry it, never none",
    });
  }
  const seen = new Set<string>();
  for (const surface of input.surfaces) {
    if (isRecordLike(surface) && typeof surface.path === "string") {
      if (seen.has(surface.path)) {
        violations.push({
          kind: "duplicate-surface",
          detail: `the surface '${surface.path}' is declared twice — identity surface declarations are a set, never a list`,
        });
      }
      seen.add(surface.path);
    }
    violations.push(...proveSurfaceDeclaration(surface, probe));
  }
  if (
    !input.surfaces.some(
      (surface) =>
        Array.isArray(surface.scopes) &&
        (surface.scopes as readonly string[]).includes("product-name-bearing"),
    )
  ) {
    violations.push({
      kind: "name-surface-required",
      detail: `no declared surface carries the product-name-bearing scope — a product identity declares at least one surface that carries the product's own name '${PRODUCT_NAME}'`,
    });
  }
  violations.push(...lineageViolations(input.lineage, known));
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const scoped = input as ProductIdentityInput;
  const content: Omit<ProductIdentity, "identityId"> = {
    productName: scoped.productName,
    brandingLaw: scoped.brandingLaw,
    surfaces: canonicalSurfaces(scoped.surfaces),
    lineage: {
      parent: scoped.lineage.parent,
      sequence: scoped.lineage.sequence,
    },
    provenance: {
      deriver: "compose-product-identity",
      inputDigest: productIdentityInputDigestOf(scoped),
      laws: IDENTITY_PROVENANCE_LAWS,
    },
  };
  const identityId: ProductIdentityId = productIdentityIdOf(content);
  return {
    ok: true,
    identity: Object.freeze({ ...content, identityId }),
  };
}
