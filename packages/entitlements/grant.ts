/**
 * The entitlement grant (W058) — who may use which listed capability,
 * under which terms, for which declared period, as typed DATA. THE GRANT
 * GATE lives here.
 *
 * The chain: W056 registers measured providers; the W058 marketplace
 * LIST their offers commercially under licensing terms. THIS module
 * seals ONE ENTITLEMENT: the cited marketplace Listing (re-proven
 * through the marketplace's OWN validator — errors carried verbatim),
 * the granted offer carried VERBATIM from the listing, the grantee
 * principal scope (tenant explicit — §14), the grant's terms (proven in
 * agreement with the listing's own), the declared period, the immutable
 * versioned lineage, the deterministic provenance, the `ent-<digest>` id.
 *
 * R056 ENFORCED STRUCTURALLY: the TENANT is part of the entitlement's
 * canonical identity — the id is minted over a canonical form whose
 * grantee tuple is [tenantId, principalId] with the TENANT FIRST
 * (identical grants under different tenants are different entitlements),
 * and a cross-tenant USE is the loud typed refusal of ./verify.ts
 * (never a silent denial). The W054 memory precedent, carried.
 *
 * A9: same listing + offer + principal + terms + period + lineage +
 * known ⇒ deep-equal entitlement, same canonical id; no clocks, no
 * randomness, no env reads (time is DECLARED data — the period
 * vocabulary is closed and clock-free). A14: the gate COMPOSES typed
 * records — no commerce execution, no payment, no metering.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateListing, validateLicensingTerms } from "marketplace";
import type { Listing, ListingId, LicensingTerms, MarketplaceError } from "marketplace";
import type { OfferId, ProviderOffer } from "capability-provider";
import { stableDigest } from "capability-registry";

// ---------------------------------------------------------------------------
// The laws this package carries on every record's provenance
// ---------------------------------------------------------------------------

/** R056 — THE tenant-isolation law of the entitlement family. */
export const TENANT_ISOLATION_LAW = "spec/REQUIREMENTS.md R056" as const;
/** §14 — explicit tenant/project/world identity in persistence + transport. */
export const EXPLICIT_SCOPE_LAW = "spec/ARCHITECTURE-LOCK.md §14" as const;
/** The canonical law list carried on every entitlement's provenance. */
export const ENTITLEMENT_PROVENANCE_LAWS: readonly string[] = [
  TENANT_ISOLATION_LAW,
  EXPLICIT_SCOPE_LAW,
  "spec/ARCHITECTURE-LOCK.md A6",
  "spec/ARCHITECTURE-LOCK.md A9",
  "spec/ARCHITECTURE-LOCK.md A14",
];

// ---------------------------------------------------------------------------
// The grantee principal scope (§14 — tenant explicit)
// ---------------------------------------------------------------------------

/**
 * WHO the entitlement is granted to: a principal within an explicit
 * tenant. The tenant is the FIRST member of the canonical grantee tuple
 * (R056 structural — the W054 memory scope-tuple precedent).
 */
export interface EntitlementScope {
  readonly tenantId: string;
  readonly principalId: string;
}

/** The scope members, in canonical order (validation + digest order). */
export const ENTITLEMENT_SCOPE_MEMBERS: readonly (keyof EntitlementScope)[] = [
  "tenantId",
  "principalId",
];

/** The blank scope members (the fail-closed identity gate's offender list). */
export function blankEntitlementScopeMembers(scope: EntitlementScope): readonly (keyof EntitlementScope)[] {
  return ENTITLEMENT_SCOPE_MEMBERS.filter(
    (member) => String(scope[member]).trim().length === 0,
  );
}

// ---------------------------------------------------------------------------
// The declared period (closed vocabulary — A9 has no clocks)
// ---------------------------------------------------------------------------

/** The closed period-kind vocabulary (declared time, never a clock read). */
export const ENTITLEMENT_PERIOD_KINDS = ["fixed-window", "perpetual"] as const;
export type EntitlementPeriodKind = (typeof ENTITLEMENT_PERIOD_KINDS)[number];

/** A fixed declared window: safe non-negative integer ticks, start < end. */
export interface FixedWindowPeriod {
  readonly kind: "fixed-window";
  readonly startAt: number;
  readonly endAt: number;
}

/** A perpetual grant: no declared window, covered at every declared tick. */
export interface PerpetualPeriod {
  readonly kind: "perpetual";
}

export type EntitlementPeriod = FixedWindowPeriod | PerpetualPeriod;

// ---------------------------------------------------------------------------
// The entitlement record (typed DATA)
// ---------------------------------------------------------------------------

declare const entitlementIdBrand: unique symbol;
/** An OPAQUE entitlement id (a canonical digest rendering). Never parsed. */
export type EntitlementId = string & { readonly [entitlementIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const ENTITLEMENT_ID_PREFIX = "ent-";

/**
 * The versioned immutable lineage of an entitlement (the W056
 * ProviderLineage pattern): genesis grants have no parent and version 1;
 * every renewal cites its parent and is exactly parent.version + 1.
 */
export interface EntitlementLineage {
  readonly parentEntitlementId: EntitlementId | null;
  readonly version: number;
}

/** The declared lineage at grant time (a genesis grant omits it). */
export interface EntitlementLineageInput {
  readonly parentEntitlementId?: EntitlementId;
  readonly version?: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface EntitlementProvenance {
  readonly deriver: "grant-entitlement";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * ONE entitlement: the opaque content-addressed id, the cited listing id,
 * the granted offer carried VERBATIM from the listing (A6 — the grant
 * cites the commercial surface it answers), the grantee principal scope,
 * the grant's terms (the listing's own, proven at the gate), the declared
 * period, the immutable lineage, the deterministic provenance. DATA only
 * — laws live in ./grant.ts (the gate) and ./validate.ts; the PURE
 * grant-check lives in ./verify.ts.
 */
export interface Entitlement {
  readonly entitlementId: EntitlementId;
  readonly listingId: ListingId;
  readonly offer: ProviderOffer;
  readonly scope: EntitlementScope;
  readonly terms: LicensingTerms;
  readonly period: EntitlementPeriod;
  readonly lineage: EntitlementLineage;
  readonly provenance: EntitlementProvenance;
}

/** The grant declaration (the gate's input). */
export interface EntitlementGrantInput {
  readonly listing: Listing;
  /** WHICH listed capability the grant covers (exact offer id). */
  readonly offerId: OfferId;
  readonly principal: EntitlementScope;
  readonly terms: LicensingTerms;
  readonly period: EntitlementPeriod;
  readonly lineage?: EntitlementLineageInput;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type EntitlementErrorCode =
  | "malformed-input" // not lawful typed data at the gate
  | "malformed-record" // not lawful typed data at re-validation
  | "listing-invalid" // the marketplace validator refused — errors carried VERBATIM
  | "unknown-offer" // the listing does not surface the cited offer
  | "terms-mismatch" // the grant's terms ≠ the listing's (loud, never silent)
  | "invalid-terms" // the closed vocabulary + price laws, loudly
  | "blank-scope-member" // §14 scope is explicit, never blank
  | "invalid-period" // the closed period vocabulary + window laws
  | "entitlement-lineage-break" // missing parent, skipped version, wrong root shape
  | "duplicate-entitlement" // the same entitlement id already granted
  | "entitlement-id-mismatch" // the id is not the canonical derivation of its content
  | "provenance-mismatch"; // the provenance does not re-derive (A9)

/** One typed entitlement error (fail-closed; the law named in the message). */
export interface EntitlementError {
  readonly code: EntitlementErrorCode;
  readonly message: string;
  readonly entitlementId?: string;
  readonly listingId?: string;
  readonly offerId?: string;
  /** Present on `listing-invalid`: the marketplace's own errors, verbatim. */
  readonly marketplaceErrors?: readonly MarketplaceError[];
}

export type EntitlementOutcome =
  | { readonly ok: true; readonly entitlement: Entitlement }
  | { readonly ok: false; readonly errors: readonly EntitlementError[] };

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
  code: EntitlementErrorCode,
  message: string,
  ids: { entitlementId?: string; listingId?: string; offerId?: string } = {},
): EntitlementError {
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

/** The clean canonical projection of a declared period. */
function canonicalPeriod(period: EntitlementPeriod): EntitlementPeriod {
  return period.kind === "fixed-window"
    ? { kind: period.kind, startAt: period.startAt, endAt: period.endAt }
    : { kind: period.kind };
}

/**
 * The declared-period laws: the closed kind vocabulary (loudly enforced)
 * and the fixed-window laws (safe non-negative integer ticks with a
 * non-empty window — declared data, never a clock read).
 */
export function validateEntitlementPeriod(period: unknown): readonly EntitlementError[] {
  if (!isRecordLike(period) || !ENTITLEMENT_PERIOD_KINDS.includes(period.kind as EntitlementPeriodKind)) {
    return [error("invalid-period", `the declared period kind '${String(isRecordLike(period) ? period.kind : period)}' is outside the closed vocabulary — entitlements are granted for ${ENTITLEMENT_PERIOD_KINDS.join(" or ")} only (declared time, never a clock read)`)];
  }
  if (period.kind === "perpetual") {
    return [];
  }
  const errors: EntitlementError[] = [];
  for (const [field, value] of [
    ["startAt", period.startAt],
    ["endAt", period.endAt],
  ] as const) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      errors.push(error("invalid-period", `the fixed window's '${field}' '${String(value)}' is not a safe non-negative integer tick — declared time is explicit data (A9 has no clocks)`));
    }
  }
  if (
    typeof period.startAt === "number" &&
    typeof period.endAt === "number" &&
    Number.isSafeInteger(period.startAt) &&
    Number.isSafeInteger(period.endAt) &&
    period.startAt >= period.endAt
  ) {
    errors.push(error("invalid-period", `the fixed window [${String(period.startAt)}, ${String(period.endAt)}] is empty — a declared period covers at least one tick`));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Identity (A9 — content-addressed, the TENANT weighed FIRST)
// ---------------------------------------------------------------------------

/**
 * The canonical bytes the entitlement id addresses: the grantee tuple
 * with the TENANT FIRST (R056 structural), the cited listing id, the
 * granted offer carried WHOLE (the W054 whole-payload precedent — every
 * carried byte is weighed, so any tamper is an id mismatch), the terms,
 * the period, and the immutable lineage.
 */
function entitlementCanonicalContent(
  listingId: ListingId,
  offer: ProviderOffer,
  scope: EntitlementScope,
  terms: LicensingTerms,
  period: EntitlementPeriod,
  lineage: EntitlementLineage,
): unknown {
  return {
    grantee: [scope.tenantId, scope.principalId],
    lineage: {
      parentEntitlementId: lineage.parentEntitlementId === null ? null : String(lineage.parentEntitlementId),
      version: lineage.version,
    },
    listing: String(listingId),
    offer,
    period: canonicalPeriod(period),
    terms: canonicalTerms(terms),
  };
}

/**
 * The entitlement id: `ent-<digest>` over the canonical record bytes —
 * the TENANT scope is part of the canonical identity (R056 family,
 * structural). Pure and deterministic (A9): the same grant always yields
 * the same id; ANY differing member — the tenant included — yields a
 * different one.
 */
export function entitlementIdOf(
  record: Pick<Entitlement, "listingId" | "offer" | "scope" | "terms" | "period" | "lineage">,
): EntitlementId {
  return `${ENTITLEMENT_ID_PREFIX}${stableDigest(
    entitlementCanonicalContent(
      record.listingId,
      record.offer,
      record.scope,
      record.terms,
      record.period,
      record.lineage,
    ),
  )}` as EntitlementId;
}

/** The deterministic provenance input digest (the citation projection). */
export function entitlementInputDigestOf(
  listingId: ListingId,
  offerId: OfferId,
  scope: EntitlementScope,
): string {
  return stableDigest({
    grantee: [scope.tenantId, scope.principalId],
    listing: String(listingId),
    offer: String(offerId),
  });
}

/** The effective recorded lineage of a declared one (genesis by default). */
function resolveLineage(input: EntitlementLineageInput | undefined): EntitlementLineage {
  return {
    parentEntitlementId: input?.parentEntitlementId ?? null,
    version: input?.version ?? 1,
  };
}

/** The lineage SHAPE laws (parent existence needs `known` — the gate's). */
export function entitlementLineageShapeErrors(
  lineage: EntitlementLineage,
  entitlementId?: string,
): readonly EntitlementError[] {
  const errors: EntitlementError[] = [];
  const label = entitlementId === undefined ? {} : { entitlementId: String(entitlementId) };
  if (!Number.isInteger(lineage.version) || lineage.version < 1) {
    errors.push(error("entitlement-lineage-break", `entitlement lineage version ${String(lineage.version)} is not a positive integer — versions start at 1`, label));
  }
  if (lineage.version === 1 && lineage.parentEntitlementId !== null) {
    errors.push(error("entitlement-lineage-break", "a version-1 entitlement is genesis: it cannot cite a parent", label));
  }
  if (lineage.version > 1 && (lineage.parentEntitlementId === null || blank(String(lineage.parentEntitlementId)))) {
    errors.push(error("entitlement-lineage-break", `entitlement lineage version ${String(lineage.version)} without a parent — only genesis (version 1) is parentless`, label));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE GRANT GATE
// ---------------------------------------------------------------------------

/**
 * THE GATE. The cited listing re-proven through the marketplace's OWN
 * whole-record validator (errors carried verbatim — R052 rides there,
 * never bypassed); the granted offer resolved from the listing's own
 * recorded offers by EXACT id (fail-closed unknown-offer, the W056 port
 * precedent); the grant's terms validated (the marketplace's own closed
 * vocabularies) and proven in agreement with the listing's own terms (a
 * loud `terms-mismatch` — a grant is UNDER the listing's terms, never
 * beside them); the principal scope typed (tenant explicit, never
 * blank); the period validated (the closed declared-time vocabulary);
 * the lineage laws (shape, parent existence + version continuity against
 * the known entitlements); the duplicate law — then the Entitlement
 * sealed with its content-addressed `ent-<digest>` id weighing the
 * TENANT scope FIRST (R056 structural). Every violation is a typed error
 * with the law named in the message; all violations are collected, none
 * silently dropped.
 *
 * `known` carries the entitlements already accepted by the caller (the
 * registry-value-carrying pattern — there is no entitlement store here).
 */
export function grantEntitlement(
  input: EntitlementGrantInput,
  known: readonly Entitlement[] = [],
): EntitlementOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.listing) || !isRecordLike(input.principal) || !isRecordLike(input.period)) {
    return { ok: false, errors: [error("malformed-input", "the grant declaration is not typed data — a listing, an offer id, a principal, terms, and a period are required")] };
  }

  const errors: EntitlementError[] = [];
  const listingLabel = { listingId: String(input.listing.listingId) };

  // -- the listing re-proven through the marketplace's OWN validator ----
  const listingProof = validateListing(input.listing);
  if (!listingProof.ok) {
    errors.push({
      code: "listing-invalid",
      message: `the cited listing fails the marketplace's own record laws — the entitlement re-proves the listing the way the marketplace proves its own (errors carried verbatim; R052 rides there, never bypassed)`,
      ...listingLabel,
      marketplaceErrors: listingProof.errors,
    });
  }

  // -- the granted offer: exact-id resolution, fail-closed ----------------
  const offer = input.listing.registration.offers.find(
    (candidate) => String(candidate.offerId) === String(input.offerId),
  );
  if (offer === undefined) {
    errors.push(error("unknown-offer", `offer '${String(input.offerId)}' is not surfaced by listing '${String(input.listing.listingId)}' — an entitlement grants one of the listing's OWN recorded offers (exact id)`, { ...listingLabel, offerId: String(input.offerId) }));
  }

  // -- the terms: closed vocabularies + agreement with the listing's ------
  const termsViolations = validateLicensingTerms(input.terms);
  errors.push(...termsViolations.map((violation) =>
    error("invalid-terms", violation.message, listingLabel),
  ));
  const terms = input.terms as LicensingTerms;
  if (
    termsViolations.length === 0 &&
    isRecordLike(input.listing.terms) &&
    stableDigest(input.listing.terms) !== stableDigest(canonicalTerms(terms))
  ) {
    errors.push(error("terms-mismatch", `the grant's terms disagree with the listing's own terms — an entitlement is granted UNDER the listing's terms (model/billing/price carried verbatim), never beside them`, listingLabel));
  }

  // -- the principal scope (§14 — tenant explicit) -------------------------
  for (const member of blankEntitlementScopeMembers(input.principal)) {
    errors.push(error("blank-scope-member", `the grantee scope's '${member}' is blank — tenant/principal identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank`, listingLabel));
  }

  // -- the declared period (closed vocabulary, no clocks) ------------------
  errors.push(...validateEntitlementPeriod(input.period));

  // -- the lineage laws ------------------------------------------------------
  const lineage = resolveLineage(input.lineage);
  errors.push(...entitlementLineageShapeErrors(lineage));
  const parent = lineage.parentEntitlementId;
  if (parent !== null) {
    const parentEntitlement = known.find(
      (candidate) => String(candidate.entitlementId) === String(parent),
    );
    if (parentEntitlement === undefined) {
      errors.push(error("entitlement-lineage-break", `entitlement lineage parent '${String(parent)}' is not among the known entitlements — a renewal cites a REAL parent`, { entitlementId: String(parent) }));
    } else if (parentEntitlement.lineage.version !== lineage.version - 1) {
      errors.push(error("entitlement-lineage-break", `entitlement lineage version ${String(lineage.version)} must be exactly parent '${String(parent)}'s version (${String(parentEntitlement.lineage.version)}) + 1 — versions are continuous`, { entitlementId: String(parent) }));
    }
  }

  // -- the identity laws (id re-derivation + duplicates) --------------------
  // The id is derived only over structurally sound input (fail-closed):
  // every structural violation above is already collected and named.
  if (errors.length > 0 || offer === undefined) {
    return { ok: false, errors };
  }
  const scope = input.principal;
  const period = input.period as EntitlementPeriod;
  const entitlementId = entitlementIdOf({
    listingId: input.listing.listingId,
    offer,
    scope,
    terms,
    period,
    lineage,
  });
  if (known.some((candidate) => String(candidate.entitlementId) === String(entitlementId))) {
    return {
      ok: false,
      errors: [
        error("duplicate-entitlement", `entitlement '${String(entitlementId)}' is already granted — entitlement identity is exact canonical-id identity`, { entitlementId: String(entitlementId) }),
      ],
    };
  }

  const entitlement: Entitlement = {
    entitlementId,
    listingId: input.listing.listingId,
    offer,
    scope: { tenantId: scope.tenantId, principalId: scope.principalId },
    terms: canonicalTerms(terms),
    period: canonicalPeriod(period),
    lineage,
    provenance: {
      deriver: "grant-entitlement",
      inputDigest: entitlementInputDigestOf(input.listing.listingId, offer.offerId, scope),
      laws: ENTITLEMENT_PROVENANCE_LAWS,
    },
  };
  return { ok: true, entitlement: Object.freeze(entitlement) };
}
