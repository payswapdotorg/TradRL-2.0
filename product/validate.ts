/**
 * `validateProductIdentity` — whole-record RE-VALIDATION of a product
 * identity from its RECORDED data alone (W066).
 *
 * Every law re-proven against the record's own bytes: the product's own
 * name, the branding-law citation RE-proven against the identity-scope
 * vocabulary's own laws AND the REAL AGENTS.md bytes, every surface
 * declaration RE-proven against the REAL repository surface through the
 * probe (fail-closed unknown-surface refusal + the migration laws +
 * the W062 deployment citation), the lineage laws, the canonical carriage
 * (a record IS canonical data — non-canonical carriage is a rewrite), the
 * id RE-DERIVED from the record's own content, and the deterministic
 * provenance re-derived. A tampered identity record is refused loudly,
 * naming the exact break — never silently repaired.
 *
 * The probe defaults to the REAL repository probe (a repository surface IS
 * a filesystem fact); the proofs never feed the id. License: Apache-2.0
 * (the repository LICENSE).
 */

import {
  IDENTITY_PROVENANCE_LAWS,
  PRODUCT_NAME,
  canonicalSurfaces,
  productIdentityInputDigestOf,
  productIdentityIdOf,
  type IdentitySurfaceDeclaration,
  type ProductIdentity,
} from "./identity.js";
import {
  proveBrandingLaw,
  proveSurfaceDeclaration,
  realSurfaceProbe,
  type IdentityViolation,
  type SurfaceProbe,
} from "./citations.js";
import { lineageViolations } from "./compose.js";

/** The whole-record re-validation outcome. */
export type ProductIdentityValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly IdentityViolation[] };

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const rendered = (
  surfaces: readonly IdentitySurfaceDeclaration[],
): string =>
  JSON.stringify(
    surfaces.map((surface) => ({
      components:
        surface.components === null || surface.components === undefined
          ? null
          : [...surface.components],
      path: surface.path,
      scopes: [...surface.scopes],
    })),
  );

/**
 * Re-validate one product identity end-to-end from its recorded data alone.
 * `known` (when supplied) is the live lineage the parent laws are proven
 * against — the re-validator never invents a parent record.
 */
export function validateProductIdentity(
  record: unknown,
  probe: SurfaceProbe = realSurfaceProbe(),
  known?: readonly ProductIdentity[],
): ProductIdentityValidation {
  if (!isRecordLike(record) || !Array.isArray(record.surfaces)) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-input",
          detail:
            "the record is not typed data — a recorded product identity carries its name, branding law, surfaces, lineage and provenance",
        },
      ],
    };
  }
  const violations: IdentityViolation[] = [];
  const identity = record as unknown as ProductIdentity;
  if (identity.productName !== PRODUCT_NAME) {
    violations.push({
      kind: "unknown-product-name",
      detail: `the recorded product name '${String(identity.productName)}' is not the product's own '${PRODUCT_NAME}' — the identity is TradRL's own, never renamed in flight`,
    });
  }
  violations.push(...proveBrandingLaw(identity.brandingLaw, probe));
  const recordedSurfaces = identity.surfaces;
  if (recordedSurfaces.length === 0) {
    violations.push({
      kind: "malformed-input",
      detail:
        "the record carries no identity surfaces — a product identity declares the surfaces that carry it, never none",
    });
  }
  const seen = new Set<string>();
  for (const surface of recordedSurfaces) {
    if (isRecordLike(surface) && typeof surface.path === "string") {
      if (seen.has(surface.path)) {
        violations.push({
          kind: "duplicate-surface",
          detail: `the surface '${surface.path}' is recorded twice — identity surface declarations are a set`,
        });
      }
      seen.add(surface.path);
    }
    violations.push(...proveSurfaceDeclaration(surface, probe));
  }
  if (
    !recordedSurfaces.some(
      (surface) =>
        Array.isArray(surface.scopes) &&
        (surface.scopes as readonly string[]).includes("product-name-bearing"),
    )
  ) {
    violations.push({
      kind: "name-surface-required",
      detail: `no recorded surface carries the product-name-bearing scope — a product identity declares at least one surface that carries the product's own name '${PRODUCT_NAME}'`,
    });
  }
  violations.push(...lineageViolations(identity.lineage, known));
  // The canonical-carriage law (a recorded identity IS canonical data):
  // surfaces sorted by path, scopes + components in the closed
  // vocabularies' own canonical order (A9 — input order never leaks).
  if (rendered(canonicalSurfaces(recordedSurfaces)) !== rendered(recordedSurfaces)) {
    violations.push({
      kind: "non-canonical-record",
      detail:
        "the recorded surfaces are not in canonical form (sorted by path; scopes + components in the closed vocabularies' own order) — input order never leaks into a record (A9)",
    });
  }
  // The id re-derivation (the whole-record re-proof).
  const { identityId: _identityId, ...content } = identity;
  const derivedId = productIdentityIdOf(content);
  if (String(identity.identityId) !== String(derivedId)) {
    violations.push({
      kind: "id-mismatch",
      detail: `the recorded identity id '${String(identity.identityId)}' does not re-derive from its own content '${String(derivedId)}' — a rewritten identity record is a loud violation, never a silent pass`,
    });
  }
  // The deterministic provenance re-derivation.
  const provenance = identity.provenance;
  if (!isRecordLike(provenance)) {
    violations.push({
      kind: "provenance-unlawful",
      detail:
        "the record carries no provenance record — deterministic provenance travels with every sealed record",
    });
  } else {
    if (provenance.deriver !== "compose-product-identity") {
      violations.push({
        kind: "provenance-unlawful",
        detail: `the provenance deriver '${String(provenance.deriver)}' is not the identity gate — records name their deriver honestly`,
      });
    }
    if (
      JSON.stringify(provenance.laws) !== JSON.stringify(IDENTITY_PROVENANCE_LAWS)
    ) {
      violations.push({
        kind: "provenance-unlawful",
        detail:
          "the provenance law list does not match the identity contract's own — the laws are carried verbatim, never edited",
      });
    }
    const expectedInputDigest = productIdentityInputDigestOf({
      productName: identity.productName,
      brandingLaw: identity.brandingLaw,
      surfaces: recordedSurfaces,
      lineage: identity.lineage,
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
