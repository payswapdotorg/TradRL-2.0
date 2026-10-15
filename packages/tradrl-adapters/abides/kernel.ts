/**
 * The reactive-loop kernel (W024) — the deterministic scheduler that orders
 * messages (arrival = send time + the sender's declared latency, resolved as
 * keyed seeded draws) and wakes agents on (a) observed market events and
 * (b) their own scheduled wake times, driving every participant through the
 * REAL W023 seam and emitting the venue's ordered WorldEvents into one
 * monotonic journal (A6).
 *
 * Spec: spec/WORK-ITEMS.md W024; spec/ARCHITECTURE-LOCK.md A6 (ordered
 * events, one journal), A7 (simulation time only — zero wall-time reads;
 * the agent clock surface fails closed on playback controls), A9
 * (determinism: fixed definition + seed + message stream ⇒ identical
 * results — test/determinism.twin.test.ts), A14 (simulated-only).
 *
 * Layering (README.md "Package layout"): the declaration types and their
 * loud validation live in ./declarations.ts; the per-agent
 * latency-firewalled W023 client in ./agentClient.ts; the delivery fan-out
 * (propagate, the issuer-result floor, wake re-arming) in ./propagation.ts;
 * the world's birth (opening book, wake arming) in ./genesis.ts. This module
 * owns the clock, the fabric, the drain discipline and the kernel API.
 *
 * THE DRAIN DISCIPLINE: one message is delivered, then exactly one
 * macrotask hop runs every microtask chain queued by that delivery (runtime
 * passes, promise continuations) to its next blocking point before the next
 * delivery — reaction order equals message order, and the kernel's behavior
 * never depends on the operator's await pattern. Twin runs and
 * step-partition changes produce deep-equal journals (tested).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  CausationId,
  CorrelationId,
  ProducerId,
  TimestampMs,
  WorldCommand,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { ParticipantRuntimeTelemetry } from "tradrl-world-contracts/participantProtocol";
import { createParticipantRuntime } from "tradrl-market-participants/runtime";
import { AbidesAdapterError } from "./errors.js";
import { createMessageScheduler, type AbidesMessage, type OrderCommandPayload } from "./messaging.js";
import {
  abidesWorldDigest,
  validateAbidesWorldDefinition,
} from "./definition.js";
import { createExchangeProcess, type ExecutionOutcome } from "./exchange.js";
import type { ExecutionContext } from "./execution.js";
import { worldCreatedEvent } from "./events.js";
import {
  type AbidesAgentDeclaration,
  type AbidesKernel,
  type AbidesKernelOptions,
  type AbidesWakeSchedule,
  validateAbidesAgentDeclarations,
} from "./declarations.js";
import { AbidesAgentClient } from "./agentClient.js";
import { createPropagation, type AgentEntry } from "./propagation.js";
import { bootstrapOpeningState } from "./genesis.js";

// The kernel's public declared types are re-exported for surface stability
// (package.json "./kernel" + index.ts `export * from "./kernel.js"`).
export type {
  AbidesAgentDeclaration,
  AbidesKernel,
  AbidesKernelOptions,
  AbidesWakeSchedule,
} from "./declarations.js";

/** The default per-advance message budget (the event-storm guard). */
export const DEFAULT_MESSAGE_BUDGET = 100_000;

/** The kernel's producer identity (world/operator events). */
const KERNEL_PRODUCER = "abides-kernel" as ProducerId;

/** One macrotask hop: every queued microtask chain runs before it resolves. */
function yieldToMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Create the reactive-loop kernel. EVERYTHING structural is validated loudly
 * at construction (fail-closed, ./errors.ts): the world definition, every
 * agent declaration (./declarations.ts), and the message budget. A
 * malformed world never runs.
 */
export function createAbidesKernel(options: AbidesKernelOptions): AbidesKernel {
  const { definition } = options;
  validateAbidesWorldDefinition(definition);
  const messageBudget = options.messageBudget ?? DEFAULT_MESSAGE_BUDGET;
  if (!Number.isInteger(messageBudget) || messageBudget < 1) {
    throw new AbidesAdapterError(
      "malformed-world-definition",
      `messageBudget must be a positive integer (got ${String(options.messageBudget)})`,
    );
  }

  // --- agent declarations: loud, complete validation BEFORE anything runs ---
  const validated = validateAbidesAgentDeclarations(definition, options.agents);
  const participantsById = new Map(definition.participants.map((participant) => [String(participant.participantId), participant]));

  // --- the venue, the journal, the fabric -----------------------------------
  const exchange = createExchangeProcess(definition);
  const journal: WorldEventEnvelope[] = [];
  let clockNow: TimestampMs = definition.clockOrigin;
  let closed = false;
  let messageCounter = 0;

  const worldCreated = worldCreatedEvent(
    {
      worldId: definition.worldId,
      stamper: { stamp: exchange.nextStamp },
      occurredAt: definition.clockOrigin,
      causationId: `abides-world-creation:${String(definition.worldId)}` as CausationId,
      correlationId: `abides-world-creation:${String(definition.worldId)}` as CorrelationId,
      producer: KERNEL_PRODUCER,
    },
    { definitionDigest: abidesWorldDigest(definition) },
  );
  journal.push(worldCreated);

  const scheduler = createMessageScheduler({
    now: () => clockNow,
    nextMessageId: () => `msg-${String((messageCounter += 1))}`,
  });

  const assertOpen = (): void => {
    if (closed) {
      throw new AbidesAdapterError(
        "message-after-close",
        "the kernel is disposed — no further messages may be enqueued or delivered",
      );
    }
  };
  const enqueue = (message: Omit<AbidesMessage, "messageId" | "sequence">): AbidesMessage => {
    assertOpen();
    return scheduler.enqueue(message);
  };

  // --- the agents: one latency-firewalled client + one REAL W023 runtime ----
  // (the account/instrument fan-out maps live in ./propagation.ts, which owns
  // the delivery fan-out; the kernel keeps only the agent-id → client index)
  const entries: AgentEntry[] = [];
  const clientsByAgentId = new Map<string, AbidesAgentClient>();
  for (const { declaration, agent } of validated) {
    const latency = definition.participantLatency[String(declaration.participantId)]!;
    const client = new AbidesAgentClient({
      worldId: String(definition.worldId),
      agent,
      viewInstruments: declaration.viewInstruments,
      exchange,
      latency,
      seed: definition.seed,
      clockOrigin: definition.clockOrigin,
      enqueue,
    });
    const runtime = createParticipantRuntime({
      client,
      agents: [agent],
      views: {
        instruments: declaration.viewInstruments,
        accountId: agent.accountId,
        ...(declaration.bookDepth === undefined ? {} : { bookDepth: declaration.bookDepth }),
        ...(declaration.tradeLookback === undefined ? {} : { tradeLookback: declaration.tradeLookback }),
        ...(declaration.tradeWindowMs === undefined ? {} : { tradeWindowMs: declaration.tradeWindowMs }),
      },
    });
    const entry: AgentEntry = { declaration, agent, latency, client, runtime };
    entries.push(entry);
    clientsByAgentId.set(agent.agentId, client);
  }

  // --- the delivery fan-out: propagate + the issuer-result floor ----------
  const { propagate, issuerResultFloor, armNextWake } = createPropagation({
    definition,
    exchange,
    participantsById,
    entries,
    enqueue,
  });

  /** Process one venue-arrived command: full lifecycle, journal, propagate. */
  const deliverCommand = (message: AbidesMessage, command: WorldCommand): void => {
    const ctx: ExecutionContext = {
      now: clockNow,
      causationId: message.messageId as CausationId,
      correlationId: (command.correlationId ?? message.messageId) as CorrelationId,
      nextStamp: exchange.nextStamp,
    };
    const issuer = clientsByAgentId.get(message.from);
    let outcome: ExecutionOutcome;
    try {
      outcome = exchange.process(command, ctx);
    } catch (error) {
      // Fail closed BOTH ways: the issuer's port promise rejects (the W023
      // runtime records the failure and stops reacting) and the error
      // propagates to the operator who stepped the clock.
      issuer?.failPending(String(command.commandId), error);
      throw error;
    }
    journal.push(...outcome.events);
    propagate(command, outcome, ctx);
    issuerResultFloor(command, outcome, ctx);
  };

  /** Deliver ONE message (synchronous; reactions run on the following yield). */
  const deliver = (message: AbidesMessage): void => {
    assertOpen();
    switch (message.messageClass) {
      case "order-command": {
        const { command } = message.payload as OrderCommandPayload;
        deliverCommand(message, command);
        return;
      }
      case "order-delivery": {
        clientsByAgentId.get(message.to)?.acceptDelivery(message);
        return;
      }
      case "market-data": {
        clientsByAgentId.get(message.to)?.acceptMarketData(message);
        return;
      }
      case "agent-wake": {
        const client = clientsByAgentId.get(message.to);
        if (client !== undefined) {
          client.acceptWake(message);
          const entry = entries.find((candidate) => candidate.agent.agentId === message.to);
          if (entry !== undefined) {
            armNextWake(entry, message.arriveAt);
          }
        }
        return;
      }
      default: {
        const unknownClass: never = message.messageClass;
        throw new Error(`[abides:kernel] unknown message class: ${String(unknownClass)}`);
      }
    }
  };

  // --- the world's birth: the opening book + every agent's wake schedule --
  bootstrapOpeningState({
    definition,
    exchange,
    journal,
    entries,
    participantsById,
    enqueue,
    propagate,
    worldCreated,
  });

  // --- start the REAL W023 runtimes (the initial pass runs on microtasks) --
  for (const entry of entries) {
    entry.runtime.start();
  }

  /** Drain every message deliverable at/before `target`, in fabric order. */
  const advanceTo = async (target: TimestampMs): Promise<TimestampMs> => {
    // Let the runtimes' construction-time chains (their initial passes) run
    // at the construction frontier BEFORE the first delivery of this advance,
    // so the kernel's behavior never depends on the operator's await pattern.
    await yieldToMicrotasks();
    let delivered = 0;
    for (;;) {
      const head = scheduler.peek();
      if (head === undefined || Number(head.arriveAt) > Number(target)) {
        break;
      }
      const message = scheduler.pop()!;
      if (Number(message.arriveAt) > Number(clockNow)) {
        clockNow = message.arriveAt;
      }
      deliver(message);
      delivered += 1;
      if (delivered > messageBudget) {
        throw new AbidesAdapterError(
          "reactive-loop-overflow",
          `one clock advance to ${String(target)} delivered more than ${String(messageBudget)} messages (event-storm guard — fail closed)`,
        );
      }
      // One macrotask hop: every microtask chain queued by this delivery
      // (runtime passes, promise continuations) runs to its next blocking
      // point before the drain looks at the fabric again.
      await yieldToMicrotasks();
    }
    if (Number(clockNow) < Number(target)) {
      clockNow = target;
    }
    return clockNow;
  };

  return {
    worldId: definition.worldId,
    now(): TimestampMs {
      return clockNow;
    },
    async step(deltaMs): Promise<TimestampMs> {
      assertOpen();
      const stepMs = deltaMs ?? definition.defaultStepMs;
      if (!Number.isInteger(stepMs) || stepMs <= 0) {
        throw new AbidesAdapterError(
          "invalid-clock-command",
          `step() needs a positive integer of simulated milliseconds (got ${String(stepMs)})`,
        );
      }
      return advanceTo((Number(clockNow) + stepMs) as TimestampMs);
    },
    async seek(to): Promise<TimestampMs> {
      assertOpen();
      if (!Number.isInteger(to) || Number(to) < Number(definition.clockOrigin)) {
        throw new AbidesAdapterError(
          "invalid-clock-command",
          `seek() needs an absolute simulation time ≥ the clock origin ${String(definition.clockOrigin)} (got ${String(to)})`,
        );
      }
      if (Number(to) < Number(clockNow)) {
        throw new AbidesAdapterError(
          "invalid-clock-command",
          `seek(${String(to)}) is backwards — the simulation clock is at ${String(clockNow)} and the journal is append-only`,
        );
      }
      return advanceTo(to);
    },
    events(): readonly WorldEventEnvelope[] {
      return [...journal];
    },
    telemetry(agentId): ParticipantRuntimeTelemetry {
      const entry = entries.find((candidate) => candidate.agent.agentId === agentId);
      if (entry === undefined) {
        throw new AbidesAdapterError(
          "unknown-agent",
          `no agent '${String(agentId)}' is registered in this kernel (registered: ${
            entries.map((candidate) => candidate.agent.agentId).join(", ") || "none"
          })`,
        );
      }
      return entry.runtime.telemetry();
    },
    deliveredMessages(): number {
      return scheduler.delivered;
    },
    queuedMessages(): number {
      return scheduler.size;
    },
    dispose(): void {
      if (closed) {
        return;
      }
      closed = true;
      for (const entry of entries) {
        entry.runtime.stop();
      }
    },
  };
}
