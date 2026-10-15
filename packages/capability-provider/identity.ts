/**
 * Capability-provider identity (W056) — the deterministic canonical identity
 * and the opaque id family for the provider-neutral capability-provider
 * interface.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL" —
 * carried forward: a provider's identity is content-addressed over its
 * DECLARED data PLUS each offer's measured provenance citations (the
 * W037/W038 canonical ids, digested through the W040 canonical
 * registration projection) and the skills it endows: same declarations +
 * same citations ⇒ same id (A9), any differing byte ⇒ a different id. A
 * provider whose offers carry no measurements has no identity here because
 * the gate refuses it before an id can mean anything.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": providers are a
 * PLUGGABLE class. This identity is provider-NEUTRAL — it weighs only the
 * neutral vocabulary (display identity, scope, offers, lineage), never any
 * concrete provider's specifics.
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed), tenant/project/world scope is explicit, composite ids use
 * canonical encoders, and lineage is immutable.
 *
 * The hashing family is the repo's W004/W016 discipline carried through
 * the W040 `capability-registry` seams (`canonicalCapabilityRegistration`,
 * `stableDigest`) — byte-compatible with the family, never re-implemented.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  canonicalCapabilityRegistration,
  stableDigest,
} from "capability-registry";
import type { CapabilityCanonicalInput, CapabilityScope } from "capability-registry";
import type { CapabilityDemandQuery } from "capability-registry";

/** The opaque-id brand (the DOMAIN-MODEL identity law: never parsed). */
export type OpaqueId<Brand extends string> = string & {
  readonly __brand: Brand;
};

/** The identity of one registered provider (opaque; digest-derived). */
export type ProviderId = OpaqueId<"ProviderId">;

/** The id prefix (a rendering convention, never a parse target). */
export const PROVIDER_ID_PREFIX = "provider-";

/** The identity of one provider offer (opaque; digest-derived). */
export type OfferId = OpaqueId<"OfferId">;

/** The id prefix (a rendering convention, never a parse target). */
export const OFFER_ID_PREFIX = "offer-";

/** The identity of one demand adjudication (opaque; digest-derived). */
export type AdjudicationId = OpaqueId<"AdjudicationId">;

/** The id prefix (a rendering convention, never a parse target). */
export const ADJUDICATION_ID_PREFIX = "adjudication-";

/**
 * The explicit scope of a provider: the tenant/project/world triple its
 * offers are measured in. Structurally the W040 `CapabilityScope` — the
 * provider registers THROUGH the registry, so the scopes agree by field
 * equality, never by parsing.
 */
export type ProviderScope = CapabilityScope;

/**
 * The canonical input of ONE offer's identity: EVERYTHING the offer id
 * weighs. The capability-shaped members (kind/domain/bearer/scope/
 * provides/lineage/provenance) are EXACTLY the W040 canonical
 * registration projection — the offer identity is the measured capability
 * identity in the offer namespace — plus the endowment skill ids (an
 * offer that endows skills is a DIFFERENT offer from one that does not).
 */
export interface OfferCanonicalInput extends CapabilityCanonicalInput {
  /** The endowed skills' canonical ids (sorted; the W041 identity, cited). */
  readonly endowmentSkillIds: readonly string[];
}

/**
 * The canonical input of a provider's identity: EVERYTHING the provider id
 * weighs — the display identity, the scope, the immutable lineage, and the
 * offers. The offer list is sorted by its own canonical digest so two
 * declarations differing ONLY in offer order are the SAME provider (A9).
 */
export interface ProviderCanonicalInput {
  readonly identity: { readonly name: string; readonly description?: string };
  readonly scope: ProviderScope;
  readonly lineage: {
    readonly parentProviderId: string | null;
    readonly version: number;
  };
  readonly offers: readonly OfferCanonicalInput[];
}

function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The canonical projection of one offer: the W040 canonical capability
 * registration projection (kind/domain/bearer carried verbatim, provides
 * and provenance sorted) plus the sorted endowment skill ids.
 */
export function canonicalOffer(input: OfferCanonicalInput): OfferCanonicalInput {
  return {
    ...canonicalCapabilityRegistration(input),
    endowmentSkillIds: [...input.endowmentSkillIds].sort(byString),
  };
}

/**
 * The offer id: the canonical hash over the offer's canonical projection.
 * The digest input is byte-identical to the W040 capability id's (through
 * `capability-registry`'s own `canonicalCapabilityRegistration`), so the
 * offer identity IS the measured capability identity, rendered in the
 * offer namespace (`offer-<digest>` vs `cap-<digest>`) — plus the
 * endowment skill ids this offer additionally weighs.
 */
export function offerIdOf(input: OfferCanonicalInput): OfferId {
  return `${OFFER_ID_PREFIX}${stableDigest(canonicalOffer(input))}` as OfferId;
}

/** The canonical sort key of one offer (a deterministic total order). */
function offerSortKey(input: OfferCanonicalInput): string {
  return stableDigest(canonicalOffer(input));
}

/**
 * The canonical projection of a provider registration: the offers sorted
 * by their canonical digest keys, so two declarations differing ONLY in
 * offer declaration order are the SAME provider (A9: same bytes ⇒ same
 * id).
 */
export function canonicalProviderRegistration(
  input: ProviderCanonicalInput,
): ProviderCanonicalInput {
  return {
    identity: input.identity,
    scope: input.scope,
    lineage: input.lineage,
    offers: [...input.offers].sort((left, right) =>
      byString(offerSortKey(left), offerSortKey(right)),
    ),
  };
}

/**
 * The provider id: the canonical hash over the registration's canonical
 * projection (A9 — the same display identity + scope + lineage + offers
 * always yield the same id; any differing byte yields a different one).
 */
export function providerIdOf(input: ProviderCanonicalInput): ProviderId {
  return `${PROVIDER_ID_PREFIX}${stableDigest(canonicalProviderRegistration(input))}` as ProviderId;
}

/**
 * The adjudication id: the canonical hash over the provider id + the
 * demand query + the registry's fingerprint (the W041
 * `registryFingerprintOf` seam: scope + every entry's capability id,
 * lifecycle state and transition record). Deterministic (A9): the same
 * provider + the same demand + the same registry value always yield the
 * same adjudication id, and any lifecycle transition yields a NEW one.
 */
export function adjudicationIdOf(input: {
  readonly providerId: string;
  readonly demand: CapabilityDemandQuery;
  readonly registryFingerprint: string;
}): AdjudicationId {
  return `${ADJUDICATION_ID_PREFIX}${stableDigest({
    providerId: input.providerId,
    demand: input.demand,
    registryFingerprint: input.registryFingerprint,
  })}` as AdjudicationId;
}
