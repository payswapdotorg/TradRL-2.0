/**
 * The world-agent binding contracts (W044) — the typed DATA a binding
 * seals, and the closed typed error family. DATA only: the binding gates
 * live in ./binding.ts, the pure routing wiring in ./routing.ts, and the
 * whole-record re-validation in ./validate.ts.
 *
 * The chain this module sits in (ARCHITECTURE.md §12 — "Agent = Body
 * possessed by Cognitive Substrate. Organization discovers capabilities
 * and composes Bodies."): W032 bodies, W033 substrates, W034 possession
 * grants, W039 organizations + compiled binding plans, W041 forged
 * plans, W042 empirical substrate selection, W043 CommissionedBody
 * activation records — and THIS module is the MISSING BRIDGE: the typed
 * wiring record that attaches a commissioned agent (or a whole
 * organization, through its compiled plan) to a World. The
 * participant-slot attachment speaks the W023 vocabulary (the declared
 * world population `Participant`); the observation routing contract
 * speaks the W035 vocabulary (the declared observation surface
 * `ObservationProtocolConfig`); the action routing contract makes A13
 * STRUCTURAL — every authority channel cites the W034 possession grants
 * that authorize it, so execution authority is always OUTSIDE model
 * outputs (grants, never claims).
 *
 * A14 boundaries: a binding is wiring DATA + routing CONTRACTS — it
 * never executes trades, never steps a world, never trains. W045 owns
 * multi-agent populations; W047 owns the RL trainer bridge.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ObservationProtocolConfig } from "agent-world-protocol";
import type { CommissionedBodyValidationError, CommissionedId } from "body-forge/commissioning";
import type { OrganizationPositionId } from "organization";
import type {
  PossessionCheckKind,
  PossessionGrant,
  PossessionId,
  PossessionIncompatibility,
} from "possession";
import type { OpaqueId } from "skills";
import type {
  InstrumentId,
  Participant,
  ParticipantKind,
} from "tradrl-world-contracts";
import type { BodyCommandKind, BodyObservationKind } from "tradrl-world-contracts/agentBody";
import type { SubstrateId } from "tradrl-world-contracts/cognitiveSubstrate";

/** The identity of one world-agent binding (opaque; digest-derived). */
export type AgentBindingId = OpaqueId<"AgentBindingId">;

/** The binding id prefix (the W016 family convention). */
export const AGENT_BINDING_ID_PREFIX = "binding-";

// ---------------------------------------------------------------------------
// The grants input (the live authority material a binding opens from)
// ---------------------------------------------------------------------------

/**
 * One live authority grant: the W034 possession declaration VERBATIM plus
 * its lifecycle record — a possession whose record is not "possessed" (a
 * released/revoked possession) NEVER authorizes a channel, no matter how
 * compatible its descriptor once was (fail-closed).
 */
export interface BindingGrantEntry {
  readonly descriptor: import("possession").PossessionDescriptor;
  readonly record: import("possession").PossessionRecord;
}

/**
 * The typed grants input of one binding run: the W040 capability registry
 * the endowment is proven live against at binding time, plus the
 * possession grants backing every authority channel the binding may open
 * (A13: authority is granted, never claimed).
 */
export interface BindingGrants {
  readonly registry: import("capability-registry").CapabilityRegistry;
  readonly grants: readonly BindingGrantEntry[];
}

// ---------------------------------------------------------------------------
// The wiring records (what a binding seals)
// ---------------------------------------------------------------------------

/**
 * The world identity reference, as recorded: the explicit scope plus the
 * bound participant slots (the W023 declared population, carried
 * verbatim). This projection — not the whole WorldDefinition — is what
 * the content-addressed binding id weighs.
 */
export interface WorldBindingRef {
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly slots: readonly Participant[];
}

/**
 * The participant-slot attachment of one bound agent: WHICH declared W023
 * participant the commissioned body occupies, on which account, of which
 * kind, in which world.
 */
export interface ParticipantSlotAttachment {
  readonly participantId: string;
  readonly accountId: string;
  readonly kind: ParticipantKind;
  readonly worldId: string;
}

/** One observation route: a kind, its instruments, and the mind it reaches. */
export interface ObservationRoute {
  readonly kind: BodyObservationKind;
  readonly instruments: readonly InstrumentId[];
  readonly substrateId: SubstrateId;
}

/**
 * The observation routing contract: which protocol observations reach
 * which substrate surface. The `config` is a REAL W035
 * `ObservationProtocolConfig` (the declared observation surface a future
 * session would consume — carried in W035's own type); the routes are the
 * per-kind wiring (kind → instruments → substrate surface).
 */
export interface ObservationRoutingContract {
  readonly config: ObservationProtocolConfig;
  readonly routes: readonly ObservationRoute[];
}

/**
 * One grant's authority citation (A13): the possession id, the grant
 * VERBATIM, its content digest, and the W034 check kinds that were proven
 * WITH the world at binding time (R051 evidence, carried verbatim).
 */
export interface GrantAuthority {
  readonly possessionId: PossessionId;
  readonly grant: PossessionGrant;
  readonly grantDigest: string;
  readonly checked: readonly PossessionCheckKind[];
}

/**
 * One authority channel: a command kind, the instruments it may act on,
 * the commissioned possession it flows through, and the authority-proof
 * chain (every covering grant) that authorizes it.
 */
export interface AuthorityChannel {
  readonly commandKind: BodyCommandKind;
  readonly instruments: readonly InstrumentId[];
  readonly possessionId: PossessionId;
  readonly authority: readonly GrantAuthority[];
}

/**
 * The action routing contract: the authority channels — A13 made
 * structural. An action intent outside these channels is refused loudly
 * (./routing.ts); a channel without a covering grant never exists (the
 * gate refuses to seal one).
 */
export interface ActionRoutingContract {
  readonly channels: readonly AuthorityChannel[];
}

/**
 * The immutable binding lineage: the commissioned activation records this
 * binding extends (their ids and possession heads, never edited), and the
 * grant digests backing it (canonical order).
 */
export interface BindingLineage {
  readonly commissionedIds: readonly CommissionedId[];
  readonly commissionedHeads: readonly string[];
  readonly grantDigests: readonly string[];
}

/**
 * The binding provenance — deterministic DATA, never a clock read (A9):
 * the declared binding time (the latest declared grantedAt among the
 * backing grants), the W040 registry fingerprint committed to, and the
 * plan id (the forged plan for an agent binding, the compiled
 * organization id for an organization binding).
 */
export interface BindingProvenance {
  readonly boundAt: number;
  readonly registryFingerprint: string;
  readonly planId: string;
}

/** One agent, bound to one world participant slot. Typed DATA (A14). */
export interface AgentBinding {
  readonly bindingId: AgentBindingId;
  readonly kind: "agent";
  readonly world: WorldBindingRef;
  readonly slot: ParticipantSlotAttachment;
  readonly commissionedId: CommissionedId;
  readonly substrateId: SubstrateId;
  readonly observation: ObservationRoutingContract;
  readonly action: ActionRoutingContract;
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly lineage: BindingLineage;
  readonly provenance: BindingProvenance;
}

/**
 * One organization seat binding: the position (in canonical execution
 * order), the commissioned body filling it, its participant slot, and its
 * own observation/action routing contracts.
 */
export interface OrganizationSeatBinding {
  readonly positionId: OrganizationPositionId;
  readonly executionIndex: number;
  readonly commissionedId: CommissionedId;
  readonly slot: ParticipantSlotAttachment;
  readonly substrateId: SubstrateId;
  readonly observation: ObservationRoutingContract;
  readonly action: ActionRoutingContract;
}

/** A whole organization, bound through its compiled plan. Typed DATA. */
export interface OrganizationBinding {
  readonly bindingId: AgentBindingId;
  readonly kind: "organization";
  readonly world: WorldBindingRef;
  readonly compiledOrganizationId: string;
  readonly organizationId: string;
  /** One seat per position, in the compiled plan's canonical execution order. */
  readonly seats: readonly OrganizationSeatBinding[];
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly lineage: BindingLineage;
  readonly provenance: BindingProvenance;
}

/** Either binding shape (the routing functions accept both). */
export type WorldAgentBinding = AgentBinding | OrganizationBinding;

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type BindingErrorCode =
  | "invalid-registry" // the W040 gate refused the registry (carried verbatim)
  | "registry-scope-mismatch" // the registry's scope ≠ the world's
  | "invalid-commissioned-body" // commissioning's own validation refused (carried verbatim)
  | "scope-mismatch" // the world/body/plan scope disagreement
  | "unknown-participant-slot" // the W023 slot lookup failed (or account/kind/world disagree)
  | "invalid-plan" // the compiled plan's own recorded output laws (W039)
  | "plan-scope-mismatch" // the compiled plan's scope ≠ the world's
  | "uncommissioned-body" // a seat/body pair that does not match the compiled plan
  | "duplicate-seat" // the same position or commissioned body bound twice
  | "revoked-possession" // a grant entry's possession is not live (state carried)
  | "grant-record-mismatch" // a grant entry's record does not match its descriptor
  | "commissioned-grant-missing" // the grants input does not carry the commissioned possession
  | "possession-incompatible" // the W034 WITH-WORLD re-proof refused (verbatim)
  | "unregistered-capability" // the endowment's capability is not in the registry
  | "deprecated-capability" // the W040 lifecycle, carried loudly
  | "revoked-capability" // terminal, carried loudly
  | "instrument-not-in-world"; // the observation routing cites an undeclared instrument

/** One typed binding error (fail-closed; upstream errors carried verbatim). */
export interface BindingError {
  readonly code: BindingErrorCode;
  readonly message: string;
  readonly commissionedId?: string;
  readonly positionId?: string;
  readonly possessionId?: string;
  readonly participantId?: string;
  readonly capabilityId?: string;
  /** Present on `invalid-registry`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly unknown[];
  /** Present on `invalid-commissioned-body`: commissioning's own errors, verbatim. */
  readonly commissioningErrors?: readonly CommissionedBodyValidationError[];
  /** Present on `possession-incompatible`: W034's own incompatibilities, verbatim. */
  readonly incompatibilities?: readonly PossessionIncompatibility[];
  /** Present on deprecated/revoked-capability: the W040 lifecycle transitions, carried VERBATIM. */
  readonly lifecycle?: readonly { readonly to: string; readonly reason: string }[];
  /** Present on `revoked-possession`: the record's honest terminal state. */
  readonly possessionState?: string;
  readonly releaseReason?: string;
}

export type AgentBindingOutcome =
  | { readonly ok: true; readonly binding: AgentBinding }
  | { readonly ok: false; readonly errors: readonly BindingError[] };

export type OrganizationBindingOutcome =
  | { readonly ok: true; readonly binding: OrganizationBinding }
  | { readonly ok: false; readonly errors: readonly BindingError[] };
