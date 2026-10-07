/**
 * Agent Body contracts — the W032 `contracts/agent` surface (the `data.ts`
 * precedent: a domain contracts file consumed through the subpath export
 * `tradrl-world-contracts/agentBody`; the exports-map entry is a registered
 * TL action item — consumers bridge to this source until it lands).
 *
 * Spec: spec/WORK-ITEMS.md W032 — "Agent Body contracts": the typed
 * contracts for an agent's BODY, the part that acts in a world. The Body
 * carries NO intelligence — that is W033's Cognitive Substrate
 * (spec/REQUIREMENTS.md R050 "Agent Body distinct from model substrate";
 * spec/ARCHITECTURE.md §12 "Agent = Body possessed by Cognitive Substrate").
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — human/agent symmetry and headless
 * parity: a Body acts in its world ONLY as a world participant terminating
 * at the same typed CommandPort (spec/WORLD-PROTOCOL.md "Human/agent
 * symmetry"). These contracts expose no back door.
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — authority outside prompts: the risk
 * envelope is a DECLARATION in the A13 `RiskLimits` shape; enforcement
 * belongs to the runtime gate (W015), never to prompt text. A Body whose
 * declared envelope exceeds the world's declared limits is INVALID at
 * attach — never silently clipped.
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — time separation: a Body observes
 * available-then projections only; the information firewall is typed here
 * as the BodyView observation contract.
 * Spec: spec/DOMAIN-MODEL.md "Future intelligence entities" (AgentBody) and
 * "Identity laws" (ids are opaque; tenant/project/world scope is explicit).
 *
 * Interop law: a Body IS a participant declaration plus the envelope —
 * `bodyAsParticipant` projects the W003 `Participant` shape. The W023-era
 * reactive participant surfaces extend the same seat; `participantKind`
 * consumes whatever `ParticipantKind` union is merged at the consuming
 * base (the design-for-both seam).
 *
 * This module is types + the small set of pure tables/predicates that
 * encode spec-stated invariants (the contracts-family law). Validators and
 * the lifecycle state machine as pure data transforms live in the
 * `agent-body` package (W032's second surface).
 */

import type {
  AccountId,
  InformationArtifactId,
  InstrumentId,
  OpaqueId,
  ParticipantId,
  VenueId,
  WorldId,
  WorldScope,
} from "./ids.js";
import type { TimestampMs } from "./primitives.js";
import type { OrderKind, TimeInForce } from "./orders.js";
import type { RiskLimits } from "./risk.js";
import type { Participant, ParticipantKind } from "./participant.js";
import type { WorldCommand } from "./commands.js";

/** The intelligence-plane identity of a Body (opaque; R050). */
export type BodyId = OpaqueId<"BodyId">;

/**
 * The command kinds a Body may issue — exactly the `WorldCommand` kind
 * discriminants (A4/A15: a Body terminates at the same CommandPort; there
 * is no body-only command channel).
 */
export type BodyCommandKind = WorldCommand["kind"];

/** The closed command-kind set (the runtime membership table). */
export const BODY_COMMAND_KINDS: readonly BodyCommandKind[] = [
  "submit-order",
  "cancel-order",
  "replace-order",
  "close-position",
  "add-annotation",
  "create-snapshot",
  "branch-world",
  "set-scenario",
];

/** The closed order-kind set a Body may declare (World Alpha `OrderKind`). */
export const BODY_ORDER_KINDS: readonly OrderKind[] = [
  "market",
  "limit",
  "stop",
  "stop-limit",
];

/** The closed time-in-force set a Body may declare. */
export const BODY_TIME_IN_FORCE: readonly TimeInForce[] = ["GTC", "IOC", "FOK"];

/**
 * The embodiment declaration: what the Body may touch and issue inside its
 * bound world. Every list is an explicit allow-list; the fail-closed default
 * is the empty list (a Body that may touch nothing).
 */
export interface BodyEmbodiment {
  /** Instruments this Body may touch (must exist in the bound world). */
  readonly instruments: readonly InstrumentId[];
  /** Venues this Body may reach (must be declared in the bound world). */
  readonly venues: readonly VenueId[];
  /** Order kinds this Body may issue (subset of the venue's policy). */
  readonly orderKinds: readonly OrderKind[];
  /** Time-in-force policies this Body may declare on its submissions. */
  readonly timeInForce: readonly TimeInForce[];
  /** Command kinds this Body may issue through the CommandPort. */
  readonly commandKinds: readonly BodyCommandKind[];
}

/**
 * A Body's declaration: identity, the bound world scope, the participant
 * seat it occupies, its embodiment and its risk envelope. Declaration
 * only — the A13 runtime gate enforces the envelope, never this shape.
 */
export interface BodyDescriptor {
  readonly bodyId: BodyId;
  /** Explicit tenant/project/world scope (DOMAIN-MODEL identity laws). */
  readonly scope: WorldScope;
  /** The world-side participant seat the Body acts through (A4). */
  readonly participantId: ParticipantId;
  /** The account the Body's orders are margined against. */
  readonly accountId: AccountId;
  /**
   * The participant kind of the occupied seat. The W003 closed set has no
   * "agent" kind — W023 (contracts/participants) owns that extension;
   * this field flows through the widened union unchanged (design-for-both).
   */
  readonly participantKind: ParticipantKind;
  readonly displayName?: string;
  readonly embodiment: BodyEmbodiment;
  /**
   * The declared risk envelope (A13 shape). Where both the Body and the
   * world declare a limit, the Body's declaration must be at least as
   * tight — a looser declaration is invalid at attach, never clipped.
   */
  readonly riskEnvelope: RiskLimits;
}

/**
 * A Body IS a participant declaration plus the envelope (the W032 interop
 * law): project the W003 `Participant` this Body occupies.
 */
export function bodyAsParticipant(descriptor: BodyDescriptor): Participant {
  return {
    participantId: descriptor.participantId,
    worldId: descriptor.scope.worldId,
    kind: descriptor.participantKind,
    ...(descriptor.displayName === undefined
      ? {}
      : { displayName: descriptor.displayName }),
    accountId: descriptor.accountId,
  };
}

/** Projection families a Body may observe (the BodyView surface). */
export type BodyObservationKind =
  | "market-quote" // quotes for embodied instruments
  | "market-book" // order-book snapshots for embodied instruments
  | "market-trades" // the public tape for embodied instruments
  | "own-orders" // the Body's own orders
  | "own-positions" // the Body's own positions
  | "own-portfolio" // the Body's account portfolio
  | "own-risk" // the Body's account risk state
  | "information-artifacts"; // the information world, behind the A7 firewall

/** The closed observation-kind set (the runtime membership table). */
export const BODY_OBSERVATION_KINDS: readonly BodyObservationKind[] = [
  "market-quote",
  "market-book",
  "market-trades",
  "own-orders",
  "own-positions",
  "own-portfolio",
  "own-risk",
  "information-artifacts",
];

/**
 * What a Body may observe: its embodied instruments' market projections,
 * its own account state, and the information world — always available-then
 * (A7). A view can be declared tighter than the embodiment, never wider.
 */
export interface BodyView {
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
  /** Instruments whose market projections are observable (⊆ embodiment). */
  readonly instruments: readonly InstrumentId[];
  /** Observation families this view admits (⊆ the closed set). */
  readonly observations: readonly BodyObservationKind[];
  /** The account whose own-state projections are visible. */
  readonly accountId: AccountId;
}

/**
 * The maximal legal view of a Body (its full embodiment and account). A
 * declared view may be tighter; validators reject anything wider.
 */
export function maximalBodyView(descriptor: BodyDescriptor): BodyView {
  return {
    bodyId: descriptor.bodyId,
    worldId: descriptor.scope.worldId,
    instruments: descriptor.embodiment.instruments,
    observations: BODY_OBSERVATION_KINDS,
    accountId: descriptor.accountId,
  };
}

/** A Body's observation request: what it wants to see, as of when. */
export interface BodyObservationRequest {
  /** The observation axis (simulation time; A7 — never wall time). */
  readonly asOf: TimestampMs;
  /** Observation families requested. */
  readonly kinds: readonly BodyObservationKind[];
  /** Instruments requested (defaults to the view's instruments). */
  readonly instruments?: readonly InstrumentId[];
  /** Information artifacts requested (defaults to none). */
  readonly artifacts?: readonly InformationArtifactId[];
}

/** Why a requested observation was not granted (named, never dropped). */
export interface BodyObservationDenial {
  readonly code:
    | "kind-not-in-view" // the view does not admit this observation family
    | "instrument-not-in-view" // the instrument is outside the view's scope
    | "unknown-artifact" // the requested artifact does not exist
    | "non-finite-as-of"; // asOf must be finite
  readonly message: string;
}

/**
 * The granted observation surface at `asOf` — the A7 firewall made typed:
 * artifacts with `availableAt` after `asOf` are withheld AND NAMED; market
 * projections are granted as-of the same instant only.
 */
export interface BodyObservationGrant {
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
  readonly asOf: TimestampMs;
  /** Granted observation families (⊆ requested ∩ view). */
  readonly kinds: readonly BodyObservationKind[];
  /** Granted instruments (⊆ requested ∩ view). */
  readonly instruments: readonly InstrumentId[];
  /** Artifacts visible at `asOf` (`availableAt` ≤ `asOf`). */
  readonly visibleArtifacts: readonly InformationArtifactId[];
  /** Artifacts withheld at `asOf` (`availableAt` > `asOf`) — named. */
  readonly withheldArtifacts: readonly InformationArtifactId[];
  /** Every ungranted request, with its reason. */
  readonly denials: readonly BodyObservationDenial[];
}

/** Lifecycle states of a Body's attachment to its world. */
export type BodyAttachmentState =
  | "unattached" // declared, not bound to a live world session (initial)
  | "active" // attached and validated: may act within embodiment + envelope
  | "detached"; // terminal: fail-closed, no observation, no commands

/** Why a Body left the attached state (honest detach states). */
export type BodyDetachReason =
  | "operator-request" // deliberate operator detach
  | "world-closed" // the world session ended
  | "embodiment-violation" // runtime caught an action outside the embodiment
  | "envelope-violation" // runtime caught an order beyond the envelope
  | "protocol-error"; // the transport/protocol layer failed

/**
 * The attachment lifecycle law (pure table, the orders.ts precedent):
 * - `unattached` → attach (validated) or detach (discard before attach);
 * - `active` → detach (the always-legal kill switch);
 * - `detached` is terminal — a Body never re-attaches through the same
 *   attachment (a new lifecycle is a new attachment record).
 */
export const BODY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<BodyAttachmentState, readonly BodyAttachmentState[]>
> = {
  unattached: ["active", "detached"],
  active: ["detached"],
  detached: [],
};

/** True when the attachment state admits no further transitions. */
export function isTerminalBodyAttachmentState(
  state: BodyAttachmentState,
): boolean {
  return BODY_LIFECYCLE_TRANSITIONS[state].length === 0;
}

/** True only in the `active` state — the sole state that may act/observe. */
export function isBodyActive(state: BodyAttachmentState): boolean {
  return state === "active";
}

/** The attachment record: the Body's honest lifecycle state. */
export interface BodyAttachment {
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
  readonly state: BodyAttachmentState;
  /** Present once detached — why. */
  readonly detachReason?: BodyDetachReason;
}

/** The attach event carries its validation outcome (the machine stays pure). */
export interface AttachBodyEvent {
  readonly kind: "attach";
  readonly validation: BodyValidationOutcome;
}

export interface DetachBodyEvent {
  readonly kind: "detach";
  readonly reason: BodyDetachReason;
}

export type BodyAttachmentEvent = AttachBodyEvent | DetachBodyEvent;

/** Why a lifecycle transition was refused (fail-closed, typed). */
export type BodyTransitionErrorCode =
  | "terminal-state" // detached admits no events
  | "invalid-transition" // the event is not legal from this state
  | "attach-validation-failed"; // attach handed a failing validation

/** Result of applying one lifecycle event (pure; refusal never mutates). */
export type BodyAttachmentTransitionResult =
  | { readonly ok: true; readonly attachment: BodyAttachment }
  | {
      readonly ok: false;
      readonly code: BodyTransitionErrorCode;
      readonly message: string;
      /** The unchanged attachment (the no-mutation law). */
      readonly attachment: BodyAttachment;
    };

/** The `RiskLimits` fields an envelope may declare (the A13 shape). */
export type RiskLimitField = keyof RiskLimits;

/** An envelope breach: the exact compared values (never silently clipped). */
export interface BodyEnvelopeBreach {
  /** The limit field that was exceeded. */
  readonly limit: RiskLimitField;
  /** The Body's declared value (canonical text). */
  readonly bodyValue: string;
  /** The world's declared limit (canonical text). */
  readonly worldValue: string;
}

/** One loud, typed validation error. */
export interface BodyValidationError {
  readonly code: BodyValidationErrorCode;
  readonly message: string;
  readonly field?: string;
  /** Present on envelope breaches: the exact compared values. */
  readonly envelope?: BodyEnvelopeBreach;
}

/**
 * Validation error codes (closed set, World Alpha; extensions go through a
 * contract change). Grouped: descriptor structure, view, world binding,
 * envelope.
 */
export type BodyValidationErrorCode =
  // descriptor structure
  | "blank-identity"
  | "duplicate-embodiment-entry"
  | "unknown-command-kind"
  | "unknown-order-kind"
  | "unknown-time-in-force"
  | "embodiment-consistency"
  | "invalid-limit-shape"
  // view
  | "scope-mismatch"
  | "unknown-observation-kind"
  | "view-beyond-embodiment"
  // world binding
  | "world-mismatch"
  | "unknown-participant"
  | "unknown-account"
  | "participant-account-mismatch"
  | "participant-kind-mismatch"
  | "unknown-instrument"
  | "unknown-venue"
  | "instrument-venue-mismatch"
  | "order-kind-not-allowed"
  | "account-not-tradable"
  // envelope vs world limits
  | "envelope-currency-mismatch"
  | "envelope-exceeds-world-limits";

/** The validation outcome: all errors, or ok (never a silent partial pass). */
export type BodyValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly BodyValidationError[] };
