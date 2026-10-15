/**
 * The world's birth (W024) — the genesis the kernel runs at construction:
 * the opening book (seed orders placed AT the venue at the clock origin,
 * through the SAME command path as everything else) and the arming of every
 * agent's wake schedule. The opening auction is part of the world's birth —
 * seed orders do not travel; their EFFECTS reach observers under the same
 * availability + latency law (README.md "Declared policies").
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  CausationId,
  CommandId,
  CorrelationId,
  Participant,
  TimestampMs,
  WorldCommand,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import { type AbidesMessage, type AgentWakePayload } from "./messaging.js";
import type { AbidesWorldDefinition } from "./definition.js";
import type { ExchangeProcess, ExecutionOutcome } from "./exchange.js";
import type { ExecutionContext } from "./execution.js";
import type { AgentEntry } from "./propagation.js";

/** Everything the genesis needs from the kernel. */
export interface GenesisContext {
  readonly definition: AbidesWorldDefinition;
  readonly exchange: ExchangeProcess;
  readonly journal: WorldEventEnvelope[];
  readonly entries: readonly AgentEntry[];
  readonly participantsById: ReadonlyMap<string, Participant>;
  readonly enqueue: (message: Omit<AbidesMessage, "messageId" | "sequence">) => AbidesMessage;
  readonly propagate: (command: WorldCommand, outcome: ExecutionOutcome, ctx: ExecutionContext) => void;
  readonly worldCreated: WorldEventEnvelope;
}

/** Place the opening book and arm every agent's wake schedule. */
export function bootstrapOpeningState(context: GenesisContext): void {
  const { definition, exchange, journal, entries, participantsById, enqueue, propagate, worldCreated } = context;

  // --- the opening book: seed orders, placed AT the venue at the origin ----
  // (the opening auction is part of the world's birth — they do not travel;
  //  their EFFECTS reach observers under the same availability + latency law).
  for (const [index, seed] of definition.seedOrders.entries()) {
    const participant = participantsById.get(String(seed.participantId))!;
    const command: WorldCommand = {
      kind: "submit-order",
      commandId: `seed-${String(index)}` as CommandId,
      worldId: definition.worldId,
      issuedBy: seed.participantId,
      issuedAt: definition.clockOrigin,
      accountId: participant.accountId,
      instrumentId: seed.instrumentId,
      submission: {
        kind: "limit",
        side: seed.side,
        quantity: seed.quantity,
        limitPrice: seed.price,
        constraints: { timeInForce: "GTC" },
      },
    };
    const ctx: ExecutionContext = {
      now: definition.clockOrigin,
      causationId: worldCreated.eventId as unknown as CausationId,
      correlationId: `abides-world-creation:${String(definition.worldId)}` as CorrelationId,
      nextStamp: exchange.nextStamp,
    };
    const outcome = exchange.process(command, ctx);
    journal.push(...outcome.events);
    propagate(command, outcome, ctx);
  }

  // --- arm every agent's wake schedule (default: origin + one interval) ----
  for (const entry of entries) {
    const everyMs = entry.declaration.wakeSchedule.everyMs;
    const firstWake =
      entry.declaration.wakeSchedule.firstWakeMs ?? (Number(definition.clockOrigin) + everyMs) as TimestampMs;
    enqueue({
      messageClass: "agent-wake",
      from: entry.agent.agentId,
      to: entry.agent.agentId,
      sentAt: definition.clockOrigin,
      arriveAt: firstWake,
      payload: { reason: "scheduled-wake" } satisfies AgentWakePayload,
    });
  }
}
