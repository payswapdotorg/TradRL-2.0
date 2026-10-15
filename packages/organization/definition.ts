/**
 * Organization definition contracts (W039) — the declarative MODEL.
 *
 * Spec: spec/ARCHITECTURE.md §12 (Future learning) — "Agent = Body
 * possessed by Cognitive Substrate. Organization discovers capabilities
 * and composes Bodies." This module is the DATA an organization IS:
 * positions (typed seats, each declaring what body may fill it, what
 * substrate may decide through it, and which capabilities it demands),
 * the composition structure (positions compose into units, units compose
 * into the organization — a parent-pointer tree, the root being the
 * organization itself), possession bindings declared through W034's
 * channel/grant vocabulary on the "organization" channel, the declared
 * capability catalogue, and the immutable lineage.
 *
 * Spec: spec/REQUIREMENTS.md R053 — "Organization is optimizable": the
 * model's structure is ablation-ready (see ./ablation.ts) — §13's
 * ORGANIZATION ABLATIONS and MODEL SUBSTITUTION axes act on THIS data.
 *
 * This module is types + nothing else (the contracts-family law): the
 * laws live in ./validate.ts, the derivation operations in ./ablation.ts,
 * the identity in ./identity.ts. No execution, no runtime, no model
 * calls — the model is data + laws.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyCommandKind, BodyDescriptor, BodyObservationKind } from "agent-body";
import type { DecisionRateEnvelope, SubstrateStateMode } from "cognitive-substrate";
import type { AblationKind } from "learning-objectives";
import type { PossessionChannel, PossessionPrincipalId } from "possession";
import type {
  OrganizationCapabilityId,
  OrganizationId,
  OrganizationPositionId,
  OrganizationScope,
  OrganizationUnitId,
} from "./identity.js";

/** An instrument reference (opaque leaf; the W032 embodiment member type). */
export type OrganizationInstrumentRef = BodyDescriptor["embodiment"]["instruments"][number];

/**
 * What a position requires of the W032 BODY that fills it: the command
 * kinds the body must be able to issue, the instruments it must cover,
 * and the observation (view) families the composed agent needs. Every
 * list is an allow-list requirement the compiler proves against the
 * registry — never silently relaxed.
 */
export interface OrganizationBodyRequirement {
  readonly commandKinds: readonly BodyCommandKind[];
  readonly instruments: readonly OrganizationInstrumentRef[];
  readonly observations: readonly BodyObservationKind[];
}

/**
 * What a position requires of the W033 SUBSTRATE that decides through
 * it: the state mode (when the seat demands one), the minimum per-view
 * decision cap the substrate must support, and the command kinds the
 * substrate must be able to propose.
 */
export interface OrganizationSubstrateRequirement {
  readonly stateMode?: SubstrateStateMode;
  readonly minMaxDecisionsPerView: number;
  readonly commandKinds: readonly BodyCommandKind[];
}

/**
 * One capability demand: the capability this position requires, with the
 * declared basis (rationale-as-data, the §10 discipline — non-blank).
 * The capability must exist in the organization's declared catalogue.
 */
export interface OrganizationCapabilityDemand {
  readonly capabilityId: OrganizationCapabilityId;
  readonly rationale: string;
}

/** A position: one typed seat in the organization. */
export interface OrganizationPosition {
  readonly positionId: OrganizationPositionId;
  /** Non-blank human-facing title (data, never a prompt). */
  readonly title: string;
  readonly bodyRequirement: OrganizationBodyRequirement;
  readonly substrateRequirement: OrganizationSubstrateRequirement;
  readonly capabilityDemands: readonly OrganizationCapabilityDemand[];
}

/**
 * A unit: one node of the composition tree. Positions compose into
 * units; units compose into the organization — `parentUnitId: null`
 * means the unit composes DIRECTLY into the organization root.
 * The parent-pointer forest is validated acyclic (./validate.ts).
 */
export interface OrganizationUnit {
  readonly unitId: OrganizationUnitId;
  /** Non-blank human-facing name. */
  readonly name: string;
  readonly parentUnitId: OrganizationUnitId | null;
  readonly positionIds: readonly OrganizationPositionId[];
}

/**
 * The grant vocabulary of one possession binding (the W034
 * `PossessionGrant` shape, carried in-model): WHO bound the seat, through
 * WHAT channel (an organization binding MUST use the "organization"
 * channel — the W039 seam, validated loudly), WHEN (a declared time —
 * data, never a clock read; A9) and on WHAT declared basis.
 */
export interface OrganizationPossessionGrant {
  readonly grantedBy: PossessionPrincipalId;
  readonly channel: PossessionChannel;
  readonly grantedAt: number;
  readonly basis: string;
}

/**
 * The optional scope narrowing of one binding: what the possession the
 * organization grants may cover. Every list is a NARROWING of the
 * position's own body requirement (the W034 scope law: a possession may
 * narrow authority through a body, never widen it) — validated loudly.
 * `decisionRate` is the possession-level rate grant the compiled
 * possession carries (the W034 `PossessionScope.decisionRate` seam).
 */
export interface OrganizationScopeNarrowing {
  readonly instruments?: readonly OrganizationInstrumentRef[];
  readonly commandKinds?: readonly BodyCommandKind[];
  readonly observations?: readonly BodyObservationKind[];
  readonly decisionRate?: DecisionRateEnvelope;
}

/** One possession binding: the organization binds ONE position. */
export interface OrganizationPossessionBinding {
  readonly positionId: OrganizationPositionId;
  readonly grant: OrganizationPossessionGrant;
  readonly scopeNarrowing?: OrganizationScopeNarrowing;
}

/** A capability the organization declares (and positions may demand). */
export interface OrganizationCapability {
  readonly capabilityId: OrganizationCapabilityId;
  /** Non-blank human-facing name. */
  readonly name: string;
  readonly description?: string;
}

/**
 * The origin of an organization definition. Genesis definitions have no
 * parent; every derived definition cites its parent AND the ablation
 * axis it came from — the kinds are W036's closed `ABLATION_KINDS` table
 * (§13: "organization ablations, model substitution"), so the lineage of
 * an organization speaks the SAME axis vocabulary the evaluation policy
 * ablates on (R053).
 */
export type OrganizationOrigin =
  | { readonly kind: "genesis" }
  | {
      readonly kind: AblationKind;
      readonly operation:
        | "remove-position"
        | "remove-unit"
        | "substitute-body-requirement"
        | "substitute-substrate-requirement";
      /** The id the operation acted on (a position or unit id). */
      readonly subject: string;
    };

/**
 * The immutable lineage of an organization definition: the parent (null
 * iff genesis) and the origin. Immutable means: derivation NEVER edits a
 * lineage in place — every ablation (./ablation.ts) constructs a NEW
 * lineage citing the ORIGINAL organization's identity, and the original
 * definition is never mutated.
 */
export interface OrganizationLineage {
  readonly parentOrganizationId: OrganizationId | null;
  readonly origin: OrganizationOrigin;
}

/**
 * An organization definition: scope + capability catalogue + positions +
 * composition tree + possession bindings + lineage. Declaration only —
 * the laws live in ./validate.ts; enforcement belongs to the compiler
 * (services/organization-compiler) and the runtime (W035+), never to
 * this shape.
 */
export interface OrganizationDefinition {
  readonly displayName?: string;
  readonly scope: OrganizationScope;
  readonly capabilities: readonly OrganizationCapability[];
  readonly positions: readonly OrganizationPosition[];
  readonly units: readonly OrganizationUnit[];
  readonly bindings: readonly OrganizationPossessionBinding[];
  readonly lineage: OrganizationLineage;
}
