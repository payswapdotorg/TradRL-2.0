/**
 * Possession contracts (W034) — the composition layer that binds a W033
 * Cognitive Substrate to a W032 Body.
 *
 * Spec: spec/ARCHITECTURE.md §12 — "Agent = Body possessed by Cognitive
 * Substrate". The Body acts (W032), the substrate decides (W033); the
 * POSSESSION is the typed relation between them, and this file is its
 * contract surface.
 * Spec: spec/REQUIREMENTS.md R051 — "Possession has compatibility
 * evidence": the compatibility outcome types below carry exactly what was
 * proven (the `checked` evidence list) and every incompatibility names the
 * exact field/limit mismatch (the W032 envelope-breach style).
 *
 * Where the contracts live: unlike W032/W033 (whose canonical contracts
 * live in `packages/tradrl-world-contracts/src/agentBody.ts` /
 * `cognitiveSubstrate.ts`), the possession contracts are owned IN-PACKAGE —
 * this Work Order's frozen surface is `packages/possession/` only. The
 * possession domain is the agent-layer composition (it consumes the Body
 * and Substrate contracts through their registered subpath exports and
 * adds no world-contract shapes), so in-package ownership loses nothing;
 * if the program later wants the canonical file under the contracts
 * package (the `data.ts` precedent), `contracts.ts` is the one-file seam.
 *
 * This module is types + the small set of pure tables/predicates that
 * encode spec-stated invariants (the contracts-family law). Validators,
 * the compatibility checker, the lifecycle machine, the lineage chain and
 * the effective-agent projection live in this package's sibling modules.
 */

import type {
  AccountId,
  InstrumentId,
  OpaqueId,
  ParticipantId,
  RiskLimits,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type {
  BodyCommandKind,
  BodyDescriptor,
  BodyObservationKind,
  BodyValidationError,
  BodyView,
} from "tradrl-world-contracts/agentBody";
import type { BodyId } from "tradrl-world-contracts/agentBody";
import type {
  CognitiveSubstrateDescriptor,
  DecisionRateEnvelope,
  DecisionStreamValidationError,
  SubstrateError,
  SubstrateId,
} from "tradrl-world-contracts/cognitiveSubstrate";

/** The identity of one possession (opaque; DOMAIN-MODEL identity laws). */
export type PossessionId = OpaqueId<"PossessionId">;

/**
 * The principal that granted a possession (opaque): an operator, an
 * organization principal (the W039 seam) or a commissioning service (the
 * W043 seam) — whoever the `channel` names.
 */
export type PossessionPrincipalId = OpaqueId<"PossessionPrincipalId">;

/**
 * What bound the substrate to the body (closed set). `operator` — a human
 * principal through a console/API; `organization` — the W039 organization
 * compiler composing capabilities (design-for-both seam: not merged yet);
 * `commissioning` — the W043 autonomous commissioning path (seam).
 */
export type PossessionChannel = "operator" | "organization" | "commissioning";

/** The closed channel set (the runtime membership table). */
export const POSSESSION_CHANNELS: readonly PossessionChannel[] = [
  "operator",
  "organization",
  "commissioning",
];

/**
 * The possession grant: WHO bound this substrate to this body, through
 * WHAT channel, WHEN (a declared time — data, never a clock read; A9) and
 * on WHAT declared basis (rationale-as-data, the §10 discipline).
 */
export interface PossessionGrant {
  readonly grantedBy: PossessionPrincipalId;
  readonly channel: PossessionChannel;
  /** Declared grant time (simulation axis; never read from a clock). */
  readonly grantedAt: TimestampMs;
  /** Non-empty declared basis: why this substrate may possess this body. */
  readonly basis: string;
}

/**
 * The declared scope of one possession: what the grant covers. Every list
 * is an allow-list ⊆ the body's own declarations — the scope may NARROW
 * the substrate's authority through this body, never widen it:
 * - `instruments` ⊆ `body.embodiment.instruments` — where the composed
 *   agent may act and what it may observe;
 * - `observations` ⊆ the closed `BodyObservationKind` set — the view
 *   families the substrate needs (the maximal-view intersection at
 *   projection time);
 * - `commandKinds` ⊆ `body.embodiment.commandKinds` — what the composed
 *   agent may propose through this possession;
 * - `decisionRate` — the optional possession-level rate grant; the
 *   effective rate at projection is the tighter-of this and the
 *   substrate's declared rate envelope.
 * The fail-closed default of every list is the empty list (W032 law).
 */
export interface PossessionScope {
  readonly instruments: readonly InstrumentId[];
  readonly observations: readonly BodyObservationKind[];
  readonly commandKinds: readonly BodyCommandKind[];
  readonly decisionRate?: DecisionRateEnvelope;
}

/**
 * A possession declaration: the substrate descriptor × the body descriptor
 * + the grant (who/what bound them) + the declared scope. Declaration
 * only — enforcement belongs to the validators, the lifecycle and the
 * runtime (W035), never to this shape.
 */
export interface PossessionDescriptor {
  readonly possessionId: PossessionId;
  /** The possessed BODY (W032 — the part that acts). */
  readonly body: BodyDescriptor;
  /** The possessing SUBSTRATE (W033 — the part that decides). */
  readonly substrate: CognitiveSubstrateDescriptor;
  readonly grant: PossessionGrant;
  readonly scope: PossessionScope;
}

// --- lifecycle -----------------------------------------------------------------

/** Lifecycle states of one possession (the W032 attachment precedent). */
export type PossessionState =
  | "unpossessed" // declared, not yet possessed (initial)
  | "possessed" // the substrate holds the body: may propose within scope
  | "released"; // terminal: fail-closed, no observation, no proposals

/**
 * The possession lifecycle law (pure table, the W032 precedent):
 * - `unpossessed` → possess (compatibility-proven) or release (the
 *   discard-before-possession path);
 * - `possessed` → release (the always-legal kill switch);
 * - `released` is terminal — a released possession never re-possesses
 *   through the same record (a new possession is a new record).
 */
export const POSSESSION_LIFECYCLE_TRANSITIONS: Readonly<
  Record<PossessionState, readonly PossessionState[]>
> = {
  unpossessed: ["possessed", "released"],
  possessed: ["released"],
  released: [],
};

/** Why a possession was released (honest states, the BodyDetachReason family). */
export type PossessionReleaseReason =
  | "operator-request" // deliberate operator release
  | "body-detached" // the body's own W032 attachment lifecycle ended
  | "substrate-retired" // the substrate is gone (model deprecation/swap)
  | "rate-violation" // the runtime caught a decision-rate breach
  | "protocol-error"; // the transport/protocol layer failed

/** The possession record: one possession's honest lifecycle state. */
export interface PossessionRecord {
  readonly possessionId: PossessionId;
  readonly bodyId: BodyId;
  readonly substrateId: SubstrateId;
  readonly worldId: WorldId;
  readonly state: PossessionState;
  /** Present once released — why. */
  readonly releaseReason?: PossessionReleaseReason;
}

/** True when the state admits no further transitions (terminal law). */
export function isTerminalPossessionState(state: PossessionState): boolean {
  return POSSESSION_LIFECYCLE_TRANSITIONS[state].length === 0;
}

/** True only in the `possessed` state — the sole state that may act/observe. */
export function isPossessionHeld(state: PossessionState): boolean {
  return state === "possessed";
}

// --- validation ----------------------------------------------------------------

/** One loud, typed possession validation error (the W032 style). */
export interface PossessionError {
  readonly code: PossessionErrorCode;
  readonly message: string;
  readonly field?: string;
  /** Present on `invalid-body`: the W032 errors, verbatim (never re-derived). */
  readonly body?: readonly BodyValidationError[];
  /** Present on `invalid-substrate`: the W033 errors, verbatim. */
  readonly substrate?: readonly SubstrateError[];
}

/**
 * Validation error codes (closed set). Grouped: the grant, the scope, and
 * the consumed descriptor delegations.
 */
export type PossessionErrorCode =
  // grant structure
  | "blank-identity"
  | "unknown-channel"
  | "non-finite-time"
  | "blank-basis"
  // scope structure
  | "duplicate-scope-entry"
  | "unknown-observation-kind"
  | "scope-beyond-embodiment"
  | "invalid-rate-grant"
  // consumed descriptor delegations (errors carried verbatim)
  | "invalid-body"
  | "invalid-substrate";

/** The validation outcome: all errors, or ok (never a silent partial pass). */
export type PossessionValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly PossessionError[] };

// --- compatibility -------------------------------------------------------------

/**
 * The exact compared values of one incompatibility (the W032
 * `BodyEnvelopeBreach` style: `{limit, substrateValue, bodyValue}` — the
 * mismatch names the exact field and both sides, never a vague refusal).
 */
export interface PossessionMismatch {
  /** The exact limit/field that was compared. */
  readonly limit: string;
  /** The substrate-side value (canonical text). */
  readonly substrateValue: string;
  /** The body-side value (canonical text). */
  readonly bodyValue: string;
}

/**
 * The checks a compatibility outcome can name (the R051 evidence list —
 * `checked` says exactly what was proven, no more).
 */
export type PossessionCheckKind =
  | "descriptor-structure" // the possession descriptor validated
  | "embodied-command-kinds" // substrate.commandKinds ⊆ body embodiment
  | "rate-grant" // the substrate's rate envelope fits the scope grant
  | "body-attachment" // the W032 attach validation against a world
  | "decision-stream"; // the W033 stream validation + scope layer

/**
 * Incompatibility codes (closed set). Grouped: declaration-level (the
 * substrate × body composition), the W032 attach constraints, and the
 * decision-level scope layer (a stream beyond the possession's grant).
 */
export type PossessionIncompatibilityCode =
  // declaration level
  | "descriptor-invalid" // the possession descriptor failed validation
  | "command-kind-not-embodied" // a proposed kind outside the embodiment
  | "rate-beyond-grant" // the substrate's per-view cap exceeds the grant
  | "view-interval-below-grant" // the substrate expects tighter spacing than the grant honors
  // the W032 attach constraints
  | "body-attachment-failed" // the body cannot attach to the given world
  // the decision-level scope layer
  | "command-kind-not-in-scope" // a proposed kind outside the possession scope
  | "instrument-not-in-scope" // a touched instrument outside the scope
  | "stream-invalid"; // the W033 stream validation failed (verbatim errors)

/** One loud, typed incompatibility — can THIS substrate possess THIS body, and if not, why exactly. */
export interface PossessionIncompatibility {
  readonly code: PossessionIncompatibilityCode;
  readonly message: string;
  readonly field?: string;
  /** Present on every mismatch-family incompatibility: the exact compared values. */
  readonly mismatch?: PossessionMismatch;
  /** Present on `descriptor-invalid`: the validation errors, verbatim. */
  readonly descriptorErrors?: readonly PossessionError[];
  /** Present on `body-attachment-failed`: the W032 errors, verbatim. */
  readonly bodyErrors?: readonly BodyValidationError[];
  /** Present on `stream-invalid`: the W033 errors, verbatim. */
  readonly streamErrors?: readonly DecisionStreamValidationError[];
}

/**
 * The compatibility outcome: ok with the `checked` evidence list (what was
 * proven), or every incompatibility collected loudly. `streamDigest` is
 * present when a decision stream was proven — the content address of the
 * proven stream (the W033 `decisionStreamDigestOf` family), cited evidence
 * for R051.
 */
export type PossessionCompatibilityOutcome =
  | {
      readonly ok: true;
      readonly checked: readonly PossessionCheckKind[];
      readonly streamDigest?: string;
    }
  | {
      readonly ok: false;
      readonly incompatibilities: readonly PossessionIncompatibility[];
    };

// --- lineage -------------------------------------------------------------------

/**
 * One entry of a body's possession lineage: the content-addressed record
 * of ONE possession lifecycle event. The entry commits to the whole
 * possession declaration (`possessionDigest`, the W016 hashing family —
 * any later edit of the declaration breaks the chain), the event, the
 * resulting state, the declared time, and — through `chainLink` — its
 * predecessor (the W028 chain discipline).
 */
export interface PossessionLineageEntry {
  /** 0-based position in the body's history (the append order). */
  readonly sequence: number;
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
  readonly possessionId: PossessionId;
  /** The substrate this entry's possession binds (committed in the digest). */
  readonly substrateId: SubstrateId;
  /** The lifecycle event this entry records. */
  readonly event: PossessionEvent;
  /** The state of this possession AFTER the event (replay-verified). */
  readonly resultingState: PossessionState;
  /** Present once the resulting state is `released` — why. */
  readonly releaseReason?: PossessionReleaseReason;
  /** Content digest of the FULL possession declaration (committed forever). */
  readonly possessionDigest: string;
  /** Declared time of the recorded event (data, never a clock read). */
  readonly recordedAt: TimestampMs;
  /** Content digest of this entry's own core (the W016 hashing family). */
  readonly entryDigest: string;
  /** The predecessor entry's digest (`null` for the first entry). */
  readonly previousEntryDigest: string | null;
  /** `fnv1aChainHex([previousLink, entryDigest])` — cites its predecessor. */
  readonly chainLink: string;
}

/**
 * The possession history of ONE body: an ordered, content-addressed chain
 * (the W028 discipline). `head` is the last link — or the lineage anchor
 * for an empty history — and is the content address of this history (A9:
 * same events ⇒ same head, bit-for-bit).
 */
export interface PossessionLineage {
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
  readonly entries: readonly PossessionLineageEntry[];
  readonly head: string;
}

/** The lifecycle events a lineage records (same shapes the machine applies). */
export interface PossessEvent {
  readonly kind: "possess";
  /** The compatibility outcome that authorized this possession (R051). */
  readonly compatibility: PossessionCompatibilityOutcome;
}

export interface ReleasePossessionEvent {
  readonly kind: "release";
  readonly reason: PossessionReleaseReason;
}

export type PossessionEvent = PossessEvent | ReleasePossessionEvent;

/** Why a lineage extension was refused (fail-closed, typed; the lineage is never mutated). */
export type PossessionLineageErrorCode =
  | "lineage-scope-mismatch" // the descriptor belongs to another body/world
  | "non-finite-time" // recordedAt must be finite
  | "lineage-not-intact" // the chain being extended fails verification
  | "illegal-event" // the lifecycle machine refuses this event (transitionCode)
  | "body-already-possessed" // the one-substrate-at-a-time law
  | "possession-declaration-changed"; // same id, different declaration

/** Result of appending one event to a lineage (pure; refusal never mutates). */
export type PossessionLineageExtension =
  | { readonly ok: true; readonly lineage: PossessionLineage }
  | {
      readonly ok: false;
      readonly code: PossessionLineageErrorCode;
      readonly message: string;
      /** Present on `illegal-event`: the machine's own refusal code. */
      readonly transitionCode?: PossessionTransitionErrorCode;
      /** The unchanged lineage (the no-mutation law). */
      readonly lineage: PossessionLineage;
    };

/** The active-possession query result (typed; a body has at most one). */
export type ActivePossessionQuery =
  | {
      readonly ok: true;
      readonly possessionId: PossessionId;
      /** Sequence of the possess entry that made it active. */
      readonly sinceSequence: number;
    }
  | { readonly ok: false; readonly code: "no-active-possession" };

/** One possession's history query result (typed). */
export type PossessionHistoryQuery =
  | { readonly ok: true; readonly entries: readonly PossessionLineageEntry[] }
  | { readonly ok: false; readonly code: "unknown-possession" };

/** Why a lineage verification failed (typed, at the exact break index). */
export type PossessionLineageVerificationCode =
  | "sequence-mismatch" // entries out of order / renumbered
  | "body-mismatch" // an entry names another body/world
  | "entry-digest-mismatch" // an entry's content does not match its digest
  | "link-mismatch" // a link does not follow from its predecessor
  | "head-mismatch" // the recorded head is not the recomputed head
  | "illegal-transition" // an event the machine would have refused
  | "concurrent-possession" // two possessions held at once (forged history)
  | "possession-declaration-changed"; // same id, different declaration

/** The lineage verification outcome (local tamper evidence, the W028 law). */
export type PossessionLineageVerification =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: PossessionLineageVerificationCode;
      /** Sequence position (0-based) of the break. */
      readonly index: number;
      readonly detail: string;
    };

// --- the lifecycle machine (pure) ----------------------------------------------

/** Why a lifecycle transition was refused (fail-closed, typed). */
export type PossessionTransitionErrorCode =
  | "terminal-state" // released admits no events
  | "invalid-transition" // the event is not legal from this state
  | "possess-compatibility-failed"; // possess handed a failing compatibility

/** Result of applying one lifecycle event (pure; refusal never mutates). */
export type PossessionTransitionResult =
  | { readonly ok: true; readonly record: PossessionRecord }
  | {
      readonly ok: false;
      readonly code: PossessionTransitionErrorCode;
      readonly message: string;
      /** The unchanged record (the no-mutation law). */
      readonly record: PossessionRecord;
    };

// --- the effective agent (pure projection) --------------------------------------

/** The composed agent AS DATA — never a mutation (a pure projection). */
export interface EffectiveAgent {
  readonly possessionId: PossessionId;
  readonly bodyId: BodyId;
  readonly substrateId: SubstrateId;
  readonly worldId: WorldId;
  /** The world seat the composed agent acts through (A4/A15). */
  readonly participantId: ParticipantId;
  /** The account the composed agent's orders are margined against. */
  readonly accountId: AccountId;
  /** The body declaration, verbatim (W032). */
  readonly body: BodyDescriptor;
  /** The substrate declaration, verbatim (W033). */
  readonly substrate: CognitiveSubstrateDescriptor;
  /**
   * The effective command surface: substrate-declared ∩ scope-granted
   * (⊆ the body's embodiment) — the tighter-of intersection, in the
   * substrate's declared order.
   */
  readonly commandKinds: readonly BodyCommandKind[];
  /**
   * The effective instruments: the possession scope (⊆ the body's
   * embodiment) — where the composed agent may act.
   */
  readonly instruments: readonly InstrumentId[];
  /**
   * The view grant intersection: `maximalBodyView(body)` ∩ the possession
   * scope (instruments and observation families narrowed; identity and
   * account preserved) — the ONLY view the substrate receives through
   * this possession (A7).
   */
  readonly view: BodyView;
  /**
   * The effective decision rate: the tighter-of the substrate's declared
   * envelope and the possession's rate grant (the W032
   * `effectiveRiskEnvelope` precedent applied to the rate family).
   */
  readonly decisionRate: DecisionRateEnvelope;
  /**
   * The effective risk envelope: with a world, the W032
   * `effectiveRiskEnvelope(body.riskEnvelope, worldLimits)` — the
   * tighter-of intersection the runtime enforces for THIS agent; without
   * a world, the body's declared envelope verbatim (nothing to
   * intersect).
   */
  readonly riskEnvelope: RiskLimits;
}

/**
 * The projection outcome: ok for a compatible possession, or every
 * incompatibility collected loudly (the projection is only defined for a
 * compatible possession — fail-closed).
 */
export type EffectiveAgentProjection =
  | { readonly ok: true; readonly agent: EffectiveAgent }
  | {
      readonly ok: false;
      readonly incompatibilities: readonly PossessionIncompatibility[];
    };
