/**
 * The capability-provider contract (W056) — the provider-neutral seam
 * concrete capability providers and their consumers compile against.
 *
 * This is the canonical, type-only contracts surface for the
 * provider-neutral capability-provider interface (the contracts/ui
 * precedent, W005's convention): the offer descriptor shape, the neutral
 * port a concrete provider implements, and the adjudication result shape
 * consumers read.
 *
 * The contract is deliberately TYPE-ONLY and dependency-free:
 *
 * - It re-declares the structural shapes with OPAQUE string ids (the
 *   branded opaque ids of `packages/capability-provider` satisfy them
 *   structurally — the brand never leaks). It must never import a
 *   workspace package, a runtime, or a framework.
 * - It must never declare concrete-provider concepts. The closed
 *   kind/domain vocabularies are carried VERBATIM from the W040
 *   descriptor vocabulary (they ARE the neutral interface — every
 *   provider answers in them); everything else stays neutral: no
 *   external-source names, no entitlement semantics, no execution
 *   surface. The forbidden-key assertions in
 *   `test/capabilityProviderContract.test.ts` make importing
 *   concrete-provider specifics into this contract a compile failure
 *   (R055 — providers are a PLUGGABLE class; this contract is the proof
 *   they are all equal at the seam).
 *
 * The concrete implementation of this seam lives in
 * `packages/capability-provider` (W056). Drift between this contract and
 * the implementation is guarded by
 * `packages/capability-provider/test/contract.test.ts`, which checks
 * compile-time assignability of the real types against these contract
 * types plus the behavioral laws at runtime.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

// ---------------------------------------------------------------------------
// The neutral vocabularies (carried verbatim from the W040 descriptor
// vocabulary — the closed sets every provider's offers answer in)
// ---------------------------------------------------------------------------

/** What an offered capability was MEASURED to do (closed set, W040 verbatim). */
export type CapabilityProviderOfferKind =
  | "execution-quality"
  | "alpha-generation"
  | "risk-control"
  | "market-making"
  | "information-synthesis";

/** The market domain the offer's measurement ran in (closed set, W040 verbatim). */
export type CapabilityProviderOfferDomain =
  | "equities"
  | "futures"
  | "fx"
  | "crypto-spot";

/** WHO demonstrated the offered capability (W040 verbatim). */
export type CapabilityProviderBearer =
  | { readonly kind: "substrate"; readonly substrateId: string }
  | { readonly kind: "body"; readonly bodyId: string };

/** The lifecycle states of an offered capability (W040 verbatim). */
export type CapabilityProviderOfferLifecycleState =
  | "registered"
  | "deprecated"
  | "revoked";

/** The explicit tenant/project/world scope (opaque strings, never parsed). */
export interface CapabilityProviderScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

// ---------------------------------------------------------------------------
// The offer descriptor shape
// ---------------------------------------------------------------------------

/** One measured-evidence citation (canonical W037/W038 ids + digest). */
export interface CapabilityProviderEvidenceCitation {
  readonly experimentId: string;
  readonly evaluationId: string;
  readonly findingsDigest: string;
}

/** One skill endowment citation (the W041 endowment vocabulary). */
export interface CapabilityProviderSkillEndowment {
  readonly skillId: string;
  readonly capabilityId: string;
  readonly evidenceTrajectoryIds: readonly string[];
}

/** One lifecycle transition of an offered capability (rationale-as-data). */
export interface CapabilityProviderLifecycleTransition {
  readonly to: "deprecated" | "revoked";
  readonly reason: string;
}

/**
 * The offer descriptor a provider exposes: its opaque offer id, the W040
 * capability id it registers as, the neutral vocabulary verbatim, the
 * organization capabilities it provides (W039 ids), the measured
 * provenance citations, the endowment citations, and the per-offer
 * lifecycle carried from W040.
 */
export interface CapabilityProviderOfferDescriptor {
  readonly offerId: string;
  readonly capabilityId: string;
  readonly name: string;
  readonly description?: string;
  readonly kind: CapabilityProviderOfferKind;
  readonly domain: CapabilityProviderOfferDomain;
  readonly bearer: CapabilityProviderBearer;
  readonly scope: CapabilityProviderScope;
  readonly providesOrganizationCapabilityIds: readonly string[];
  readonly capabilityLineage: {
    readonly parentCapabilityId: string | null;
    readonly version: number;
  };
  readonly provenance: readonly CapabilityProviderEvidenceCitation[];
  readonly endowments: readonly CapabilityProviderSkillEndowment[];
  readonly lifecycle: {
    readonly state: CapabilityProviderOfferLifecycleState;
    readonly transitions: readonly CapabilityProviderLifecycleTransition[];
  };
}

// ---------------------------------------------------------------------------
// The neutral port (the ONLY surface a concrete provider implements)
// ---------------------------------------------------------------------------

/** The typed error shape every fail-closed seam answers in. */
export interface CapabilityProviderError {
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly offerId?: string;
  readonly skillId?: string;
}

/** One offer resolved by exact id — typed, never a silent undefined. */
export type CapabilityProviderOfferLookup =
  | { readonly ok: true; readonly offer: CapabilityProviderOfferDescriptor }
  | { readonly ok: false; readonly errors: readonly CapabilityProviderError[] };

/** One offer's measured provenance resolved by exact id — fail-closed. */
export type CapabilityProviderProvenanceLookup =
  | { readonly ok: true; readonly provenance: readonly CapabilityProviderEvidenceCitation[] }
  | { readonly ok: false; readonly errors: readonly CapabilityProviderError[] };

/**
 * THE NEUTRAL PORT: list the offers (canonical offer-id order), describe
 * one offer by exact id, expose the measured provenance an offer rests
 * on. A concrete provider implements exactly this — nothing more is
 * required, nothing less is accepted.
 */
export interface CapabilityProviderPort {
  readonly providerId: string;
  listOffers(): readonly CapabilityProviderOfferDescriptor[];
  describeOffer(offerId: string): CapabilityProviderOfferLookup;
  provenanceOf(offerId: string): CapabilityProviderProvenanceLookup;
}

// ---------------------------------------------------------------------------
// The adjudication result shape (consumers read; W040's reasons carried)
// ---------------------------------------------------------------------------

/** One refusal reason, carried verbatim from the W040 demand seam. */
export interface CapabilityProviderDemandRejection {
  readonly code: string;
  readonly message: string;
  readonly capabilityId?: string;
}

/** One resolution error, carried verbatim from the W040 registry. */
export interface CapabilityProviderResolutionError {
  readonly code: string;
  readonly message: string;
  readonly entryId?: string;
}

/** One offer's adjudication against a demand. */
export interface CapabilityProviderOfferAdjudication {
  readonly offerId: string;
  readonly capabilityId: string;
  readonly matched: boolean;
  readonly evidence: readonly string[];
  readonly reasons: readonly CapabilityProviderDemandRejection[];
  readonly resolutionErrors: readonly CapabilityProviderResolutionError[];
}

/** The whole adjudication: typed yes/no, everything carried, id-addressed. */
export type CapabilityProviderAdjudication =
  | {
      readonly ok: true;
      readonly adjudicationId: string;
      readonly providerId: string;
      readonly offerId: string;
      readonly capabilityId: string;
      readonly evidence: readonly string[];
      readonly considered: readonly CapabilityProviderOfferAdjudication[];
    }
  | {
      readonly ok: false;
      readonly adjudicationId: string;
      readonly providerId: string;
      readonly queryReasons: readonly CapabilityProviderDemandRejection[];
      readonly offerRejections: readonly {
        readonly offerId: string;
        readonly capabilityId: string;
        readonly reasons: readonly CapabilityProviderDemandRejection[];
        readonly resolutionErrors: readonly CapabilityProviderResolutionError[];
      }[];
      readonly considered: readonly CapabilityProviderOfferAdjudication[];
    };
