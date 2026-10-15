/**
 * The marketplace listing (W058) — a provider's measured offers surfaced
 * commercially, as typed DATA. THE LISTING GATE lives here.
 *
 * The chain: W037/W038 measure; W040 registers MEASURED capabilities;
 * W056 registers provider-neutral PROVIDER REGISTRATIONS whose offers
 * carry the measured provenance the W040 gate re-proves. THIS module
 * seals ONE MARKETPLACE LISTING: the cited W056 ProviderRegistration
 * carried VERBATIM (its offers ARE the listing's offers — never
 * re-declared), the licensing terms as data (closed vocabularies declared
 * HERE and only here — the W057 arena-identity precedent), the explicit
 * §14 scope carried from the registration, the immutable listing
 * lineage, the deterministic provenance, the `mkt-<digest>` id.
 *
 * R052 CARRIED, never bypassed: `listOffer` re-proves the registration
 * through W056's OWN `validateProviderRegistration` with the registry
 * supplied — an unmeasured offer surfaces as W056's own
 * `unmeasured-offer` error carried VERBATIM inside
 * `provider-registration-invalid`. The marketplace never re-scores
 * evidence and never lists on a label.
 *
 * The W040 lifecycle law, carried: every offered capability must be LIVE
 * (state "registered") in the supplied registry — a deprecated or
 * revoked capability is refused LOUDLY with the W040 lifecycle named.
 *
 * A9: same registration + terms + lineage + known ⇒ deep-equal listing,
 * same canonical id; no clocks, no randomness, no env reads. A14: the
 * gate COMPOSES typed records — no commerce execution, no payment, no
 * metering. License: Apache-2.0 (the repository LICENSE).
 */

import { validateProviderRegistration } from "capability-provider";
import type { ProviderError, ProviderRegistration, ProviderScope } from "capability-provider";
import { resolveCapability, stableDigest } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";

// ---------------------------------------------------------------------------
// The laws this package carries on every record's provenance
// ---------------------------------------------------------------------------

/** R052 — THE measured-evidence law, carried from the empirical chain. */
export const MEASURED_EVIDENCE_LAW = "spec/REQUIREMENTS.md R052" as const;
/** R055 — providers are a PLUGGABLE class, equal at this surface. */
export const PLUGGABLE_PROVIDER_LAW = "spec/REQUIREMENTS.md R055" as const;
/** §14 — explicit tenant/project/world identity in persistence + transport. */
export const EXPLICIT_SCOPE_LAW = "spec/ARCHITECTURE-LOCK.md §14" as const;
/** The canonical law list carried on every listing's provenance. */
export const MARKETPLACE_PROVENANCE_LAWS: readonly string[] = [
  MEASURED_EVIDENCE_LAW,
  PLUGGABLE_PROVIDER_LAW,
  EXPLICIT_SCOPE_LAW,
  "spec/ARCHITECTURE-LOCK.md A9",
  "spec/ARCHITECTURE-LOCK.md A14",
];

// ---------------------------------------------------------------------------
// The licensing terms (closed vocabularies, declared HERE and only here)
// ---------------------------------------------------------------------------

/** The closed licensing-model vocabulary (how usage is licensed). */
export const LICENSING_MODELS = [
  "subscription",
  "per-use",
  "site-license",
  "revenue-share",
] as const;
export type LicensingModel = (typeof LICENSING_MODELS)[number];

/** The closed billing-period vocabulary (the declared cadence). */
export const BILLING_PERIODS = ["monthly", "quarterly", "annual", "one-time"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** The declared price, as data (never executed, never metered — A14). */
export interface LicensingPrice {
  /** A finite non-negative amount of the declared currency. */
  readonly amount: number;
  /** The currency code (three uppercase letters — a structural law). */
  readonly currency: string;
}

/**
 * The licensing terms as DATA: the model, the billing period, and the
 * declared price. The marketplace validates the closed vocabularies and
 * the structural laws; the COMMERCIAL semantics (charging, proration,
 * metering) are the runtime's job, never this contract's (A14).
 */
export interface LicensingTerms {
  readonly model: LicensingModel;
  readonly billingPeriod: BillingPeriod;
  readonly price: LicensingPrice;
}

// ---------------------------------------------------------------------------
// The listing record (typed DATA)
// ---------------------------------------------------------------------------

declare const listingIdBrand: unique symbol;
/** An OPAQUE marketplace-listing id (a canonical digest rendering). Never parsed. */
export type ListingId = string & { readonly [listingIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const LISTING_ID_PREFIX = "mkt-";

/**
 * The versioned immutable lineage of a listing (the W056 ProviderLineage
 * pattern): genesis listings have no parent and version 1; every
 * successor cites its parent and is exactly parent.version + 1. Immutable
 * means derivation never edits a lineage in place — a successor is a NEW
 * listing.
 */
export interface ListingLineage {
  readonly parentListingId: ListingId | null;
  readonly version: number;
}

/** The declared lineage at listing time (a genesis listing omits it). */
export interface ListingLineageInput {
  readonly parentListingId?: ListingId;
  readonly version?: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface ListingProvenance {
  readonly deriver: "list-offer";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * ONE marketplace listing: the opaque content-addressed id, the cited
 * W056 ProviderRegistration carried VERBATIM (its offers ARE the
 * listing's commercial surface), the licensing terms as data, the
 * explicit §14 scope carried from the registration, the immutable
 * lineage, the deterministic provenance. DATA only — laws live in
 * ./listing.ts (the gate) and ./validate.ts.
 */
export interface Listing {
  readonly listingId: ListingId;
  readonly registration: ProviderRegistration;
  readonly terms: LicensingTerms;
  readonly scope: ProviderScope;
  readonly lineage: ListingLineage;
  readonly provenance: ListingProvenance;
}

/** The listing declaration (the gate's input). */
export interface ListingDeclaration {
  readonly registration: ProviderRegistration;
  readonly terms: LicensingTerms;
  readonly lineage?: ListingLineageInput;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type MarketplaceErrorCode =
  // gate + record laws
  | "malformed-input" // not lawful typed data at the gate
  | "malformed-record" // not lawful typed data at re-validation
  | "invalid-terms" // the closed vocabulary + price laws, loudly
  | "blank-scope-member" // §14 scope is explicit, never blank
  | "scope-mismatch" // the listing's scope ≠ the registration's
  | "provider-registration-invalid" // W056's validator refused — errors carried VERBATIM
  | "deprecated-capability" // the W040 lifecycle, carried: not live
  | "revoked-capability" // the W040 lifecycle, carried: terminal, not live
  | "capability-not-live" // unresolvable in the registry — fail-closed
  | "listing-lineage-break" // missing parent, skipped version, wrong root shape
  | "duplicate-listing" // the same listing id already listed
  // re-validation laws (./validate.ts + the catalogue)
  | "listing-id-mismatch" // the id is not the canonical derivation of its content
  | "provenance-mismatch" // the provenance does not re-derive (A9)
  | "unknown-listing"; // catalogue by-id resolution misses

/** One typed marketplace error (fail-closed; the law named in the message). */
export interface MarketplaceError {
  readonly code: MarketplaceErrorCode;
  readonly message: string;
  readonly listingId?: string;
  readonly providerId?: string;
  readonly offerId?: string;
  /** Present on `provider-registration-invalid`: W056's own errors, verbatim. */
  readonly providerErrors?: readonly ProviderError[];
}

export type ListingOutcome =
  | { readonly ok: true; readonly listing: Listing }
  | { readonly ok: false; readonly errors: readonly MarketplaceError[] };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function error(
  code: MarketplaceErrorCode,
  message: string,
  ids: { listingId?: string; providerId?: string; offerId?: string } = {},
): MarketplaceError {
  return { code, message, ...ids };
}

/** The clean canonical projection of declared terms (no extra members ride). */
function canonicalTerms(terms: LicensingTerms): LicensingTerms {
  return {
    model: terms.model,
    billingPeriod: terms.billingPeriod,
    price: { amount: terms.price.amount, currency: terms.price.currency },
  };
}

/**
 * The licensing-terms laws: the closed model + billing-period
 * vocabularies (loudly enforced — a term outside the table is a typed
 * error, never a silent stringly entry) and the structural price laws.
 */
export function validateLicensingTerms(terms: unknown): readonly MarketplaceError[] {
  if (!isRecordLike(terms) || !isRecordLike(terms.price)) {
    return [error("invalid-terms", "the licensing terms are not typed data — a model, a billing period, and a price are required")];
  }
  const errors: MarketplaceError[] = [];
  if (!LICENSING_MODELS.includes(terms.model as LicensingModel)) {
    errors.push(error("invalid-terms", `the licensing model '${String(terms.model)}' is outside the closed vocabulary — the marketplace licenses through ${LICENSING_MODELS.join(", ")} only`));
  }
  if (!BILLING_PERIODS.includes(terms.billingPeriod as BillingPeriod)) {
    errors.push(error("invalid-terms", `the billing period '${String(terms.billingPeriod)}' is outside the closed vocabulary — listings bill through ${BILLING_PERIODS.join(", ")} only`));
  }
  const amount: unknown = terms.price.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    errors.push(error("invalid-terms", `the declared price amount '${String(amount)}' is not a finite non-negative number — price is declared data, never an invention`));
  }
  const currency: unknown = terms.price.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    errors.push(error("invalid-terms", `the declared price currency '${String(currency)}' is not a three-uppercase-letter currency code — the currency is explicit, never ambiguous`));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Identity (A9 — content-addressed over the whole carried record)
// ---------------------------------------------------------------------------

/**
 * The canonical bytes the listing id addresses: the whole carried
 * registration (the W054 whole-payload precedent — every recorded byte is
 * weighed, so any tamper is an id mismatch), the §14 scope tuple
 * (tenant first), the clean terms, and the immutable lineage.
 */
function listingCanonicalContent(
  registration: ProviderRegistration,
  terms: LicensingTerms,
  scope: ProviderScope,
  lineage: ListingLineage,
): unknown {
  return {
    lineage: {
      parentListingId: lineage.parentListingId === null ? null : String(lineage.parentListingId),
      version: lineage.version,
    },
    registration,
    scope: [scope.tenantId, scope.projectId, scope.worldId],
    terms: canonicalTerms(terms),
  };
}

/**
 * The listing id: `mkt-<digest>` over the canonical record bytes. Pure
 * and deterministic (A9): the same registration + terms + scope + lineage
 * always yield the same id; ANY differing member yields a different one.
 */
export function listingIdOf(
  record: Pick<Listing, "registration" | "terms" | "scope" | "lineage">,
): ListingId {
  return `${LISTING_ID_PREFIX}${stableDigest(
    listingCanonicalContent(record.registration, record.terms, record.scope, record.lineage),
  )}` as ListingId;
}

/** The deterministic provenance input digest (the citation projection). */
export function listingInputDigestOf(
  registration: ProviderRegistration,
  scope: ProviderScope,
): string {
  return stableDigest({
    offers: registration.offers.map((offer) => String(offer.offerId)).sort(),
    provider: String(registration.providerId),
    scope: [scope.tenantId, scope.projectId, scope.worldId],
  });
}

/** The effective recorded lineage of a declared one (genesis by default). */
function resolveLineage(input: ListingLineageInput | undefined): ListingLineage {
  return {
    parentListingId: input?.parentListingId ?? null,
    version: input?.version ?? 1,
  };
}

/** The lineage SHAPE laws (parent existence needs `known` — the gate's). */
export function listingLineageShapeErrors(
  lineage: ListingLineage,
  listingId?: string,
): readonly MarketplaceError[] {
  const errors: MarketplaceError[] = [];
  const label = listingId === undefined ? {} : { listingId: String(listingId) };
  if (!Number.isInteger(lineage.version) || lineage.version < 1) {
    errors.push(error("listing-lineage-break", `listing lineage version ${String(lineage.version)} is not a positive integer — versions start at 1`, label));
  }
  if (lineage.version === 1 && lineage.parentListingId !== null) {
    errors.push(error("listing-lineage-break", "a version-1 listing is genesis: it cannot cite a parent", label));
  }
  if (lineage.version > 1 && (lineage.parentListingId === null || blank(String(lineage.parentListingId)))) {
    errors.push(error("listing-lineage-break", `listing lineage version ${String(lineage.version)} without a parent — only genesis (version 1) is parentless`, label));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE LISTING GATE
// ---------------------------------------------------------------------------

/**
 * THE GATE. The provider registration re-proven through W056's own
 * validator (with the registry supplied — R052 carried verbatim, never
 * bypassed), every offered capability proven LIVE in the registry (the
 * W040 lifecycle carried verbatim — deprecated/revoked refused loudly),
 * the terms validated (closed vocabularies), the lineage laws (shape,
 * parent existence + version continuity against the known listings), the
 * duplicate law — then the Listing sealed with its content-addressed
 * `mkt-<digest>` id. Every violation is a typed error with the law named
 * in the message; all violations are collected, none silently dropped.
 *
 * `known` carries the listings already accepted by the caller (the
 * registry-value-carrying pattern — there is no listing store here).
 */
export function listOffer(
  registry: CapabilityRegistry,
  declaration: ListingDeclaration,
  known: readonly Listing[] = [],
): ListingOutcome {
  if (!isRecordLike(declaration) || !isRecordLike(declaration.registration)) {
    return { ok: false, errors: [error("malformed-input", "the listing declaration is not typed data — a registration and terms are required")] };
  }
  const registration = declaration.registration;
  if (!isRecordLike(registration.scope) || !Array.isArray(registration.offers)) {
    return { ok: false, errors: [error("malformed-input", "the cited registration is not typed data — a scope and an offers array are required")] };
  }

  const errors: MarketplaceError[] = [];
  const providerLabel = { providerId: String(registration.providerId) };

  // -- the terms (closed vocabularies + structural price laws) ----------
  errors.push(...validateLicensingTerms(declaration.terms));

  // -- R052 carried: W056's own validator, errors carried VERBATIM ------
  const reproof = validateProviderRegistration(registration, registry);
  if (!reproof.ok) {
    errors.push({
      code: "provider-registration-invalid",
      message: `the cited registration fails W056's own record laws — the marketplace re-proves the provider registration the way W056 proves its own (errors carried verbatim; R052 rides there, never bypassed)`,
      ...providerLabel,
      providerErrors: reproof.errors,
    });
  }

  // -- the W040 lifecycle law: every offered capability LIVE ------------
  for (const offer of registration.offers) {
    const offerLabel = { ...providerLabel, offerId: String(offer.offerId) };
    const lookup = resolveCapability(registry, offer.capabilityId);
    if (!lookup.ok) {
      errors.push(error("capability-not-live", `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' which does not resolve in the registry — a listing surfaces a LIVE registered capability (fail-closed)`, offerLabel));
    } else if (lookup.entry.state === "deprecated") {
      errors.push(error("deprecated-capability", `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' whose W040 lifecycle state is 'deprecated' — a deprecated capability is refused loudly, never listed (the W040 lifecycle, carried)`, offerLabel));
    } else if (lookup.entry.state === "revoked") {
      errors.push(error("revoked-capability", `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' whose W040 lifecycle state is 'revoked' — a revoked capability is terminal and refused loudly, never listed (the W040 lifecycle, carried)`, offerLabel));
    }
  }

  // -- the lineage laws ---------------------------------------------------
  const lineage = resolveLineage(declaration.lineage);
  errors.push(...listingLineageShapeErrors(lineage));
  const parent = lineage.parentListingId;
  if (parent !== null) {
    const parentListing = known.find((candidate) => String(candidate.listingId) === String(parent));
    if (parentListing === undefined) {
      errors.push(error("listing-lineage-break", `listing lineage parent '${String(parent)}' is not among the known listings — a successor cites a REAL parent`, { listingId: String(parent) }));
    } else if (parentListing.lineage.version !== lineage.version - 1) {
      errors.push(error("listing-lineage-break", `listing lineage version ${String(lineage.version)} must be exactly parent '${String(parent)}'s version (${String(parentListing.lineage.version)}) + 1 — versions are continuous`, { listingId: String(parent) }));
    }
  }

  // -- the identity laws (id re-derivation + duplicates) ------------------
  const scope: ProviderScope = registration.scope;
  const terms = declaration.terms as LicensingTerms;
  const listingId = listingIdOf({ registration, terms, scope, lineage });
  if (known.some((candidate) => String(candidate.listingId) === String(listingId))) {
    errors.push(error("duplicate-listing", `listing '${String(listingId)}' is already listed — listing identity is exact canonical-id identity`, { listingId: String(listingId) }));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const listing: Listing = {
    listingId,
    registration,
    terms: canonicalTerms(terms),
    scope: { tenantId: scope.tenantId, projectId: scope.projectId, worldId: scope.worldId },
    lineage,
    provenance: {
      deriver: "list-offer",
      inputDigest: listingInputDigestOf(registration, scope),
      laws: MARKETPLACE_PROVENANCE_LAWS,
    },
  };
  return { ok: true, listing: Object.freeze(listing) };
}
