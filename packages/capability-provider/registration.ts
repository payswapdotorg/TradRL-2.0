/**
 * Capability-provider registration contracts (W056) — the typed DATA a
 * provider registration IS, plus the package's closed typed error family.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * every offer carries MEASURED provenance (the W040 `MeasuredEvidence`
 * citations the registration gate re-proves the way W040 proves its own);
 * an offer without measured evidence is REJECTED at the gate with the
 * typed, loud error `unmeasured-offer` naming the law.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": providers are a
 * PLUGGABLE class and every member of that class is EQUAL at this
 * surface. The vocabulary here is provider-NEUTRAL: the W040 descriptor
 * vocabulary (kind/domain/bearer) typed VERBATIM, the W039 organization
 * capability ids an offer provides, and the W041 skill records it may
 * endow. Concrete provider specifics live in THEIR packages, never here.
 *
 * Spec: spec/DOMAIN-MODEL.md identity laws — opaque ids, canonical
 * encoders, explicit scope, immutable lineage.
 *
 * This module is types + closed sets (the contracts-family law): the
 * registration gate lives in ./register.ts, the neutral port in
 * ./port.ts, demand adjudication in ./match.ts, re-validation in
 * ./validate.ts, identity in ./identity.ts. No execution, no runtime, no
 * provider calls (A14: this interface COMPOSES and ADJUDICATES typed
 * data; it never executes a provider).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  CapabilityBearer,
  CapabilityDomain,
  CapabilityError,
  CapabilityId,
  CapabilityKind,
  CapabilityLineage,
  CapabilityRegistry,
  CapabilityState,
  EvidenceCitation,
  LifecycleTransition,
  MeasuredEvidence,
} from "capability-registry";
import type { OrganizationCapabilityId } from "organization";
import type { SkillError, SkillRecord } from "skills";
import type { OfferId, ProviderId, ProviderScope } from "./identity.js";

// ---------------------------------------------------------------------------
// The declaration (the gate's input)
// ---------------------------------------------------------------------------

/** The provider's display identity: a non-blank name, optionally described. */
export interface ProviderIdentity {
  readonly name: string;
  readonly description?: string;
}

/**
 * The versioned immutable lineage of a provider: genesis providers have
 * no parent and version 1; every successor cites its parent and is
 * exactly parent.version + 1 (a gap or a skip is a typed lineage break).
 * Immutable means derivation never edits a lineage in place — a successor
 * is a NEW registration.
 */
export interface ProviderLineage {
  readonly parentProviderId: ProviderId | null;
  readonly version: number;
}

/**
 * One offer as DECLARED: the W040 descriptor vocabulary typed VERBATIM
 * (kind/domain/bearer — never re-declared here), the W039 organization
 * capabilities it provides, the W040 capability lineage the offer
 * registers under, the MEASURED evidence citations the W040 gate can
 * re-prove (experimentIdOf binding, findings digest re-derivation,
 * verdict law), and the OPTIONAL W041 skill endowments (a provider MAY
 * endow skills; each endowment cites the skill measured AS the offered
 * capability, demonstrated by the offered bearer).
 */
export interface ProviderOfferDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly kind: CapabilityKind;
  readonly domain: CapabilityDomain;
  readonly bearer: CapabilityBearer;
  readonly providesOrganizationCapabilityIds: readonly OrganizationCapabilityId[];
  /** The W040 capability lineage the offer registers under (genesis by default in practice). */
  readonly capabilityLineage: CapabilityLineage;
  /** R052: the measured evidence. Empty is refused LOUDLY at the gate. */
  readonly evidence: readonly MeasuredEvidence[];
  /** The W041 skills this offer endows (optional; cited, never re-scored). */
  readonly skillEndowments?: readonly SkillRecord[];
}

/** The registration input: display identity, scope, lineage, and the offers. */
export interface ProviderDeclaration {
  readonly identity: ProviderIdentity;
  readonly scope: ProviderScope;
  readonly lineage: ProviderLineage;
  readonly offers: readonly ProviderOfferDeclaration[];
}

// ---------------------------------------------------------------------------
// The recorded registration (typed DATA)
// ---------------------------------------------------------------------------

/**
 * One endowment citation: WHICH skill, measured AS WHICH capability, on
 * WHICH trajectory evidence — the W041 endowment vocabulary (the
 * `SkillEndowmentEntry` members), carried from the endowed `SkillRecord`.
 */
export interface SkillEndowmentCitation {
  readonly skillId: SkillRecord["skillId"];
  readonly capabilityId: SkillRecord["competence"]["capabilityId"];
  readonly evidenceTrajectoryIds: SkillRecord["evidence"]["trajectoryIds"];
}

/** The per-offer lifecycle, carried from the W040 registry entry. */
export interface ProviderOfferLifecycle {
  readonly state: CapabilityState;
  readonly transitions: readonly LifecycleTransition[];
}

/**
 * One offer as RECORDED: its opaque canonical offer id, the W040
 * capability id it registered as, the descriptor vocabulary verbatim, the
 * measured provenance citations carried from the W040 descriptor, the
 * endowment citations, and the lifecycle carried from W040 at
 * registration time.
 */
export interface ProviderOffer {
  readonly offerId: OfferId;
  readonly capabilityId: CapabilityId;
  readonly name: string;
  readonly description?: string;
  readonly kind: CapabilityKind;
  readonly domain: CapabilityDomain;
  readonly bearer: CapabilityBearer;
  readonly scope: ProviderScope;
  readonly providesOrganizationCapabilityIds: readonly OrganizationCapabilityId[];
  readonly capabilityLineage: CapabilityLineage;
  /** The measured provenance, carried from the W040 descriptor (A6). */
  readonly provenance: readonly EvidenceCitation[];
  /** The W041 endowment citations (empty when the offer endows nothing). */
  readonly endowments: readonly SkillEndowmentCitation[];
  /** The lifecycle carried from the W040 registry entry at registration time. */
  readonly lifecycle: ProviderOfferLifecycle;
}

/**
 * A provider registration as RECORDED: the opaque canonical provider id,
 * the display identity, the explicit scope, the offers in CANONICAL
 * offer-id order (A9: declaration order never leaks into the record
 * value), and the versioned immutable lineage. DATA only — laws live in
 * ./register.ts and ./validate.ts.
 */
export interface ProviderRegistration {
  readonly providerId: ProviderId;
  readonly identity: ProviderIdentity;
  readonly scope: ProviderScope;
  readonly offers: readonly ProviderOffer[];
  readonly lineage: ProviderLineage;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ProviderErrorCode =
  // provider-level declaration laws
  | "blank-provider-name"
  | "blank-scope-member" // tenant/project/world scope is explicit, never blank
  | "no-offers" // a provider registration carries at least one offer
  | "provider-lineage-break" // missing parent, skipped version, wrong root shape
  | "duplicate-provider" // the same provider id already registered
  // offer-level laws
  | "blank-offer-name"
  | "duplicate-offer" // the same offer id twice in one registration
  | "unmeasured-offer" // R052 — THE law of this package
  | "offer-refused" // W040's gate refused the offer's capability (errors carried)
  // endowment laws (W041 citations)
  | "invalid-skill-endowment" // W041's gate refused the skill (errors carried)
  | "skill-scope-mismatch" // the endowed skill's scope ≠ the provider's
  | "duplicate-skill-endowment" // the same skill id endowed twice in one offer
  | "endowment-capability-mismatch" // the skill was measured as a different capability
  | "endowment-bearer-mismatch" // the skill was demonstrated by a different bearer
  | "blank-endowment-member" // an endowment citation member is blank
  // port laws
  | "unknown-offer" // by-id resolution misses
  // re-validation laws (./validate.ts)
  | "offer-id-mismatch" // the id is not the canonical derivation of its content
  | "capability-id-mismatch" // the W040 capability id disagrees with the content
  | "provider-id-mismatch"
  | "non-canonical-order" // the record value's A9 ordering law
  | "offer-descriptor-mismatch"; // the registry's descriptor disagrees with the record

/** One typed provider error (fail-closed; the law named in the message). */
export interface ProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
  /** The offending provider/offer/skill id, when the error belongs to one. */
  readonly providerId?: string;
  readonly offerId?: string;
  readonly skillId?: string;
  /** Present on `offer-refused`: W040's own errors, verbatim. */
  readonly capabilityErrors?: readonly CapabilityError[];
  /** Present on `invalid-skill-endowment`: W041's own errors, verbatim. */
  readonly skillErrors?: readonly SkillError[];
}

export type ProviderRegistrationOutcome =
  | {
      readonly ok: true;
      readonly registration: ProviderRegistration;
      readonly registry: CapabilityRegistry;
    }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };
