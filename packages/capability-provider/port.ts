/**
 * The neutral provider port (W056) — the minimal typed surface a CONCRETE
 * capability provider implements.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": providers are a
 * PLUGGABLE class. This port is the ONE provider-neutral surface every
 * concrete provider (a later lane's external capability source) must
 * satisfy: list the offers, describe one offer by exact id, and expose
 * the measured provenance an offer rests on. ZERO concrete-provider
 * specifics live here — they belong to the concrete adapters, in their
 * own packages.
 *
 * A14: the port is a DATA surface — methods return typed records and
 * typed refusals; nothing here executes a provider, and the reference
 * adapter below is a deterministic in-memory value over a recorded
 * registration (the only implementation this package ships).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceCitation } from "capability-registry";
import type { OfferId, ProviderId } from "./identity.js";
import type { ProviderError, ProviderOffer, ProviderRegistration } from "./registration.js";

/** One offer resolved by exact id — typed, never a silent undefined. */
export type ProviderOfferLookup =
  | { readonly ok: true; readonly offer: ProviderOffer }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };

/** One offer's measured provenance resolved by exact id — typed, fail-closed. */
export type OfferProvenanceLookup =
  | { readonly ok: true; readonly provenance: readonly EvidenceCitation[] }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };

/**
 * THE NEUTRAL PORT. The ONLY surface a concrete capability provider
 * implements against this interface: the provider's canonical id, the
 * offer list in canonical offer-id order (deterministic — A9), the
 * by-id offer descriptor lookup, and the provenance accessor (A6: the
 * measured evidence citations every claim the offer makes rests on).
 * Every lookup is fail-closed: an unknown offer id is the typed
 * `unknown-offer` error, never a silent undefined.
 */
export interface CapabilityProviderPort {
  readonly providerId: ProviderId;
  listOffers(): readonly ProviderOffer[];
  describeOffer(offerId: OfferId): ProviderOfferLookup;
  provenanceOf(offerId: OfferId): OfferProvenanceLookup;
}

/**
 * The deterministic in-memory REFERENCE adapter — the only
 * implementation this package ships. It serves a recorded registration's
 * offers in the registration's canonical offer-id order, resolves by
 * exact opaque-id equality (never parsing), and refuses unknown ids with
 * the typed `unknown-offer` error. No I/O, no clocks, no provider
 * execution: the same registration always yields deep-equal answers
 * (A9). Concrete providers (external capability sources) are later
 * lanes' adapters over the port — NOT this package's concern.
 */
export function referenceProviderAdapter(
  registration: ProviderRegistration,
): CapabilityProviderPort {
  const offers = [...registration.offers].sort((left, right) =>
    String(left.offerId) < String(right.offerId) ? -1 : 1,
  );
  return {
    providerId: registration.providerId,
    listOffers: () => offers,
    describeOffer: (offerId: OfferId): ProviderOfferLookup => {
      const offer = offers.find((candidate) => String(candidate.offerId) === String(offerId));
      if (offer === undefined) {
        return {
          ok: false,
          errors: [
            {
              code: "unknown-offer",
              message: `offer '${String(offerId)}' is not offered by provider '${String(registration.providerId)}' — the port resolves exact ids only`,
              providerId: String(registration.providerId),
              offerId: String(offerId),
            },
          ],
        };
      }
      return { ok: true, offer };
    },
    provenanceOf: (offerId: OfferId): OfferProvenanceLookup => {
      const offer = offers.find((candidate) => String(candidate.offerId) === String(offerId));
      if (offer === undefined) {
        return {
          ok: false,
          errors: [
            {
              code: "unknown-offer",
              message: `offer '${String(offerId)}' is not offered by provider '${String(registration.providerId)}' — the port resolves exact ids only`,
              providerId: String(registration.providerId),
              offerId: String(offerId),
            },
          ],
        };
      }
      return { ok: true, provenance: offer.provenance };
    },
  };
}
