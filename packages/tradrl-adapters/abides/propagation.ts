/**
 * The kernel's delivery fan-out (W024) — how one processed command's
 * outcome reaches the reactive world as ORDERED fabric traffic:
 *
 * - `propagate`: `order-delivery` to every agent whose account the command
 *   touched (the issuer's carries the typed `CommandResult`) and
 *   `market-data` to every agent whose declared view watches a touched
 *   instrument — each under the availability law + the recipient's declared
 *   from-venue latency (A7/A9);
 * - `issuerResultFloor`: the transport law's floor — a typed rejection that
 *   touched nothing still reaches its issuer as a minimal pure-result
 *   delivery, so the issuer's outcome promise ALWAYS settles;
 * - `armNextWake`: the agent's own self-re-arming timer.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type { Participant, TimestampMs, WorldCommand } from "tradrl-world-contracts";
import type { ReactiveParticipantAgent } from "tradrl-world-contracts/participantProtocol";
import type { ParticipantRuntime } from "tradrl-market-participants/runtime";
import { resolveLatencyMs, type AgentLatencySpec } from "./latency.js";
import {
  type AbidesMessage,
  type AgentWakePayload,
  type MarketDataPayload,
  type OrderDeliveryPayload,
} from "./messaging.js";
import type { AbidesWorldDefinition } from "./definition.js";
import type { ExchangeProcess, ExecutionOutcome } from "./exchange.js";
import type { ExecutionContext } from "./execution.js";
import { VENUE, type AbidesAgentClient } from "./agentClient.js";
import type { AbidesAgentDeclaration } from "./declarations.js";

/** One registered agent: its declaration, its W023 agent + runtime + client. */
export interface AgentEntry {
  readonly declaration: AbidesAgentDeclaration;
  readonly agent: ReactiveParticipantAgent;
  readonly latency: AgentLatencySpec;
  readonly client: AbidesAgentClient;
  readonly runtime: ParticipantRuntime;
}

/** Everything the delivery fan-out needs from the kernel. */
export interface PropagationContext {
  readonly definition: AbidesWorldDefinition;
  readonly exchange: ExchangeProcess;
  readonly participantsById: ReadonlyMap<string, Participant>;
  readonly entries: readonly AgentEntry[];
  readonly enqueue: (message: Omit<AbidesMessage, "messageId" | "sequence">) => AbidesMessage;
}

/** The kernel's delivery fan-out for processed commands (see the module docstring). */
export function createPropagation(context: PropagationContext): {
  readonly propagate: (command: WorldCommand, outcome: ExecutionOutcome, ctx: ExecutionContext) => void;
  readonly issuerResultFloor: (command: WorldCommand, outcome: ExecutionOutcome, ctx: ExecutionContext) => void;
  readonly armNextWake: (entry: AgentEntry, previousWakeAt: TimestampMs) => void;
} {
  const { definition, exchange, participantsById, enqueue } = context;

  const agentsByAccount = new Map<string, AgentEntry[]>();
  const agentsByInstrument = new Map<string, AgentEntry[]>();
  for (const entry of context.entries) {
    const accountKey = String(entry.agent.accountId);
    const byAccount = agentsByAccount.get(accountKey) ?? [];
    byAccount.push(entry);
    agentsByAccount.set(accountKey, byAccount);
    for (const instrumentId of entry.declaration.viewInstruments) {
      const key = String(instrumentId);
      const watchers = agentsByInstrument.get(key) ?? [];
      watchers.push(entry);
      agentsByInstrument.set(key, watchers);
    }
  }

  /** Per-account fill cursor: each delivery propagates only the NEW fills. */
  const fillsDelivered = new Map<string, number>();

  /** Schedule every observer's deliveries for one processed command. */
  const propagate = (command: WorldCommand, outcome: ExecutionOutcome, ctx: ExecutionContext): void => {
    // The delivery rides the events' own availability law: it cannot be
    // observable before the LAST event it propagates (./events.ts).
    let availableAt = ctx.now;
    for (const event of outcome.events) {
      if (event.availableAt !== undefined && Number(event.availableAt) > Number(availableAt)) {
        availableAt = event.availableAt;
      }
    }
    for (const accountId of outcome.touchedOwners) {
      for (const entry of agentsByAccount.get(String(accountId)) ?? []) {
        const latencyMs = resolveLatencyMs({
          bound: entry.latency.fromVenueMs,
          seed: definition.seed,
          direction: "from-venue",
          actor: String(entry.agent.participantId),
          key: `${String(command.commandId)}:${entry.agent.agentId}:order-delivery`,
        });
        const issuer = String(command.issuedBy) === String(entry.agent.participantId);
        const fillsBefore = fillsDelivered.get(String(accountId)) ?? 0;
        const allFills = exchange.fillsOf(accountId);
        const fills = allFills.slice(fillsBefore);
        fillsDelivered.set(String(accountId), allFills.length);
        enqueue({
          messageClass: "order-delivery",
          from: VENUE,
          to: entry.agent.agentId,
          sentAt: ctx.now,
          arriveAt: (Number(availableAt) + latencyMs) as TimestampMs,
          payload: {
            ...(issuer ? { commandId: command.commandId, result: outcome.result } : {}),
            orders: exchange.ordersOf({ accountId }),
            ...(fills.length > 0 ? { fills } : {}),
            portfolio: exchange.portfolioOf(accountId, ctx.now),
            risk: exchange.riskOf(accountId, ctx.now),
          } satisfies OrderDeliveryPayload,
        });
      }
    }
    for (const instrumentId of outcome.touchedInstruments) {
      for (const entry of agentsByInstrument.get(String(instrumentId)) ?? []) {
        const latencyMs = resolveLatencyMs({
          bound: entry.latency.fromVenueMs,
          seed: definition.seed,
          direction: "from-venue",
          actor: String(entry.agent.participantId),
          key: `${String(command.commandId)}:${entry.agent.agentId}:market-data`,
        });
        enqueue({
          messageClass: "market-data",
          from: VENUE,
          to: entry.agent.agentId,
          sentAt: ctx.now,
          arriveAt: (Number(availableAt) + latencyMs) as TimestampMs,
          payload: {
            instrumentId,
            venueTime: ctx.now,
            book: exchange.bookOf(instrumentId, entry.declaration.bookDepth, ctx.now),
            quote: exchange.quoteOf(instrumentId, ctx.now),
            trades: outcome.newTrades,
          } satisfies MarketDataPayload,
        });
      }
    }
  };

  /**
   * THE TRANSPORT LAW'S FLOOR (README.md "The message flow"): the issuer's
   * `CommandResult` resolves when the ack DELIVERY arrives — for EVERY
   * outcome, rejected ones included. A typed rejection can touch nothing
   * (no order was created: post-only-would-take, insufficient buying power,
   * a duplicate commandId, …), so `propagate` would enqueue no delivery and
   * the issuer's port promise would never settle — the W023 runtime would
   * hang mid-pass. This floor closes that gap: when the outcome did not
   * already deliver to the issuer's account, send the issuer a minimal
   * pure-result delivery under the same availability + latency law.
   */
  const issuerResultFloor = (command: WorldCommand, outcome: ExecutionOutcome, ctx: ExecutionContext): void => {
    const issuerAccount =
      "accountId" in command
        ? String(command.accountId)
        : participantsById.get(String(command.issuedBy))?.accountId;
    if (issuerAccount === undefined) {
      return; // unreachable through the seam: issuedBy is a registered participant
    }
    if (outcome.touchedOwners.some((owner) => String(owner) === String(issuerAccount))) {
      return; // propagate already delivered the typed result to the issuer
    }
    const entry = (agentsByAccount.get(String(issuerAccount)) ?? []).find(
      (candidate) => String(candidate.agent.participantId) === String(command.issuedBy),
    );
    if (entry === undefined) {
      return; // no reactive agent trades this account (seed-only replay)
    }
    let availableAt = ctx.now;
    for (const event of outcome.events) {
      if (event.availableAt !== undefined && Number(event.availableAt) > Number(availableAt)) {
        availableAt = event.availableAt;
      }
    }
    const latencyMs = resolveLatencyMs({
      bound: entry.latency.fromVenueMs,
      seed: definition.seed,
      direction: "from-venue",
      actor: String(entry.agent.participantId),
      key: `${String(command.commandId)}:${entry.agent.agentId}:order-delivery`,
    });
    enqueue({
      messageClass: "order-delivery",
      from: VENUE,
      to: entry.agent.agentId,
      sentAt: ctx.now,
      arriveAt: (Number(availableAt) + latencyMs) as TimestampMs,
      payload: { commandId: command.commandId, result: outcome.result } satisfies OrderDeliveryPayload,
    });
  };

  const armNextWake = (entry: AgentEntry, previousWakeAt: TimestampMs): void => {
    enqueue({
      messageClass: "agent-wake",
      from: entry.agent.agentId,
      to: entry.agent.agentId,
      sentAt: previousWakeAt,
      arriveAt: (Number(previousWakeAt) + entry.declaration.wakeSchedule.everyMs) as TimestampMs,
      payload: { reason: "scheduled-wake" } satisfies AgentWakePayload,
    });
  };

  return { propagate, issuerResultFloor, armNextWake };
}
