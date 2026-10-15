/**
 * Provider registration re-validation (W056) — the whole registration
 * re-proved from its RECORDED data.
 *
 * Identity is a function of content (A9), so every id the record carries
 * is re-derived from the record's own bytes and compared exactly; the
 * canonical-order laws are re-proved; the provider-level structure laws
 * (blank members, offer presence, lineage shape, duplicates) are
 * re-proved; and the endowment citations are re-proved against the offer
 * they ride on. When a registry is supplied, every offer's capability is
 * resolved in it and the W040 descriptor's agreement with the recorded
 * offer is re-proved by field equality (kind/domain/bearer/provides/
 * provenance) — lifecycle state is deliberately NOT compared: a
 * deprecated or revoked offer is a legitimate LATER registry state, and
 * demand-matching (not re-validation) is where it fails loudly.
 *
 * The provider lineage PARENT-existence law needs the other registrations
 * (the caller's accepted set — the same value `registerProvider`
 * consumed), so shape laws only are re-proved here; that is disclosed in
 * each law's doc.
 *
 * Fail-closed, deterministic, pure: no I/O, no clocks, no provider
 * execution.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { capabilityIdOf, resolveCapability } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { offerIdOf, providerIdOf } from "./identity.js";
import type { OfferCanonicalInput } from "./identity.js";
import type {
  ProviderError,
  ProviderOffer,
  ProviderRegistration,
} from "./registration.js";

export type ProviderValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };

function error(
  code: ProviderError["code"],
  message: string,
  ids: { providerId?: string; offerId?: string } = {},
): ProviderError {
  return { code, message, ...ids };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * The canonical offer input of one RECORDED offer — rebuilt purely from
 * the record's own members (the provenance citations are already the
 * canonical string ids the W040 descriptor carries).
 */
function recordedOfferInput(offer: ProviderOffer): OfferCanonicalInput {
  return {
    name: offer.name,
    ...(offer.description === undefined ? {} : { description: offer.description }),
    kind: offer.kind,
    domain: offer.domain,
    bearer: {
      kind: offer.bearer.kind,
      id:
        offer.bearer.kind === "substrate"
          ? String(offer.bearer.substrateId)
          : String((offer.bearer as { readonly bodyId?: string }).bodyId ?? ""),
    },
    scope: offer.scope,
    providesOrganizationCapabilityIds: offer.providesOrganizationCapabilityIds.map((id) => String(id)),
    lineage: {
      parentCapabilityId:
        offer.capabilityLineage.parentCapabilityId === null
          ? null
          : String(offer.capabilityLineage.parentCapabilityId),
      version: offer.capabilityLineage.version,
    },
    provenance: offer.provenance.map((citation) => ({
      experimentId: String(citation.experimentId),
      evaluationId: String(citation.evaluationId),
      findingsDigest: citation.findingsDigest,
    })),
    endowmentSkillIds: offer.endowments.map((endowment) => String(endowment.skillId)).sort(),
  };
}

/**
 * Re-validate ONE recorded provider registration against the
 * provider-registration laws. Every violation is a typed error with the
 * law named in the message; all violations are collected, none silently
 * dropped. With `registry` supplied, additionally re-proves the offers'
 * W040 descriptor agreement (resolution errors carried verbatim).
 */
export function validateProviderRegistration(
  registration: ProviderRegistration,
  registry?: CapabilityRegistry,
): ProviderValidationOutcome {
  const errors: ProviderError[] = [];
  const providerLabel = { providerId: String(registration.providerId) };

  // -- structure ------------------------------------------------------------
  if (blank(registration.identity.name)) {
    errors.push(error("blank-provider-name", "the provider's display name is blank — an interface counterpart needs a name", providerLabel));
  }
  for (const [field, value] of [
    ["tenantId", registration.scope.tenantId],
    ["projectId", registration.scope.projectId],
    ["worldId", registration.scope.worldId],
  ] as const) {
    if (blank(value)) {
      errors.push(error("blank-scope-member", `the provider scope's '${field}' is blank — scope is explicit, never blank`, providerLabel));
    }
  }
  if (registration.offers.length === 0) {
    errors.push(error("no-offers", "the registration records no offers — a provider registration offers at least one MEASURED capability", providerLabel));
  }
  if (
    !Number.isInteger(registration.lineage.version) ||
    registration.lineage.version < 1
  ) {
    errors.push(error("provider-lineage-break", `provider lineage version ${String(registration.lineage.version)} is not a positive integer — versions start at 1`, providerLabel));
  }
  if (registration.lineage.version === 1 && registration.lineage.parentProviderId !== null) {
    errors.push(error("provider-lineage-break", "a version-1 provider is genesis: it cannot cite a parent", providerLabel));
  }
  if (registration.lineage.version > 1 && registration.lineage.parentProviderId === null) {
    errors.push(error("provider-lineage-break", `provider lineage version ${String(registration.lineage.version)} without a parent — only genesis (version 1) is parentless`, providerLabel));
  }

  // -- the offers: structure, endowments, order, identity --------------------
  const seenOfferIds = new Set<string>();
  const offerInputs: OfferCanonicalInput[] = [];
  registration.offers.forEach((offer) => {
    const offerLabel = { ...providerLabel, offerId: String(offer.offerId) };
    if (blank(offer.name)) {
      errors.push(error("blank-offer-name", "the offer's name is blank — an offer is a named, measured capability", offerLabel));
    }
    if (offer.provenance.length === 0) {
      errors.push(error("unmeasured-offer", `R052 (capability discovery is EMPIRICAL): offer '${String(offer.offerId)}' records no measured provenance — labels are not measurements`, offerLabel));
    }
    if (seenOfferIds.has(String(offer.offerId))) {
      errors.push(error("duplicate-offer", `offer '${String(offer.offerId)}' is recorded twice — offer identity is exact canonical-id identity`, offerLabel));
    }
    seenOfferIds.add(String(offer.offerId));

    // The endowment citations: capability agreement, blank members,
    // duplicates, canonical trajectory order.
    const seenSkillIds = new Set<string>();
    for (const endowment of offer.endowments) {
      if (String(endowment.capabilityId) !== String(offer.capabilityId)) {
        errors.push(error("endowment-capability-mismatch", `the endowment '${String(endowment.skillId)}' cites capability '${String(endowment.capabilityId)}' but rides offer '${String(offer.offerId)}' which registers '${String(offer.capabilityId)}' — an endowment cites the capability it offers`, offerLabel));
      }
      if (blank(String(endowment.skillId))) {
        errors.push(error("blank-endowment-member", `an endowment of offer '${String(offer.offerId)}' carries a blank skill id — citations are canonical ids, never blank`, offerLabel));
      }
      if (seenSkillIds.has(String(endowment.skillId))) {
        errors.push(error("duplicate-skill-endowment", `skill '${String(endowment.skillId)}' is endowed twice in offer '${String(offer.offerId)}' — endowments are a set`, offerLabel));
      }
      seenSkillIds.add(String(endowment.skillId));
      if (
        JSON.stringify(endowment.evidenceTrajectoryIds.map(String).sort()) !==
        JSON.stringify(endowment.evidenceTrajectoryIds.map(String))
      ) {
        errors.push(error("non-canonical-order", `the endowment '${String(endowment.skillId)}' cites its trajectory evidence out of canonical (sorted id) order — declaration order must never leak into the record value (A9)`, offerLabel));
      }
    }

    // The identity laws: both ids are functions of the recorded content.
    const input = recordedOfferInput(offer);
    offerInputs.push(input);
    const derivedOfferId = offerIdOf(input);
    if (String(derivedOfferId) !== String(offer.offerId)) {
      errors.push(error("offer-id-mismatch", `offer '${String(offer.offerId)}' is not the canonical derivation of its own recorded content — identity is a function of the measured evidence bytes (A9), never an arbitrary label`, offerLabel));
    }
    const derivedCapabilityId = capabilityIdOf(input);
    if (String(derivedCapabilityId) !== String(offer.capabilityId)) {
      errors.push(error("capability-id-mismatch", `the recorded capability id '${String(offer.capabilityId)}' is not the canonical W040 derivation of the offer's own recorded content — carry the registry's id, never invent one`, offerLabel));
    }

    // The optional registry cross-check: resolution + descriptor
    // agreement (lifecycle deliberately NOT compared — later states are
    // legitimate; demand-matching fails loudly there instead).
    if (registry !== undefined) {
      const lookup = resolveCapability(registry, offer.capabilityId);
      if (!lookup.ok) {
        errors.push(error(
          "offer-descriptor-mismatch",
          `offer '${String(offer.offerId)}' cites capability '${String(offer.capabilityId)}' which does not resolve in the supplied registry — an offer cites the capability it registered as`,
          offerLabel,
        ));
        return;
      }
      const descriptor = lookup.entry.descriptor;
      const agrees =
        descriptor.name === offer.name &&
        descriptor.description === offer.description &&
        descriptor.kind === offer.kind &&
        descriptor.domain === offer.domain &&
        descriptor.bearer.kind === offer.bearer.kind &&
        JSON.stringify(descriptor.providesOrganizationCapabilityIds.map(String)) ===
          JSON.stringify(offer.providesOrganizationCapabilityIds.map(String)) &&
        JSON.stringify(descriptor.provenance) === JSON.stringify(offer.provenance);
      if (!agrees) {
        errors.push(error("offer-descriptor-mismatch", `offer '${String(offer.offerId)}' disagrees with the registry's own descriptor for capability '${String(offer.capabilityId)}' — the record carries the W040 descriptor verbatim, never a re-declaration`, offerLabel));
      }
    }
  });

  // The canonical-order law (A9: the record value's offers are in
  // canonical offer-id order).
  const recordedIds = registration.offers.map((offer) => String(offer.offerId));
  if (JSON.stringify([...recordedIds].sort()) !== JSON.stringify(recordedIds)) {
    errors.push(error("non-canonical-order", "the registration records its offers out of canonical offer-id order — declaration order must never leak into the record value (A9)", providerLabel));
  }

  // The provider identity law.
  const derivedProviderId = providerIdOf({
    identity: {
      name: registration.identity.name,
      ...(registration.identity.description === undefined
        ? {}
        : { description: registration.identity.description }),
    },
    scope: registration.scope,
    lineage: {
      parentProviderId:
        registration.lineage.parentProviderId === null
          ? null
          : String(registration.lineage.parentProviderId),
      version: registration.lineage.version,
    },
    offers: offerInputs,
  });
  if (String(derivedProviderId) !== String(registration.providerId)) {
    errors.push(error("provider-id-mismatch", `provider '${String(registration.providerId)}' is not the canonical derivation of its own recorded content — identity is a function of the declared + measured bytes (A9), never an arbitrary label`, providerLabel));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "structure",
      "offer-laws",
      "endowment-laws",
      "canonical-order",
      "identity",
      ...(registry === undefined ? [] : ["registry-agreement"]),
    ],
  };
}
