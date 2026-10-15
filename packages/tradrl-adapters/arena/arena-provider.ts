/**
 * The Arena capability provider (W057) — the FIRST CONCRETE implementation
 * of W056's provider-neutral `CapabilityProviderPort`.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": this adapter is
 * the Arena's plug in the neutral socket. It serves a recorded arena
 * registration's offers in the registration's canonical offer-id order
 * (deterministic — A9), resolves by exact opaque-id equality (never
 * parsing), and refuses unknown ids with the typed `unknown-offer` error
 * — the same fail-closed laws W056's reference adapter carries, owned
 * here by the concrete adapter.
 *
 * A14: the provider is a DATA surface — no I/O, no clocks, no arena round
 * EXECUTION, no network: the same registration always yields deep-equal
 * answers (A9). The arena-specific vocabulary never leaks through this
 * port — the neutral surface serves the neutral record only.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  CapabilityProviderPort,
  OfferId,
  OfferProvenanceLookup,
  ProviderError,
  ProviderOffer,
  ProviderOfferLookup,
} from "capability-provider";
import type { ArenaProviderRegistration } from "./arena-registration.js";

/** The typed fail-closed refusal for a by-id miss (never a silent undefined). */
function unknownOffer(providerId: string, offerId: OfferId): readonly ProviderError[] {
  return [
    {
      code: "unknown-offer",
      message: `offer '${String(offerId)}' is not offered by provider '${providerId}' — the port resolves exact ids only`,
      providerId,
      offerId: String(offerId),
    },
  ];
}

/**
 * The Arena capability provider: W056's neutral port over the recorded
 * arena registration — deterministic, in-memory, pure. `listOffers` serves
 * the recorded provider offers in canonical offer-id order;
 * `describeOffer` resolves by exact id; `provenanceOf` exposes the
 * measured evidence citations (A6) every claim the offer makes rests on.
 */
export function arenaCapabilityProvider(
  registration: ArenaProviderRegistration,
): CapabilityProviderPort {
  const providerId = String(registration.provider.providerId);
  const offers: readonly ProviderOffer[] = [...registration.provider.offers].sort((left, right) =>
    String(left.offerId) < String(right.offerId) ? -1 : 1,
  );
  const byExactId = (offerId: OfferId): ProviderOffer | undefined =>
    offers.find((candidate) => String(candidate.offerId) === String(offerId));
  return {
    providerId: registration.provider.providerId,
    listOffers: () => offers,
    describeOffer: (offerId: OfferId): ProviderOfferLookup => {
      const offer = byExactId(offerId);
      return offer === undefined ? { ok: false, errors: unknownOffer(providerId, offerId) } : { ok: true, offer };
    },
    provenanceOf: (offerId: OfferId): OfferProvenanceLookup => {
      const offer = byExactId(offerId);
      return offer === undefined
        ? { ok: false, errors: unknownOffer(providerId, offerId) }
        : { ok: true, provenance: offer.provenance };
    },
  };
}
