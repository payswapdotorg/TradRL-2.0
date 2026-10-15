/**
 * The latency-firewalled agent client (W024) — the W023
 * `ReactiveParticipantWorldClient` surface of ONE agent, served ENTIRELY
 * from what the transport has DELIVERED (plus the world's static,
 * declared configuration — instrument definitions are declared state, not
 * market data).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the observation frontier only moves
 * when a message arrives; no port call can reach the venue's live present.
 * Spec: spec/WORLD-PROTOCOL.md — commands enter through the typed
 * CommandPort; the issuer's `CommandResult` resolves when the ack DELIVERY
 * arrives (the true round trip). The clock surface is read-only and fails
 * closed on every playback control (the kernel owns the simulation clock).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  AccountId,
  ClockPort,
  ClockView,
  CommandPort,
  CommandResult,
  InstrumentId,
  Order,
  OrderBookSnapshot,
  Portfolio,
  QueryPort,
  RiskState,
  SequenceNumber,
  TimestampMs,
  Trade,
  WorldCommand,
} from "tradrl-world-contracts";
import type {
  ReactiveParticipantAgent,
  ReactiveParticipantWorldClient,
} from "tradrl-world-contracts/participantProtocol";
import { AbidesAdapterError } from "./errors.js";
import { resolveLatencyMs, type AgentLatencySpec } from "./latency.js";
import {
  type AbidesMessage,
  type AgentWakePayload,
  type MarketDataPayload,
  type OrderCommandPayload,
  type OrderDeliveryPayload,
} from "./messaging.js";
import { emptyBookSnapshot } from "./book.js";
import type { ExchangeProcess } from "./exchange.js";

/** The venue's address on the fabric. */
export const VENUE = "venue";

// ---------------------------------------------------------------------------
// The latency-firewalled agent client (the A7 surface of ONE agent)
// ---------------------------------------------------------------------------

/** Everything one agent client needs from the kernel. */
interface AgentClientContext {
  readonly worldId: string;
  readonly agent: ReactiveParticipantAgent;
  readonly viewInstruments: readonly InstrumentId[];
  readonly exchange: ExchangeProcess;
  readonly latency: AgentLatencySpec;
  readonly seed: string;
  readonly clockOrigin: TimestampMs;
  readonly enqueue: (message: Omit<AbidesMessage, "messageId" | "sequence">) => AbidesMessage;
}

/**
 * The world client of ONE agent: the W023 `ReactiveParticipantWorldClient`
 * surface served ENTIRELY from what the transport has DELIVERED (plus the
 * world's static configuration — instrument definitions are declared state,
 * not market data). The observation frontier only moves when a message
 * arrives; no port call can reach the venue's live present (A7).
 */
export class AbidesAgentClient implements ReactiveParticipantWorldClient {
  readonly worldId: string;
  readonly query: QueryPort;
  readonly command: CommandPort;
  readonly clock: ClockPort;

  private readonly agent: ReactiveParticipantAgent;
  private readonly viewInstruments: readonly InstrumentId[];
  private readonly exchange: ExchangeProcess;
  private readonly latency: AgentLatencySpec;
  private readonly seed: string;
  private readonly enqueue: AgentClientContext["enqueue"];

  private observedUntil: TimestampMs;
  private readonly books = new Map<string, OrderBookSnapshot>();
  private readonly quotes = new Map<string, { readonly instrumentId: InstrumentId; readonly asOf: TimestampMs }>();
  private readonly trades: Trade[] = [];
  private orders: readonly Order[] = [];
  private portfolio: Portfolio;
  private risk: RiskState;
  private readonly pending = new Map<
    string,
    { readonly resolve: (result: CommandResult) => void; readonly reject: (error: unknown) => void }
  >();
  private readonly clockListeners = new Set<(clock: ClockView) => void>();

  constructor(context: AgentClientContext) {
    this.worldId = context.worldId;
    this.agent = context.agent;
    this.viewInstruments = context.viewInstruments;
    this.exchange = context.exchange;
    this.latency = context.latency;
    this.seed = context.seed;
    this.enqueue = context.enqueue;
    this.observedUntil = context.clockOrigin;
    // The OPENING observation (README.md): the PRE-SEED world at its birth —
    // empty books, no tape, the account's opening cash, no orders. Every
    // later observation — including the seed orders' effects — crosses the
    // declared transport like any other market information.
    for (const instrumentId of context.viewInstruments) {
      this.books.set(String(instrumentId), emptyBookSnapshot(instrumentId, context.clockOrigin, 0 as SequenceNumber));
      this.quotes.set(String(instrumentId), { instrumentId, asOf: context.clockOrigin });
    }
    this.portfolio = context.exchange.portfolioOf(this.agent.accountId, context.clockOrigin);
    this.risk = context.exchange.riskOf(this.agent.accountId, context.clockOrigin);

    this.query = {
      getWorldMeta: async () => this.notOnSurface("world meta"),
      getSnapshot: async () => this.notOnSurface("snapshots"),
      getInstrument: async (instrumentId) => {
        this.requireViewInstrument(instrumentId);
        return this.exchange.instrumentOf(instrumentId);
      },
      getQuote: async (instrumentId) => {
        this.requireViewInstrument(instrumentId);
        return this.quotes.get(String(instrumentId)) ?? { instrumentId, asOf: this.observedUntil };
      },
      getOrderBook: async (instrumentId) => {
        this.requireViewInstrument(instrumentId);
        return this.books.get(String(instrumentId)) ?? emptyBookSnapshot(instrumentId, this.observedUntil, 0 as SequenceNumber);
      },
      getTrades: async (instrumentId, query) => {
        this.requireViewInstrument(instrumentId);
        let rows: Trade[] = [...this.trades];
        if (query?.from !== undefined) {
          rows = rows.filter((trade) => Number(trade.occurredAt) >= Number(query.from));
        }
        if (query?.to !== undefined) {
          rows = rows.filter((trade) => Number(trade.occurredAt) <= Number(query.to));
        }
        return query?.limit === undefined ? rows : rows.slice(-Math.max(0, query.limit));
      },
      getOrders: async (query) => {
        if (query?.accountId !== undefined) {
          this.requireOwnAccount(query.accountId);
        }
        let rows: Order[] = [...this.orders];
        if (query?.instrumentId !== undefined) {
          rows = rows.filter((order) => String(order.instrumentId) === String(query.instrumentId));
        }
        if (query?.statuses !== undefined) {
          rows = rows.filter((order) => query.statuses?.includes(order.status) === true);
        }
        return rows;
      },
      getPositions: async (accountId) => {
        this.requireOwnAccount(accountId);
        return this.portfolio.positions;
      },
      getPortfolio: async (accountId) => {
        this.requireOwnAccount(accountId);
        return this.portfolio;
      },
      getRisk: async (accountId) => {
        this.requireOwnAccount(accountId);
        return this.risk;
      },
      getNews: async () => [],
      getTimeline: async () => this.notOnSurface("the event timeline"),
    };

    this.command = {
      submitOrder: (command) => this.enqueueOrderCommand(command),
      cancelOrder: (command) => this.enqueueOrderCommand(command),
      replaceOrder: (command) => this.enqueueOrderCommand(command),
      closePosition: (command) => this.enqueueOrderCommand(command),
      addAnnotation: async () => this.notOnSurface("world-administration commands (add-annotation)"),
      createSnapshot: async () => this.notOnSurface("world-administration commands (create-snapshot)"),
      branchWorld: async () => this.notOnSurface("world-administration commands (branch-world)"),
      setScenario: async () => this.notOnSurface("world-administration commands (set-scenario)"),
    };

    this.clock = {
      play: async () => {
        throw new AbidesAdapterError("wall-time-forbidden", `the agent clock surface is read-only; playback is kernel-owned (agent ${this.agent.agentId}, A7)`);
      },
      pause: async () => {
        throw new AbidesAdapterError("invalid-clock-command", `the agent clock surface is read-only — the kernel owns the simulation clock (agent ${this.agent.agentId})`);
      },
      step: async () => {
        throw new AbidesAdapterError("invalid-clock-command", `the agent clock surface is read-only — the kernel owns the simulation clock (agent ${this.agent.agentId})`);
      },
      seek: async () => {
        throw new AbidesAdapterError("invalid-clock-command", `the agent clock surface is read-only — the kernel owns the simulation clock (agent ${this.agent.agentId})`);
      },
      jumpToEvent: async () => {
        throw new AbidesAdapterError("invalid-clock-command", `the agent clock surface is read-only — the kernel owns the simulation clock (agent ${this.agent.agentId})`);
      },
      setSpeed: async () => {
        throw new AbidesAdapterError("wall-time-forbidden", `the agent clock surface is read-only; speed is kernel-owned and never wall-coupled (agent ${this.agent.agentId}, A7)`);
      },
      followRealtime: async () => {
        throw new AbidesAdapterError("wall-time-forbidden", `the agent clock surface is read-only; realtime following couples simulation time to wall time and is forbidden (agent ${this.agent.agentId}, A7)`);
      },
      getClock: async () => this.clockView(),
    };
  }

  onClock(listener: (clock: ClockView) => void): () => void {
    this.clockListeners.add(listener);
    return () => {
      this.clockListeners.delete(listener);
    };
  }

  /** An outcome delivery arrived: apply state, resolve the issuer's result, wake. */
  acceptDelivery(message: AbidesMessage): void {
    const payload = message.payload as OrderDeliveryPayload;
    if (payload.orders !== undefined) {
      this.orders = payload.orders;
    }
    if (payload.portfolio !== undefined) {
      this.portfolio = payload.portfolio;
    }
    if (payload.risk !== undefined) {
      this.risk = payload.risk;
    }
    this.advanceFrontier(message.arriveAt);
    if (payload.commandId !== undefined) {
      const pending = this.pending.get(String(payload.commandId));
      if (pending === undefined) {
        throw new AbidesAdapterError(
          "out-of-order-message",
          `a delivery for command ${String(payload.commandId)} reached agent ${this.agent.agentId} with no command in flight (transport invariant)`,
        );
      }
      this.pending.delete(String(payload.commandId));
      if (payload.result === undefined) {
        pending.reject(new AbidesAdapterError(
          "out-of-order-message",
          `the issuer delivery for command ${String(payload.commandId)} carries no CommandResult (transport invariant)`,
        ));
      } else {
        pending.resolve(payload.result);
      }
    }
    this.pushClock();
  }

  /** A market-data delivery arrived: books, quotes, prints — then wake. */
  acceptMarketData(message: AbidesMessage): void {
    const payload = message.payload as MarketDataPayload;
    const key = String(payload.instrumentId);
    this.books.set(key, payload.book);
    this.quotes.set(key, payload.quote);
    this.trades.push(...payload.trades);
    this.advanceFrontier(message.arriveAt);
    this.pushClock();
  }

  /** The agent's own timer fired: move the frontier, wake. */
  acceptWake(message: AbidesMessage): void {
    void (message.payload as AgentWakePayload); // the reason is display text only
    this.advanceFrontier(message.arriveAt);
    this.pushClock();
  }

  /** Reject a pending command's promise (the venue failed mid-lifecycle). */
  failPending(commandId: string, error: unknown): void {
    const pending = this.pending.get(String(commandId));
    if (pending !== undefined) {
      this.pending.delete(String(commandId));
      pending.reject(error);
    }
  }

  private enqueueOrderCommand(command: WorldCommand): Promise<CommandResult> {
    const sentAt = this.observedUntil;
    const latencyMs = resolveLatencyMs({
      bound: this.latency.toVenueMs,
      seed: this.seed,
      direction: "to-venue",
      actor: String(this.agent.participantId),
      key: String(command.commandId),
    });
    this.enqueue({
      messageClass: "order-command",
      from: this.agent.agentId,
      to: VENUE,
      sentAt,
      arriveAt: (Number(sentAt) + latencyMs) as TimestampMs,
      payload: { command } satisfies OrderCommandPayload,
    });
    return new Promise<CommandResult>((resolve, reject) => {
      this.pending.set(String(command.commandId), { resolve, reject });
    });
  }

  private advanceFrontier(arriveAt: TimestampMs): void {
    if (Number(arriveAt) > Number(this.observedUntil)) {
      this.observedUntil = arriveAt;
    }
  }

  private clockView(): ClockView {
    return { simulationTime: this.observedUntil, status: "paused", speed: 1, followingRealtime: false };
  }

  private pushClock(): void {
    const clock = this.clockView();
    for (const listener of Array.from(this.clockListeners)) {
      listener(clock);
    }
  }

  private requireViewInstrument(instrumentId: InstrumentId): void {
    if (!this.viewInstruments.some((id) => String(id) === String(instrumentId))) {
      throw new AbidesAdapterError(
        "agent-observation-surface",
        `instrument ${String(instrumentId)} is not in agent ${this.agent.agentId}'s declared view set (A7 — the set IS the declaration)`,
      );
    }
  }

  private requireOwnAccount(accountId: AccountId | undefined): void {
    if (accountId !== undefined && String(accountId) !== String(this.agent.accountId)) {
      throw new AbidesAdapterError(
        "agent-observation-surface",
        `agent ${this.agent.agentId} serves account ${String(this.agent.accountId)} only (asked for ${String(accountId)})`,
      );
    }
  }

  private notOnSurface(what: string): never {
    throw new AbidesAdapterError(
      "agent-observation-surface",
      `${what} is not part of agent ${this.agent.agentId}'s declared observation surface (A7)`,
    );
  }
}
