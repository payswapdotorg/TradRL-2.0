/**
 * Marketplace listing re-validation (W058) — the whole listing re-proved
 * from its RECORDED data.
 *
 * Identity is a function of content (A9), so the `mkt-<digest>` id is
 * re-derived from the record's own bytes and compared exactly; the terms
 * laws (closed vocabularies) are re-proved; the §14 scope laws (blank
 * members + agreement with the cited registration's scope) are re-proved;
 * the lineage SHAPE laws are re-proved (parent existence needs the other
 * listings — the same disclosure W056 makes for its provider lineage);
 * and the cited registration is re-proven through W056's OWN
 * `validateProviderRegistration` with errors carried VERBATIM (R052
 * rides there — the marketplace never re-scores evidence). With a
 * registry supplied, the W040 lifecycle law is re-proved: every offered
 * capability must resolve LIVE (deprecated/revoked refused loudly).
 *
 * Fail-closed, deterministic, pure: no I/O, no clocks, no execution.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateProviderRegistration } from "capability-provider";
import { resolveCapability } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { listingIdOf, listingInputDigestOf, listingLineageShapeErrors, validateLicensingTerms } from "./listing.js";
import type { Listing, MarketplaceError } from "./listing.js";

export type ListingValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly MarketplaceError[] };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Re-validate ONE recorded marketplace listing against the marketplace
 * record laws. Every violation is a typed error with the law named in
 * the message; all violations are collected, none silently dropped.
 * With `registry` supplied, additionally re-proves the W056 registration
 * agreement AND the W040 liveness law for every offered capability.
 */
export function validateListing(
  listing: Listing,
  registry?: CapabilityRegistry,
): ListingValidationOutcome {
  if (!isRecordLike(listing) || !isRecordLike(listing.registration) || !isRecordLike(listing.scope) || !isRecordLike(listing.provenance)) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the listing is not typed data — an id, a registration, terms, a scope, a lineage, and a provenance are required" }] };
  }
  const errors: MarketplaceError[] = [];
  const label = { listingId: String(listing.listingId) };
  const providerLabel = { ...label, providerId: String(listing.registration.providerId) };

  // -- the terms laws ------------------------------------------------------
  errors.push(...validateLicensingTerms(listing.terms));

  // -- the §14 scope laws --------------------------------------------------
  for (const [field, value] of [
    ["tenantId", listing.scope.tenantId],
    ["projectId", listing.scope.projectId],
    ["worldId", listing.scope.worldId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push({ code: "blank-scope-member", message: `the listing scope's '${field}' is blank — tenant/project/world identity is explicit, never blank`, ...label });
    }
  }
  const carriedScope = listing.registration.scope;
  if (
    !isRecordLike(carriedScope) ||
    String(carriedScope.tenantId) !== String(listing.scope.tenantId) ||
    String(carriedScope.projectId) !== String(listing.scope.projectId) ||
    String(carriedScope.worldId) !== String(listing.scope.worldId)
  ) {
    errors.push({ code: "scope-mismatch", message: `the listing's scope disagrees with the cited registration's scope — the listing carries the registration's §14 scope verbatim, never a re-declaration`, ...providerLabel });
  }

  // -- the lineage shape laws ----------------------------------------------
  errors.push(...listingLineageShapeErrors(listing.lineage, listing.listingId));

  // -- R052 carried: W056's own validator, errors carried VERBATIM ----------
  const reproof = validateProviderRegistration(listing.registration, registry);
  if (!reproof.ok) {
    errors.push({
      code: "provider-registration-invalid",
      message: `the cited registration fails W056's own record laws — the marketplace re-proves the provider registration the way W056 proves its own (errors carried verbatim; R052 rides there, never bypassed)`,
      ...providerLabel,
      providerErrors: reproof.errors,
    });
  }

  // -- the W040 liveness law (only with the caller's CURRENT registry) ------
  if (registry !== undefined && Array.isArray(listing.registration.offers)) {
    for (const offer of listing.registration.offers) {
      const offerLabel = { ...providerLabel, offerId: String(offer.offerId) };
      const lookup = resolveCapability(registry, offer.capabilityId);
      if (!lookup.ok) {
        errors.push({ code: "capability-not-live", message: `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' which does not resolve in the supplied registry — a listing surfaces a LIVE registered capability (fail-closed)`, ...offerLabel });
      } else if (lookup.entry.state === "deprecated") {
        errors.push({ code: "deprecated-capability", message: `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' whose W040 lifecycle state is 'deprecated' — a deprecated capability is refused loudly (the W040 lifecycle, carried)`, ...offerLabel });
      } else if (lookup.entry.state === "revoked") {
        errors.push({ code: "revoked-capability", message: `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' whose W040 lifecycle state is 'revoked' — a revoked capability is terminal and refused loudly (the W040 lifecycle, carried)`, ...offerLabel });
      }
    }
  }

  // -- the identity laws ----------------------------------------------------
  const derivedId = listingIdOf(listing);
  if (String(derivedId) !== String(listing.listingId)) {
    errors.push({ code: "listing-id-mismatch", message: `listing '${String(listing.listingId)}' is not the canonical derivation of its own recorded content — identity is a function of the carried registration + terms + scope + lineage bytes (A9), never an arbitrary label`, ...label });
  }
  const derivedInputDigest = listingInputDigestOf(listing.registration, listing.scope);
  if (
    listing.provenance.deriver !== "list-offer" ||
    listing.provenance.inputDigest !== derivedInputDigest
  ) {
    errors.push({ code: "provenance-mismatch", message: `the provenance of listing '${String(listing.listingId)}' does not re-derive from the record's own citation bytes — provenance is deterministic data (A9)`, ...label });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "structure",
      "terms-laws",
      "scope-laws",
      "lineage-shape",
      "provider-registration",
      "identity",
      "provenance",
      ...(registry === undefined ? [] : ["lifecycle"]),
    ],
  };
}
