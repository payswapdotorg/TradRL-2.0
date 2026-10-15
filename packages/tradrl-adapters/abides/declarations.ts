/**
 * The kernel's declared types + the loud, complete validation of every
 * agent declaration (W024) — registered kind, known participant, one agent
 * per participant, account/identity agreement, declared instruments, wake
 * schedule. A malformed declaration never runs (fail-closed, ./errors.ts).
 *
 * Spec: spec/WORK-ITEMS.md W024 — "the reactive loop: participants wake on
 * (a) market events they observe and (b) their own scheduled wake times";
 * spec/ARCHITECTURE-LOCK.md A7 (the declared view IS the declaration).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  InstrumentId,
  ParticipantId,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type {
  ParticipantRuntimeTelemetry,
  ReactiveParticipantAgent,
} from "tradrl-world-contracts/participantProtocol";
import { AbidesAdapterError } from "./errors.js";
import { createAbidesAgent } from "./agents.js";
import type { AbidesWorldDefinition } from "./definition.js";


/** One agent's own scheduled wakes (the second wake source of the loop). */
export interface AbidesWakeSchedule {
  /** The wake interval — a positive integer of simulated milliseconds. */
  readonly everyMs: number;
  /**
   * The first wake (absolute simulation ms). Defaults to
   * `clockOrigin + everyMs`: the runtime's own initial pass at the settled
   * present is the agent's first observation; scheduled wakes follow.
   */
  readonly firstWakeMs?: TimestampMs;
}

/** One declared agent: kind + config + observation surface + wake schedule. */
export interface AbidesAgentDeclaration {
  /** Unique agent identity (telemetry attribution; fail-closed on reuse). */
  readonly agentId: string;
  /** The world participant this agent acts as (one agent per participant). */
  readonly participantId: ParticipantId;
  /** A REGISTERED ./agents.ts kind — anything else fails closed. */
  readonly kind: string;
  /** The kind's own configuration (validated by the kind's factory). */
  readonly config: unknown;
  /** The declared observation surface — the instruments the agent watches. */
  readonly viewInstruments: readonly InstrumentId[];
  /** Order-book depth served per watched instrument (the port `depth`). */
  readonly bookDepth?: number;
  /** Declared trade lookback (passed through to the W023 view config). */
  readonly tradeLookback?: number;
  /** Declared trade-tape window in simulated ms (the W023 view config). */
  readonly tradeWindowMs?: number;
  /** The agent's own scheduled wakes (required — reactive agents wake). */
  readonly wakeSchedule: AbidesWakeSchedule;
}

/** Input for {@link createAbidesKernel}. */
export interface AbidesKernelOptions {
  /** The validated-at-construction world definition (the whole market). */
  readonly definition: AbidesWorldDefinition;
  /** The reactive population (may be empty: a seed-only replay world). */
  readonly agents: readonly AbidesAgentDeclaration[];
  /**
   * The event-storm guard: the maximum messages ONE clock advance may
   * deliver before the kernel fails closed (`reactive-loop-overflow`).
   * Defaults to {@link DEFAULT_MESSAGE_BUDGET}.
   */
  readonly messageBudget?: number;
}

/** The reactive-loop kernel (see the module docstring for the transport law). */
export interface AbidesKernel {
  readonly worldId: WorldId;
  /** The simulation clock position (A7 — simulation time only). */
  now(): TimestampMs;
  /** Advance the clock by `deltaMs` (the definition's default step when omitted). */
  step(deltaMs?: number): Promise<TimestampMs>;
  /** Move the clock to an absolute simulation time (forward only) and drain. */
  seek(to: TimestampMs): Promise<TimestampMs>;
  /** The ordered world journal (A6 — sequences unique and monotonic). */
  events(): readonly WorldEventEnvelope[];
  /** One agent's complete W023 runtime telemetry (passes, views, outcomes). */
  telemetry(agentId: string): ParticipantRuntimeTelemetry;
  /** Messages delivered so far (diagnostics). */
  deliveredMessages(): number;
  /** Messages still queued (diagnostics). */
  queuedMessages(): number;
  /** Stop every runtime and close the fabric; further traffic fails closed. */
  dispose(): void;
}

/** One agent declaration that passed complete validation. */
export interface ValidatedAgentDeclaration {
  readonly declaration: AbidesAgentDeclaration;
  readonly agent: ReactiveParticipantAgent;
}

/**
 * Validate every agent declaration loudly and completely BEFORE anything
 * runs: identity, registration, one-agent-per-participant, view agreement,
 * and the wake schedule. Returns the validated declarations with their
 * registered W023 agents (kind factories run here — malformed kind
 * configurations fail closed too).
 */
export function validateAbidesAgentDeclarations(
  definition: AbidesWorldDefinition,
  agents: readonly AbidesAgentDeclaration[],
): readonly ValidatedAgentDeclaration[] {
  const participantsById = new Map(definition.participants.map((participant) => [String(participant.participantId), participant]));
  const instrumentIds = new Set(definition.instruments.map((instrument) => String(instrument.instrumentId)));

  // --- agent declarations: loud, complete validation BEFORE anything runs ---
  const validated: { readonly declaration: AbidesAgentDeclaration; readonly agent: ReactiveParticipantAgent }[] = [];
  const seenAgentIds = new Set<string>();
  const seenParticipants = new Set<string>();
  for (const declaration of agents) {
    if (typeof declaration.agentId !== "string" || declaration.agentId.trim().length === 0) {
      throw new AbidesAdapterError("malformed-agent-config", "an agent declaration has a blank agentId");
    }
    if (seenAgentIds.has(declaration.agentId)) {
      throw new AbidesAdapterError("duplicate-agent", `agentId ${declaration.agentId} is declared twice`);
    }
    seenAgentIds.add(declaration.agentId);
    const participant = participantsById.get(String(declaration.participantId));
    if (participant === undefined) {
      throw new AbidesAdapterError(
        "unknown-agent",
        `agent ${declaration.agentId} acts as participant ${String(declaration.participantId)} which is not in the world population`,
      );
    }
    if (seenParticipants.has(String(declaration.participantId))) {
      throw new AbidesAdapterError(
        "duplicate-agent",
        `participant ${String(declaration.participantId)} is already driven by another agent (one reactive actor per participant)`,
      );
    }
    seenParticipants.add(String(declaration.participantId));
    const agent = createAbidesAgent(declaration.kind, declaration.config);
    if (String(agent.participantId) !== String(declaration.participantId)) {
      throw new AbidesAdapterError(
        "view-config-mismatch",
        `agent ${declaration.agentId} (kind ${declaration.kind}) declares participant ${String(agent.participantId)} but its declaration says ${String(declaration.participantId)}`,
      );
    }
    if (String(agent.accountId) !== String(participant.accountId)) {
      throw new AbidesAdapterError(
        "view-config-mismatch",
        `agent ${declaration.agentId} trades account ${String(agent.accountId)} but participant ${String(participant.participantId)} trades ${String(participant.accountId)}`,
      );
    }
    for (const instrumentId of declaration.viewInstruments) {
      if (!instrumentIds.has(String(instrumentId))) {
        throw new AbidesAdapterError(
          "view-config-mismatch",
          `agent ${declaration.agentId} declares instrument ${String(instrumentId)} in its view, which the world does not list`,
        );
      }
    }
    const tradingInstrument = (declaration.config as { instrumentId?: InstrumentId } | null | undefined)?.instrumentId;
    if (
      tradingInstrument !== undefined &&
      !declaration.viewInstruments.some((id) => String(id) === String(tradingInstrument))
    ) {
      throw new AbidesAdapterError(
        "view-config-mismatch",
        `agent ${declaration.agentId} trades instrument ${String(tradingInstrument)} but its declared view does not watch it (it could never observe its own market)`,
      );
    }
    if (declaration.bookDepth !== undefined && (!Number.isInteger(declaration.bookDepth) || declaration.bookDepth < 1)) {
      throw new AbidesAdapterError("malformed-agent-config", `agent ${declaration.agentId} bookDepth must be a positive integer (got ${String(declaration.bookDepth)})`);
    }
    if (declaration.tradeLookback !== undefined && (!Number.isInteger(declaration.tradeLookback) || declaration.tradeLookback < 0)) {
      throw new AbidesAdapterError("malformed-agent-config", `agent ${declaration.agentId} tradeLookback must be a non-negative integer (got ${String(declaration.tradeLookback)})`);
    }
    if (declaration.tradeWindowMs !== undefined && (!Number.isInteger(declaration.tradeWindowMs) || declaration.tradeWindowMs < 0)) {
      throw new AbidesAdapterError("malformed-agent-config", `agent ${declaration.agentId} tradeWindowMs must be a non-negative integer (got ${String(declaration.tradeWindowMs)})`);
    }
    const schedule = declaration.wakeSchedule;
    if (typeof schedule !== "object" || schedule === null || !Number.isInteger(schedule.everyMs) || schedule.everyMs <= 0) {
      throw new AbidesAdapterError(
        "malformed-wake-schedule",
        `agent ${declaration.agentId} needs a positive integer everyMs (got ${String(schedule?.everyMs)})`,
      );
    }
    if (
      schedule.firstWakeMs !== undefined &&
      (!Number.isInteger(schedule.firstWakeMs) || Number(schedule.firstWakeMs) < Number(definition.clockOrigin))
    ) {
      throw new AbidesAdapterError(
        "malformed-wake-schedule",
        `agent ${declaration.agentId} firstWakeMs ${String(schedule.firstWakeMs)} precedes the clock origin ${String(definition.clockOrigin)}`,
      );
    }
    validated.push({ declaration, agent });
  }
  return validated;
}
