/**
 * The marketplace catalogue (W058) — the typed catalogue surface:
 * deterministic queries over listings (canonical order, carried data).
 *
 * A9: `assembleCatalogue` is pure — it re-validates every listing through
 * the marketplace's own whole-record validator (errors carried verbatim),
 * refuses duplicate listing ids, and returns the listings in CANONICAL
 * listing-id order (input order never leaks into the catalogue value).
 * Every query is a deterministic filter over that canonical order and
 * answers with the CARRIED listing records — never a re-scored
 * statistic, never a projection that edits data (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateListing } from "./validate.js";
import type { Listing, ListingId, MarketplaceError } from "./listing.js";
import type { OfferId, ProviderId, ProviderScope } from "capability-provider";

/** The catalogue: the listings in CANONICAL listing-id order (A9). */
export interface MarketplaceCatalogue {
  readonly listings: readonly Listing[];
}

export type CatalogueOutcome =
  | { readonly ok: true; readonly catalogue: MarketplaceCatalogue }
  | { readonly ok: false; readonly errors: readonly MarketplaceError[] };

function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Assemble the catalogue from carried listings. Every listing is
 * re-validated whole-record (no registry — the liveness law needs the
 * caller's CURRENT registry and is re-proved by
 * `validateListing(listing, registry)` at the seams that have one);
 * duplicate listing ids are refused (exact canonical-id identity); the
 * value is the listings in canonical listing-id order regardless of the
 * input order (A9).
 */
export function assembleCatalogue(listings: readonly Listing[]): CatalogueOutcome {
  if (!Array.isArray(listings)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the catalogue input is not a listing array — the catalogue assembles carried listings" }] };
  }
  const errors: MarketplaceError[] = [];
  const seen = new Set<string>();
  listings.forEach((listing) => {
    const label = { listingId: String(listing?.listingId) };
    const validation = validateListing(listing);
    if (!validation.ok) {
      errors.push({
        code: "listing-id-mismatch",
        message: `listing '${String(listing?.listingId)}' fails the marketplace record laws — the catalogue assembles only re-proven listings (errors carried verbatim)`,
        ...label,
      });
      return;
    }
    if (seen.has(String(listing.listingId))) {
      errors.push({
        code: "duplicate-listing",
        message: `listing '${String(listing.listingId)}' is assembled twice — listing identity is exact canonical-id identity`,
        ...label,
      });
      return;
    }
    seen.add(String(listing.listingId));
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const ordered = [...listings].sort((left, right) =>
    byString(String(left.listingId), String(right.listingId)),
  );
  return { ok: true, catalogue: { listings: ordered } };
}

/** Every listing surfacing the given provider's registration (canonical order). */
export function listingsByProvider(
  catalogue: MarketplaceCatalogue,
  providerId: ProviderId,
): readonly Listing[] {
  return catalogue.listings.filter(
    (listing) => String(listing.registration.providerId) === String(providerId),
  );
}

/** Every listing surfacing the given offer (canonical order, carried data). */
export function listingsByOffer(
  catalogue: MarketplaceCatalogue,
  offerId: OfferId,
): readonly Listing[] {
  return catalogue.listings.filter((listing) =>
    listing.registration.offers.some((offer) => String(offer.offerId) === String(offerId)),
  );
}

/** Every listing measured in the given §14 scope (field equality, never parsed). */
export function listingsByScope(
  catalogue: MarketplaceCatalogue,
  scope: ProviderScope,
): readonly Listing[] {
  return catalogue.listings.filter(
    (listing) =>
      listing.scope.tenantId === scope.tenantId &&
      listing.scope.projectId === scope.projectId &&
      listing.scope.worldId === scope.worldId,
  );
}

/** The fail-closed by-id resolution (unknown ids are loud, never undefined). */
export function resolveListing(
  catalogue: MarketplaceCatalogue,
  listingId: ListingId,
): { readonly ok: true; readonly listing: Listing } | { readonly ok: false; readonly errors: readonly MarketplaceError[] } {
  const listing = catalogue.listings.find(
    (candidate) => String(candidate.listingId) === String(listingId),
  );
  if (listing === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown-listing",
          message: `listing '${String(listingId)}' is not in the catalogue — the catalogue resolves exact ids only`,
          listingId: String(listingId),
        },
      ],
    };
  }
  return { ok: true, listing };
}
