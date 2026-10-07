/**
 * Cognitive Substrate contracts — the W033 `contracts/agent` surface (the
 * `data.ts`/`agentBody.ts` precedent: a domain contracts file consumed
 * through the subpath export `tradrl-world-contracts/cognitiveSubstrate`;
 * the exports-map entry is a registered TL action item — consumers bridge
 * to this source until it lands).
 *
 * Spec: spec/WORK-ITEMS.md W033 — "Cognitive Substrate contract": the typed
 * contracts for an agent's MIND, the part that decides. Spec: spec/
 * REQUIREMENTS.md R050 "Agent Body distinct from model substrate"; spec/
 * ARCHITECTURE.md §12 "Agent = Body possessed by Cognitive Substrate".
 * Spec: spec/ARCHITECTURE.md §10 Evidence — "observation → decision metadata
 * → action → resulting state. No private model chain-of-thought is
 * stored": a Decision carries its rationale AS DATA (the declared rule and
 * its input signals), never a private chain-of-thought.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: a substrate is a pure
 * decision function; same views + same seed ⇒ same DecisionStream, never
 * wall time, never unseeded randomness.
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — time separation: the ONLY input is
 * the observed BodyView (the W032 A7-bounded observation extended with the
 * granted content); a substrate physically cannot see beyond the view
 * grant — there is no other input type, and content outside the grant is
 * a typed error, never silently seen.
 * Spec: spec/WORLD-PROTOCOL.md "Human/agent symmetry" (A4/A15): the
 * substrate PROPOSES world commands and never touches a port — the Body
 * executes through the same CommandPort everyone else uses.
 *
 * This module is types + the small set of pure tables/predicates that
 * encode spec-stated invariants (the contracts-family law). The view
 * firewall validator, the view digest, the stream validator and the
 * reference substrates live in the `cognitive-substrate` package (W033's
 * second surface, the W032 `agent-body` split).
 */

import type { OpaqueId, ParticipantId } from "./ids.js";
import type { TimestampMs } from "./primitives.js";
import type { BodyCommandKind, BodyView } from "./agentBody.js";
import type { WorldCommand } from "./commands.js";
import type { Order } from "./orders.js";
import type { Quote, OrderBookSnapshot, Trade } from "./market.js";
import type { Portfolio, Position } from "./portfolio.js";
import type { RiskState } from "./risk.js";
import type { InformationArtifact } from "./information.js";

/** The intelligence-plane identity of a Cognitive Substrate (opaque; R050). */
export type SubstrateId = OpaqueId<"SubstrateId">;

/** One decision's identity (opaque; deterministic by construction). */
export type DecisionId = OpaqueId<"DecisionId">;

/**
 * The digest of one observed view — what every decision cites. Computed by
 * the `cognitive-substrate` package over the WHOLE observed view using the
 * W016 hashing family (canonical JSON + FNV-1a, `stableDigest`), so view
 * digests agree with the engine's own content addressing (the W028 chain
 * discipline: the citation commits to everything the substrate saw).
 */
export type ViewDigest = string & { readonly __brand: "ViewDigest" };

/**
 * The two state modes (the substrate contract law): stateless-per-view —
 * each decide call is independent; declared-state — the substrate is a
 * seeded state machine whose state flows in and out of decide as data.
 */
export type SubstrateStateMode = "stateless-per-view" | "declared-state";

/** The closed state-mode set (the runtime membership table). */
export const SUBSTRATE_STATE_MODES: readonly SubstrateStateMode[] = [
  "stateless-per-view",
  "declared-state",
];

/**
 * The declared decision-rate envelope. `maxDecisionsPerView` is the per-
 * view cap one decide call may emit (validated loudly — a breach is a
 * typed error, never a silent truncation); `minViewIntervalMs` is the
 * declared minimum spacing between observed views the substrate expects —
 * a runtime-facing declaration (W035), not validated here.
 */
export interface DecisionRateEnvelope {
  readonly maxDecisionsPerView: number;
  readonly minViewIntervalMs?: number;
}

/**
 * A substrate's declaration: identity, the state mode, the seed, the
 * decision-rate envelope and the command kinds it may propose. Declaration
 * only — enforcement belongs to the validators, never to this shape.
 */
export interface CognitiveSubstrateDescriptor {
  readonly substrateId: SubstrateId;
  readonly displayName?: string;
  readonly stateMode: SubstrateStateMode;
  /** Non-empty. The determinism root (A9): same views + same seed ⇒ same decisions. */
  readonly seed: string;
  readonly decisionRate: DecisionRateEnvelope;
  /** The command kinds this substrate is declared to propose (no duplicates). */
  readonly commandKinds: readonly BodyCommandKind[];
}

/**
 * What a substrate may see: the W032 `BodyView` grant (scope only) plus the
 * GRANTED CONTENT at `asOf` — the A7-bounded observation. Every content
 * family is optional; its PRESENCE is lawful only inside the view grant
 * (a family's kind must be admitted by `observations`, market content must
 * be inside `instruments`, own-state must be the view's own account) —
 * violations are typed errors from the view validator, never silently seen.
 * This is the ONLY input type a substrate receives (A7).
 */
export interface ObservedBodyView extends BodyView {
  /** The body's world seat — proposed commands are issued by it. */
  readonly participantId: ParticipantId;
  /** The observation instant (simulation time; never wall time). */
  readonly asOf: TimestampMs;
  /** `market-quote`: latest top-of-book quotes (one per instrument at most). */
  readonly quotes?: readonly Quote[];
  /** `market-book`: order-book snapshots (one per instrument at most). */
  readonly books?: readonly OrderBookSnapshot[];
  /** `market-trades`: the recent public tape. */
  readonly trades?: readonly Trade[];
  /** `own-orders`: the body's own orders. */
  readonly ownOrders?: readonly Order[];
  /** `own-positions`: the body's own positions. */
  readonly ownPositions?: readonly Position[];
  /** `own-portfolio`: the body's account portfolio. */
  readonly portfolio?: Portfolio;
  /** `own-risk`: the body's account risk state. */
  readonly riskState?: RiskState;
  /** `information-artifacts`: visible artifacts (availableAt ≤ asOf, A7). */
  readonly artifacts?: readonly InformationArtifact<unknown>[];
}

/**
 * One rationale signal: a named scalar the declared rule used — the input
 * side of "rationale as data" (§10: decision metadata, never private
 * chain-of-thought).
 */
export interface RationaleSignal {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
}

/** The declared reasoning every decision carries as data (the auditability spine). */
export interface DecisionRationale {
  /** The named rule that fired (non-empty). */
  readonly rule: string;
  /** The rule's inputs, as data (at least one). */
  readonly signals: readonly RationaleSignal[];
  /** Deterministic human-readable summary (derived, never free-form chat). */
  readonly explanation: string;
}

/** The declared confidence ∈ [0,1] — the substrate's own, never defaulted. */
export type Confidence = number;

/**
 * One decision: a PROPOSED world command plus its declared reasoning. The
 * command is complete and deterministic (ids/identity/time derive from the
 * view — the substrate invents nothing); it is a proposal only — the Body
 * executes through the CommandPort (A4/A15), never the substrate.
 */
export interface Decision {
  readonly decisionId: DecisionId;
  /** The observed view this decision cites (the W028 chain discipline). */
  readonly viewDigest: ViewDigest;
  readonly command: WorldCommand;
  readonly rationale: DecisionRationale;
  readonly confidence: Confidence;
}

/**
 * The ordered, deterministic output of one decide call over one observed
 * view. Decisions are ordered as emitted; the stream is self-describing
 * (substrate identity, seed, the cited view digest, the observation asOf).
 */
export interface DecisionStream {
  readonly substrateId: SubstrateId;
  readonly seed: string;
  readonly viewDigest: ViewDigest;
  readonly asOf: TimestampMs;
  readonly decisions: readonly Decision[];
}

/** Opaque substrate state — the substrate defines the shape; must be serializable data. */
export type SubstrateState = Readonly<Record<string, unknown>>;

/** One loud, typed error (closed sets; extensions go through a contract change). */
export interface SubstrateError {
  readonly code: SubstrateErrorCode;
  readonly message: string;
  readonly field?: string;
}

/**
 * Substrate error codes, grouped: the observed-view firewall (fail-closed —
 * content beyond the grant is never silently seen), the state-mode laws,
 * and the descriptor structure.
 */
export type SubstrateErrorCode =
  // observed-view firewall (the A7 grant)
  | "non-finite-as-of"
  | "observation-kind-not-in-view"
  | "instrument-not-in-view"
  | "duplicate-projection"
  | "future-dated-content"
  | "account-mismatch"
  | "world-mismatch"
  | "artifact-not-available"
  | "malformed-decimal"
  // state-mode laws
  | "state-required" // declared-state called without state
  | "unexpected-state" // stateless-per-view handed state
  | "malformed-state" // a state that does not match the substrate's shape
  // descriptor structure
  | "blank-identity"
  | "unknown-state-mode"
  | "empty-seed"
  | "invalid-rate-envelope"
  | "unknown-command-kind"
  | "duplicate-command-kind";

/** The observed-view validation outcome: all errors, or ok. */
export type ObservedViewValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SubstrateError[] };

/** The input of one decide call. */
export interface SubstrateDecisionInput {
  readonly view: ObservedBodyView;
  /** Required for declared-state substrates (the prior next state, or the seed-derived initial state). */
  readonly state?: SubstrateState;
}

/** The outcome of one decide call: a stream, or typed errors (never a partial stream). */
export type SubstrateDecisionOutcome =
  | { readonly ok: true; readonly stream: DecisionStream; readonly state?: SubstrateState }
  | { readonly ok: false; readonly errors: readonly SubstrateError[] };

/**
 * A Cognitive Substrate: a pure decision function over observed body views.
 * `decide` is total, deterministic (A9) and fail-closed: an invalid view or
 * state is a typed error; the only effects are the returned data. No IO,
 * no clock reads, no randomness beyond the declared seed.
 */
export interface CognitiveSubstrate {
  readonly descriptor: CognitiveSubstrateDescriptor;
  /** Present exactly for declared-state substrates: the seed-derived initial state. */
  readonly initialState?: SubstrateState;
  decide(input: SubstrateDecisionInput): SubstrateDecisionOutcome;
}

/** One loud, typed decision-stream validation error. */
export interface DecisionStreamValidationError {
  readonly code: DecisionStreamValidationErrorCode;
  readonly message: string;
  readonly field?: string;
  /** Present on rate breaches: the emitted count and the declared cap. */
  readonly rate?: { readonly count: number; readonly max: number };
}

/**
 * Decision-stream validation error codes, grouped: stream-vs-descriptor,
 * stream-vs-body (the embodiment — a substrate producing commands outside
 * the body's embodiment is invalid, never silently clipped), and decision
 * well-formedness (the auditability spine: digests, rationale, confidence).
 */
export type DecisionStreamValidationErrorCode =
  // stream vs descriptor
  | "substrate-mismatch"
  | "seed-mismatch"
  | "rate-envelope-breach"
  | "command-kind-not-declared"
  // stream vs body embodiment
  | "command-kind-not-in-embodiment"
  | "instrument-not-in-embodiment"
  | "order-kind-not-in-embodiment"
  | "time-in-force-not-in-embodiment"
  | "issued-by-mismatch"
  | "account-mismatch"
  | "world-mismatch"
  // decision well-formedness
  | "issued-at-mismatch" // the substrate cannot invent time (no clock reads)
  | "view-digest-mismatch" // a decision citing a view other than its stream's
  | "malformed-decision-id"
  | "duplicate-decision-id"
  | "malformed-rationale"
  | "invalid-confidence";

/** The stream-validation outcome: all errors, or ok (never a silent partial pass). */
export type DecisionStreamValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly DecisionStreamValidationError[] };
