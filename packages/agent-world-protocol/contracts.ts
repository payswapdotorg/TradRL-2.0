/**
 * The observation/action protocol contracts (W035) — the typed bridge
 * between a POSSESSED AGENT (W032 Body + W033 Substrate + W034 Possession)
 * and a WORLD (the W023 reactive participant seam).
 *
 * Spec: spec/WORK-ITEMS.md W035 — "Observation/action protocol": how an
 * agent observes the world and acts in it. The composed agent (W034's
 * `EffectiveAgent` — Body possessed by Substrate) meets the world through
 * the SAME typed ports humans use (spec/ARCHITECTURE-LOCK.md A4/A15 —
 * human/agent symmetry, headless parity): the session observes SETTLED
 * port projections only (A7 — the W023 settled-view discipline), and its
 * substrate's proposals issue through the single CommandPort only after
 * the W033 stream law admits them (commands outside the embodiment NEVER
 * issue — never silently clipped).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the observation grant: the W032
 * view-grant machinery (`maximalBodyView` ∩ the W034 possession scope,
 * projected by W034) bounds WHAT the substrate may see; the W023
 * coherence-guarded read bounds WHEN it may see it (settled views, never
 * mid-flight, never future); artifacts with `availableAt` after the
 * observation instant are WITHHELD AND NAMED.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the protocol holds no
 * clocks, no counters that depend on wall time and no unseeded randomness;
 * `issuedAt` is the settled view's simulation time and command ids are the
 * substrate's deterministic ids. Same world + same agent + same clock
 * stream ⇒ identical command streams and telemetry, wall clocks apart.
 *
 * Where the contracts live: like W034 (whose domain is the agent-layer
 * composition), the protocol contracts are owned IN-PACKAGE — this Work
 * Order's frozen surface is `packages/agent-world-protocol/` only. The
 * protocol CONSUMES the registered contracts subpaths
 * (`tradrl-world-contracts/agentBody`, `/cognitiveSubstrate`,
 * `/participantProtocol`) and the sibling agent packages through their
 * package specifiers; it adds no world-contract shapes.
 *
 * This module is types + the small set of pure tables/predicates that
 * encode spec-stated invariants (the contracts-family law). The
 * observation reader, the action issuer and the composed session live in
 * the sibling modules (`observation.ts`, `action.ts`, `session.ts`).
 */

import type {
  CommandId,
  CommandResult,
  InstrumentId,
  TimestampMs,
} from "tradrl-world-contracts";
import type {
  BodyAttachment,
  BodyObservationGrant,
  BodyObservationKind,
  BodyCommandKind,
  BodyId,
} from "tradrl-world-contracts/agentBody";
import type {
  CognitiveSubstrate,
  DecisionId,
  DecisionStream,
  ObservedBodyView,
  SubstrateId,
  ViewDigest,
} from "tradrl-world-contracts/cognitiveSubstrate";
import type { ReactiveParticipantWorldClient } from "tradrl-world-contracts/participantProtocol";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type {
  EffectiveAgent,
  PossessionCompatibilityOutcome,
  PossessionDescriptor,
  PossessionId,
  PossessionIncompatibility,
  PossessionRecord,
} from "possession/contracts";

// ---------------------------------------------------------------------------
// The world seam (the W023 reactive participant client)
// ---------------------------------------------------------------------------

/**
 * The world a session bridges to: the W023 typed client surface — the three
 * World ports plus the settled-view channel, structurally satisfied by the
 * engine-backed world client the human surfaces consume (A4/A15: an agent
 * and a human pane drive the SAME provider; there is no agent-only port).
 */
export type AgentWorldClient = ReactiveParticipantWorldClient;

// ---------------------------------------------------------------------------
// The observation grant protocol (what the agent observes, at what rate)
// ---------------------------------------------------------------------------

/**
 * The declared observation surface of one session (the W023 view-config
 * law applied to the agent view): which observation families the substrate
 * reads, on which instruments, with which port-level read knobs. Every
 * field may only NARROW the effective view (the W034 projection) — a
 * config beyond the view is a typed attach refusal, never a per-pass
 * denial; the declared set IS the observation surface (A7).
 */
export interface ObservationProtocolConfig {
  /** Observation families read per view (⊆ `agent.view.observations`). */
  readonly kinds: readonly BodyObservationKind[];
  /** Instruments read per view (⊆ `agent.view.instruments`; default: all). */
  readonly instruments?: readonly InstrumentId[];
  /** Order-book depth per instrument (the port's `depth` argument). */
  readonly bookDepth?: number;
  /** Trade-tape window: `from` bound of each trades read (simulation ms). */
  readonly tradeWindowMs?: number;
}

/** One observation-config violation at attach (typed, with the offenders). */
export interface ObservationConfigError {
  readonly code:
    | "kind-beyond-view" // a kind the effective view does not admit
    | "instrument-beyond-view" // an instrument outside the effective view
    | "duplicate-config-entry" // a repeated kind/instrument
    | "unknown-observation-kind" // not a BodyObservationKind at all
    | "invalid-book-depth" // < 1 or not an integer
    | "invalid-trade-window"; // negative or non-finite
  readonly message: string;
}

/**
 * One observation, as data (the observed-stream contract): the settled
 * instant, the W032 grant (every ungranted request denied by name;
 * future-dated artifacts WITHHELD AND NAMED), the observed view actually
 * fed to the substrate (the W033 input — granted content only), and its
 * W033 content digest (the citation every decision from it carries).
 */
export interface AgentObservation {
  readonly asOf: TimestampMs;
  readonly grant: BodyObservationGrant;
  readonly view: ObservedBodyView;
  readonly viewDigest: ViewDigest;
}

/** Why an observation read failed closed (typed; the session records it). */
export interface ObservationFailure {
  readonly code:
    | "torn-read-exhausted" // the clock never settled under the reader
    | "grant-inconsistency"; // the port served content the grant refuses
  readonly message: string;
}

// ---------------------------------------------------------------------------
// The action protocol (how proposals become WorldCommands)
// ---------------------------------------------------------------------------

/** The typed outcome of one issued command (the port's own result, verbatim). */
export interface AgentCommandOutcome {
  readonly decisionId: DecisionId;
  readonly commandId: CommandId;
  readonly commandKind: BodyCommandKind;
  readonly result: CommandResult;
}

/** The action result of one decision stream: the admission, then the outcomes. */
export interface AgentActionResult {
  /**
   * The admission gate: W034's decision-level check — W033's
   * `validateDecisionStream` (the stream vs the BODY's embodiment) plus
   * the possession-scope layer (the stream vs the POSSESSION's narrower
   * grant). A failing admission issues NOTHING (never a partial stream).
   */
  readonly admission: PossessionCompatibilityOutcome;
  /** Issuance order (FIFO); EMPTY whenever the admission refused the stream. */
  readonly outcomes: readonly AgentCommandOutcome[];
}

// ---------------------------------------------------------------------------
// The session (the composed lifecycle)
// ---------------------------------------------------------------------------

/** Session states: created → attached → detached | failed. */
export type AgentSessionStatus =
  | "created" // constructed; the gates have not run
  | "attached" // attach passed: the machines are active; may observe/act
  | "detached" // terminal: the composed lifecycle ended (fail-closed)
  | "failed"; // terminal: a transport/protocol failure stopped the session

/**
 * Why a session was detached. Mapped onto the two composed machines: the
 * W032 attachment (its own `BodyDetachReason` family) and the W034
 * possession (its own `PossessionReleaseReason` family).
 */
export type AgentSessionDetachReason =
  | "operator-request" // the operator's kill switch
  | "world-closed" // the world session ended (the transport closed)
  | "protocol-error"; // the transport/protocol layer failed

/** One completed pass: observation → decision → admission → action, as data. */
export interface AgentPassRecord {
  /** Pass sequence number (deterministic: one per completed reaction). */
  readonly pass: number;
  /** The settled simulation time the pass observed at. */
  readonly observedAt: TimestampMs;
  readonly observation: AgentObservation;
  /** The substrate's stream, verbatim (the W033 output). */
  readonly stream: DecisionStream;
  /** The stream's content digest (recorded even when admission refused). */
  readonly streamDigest: string;
  /** The admission gate's outcome (a refusal NEVER issues commands). */
  readonly admission: PossessionCompatibilityOutcome;
  /** The issued commands' typed outcomes, in issuance order. */
  readonly outcomes: readonly AgentCommandOutcome[];
}

/**
 * The telemetry surface (the W023 pass-record precedent, composed): the
 * complete, ordered record of what the session observed and what it
 * issued, plus the three composed lifecycle records. Deterministic replay
 * of the same world + agent + clock stream yields identical telemetry (A9).
 */
export interface AgentSessionTelemetry {
  readonly status: AgentSessionStatus;
  readonly worldId: string;
  readonly possessionId: PossessionId;
  readonly bodyId: BodyId;
  readonly substrateId: SubstrateId;
  /**
   * The composed agent as data (the W034 projection this session runs) —
   * present once the possession projects (world-lessly at construction,
   * against the bound world once attached); absent for a possession that
   * projects to nothing (honest: there is no effective agent to show).
   */
  readonly effectiveAgent?: EffectiveAgent;
  /** The W032 attachment record (the Body's lifecycle). */
  readonly attachment: BodyAttachment;
  /** The W034 possession record (the possession's lifecycle). */
  readonly possession: PossessionRecord;
  /** Completed passes, oldest-first. */
  readonly passes: readonly AgentPassRecord[];
  /** Count of settled clock views received (views may coalesce into passes). */
  readonly viewsReceived: number;
  /** Count of settled views the declared rate spacing refused to observe. */
  readonly observationsSkipped: number;
  /** Every issued command's typed outcome, issuance order. */
  readonly outcomes: readonly AgentCommandOutcome[];
  /** Count of acked commands. */
  readonly acked: number;
  /** Count of rejected commands (typed rejections are outcomes, not errors). */
  readonly rejected: number;
  /** Count of streams the admission gate refused (commands never issued). */
  readonly admissionRefused: number;
  /** The first fail-closed failure, when status is "failed". */
  readonly failure?: unknown;
}

/** Why an attach was refused (closed set; every refusal is typed). */
export type AgentAttachErrorCode =
  | "already-attached" // attach ran twice
  | "session-terminal" // the session was detached/failed before attach
  | "possession-incompatible" // the W034 gate refused (incompatibilities verbatim)
  | "substrate-descriptor-mismatch" // the live substrate is not the declared one
  | "client-world-mismatch" // the client serves another world
  | "definition-world-mismatch" // the definition is not the client's world
  | "invalid-observation-config" // the config is beyond the effective view
  | "client-unreachable"; // the attach clock handshake failed closed

/** The attach outcome: ok, or the typed refusal (the session stays created). */
export type AgentSessionAttachOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: AgentAttachErrorCode;
      readonly message: string;
      /** Present on `possession-incompatible`: the W034 incompatibilities, verbatim. */
      readonly incompatibilities?: readonly PossessionIncompatibility[];
      /** Present on `invalid-observation-config`: the offending entries. */
      readonly configErrors?: readonly ObservationConfigError[];
      /** Present on `client-unreachable`: the handshake failure. */
      readonly cause?: unknown;
    };

/** The detach outcome: ok, or the typed refusal (terminal stays terminal). */
export type AgentSessionDetachOutcome =
  | { readonly ok: true; readonly status: AgentSessionStatus }
  | { readonly ok: false; readonly code: "session-terminal"; readonly message: string };

/** Input for {@link import("./session.js").createAgentWorldSession}. */
export interface AgentSessionOptions {
  /** The world client (the W023 typed seam; the SAME ports humans use). */
  readonly client: AgentWorldClient;
  /** The W034 possession declaration (data): body × substrate + grant + scope. */
  readonly possession: PossessionDescriptor;
  /** The live W033 substrate whose `descriptor` must be the declared one. */
  readonly substrate: CognitiveSubstrate;
  /** The world definition the body binds at attach (the W032/W034 gate input). */
  readonly world: WorldDefinition;
  /** The observation protocol config (default: everything the view grants). */
  readonly observation?: ObservationProtocolConfig;
}

/** A live agent-world session (see `session.ts` for the discipline). */
export interface AgentSession {
  /**
   * The attach gate (typed, fail-closed): the W034 possession check (with
   * the W032 world binding), the live-substrate identity, the client/
   * definition world match, the observation config, and a live clock
   * handshake. A refusal leaves the session (and both composed machines)
   * untouched; ok turns both machines active.
   */
  attach(): Promise<AgentSessionAttachOutcome>;
  /** Subscribe + run the initial pass at the settled present. Idempotent. */
  start(): void;
  /** Resolve when quiet (no pass in flight, no pending view). Rejects when failed. */
  settle(): Promise<void>;
  /**
   * The composed kill switch (always legal — even before attach, the
   * discard path both machines honor). The reason maps onto the W032
   * detach reason and the W034 release reason.
   */
  detach(reason: AgentSessionDetachReason): AgentSessionDetachOutcome;
  /** The ordered record of what was observed and what was issued. */
  telemetry(): AgentSessionTelemetry;
  /** Observe each completed pass (live consumers; never reorders anything). */
  onPass(listener: (record: AgentPassRecord) => void): () => void;
}

/**
 * The attach-resolved observation protocol: the config validated against
 * the effective view, with the defaults filled in (the instruments default
 * to the view's; the artifact universe is the world's declared artifacts —
 * the W032 grant judges THAT list, so future-dated artifacts are named as
 * withheld even though the port would never serve them).
 */
export interface ResolvedObservationProtocol {
  /** The effective agent (the W034 projection the session runs). */
  readonly agent: EffectiveAgent;
  /** The validated observation kinds (declaration order preserved). */
  readonly kinds: readonly BodyObservationKind[];
  /** The validated instruments (declaration order preserved). */
  readonly instruments: readonly InstrumentId[];
  /** The port's `depth` argument for book reads (when configured). */
  readonly bookDepth?: number;
  /** The trades `from` offset (when configured). */
  readonly tradeWindowMs?: number;
  /** The world's declared information artifacts (the grant's universe). */
  readonly declaredArtifacts: readonly import("tradrl-world-contracts").InformationArtifact<unknown>[];
}
