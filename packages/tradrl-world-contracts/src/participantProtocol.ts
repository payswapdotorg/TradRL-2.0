/**
 * The reactive participant protocol (W023) — the typed contract family for
 * REACTIVE participants: agents that observe the world's settled projection
 * views and issue commands in reaction, through the SAME CommandPort human
 * traders use.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — "human and AI traders use the same
 * World Protocol; headless parity"; every participant terminates at the same
 * typed CommandPort (WORLD-PROTOCOL.md "Human/agent symmetry"). This module
 * extends the {@link Participant} family (./participant.ts — the DECLARED
 * world population) with the runtime protocol a reactive participant codes
 * against; it introduces no new execution path, no engine reach-through and
 * no back door — commands typed here are exactly the CommandPort commands of
 * ./commands.ts.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the information firewall: a reactive
 * participant sees the world ONLY through the projection views the ports
 * serve "as available then" (quotes/books/trades/portfolio/risk, each
 * firewalled at the port boundary by availableAt and the clock position).
 * {@link ParticipantSettledView} carries nothing a port could not serve.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the protocol's event-loop
 * law is that a participant reacts to SETTLED views, never to mid-flight
 * state; commands serialize FIFO with the engine's own arrival-order queue.
 * Same world + same settled views ⇒ same command stream.
 *
 * This file is TYPE-ONLY (the ./ports.ts precedent): the reference runtime +
 * reference agents live in packages/tradrl-market-participants/.
 */

import type {
  AccountId,
  InstrumentId,
  OrderId,
  ParticipantId,
} from "./ids.js";
import type { Quantity, TimestampMs } from "./primitives.js";
import type {
  NewsItem,
  OrderBookSnapshot,
  Quote,
  Trade,
} from "./market.js";
import type { Instrument } from "./instrument.js";
import type { Order } from "./orders.js";
import type { Portfolio } from "./portfolio.js";
import type { RiskState } from "./risk.js";
import type {
  ClockPort,
  ClockView,
  CommandPort,
  QueryPort,
} from "./ports.js";
import type {
  CommandResult,
  OrderSubmission,
} from "./commands.js";

// ---------------------------------------------------------------------------
// The settled view (what a reactive participant may observe)
// ---------------------------------------------------------------------------

/**
 * The declared view set of one reactive participant runtime: which
 * instruments it watches, which account's financial projections it reads and
 * with which declared lookbacks. Everything else stays unobserved — the
 * declared set IS the observation surface (A7).
 */
export interface ParticipantViewConfig {
  /** Instruments whose quotes/books/trades the runtime reads, in order. */
  readonly instruments: readonly InstrumentId[];
  /** The account whose portfolio/risk/own-orders views are read. */
  readonly accountId: AccountId;
  /** Order-book depth per instrument (the port's `depth` argument). */
  readonly bookDepth?: number;
  /** How many most-recent observable trades to read per instrument. */
  readonly tradeLookback?: number;
  /** Trade-tape window: `from` bound of the trades query (simulation ms). */
  readonly tradeWindowMs?: number;
  /** Whether the news view (available-then information artifacts) is read. */
  readonly includeNews?: boolean;
}

/**
 * One settled view of the world, as served by the QueryPort at a settled
 * clock position. Every member is a port projection (never engine state):
 * trades are availableAt-firewalled, news is observable-then, and the
 * observation time is the engine's own clock position — a participant cannot
 * see future-dated information through this shape (A7).
 */
export interface ParticipantSettledView {
  /** The settled simulation time the view was read at (the clock position). */
  readonly observedAt: TimestampMs;
  /** The engine's clock view at observation time. */
  readonly clock: ClockView;
  /** The watched instruments' definitions (tick/lot sizes for tick math). */
  readonly instruments: readonly Instrument[];
  /** Top-of-book quote per watched instrument (declared order). */
  readonly quotes: readonly Quote[];
  /** Order-book snapshot per watched instrument (declared order). */
  readonly books: readonly OrderBookSnapshot[];
  /** Observable trades per watched instrument, oldest-first, port-ordered. */
  readonly trades: readonly Trade[];
  /** The account's portfolio projection (positions, cash, P&L). */
  readonly portfolio: Portfolio;
  /** The account's risk projection (limits in force, breach history). */
  readonly risk: RiskState;
  /** The account's OWN orders (the venue's record, filtered to the account). */
  readonly orders: readonly Order[];
  /** News items observable at the observation time (when declared). */
  readonly news?: readonly NewsItem[];
}

// ---------------------------------------------------------------------------
// The decision (what a reactive participant may want)
// ---------------------------------------------------------------------------

/**
 * A trading intent: WHAT the agent wants, without command identity. The
 * runtime stamps the full command (commandId, worldId, issuedBy, issuedAt,
 * accountId) and issues it through the CommandPort — the single path.
 */
export type ParticipantOrderIntent =
  | {
      readonly kind: "submit-order";
      readonly instrumentId: InstrumentId;
      readonly submission: OrderSubmission;
    }
  | {
      readonly kind: "cancel-order";
      readonly orderId: OrderId;
      readonly reason?: string;
    }
  | {
      readonly kind: "replace-order";
      readonly orderId: OrderId;
      readonly quantity?: Quantity;
      readonly reason?: string;
      /** Replace fields; unset fields keep their current values. */
      readonly limitPrice?: OrderSubmission["limitPrice"];
      readonly stopPrice?: OrderSubmission["stopPrice"];
      readonly constraints?: OrderSubmission["constraints"];
    }
  | {
      readonly kind: "close-position";
      readonly instrumentId: InstrumentId;
    };

/**
 * One agent's decision over one settled view. `decide` is PURE: the same view
 * (and the same agent configuration, including any declared seed) always
 * yields the same decision — the A9 law at the participant boundary.
 * `rationale` is a deterministic, human-readable one-line explanation (never
 * model free text; R073 keeps chain-of-thought out of the protocol).
 */
export interface ParticipantDecision {
  readonly intents: readonly ParticipantOrderIntent[];
  readonly rationale: string;
}

/**
 * A reactive participant agent: a pure decision function over settled views.
 * Agents hold NO ports and NO engine references — the runtime issues their
 * intents through the CommandPort (A4/A15: the same port humans use).
 */
export interface ReactiveParticipantAgent {
  /** Stable agent identity (telemetry attribution; not an engine id). */
  readonly agentId: string;
  /** The declared world participant this agent acts as. */
  readonly participantId: ParticipantId;
  /** The account the agent's commands trade through. */
  readonly accountId: AccountId;
  /** One-line description of the agent's declared policy. */
  readonly description: string;
  /** Decide over one settled view. Pure; never throws for reachable views. */
  decide(view: ParticipantSettledView): ParticipantDecision;
}

// ---------------------------------------------------------------------------
// The runtime protocol (how reaction is disciplined)
// ---------------------------------------------------------------------------

/**
 * The typed outcome of one issued intent: the CommandPort's own CommandResult
 * (acked with the engine's ack, or rejected with the typed stage/code) —
 * participants consume typed outcomes, never fabricated success.
 */
export interface ParticipantCommandOutcome {
  readonly agentId: string;
  readonly intentIndex: number;
  readonly commandId: string;
  readonly result: CommandResult;
}

/** One completed runtime pass: the settled view, the decisions, the outcomes. */
export interface ParticipantPassRecord {
  /** Pass sequence number (deterministic: one per settled-view reaction). */
  readonly pass: number;
  readonly observedAt: TimestampMs;
  readonly view: ParticipantSettledView;
  readonly decisions: ReadonlyMap<string, ParticipantDecision>;
  readonly outcomes: readonly ParticipantCommandOutcome[];
}

/** Runtime status under the event-loop discipline. */
export type ParticipantRuntimeStatus =
  | "created" // constructed, not started
  | "idle" // started; no pass in flight; awaiting the next settled view
  | "reacting" // a pass is in flight (view → decide → command)
  | "failed" // a port/transport call failed closed; the runtime stopped
  | "stopped"; // disposed by the operator

/**
 * The telemetry surface every participant runtime serves: the complete,
 * ordered record of what it observed and what it issued. Deterministic
 * replay of the same world + clock stream yields identical telemetry (A9).
 */
export interface ParticipantRuntimeTelemetry {
  readonly status: ParticipantRuntimeStatus;
  /** The world the runtime is attached to (opaque pane identity). */
  readonly worldId: string;
  /** Completed passes, oldest-first. */
  readonly passes: readonly ParticipantPassRecord[];
  /** Count of settled clock views received (views may coalesce into passes). */
  readonly viewsReceived: number;
  /** Every issued command's typed outcome, issuance order. */
  readonly outcomes: readonly ParticipantCommandOutcome[];
  /** Count of acked commands. */
  readonly acked: number;
  /** Count of rejected commands (typed rejections are outcomes, not errors). */
  readonly rejected: number;
  /** The first fail-closed error, when status is "failed". */
  readonly failure?: unknown;
}

/**
 * The minimal typed client surface a participant runtime consumes: the three
 * world ports plus the settled-view channel (`onClock` — pushed after acked
 * mutating clock calls; the clock channel's law). Structurally satisfied by
 * the engine-backed world client the tool surfaces consume — a participant
 * and a human pane drive the SAME provider surface (A4/A15, headless parity).
 */
export interface ReactiveParticipantWorldClient {
  readonly worldId: string;
  readonly query: QueryPort;
  readonly command: CommandPort;
  readonly clock: ClockPort;
  /** Settled clock views (the reaction trigger; never mid-flight state). */
  onClock(listener: (clock: ClockView) => void): () => void;
}
