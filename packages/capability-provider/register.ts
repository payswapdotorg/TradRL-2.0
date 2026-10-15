/**
 * The provider registration gate (W056) — R052 and R055 enforced
 * STRUCTURALLY, provider-neutral.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * every offer's evidence is re-proved THE WAY W040 PROVES ITS OWN — the
 * gate builds each offer's `CapabilityRegistration` and runs W040's own
 * `registerCapability` (experimentIdOf binding, findings digest
 * re-derivation, verdict law, closed vocabularies, scope agreement,
 * lineage continuity, duplicate identity), carrying W040's errors
 * VERBATIM. An offer with NO measured evidence is refused HERE first,
 * with the typed, loud `unmeasured-offer` error naming the law — never a
 * label-only offer, never silent acceptance.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": the gate is
 * provider-NEUTRAL. It knows nothing about any concrete provider; it
 * adjudicates the typed declaration only.
 *
 * A9: `registerProvider` is pure — it returns a NEW registry with every
 * offer's capability inserted in canonical id order and a NEW recorded
 * registration with offers in canonical offer-id order (no clocks, no
 * randomness, no env reads; same inputs ⇒ deep-equal outputs).
 *
 * A14: the gate COMPOSES typed data and adjudicates it; it never executes
 * a provider, never calls out, never performs I/O.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  canonicalRegistration,
  capabilityIdOf,
  registerCapability,
} from "capability-registry";
import type {
  CapabilityId,
  CapabilityRegistration,
  CapabilityRegistry,
  RegistryEntry,
} from "capability-registry";
import { validateSkillRecord } from "skills";
import type { SkillRecord } from "skills";
import { offerIdOf, providerIdOf } from "./identity.js";
import type { OfferCanonicalInput, OfferId } from "./identity.js";
import type {
  ProviderDeclaration,
  ProviderError,
  ProviderOffer,
  ProviderOfferDeclaration,
  ProviderRegistration,
  ProviderRegistrationOutcome,
  SkillEndowmentCitation,
} from "./registration.js";

function error(
  code: ProviderError["code"],
  message: string,
  ids: { providerId?: string; offerId?: string; skillId?: string } = {},
): ProviderError {
  return { code, message, ...ids };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bearerIdOf(bearer: ProviderOfferDeclaration["bearer"]): string {
  // Defensive on runtime-malformed bearers (the W040 precedent): the
  // mismatch laws fire, never a crash.
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "");
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "");
}

function sameScope(
  left: { tenantId: string; projectId: string; worldId: string },
  right: { tenantId: string; projectId: string; worldId: string },
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.worldId === right.worldId
  );
}

/** The W040 registration one declared offer submits to the W040 gate. */
function offerRegistrationOf(
  declaration: ProviderDeclaration,
  offer: ProviderOfferDeclaration,
): CapabilityRegistration {
  return {
    name: offer.name,
    ...(offer.description === undefined ? {} : { description: offer.description }),
    kind: offer.kind,
    domain: offer.domain,
    bearer: offer.bearer,
    scope: declaration.scope,
    providesOrganizationCapabilityIds: offer.providesOrganizationCapabilityIds,
    lineage: offer.capabilityLineage,
    evidence: offer.evidence,
  };
}

/**
 * The canonical offer input of one declared offer: the W040 canonical
 * registration projection (built through the registry's own
 * `canonicalRegistration` — the citation strings derive through the
 * registry's own seams) plus the sorted endowment skill ids.
 */
function offerCanonicalInputOf(
  declaration: ProviderDeclaration,
  offer: ProviderOfferDeclaration,
): OfferCanonicalInput {
  const endowments: readonly SkillRecord[] = offer.skillEndowments ?? [];
  return {
    ...canonicalRegistration(offerRegistrationOf(declaration, offer)),
    endowmentSkillIds: endowments.map((skill) => String(skill.skillId)).sort(byString),
  };
}

/**
 * THE REGISTRATION GATE. Provider-level structure first (display identity,
 * scope, lineage shape), then each offer: R052 (the measured evidence —
 * the headline law, refused HERE), the endowment laws (W041 records
 * re-validated through W041's own gate, scope/capability/bearer
 * agreement, duplicates), then the W040 gate itself (`registerCapability`
 * — errors carried verbatim, the registry chained offer by offer).
 * Finally the provider-level identity laws (duplicate provider id,
 * lineage parent existence and version continuity against the known
 * registrations). Every violation is a typed error with the law named in
 * the message; all violations are collected, none silently dropped.
 *
 * `known` carries the provider registrations already accepted by the
 * caller (the registry-value-carrying pattern: there is no provider
 * store here — the caller holds the accepted registrations the way W040's
 * callers hold the registry value). Default: none.
 */
export function registerProvider(
  registry: CapabilityRegistry,
  declaration: ProviderDeclaration,
  known: readonly ProviderRegistration[] = [],
): ProviderRegistrationOutcome {
  const errors: ProviderError[] = [];

  // -- provider-level structure --------------------------------------------
  if (blank(declaration.identity.name)) {
    errors.push(error("blank-provider-name", "the provider's display name is blank — an interface counterpart needs a name, a measurement needs more"));
  }
  for (const [field, value] of [
    ["tenantId", declaration.scope.tenantId],
    ["projectId", declaration.scope.projectId],
    ["worldId", declaration.scope.worldId],
  ] as const) {
    if (blank(value)) {
      errors.push(error("blank-scope-member", `the provider scope's '${field}' is blank — scope is explicit, never blank`));
    }
  }
  if (declaration.offers.length === 0) {
    errors.push(error("no-offers", "the provider declaration carries no offers — a provider registration offers at least one MEASURED capability (R055: providers are pluggable, never empty)"));
  }
  if (!Number.isInteger(declaration.lineage.version) || declaration.lineage.version < 1) {
    errors.push(error("provider-lineage-break", `provider lineage version ${String(declaration.lineage.version)} is not a positive integer — versions start at 1`));
  }
  if (declaration.lineage.version === 1 && declaration.lineage.parentProviderId !== null) {
    errors.push(error("provider-lineage-break", "a version-1 provider is genesis: it cannot cite a parent"));
  }
  if (declaration.lineage.version > 1 && declaration.lineage.parentProviderId === null) {
    errors.push(error("provider-lineage-break", `provider lineage version ${String(declaration.lineage.version)} without a parent — only genesis (version 1) is parentless`));
  }

  // -- the offers -----------------------------------------------------------
  const offerInputs = declaration.offers.map((offer) => offerCanonicalInputOf(declaration, offer));
  const offerIds = offerInputs.map((input) => offerIdOf(input));
  const capabilityIds = offerInputs.map((input) => capabilityIdOf(input));
  const seenOfferIds = new Set<string>();
  let chained: CapabilityRegistry = registry;
  const accepted: ProviderOffer[] = [];

  declaration.offers.forEach((offer, index) => {
    const offerId: OfferId = offerIds[index] as OfferId;
    const capabilityId: CapabilityId = capabilityIds[index] as CapabilityId;
    const offerLabel = { offerId: String(offerId) };

    if (blank(offer.name)) {
      errors.push(error("blank-offer-name", "the offer's name is blank — an offer is a named, measured capability", offerLabel));
    }
    if (seenOfferIds.has(String(offerId))) {
      errors.push(error("duplicate-offer", `offer '${String(offerId)}' is declared twice — offer identity is exact canonical-id identity`, offerLabel));
    }
    seenOfferIds.add(String(offerId));

    // R052 — THE law of this package, refused at THIS gate.
    if (offer.evidence.length === 0) {
      errors.push(error(
        "unmeasured-offer",
        "R052 (capability discovery is EMPIRICAL): an offer without measured evidence is refused — labels are not measurements; cite the W037/W038 artifacts that established the offered capability",
        offerLabel,
      ));
    }

    // The endowment laws: each endowed skill re-validated through W041's
    // own gate, then scope/capability/bearer agreement — carried, never
    // re-scored.
    const endowments: readonly SkillRecord[] = offer.skillEndowments ?? [];
    const seenSkillIds = new Set<string>();
    for (const skill of endowments) {
      const skillLabel = { ...offerLabel, skillId: String(skill.skillId) };
      const validation = validateSkillRecord(skill);
      if (!validation.ok) {
        errors.push({
          code: "invalid-skill-endowment",
          message: `the endowed skill '${String(skill.skillId)}' fails W041's record laws — an endowment cites a REAL skill, re-validated through the skills gate (errors carried verbatim)`,
          offerId: String(offerId),
          skillId: String(skill.skillId),
          skillErrors: validation.errors,
        });
        continue;
      }
      if (seenSkillIds.has(String(skill.skillId))) {
        errors.push(error("duplicate-skill-endowment", `skill '${String(skill.skillId)}' is endowed twice in offer '${String(offerId)}' — endowments are a set`, skillLabel));
      }
      seenSkillIds.add(String(skill.skillId));
      if (!sameScope(skill.scope, declaration.scope)) {
        errors.push(error(
          "skill-scope-mismatch",
          `the endowed skill '${String(skill.skillId)}' declares scope (${skill.scope.tenantId}, ${skill.scope.projectId}, ${skill.scope.worldId}) which disagrees with the provider's scope — an endowment is measured WHERE it is offered`,
          skillLabel,
        ));
      }
      if (String(skill.competence.capabilityId) !== String(capabilityId)) {
        errors.push(error(
          "endowment-capability-mismatch",
          `the endowed skill '${String(skill.skillId)}' was measured as capability '${String(skill.competence.capabilityId)}' but the offer registers capability '${String(capabilityId)}' — an endowment cites the capability it offers`,
          skillLabel,
        ));
      }
      if (skill.bearer.kind !== offer.bearer.kind || bearerIdOf(skill.bearer) !== bearerIdOf(offer.bearer)) {
        errors.push(error(
          "endowment-bearer-mismatch",
          `the endowed skill '${String(skill.skillId)}' was demonstrated by a different bearer (${skill.bearer.kind} '${bearerIdOf(skill.bearer)}') than the offer's (${offer.bearer.kind} '${bearerIdOf(offer.bearer)}') — an endowment is demonstrated by the bearer that offers it`,
          skillLabel,
        ));
      }
    }

    // W040's own gate, carried verbatim: the offer IS a capability
    // registration (scope = the provider's), and the registry chains.
    const outcome = registerCapability(chained, offerRegistrationOf(declaration, offer));
    if (!outcome.ok) {
      errors.push({
        code: "offer-refused",
        message: `offer '${String(offerId)}' is refused by the W040 capability gate — the offer's evidence is re-proved the way the registry proves its own (errors carried verbatim)`,
        offerId: String(offerId),
        capabilityErrors: outcome.errors,
      });
      return;
    }
    chained = outcome.registry;
    const entry: RegistryEntry | undefined = chained.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === String(outcome.capabilityId),
    );
    if (entry === undefined) {
      // Unreachable by W040's own construction; fail-closed regardless.
      errors.push(error("offer-refused", `offer '${String(offerId)}' registered but its registry entry did not resolve — fail-closed`, offerLabel));
      return;
    }
    const descriptor = entry.descriptor;
    const endowmentCitations: SkillEndowmentCitation[] = endowments.map((skill) => ({
      skillId: skill.skillId,
      capabilityId: skill.competence.capabilityId,
      evidenceTrajectoryIds: skill.evidence.trajectoryIds,
    }));
    accepted.push({
      offerId,
      capabilityId: descriptor.capabilityId,
      name: descriptor.name,
      ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
      kind: descriptor.kind,
      domain: descriptor.domain,
      bearer: descriptor.bearer,
      scope: descriptor.scope,
      providesOrganizationCapabilityIds: descriptor.providesOrganizationCapabilityIds,
      capabilityLineage: descriptor.lineage,
      provenance: descriptor.provenance,
      endowments: endowmentCitations,
      lifecycle: { state: entry.state, transitions: entry.transitions },
    });
  });

  // -- the provider identity laws -------------------------------------------
  const providerId = providerIdOf({
    identity: {
      name: declaration.identity.name,
      ...(declaration.identity.description === undefined
        ? {}
        : { description: declaration.identity.description }),
    },
    scope: declaration.scope,
    lineage: {
      parentProviderId:
        declaration.lineage.parentProviderId === null
          ? null
          : String(declaration.lineage.parentProviderId),
      version: declaration.lineage.version,
    },
    offers: offerInputs,
  });

  const parent = declaration.lineage.parentProviderId;
  if (parent !== null) {
    const parentRegistration = known.find(
      (candidate) => String(candidate.providerId) === String(parent),
    );
    if (parentRegistration === undefined) {
      errors.push(error(
        "provider-lineage-break",
        `provider lineage parent '${String(parent)}' is not among the known registrations — a successor cites a REAL parent`,
        { providerId: String(parent) },
      ));
    } else if (parentRegistration.lineage.version !== declaration.lineage.version - 1) {
      errors.push(error(
        "provider-lineage-break",
        `provider lineage version ${String(declaration.lineage.version)} must be exactly parent '${String(parent)}'s version (${String(parentRegistration.lineage.version)}) + 1 — versions are continuous`,
        { providerId: String(parent) },
      ));
    }
  }
  if (known.some((candidate) => String(candidate.providerId) === String(providerId))) {
    errors.push(error(
      "duplicate-provider",
      `provider '${String(providerId)}' is already registered — provider identity is exact canonical-id identity`,
      { providerId: String(providerId) },
    ));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const registration: ProviderRegistration = {
    providerId,
    identity: declaration.identity,
    scope: declaration.scope,
    offers: [...accepted].sort((left, right) =>
      String(left.offerId) < String(right.offerId) ? -1 : 1,
    ),
    lineage: declaration.lineage,
  };
  return { ok: true, registration, registry: chained };
}
