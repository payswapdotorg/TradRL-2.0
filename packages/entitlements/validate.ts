/**
 * Entitlement re-validation (W058) — the whole entitlement re-proved
 * from its RECORDED data.
 *
 * Identity is a function of content (A9), so the `ent-<digest>` id is
 * re-derived from the record's own bytes (the grantee tuple with the
 * TENANT FIRST — R056 structural) and compared exactly; the terms laws
 * are re-proved through the marketplace's OWN `validateLicensingTerms`
 * (mapped, messages carried verbatim); the period laws (closed
 * vocabulary + window laws) are re-proved; the §14 grantee scope laws
 * and the lineage SHAPE laws are re-proved (parent existence needs the
 * other entitlements — the same disclosure W056 makes for its provider
 * lineage and the marketplace makes for its listing lineage); and the
 * provenance input digest is re-derived. The carried offer's own bytes
 * are weighed by the id (the W054 whole-payload precedent), so any
 * tamper is an `entitlement-id-mismatch`; its DEEP validity was proven
 * at the gate through the cited listing (A14 division of labor).
 *
 * Fail-closed, deterministic, pure. License: Apache-2.0 (the repository
 * LICENSE).
 */

import { validateLicensingTerms } from "marketplace";
import {
  blankEntitlementScopeMembers,
  entitlementIdOf,
  entitlementInputDigestOf,
  entitlementLineageShapeErrors,
  validateEntitlementPeriod,
} from "./grant.js";
import type { Entitlement, EntitlementError } from "./grant.js";
import { EXPLICIT_SCOPE_LAW } from "./grant.js";

export type EntitlementValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly EntitlementError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Re-validate ONE recorded entitlement against the entitlement record
 * laws. Every violation is a typed error with the law named in the
 * message; all violations are collected, none silently dropped.
 */
export function validateEntitlement(
  entitlement: Entitlement,
): EntitlementValidationOutcome {
  if (
    !isRecordLike(entitlement) ||
    !isRecordLike(entitlement.scope) ||
    !isRecordLike(entitlement.period) ||
    !isRecordLike(entitlement.provenance) ||
    !isRecordLike(entitlement.lineage)
  ) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the entitlement is not typed data — an id, a listing id, an offer, a scope, terms, a period, a lineage, and a provenance are required" }] };
  }
  const errors: EntitlementError[] = [];
  const label = { entitlementId: String(entitlement.entitlementId) };

  // -- the §14 grantee scope laws -------------------------------------------
  for (const member of blankEntitlementScopeMembers(entitlement.scope)) {
    errors.push({
      code: "blank-scope-member",
      message: `the grantee scope's '${member}' is blank — tenant/principal identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank`,
      ...label,
    });
  }

  // -- the terms laws (the marketplace's own validator, mapped) -------------
  errors.push(
    ...validateLicensingTerms(entitlement.terms).map((violation) => ({
      code: "invalid-terms" as const,
      message: violation.message,
      ...label,
    })),
  );

  // -- the declared-period laws ----------------------------------------------
  errors.push(...validateEntitlementPeriod(entitlement.period));

  // -- the lineage shape laws ------------------------------------------------
  errors.push(...entitlementLineageShapeErrors(entitlement.lineage, entitlement.entitlementId));

  // -- the identity laws -------------------------------------------------------
  const derivedId = entitlementIdOf(entitlement);
  if (String(derivedId) !== String(entitlement.entitlementId)) {
    errors.push({
      code: "entitlement-id-mismatch",
      message: `entitlement '${String(entitlement.entitlementId)}' is not the canonical derivation of its own recorded content — identity is a function of the grantee (tenant FIRST) + listing + offer + terms + period + lineage bytes (A9), never an arbitrary label`,
      ...label,
    });
  }

  // -- the provenance law -------------------------------------------------------
  const derivedInputDigest = entitlementInputDigestOf(
    entitlement.listingId,
    entitlement.offer.offerId,
    entitlement.scope,
  );
  if (
    entitlement.provenance.deriver !== "grant-entitlement" ||
    entitlement.provenance.inputDigest !== derivedInputDigest
  ) {
    errors.push({
      code: "provenance-mismatch",
      message: `the provenance of entitlement '${String(entitlement.entitlementId)}' does not re-derive from the record's own citation bytes — provenance is deterministic data (A9)`,
      ...label,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "structure",
      "scope-laws",
      "terms-laws",
      "period-laws",
      "lineage-shape",
      "identity",
      "provenance",
    ],
  };
}
