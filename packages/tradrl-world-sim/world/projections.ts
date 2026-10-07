/**
 * QueryPort + EvidencePort projections over the authoritative engine state.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports" (QueryPort / EvidencePort methods)
 * and "UI projection law" (projections may batch/conflate but never
 * fabricate financial facts).
 * Spec: spec/ARCHITECTURE-LOCK.md A3 (charts/DOM/orders/... are consumers),
 * A7 (historical information is not observable before availableAt — the
 * firewall is applied HERE, at the port boundary; the raw journal is the
 * engine's own authoritative history).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md L (evidence: causal events and
 * provenance for every applied command).
 *
 * W014/W015/W016/W017 seam boundary (typed, honest):
 * - getOrderBook / getTrades / getOrders project the authoritative matching
 *   state (orders, books, trade tape) — W014's engine surface;
 * - getQuote projects the top-of-book quote from the authoritative book
 *   (W017: the generator fills the books, so a quote exists to project);
 * - getPositions / getPortfolio / getRisk project the authoritative
 *   financial state (positions, P&L, margin, breaches) — W015's engine
 *   surface, exact decimal text, never fabricated (WORLD-PROTOCOL.md "UI
 *   projection law");
 * - getSnapshot (QueryPort + EvidencePort) and getBranchLineage are REAL
 *   (W016): the event-derived snapshot registry and the lineage chain.
 */

import type {
  AccountId,
  DeterminismManifest,
  EvidencePort,
  EventQuery,
  QueryPort,
  SnapshotDescriptor,
  SnapshotId,
  TimelineSlice,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type {
  NewsItem,
  NewsQuery,
  OrderBookSnapshot,
  Portfolio,
  Position,
  Quantity,
  Quote,
  RiskState,
  TimestampMs,
  Trade,
} from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, isArtifactObservableAt, isEventObservableAt } from "tradrl-world-contracts/time";
import type { ClockState } from "tradrl-world-contracts/time";
import { computeInformationBoundary } from "tradrl-world-contracts/time";
import type { EventJournal } from "../journal/eventJournal.js";
import type { ClockEventLookup } from "../clock/simulationClock.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
import { bestLevel, bookSnapshot, formatScaled } from "../orderbook/index.js";
import {
  financialLedgerOf,
  computeAccountFinancials,
  ledgerOf,
} from "../account/index.js";
import { isOpenPosition, projectPosition, projectPortfolio } from "../portfolio/index.js";
import { projectRiskState } from "../risk/index.js";
import { UnknownWorldEntityError } from "./errors.js";
import { projectWorldMeta, type WorldDefinition } from "./definition.js";
import type { SnapshotSummary, WorldState } from "./state.js";

/** A read-only slice of the engine the projections see. */
export interface EngineReadModel {
  readonly definition: WorldDefinition;
  readonly state: WorldState;
  readonly clockState: ClockState;
  readonly journal: EventJournal;
  /** The world's ancestry chain, engine-carried (W016; empty for roots). */
  readonly lineage: readonly BranchLineageRecord[];
}

/** The A7 observation point for every port read: the clock position. */
function observationTime(read: () => EngineReadModel): SimulationTimeMs {
  return read().clockState.simulationTime;
}

function assertObservable(
  envelope: WorldEventEnvelope,
  at: SimulationTimeMs,
): WorldEventEnvelope | undefined {
  return isEventObservableAt(envelope, at) ? envelope : undefined;
}

/**
 * Resolve the account a financial projection targets: the given id, or the
 * world's first declared account when omitted (documented single-account
 * default; multi-account consumers pass the id explicitly).
 */
function resolveAccountId(read: () => EngineReadModel, accountId?: AccountId): AccountId {
  if (accountId !== undefined) {
    if (ledgerOf(read().state.financial.accounts, accountId) === undefined) {
      throw new UnknownWorldEntityError("account", String(accountId));
    }
    return accountId;
  }
  const first = read().definition.accounts[0];
  if (first === undefined) {
    throw new UnknownWorldEntityError("account", "(the world declares none)");
  }
  return first.accountId;
}

/** Project the protocol-level descriptor of one snapshot summary. */
function snapshotDescriptor(
  worldId: WorldId,
  summary: SnapshotSummary,
): SnapshotDescriptor {
  return {
    snapshotId: summary.snapshotId,
    worldId,
    ...(summary.parentSnapshotId === undefined ? {} : { parentSnapshotId: summary.parentSnapshotId }),
    createdAt: summary.createdAt,
    journalCursor: summary.journalCursor,
    digest: summary.digest,
  };
}

/** Build the QueryPort over a live read model. */
export function createQueryPort(read: () => EngineReadModel): QueryPort {
  return {
    async getWorldMeta() {
      const { definition, state, lineage } = read();
      const parentWorldId = lineage[lineage.length - 1]?.parentWorldId;
      return projectWorldMeta(definition, state.currentScenario, parentWorldId);
    },
    async getSnapshot(snapshotId?) {
      // W016: REAL — the event-derived snapshot registry projected to the
      // protocol descriptor. Unknown ids (and a snapshot-less world) fail
      // closed with the typed entity error.
      const { definition, state } = read();
      const summary =
        snapshotId === undefined
          ? state.snapshots[state.snapshots.length - 1]
          : state.snapshots.find((candidate) => candidate.snapshotId === snapshotId);
      if (summary === undefined) {
        throw new UnknownWorldEntityError(
          "snapshot",
          snapshotId === undefined ? "latest (no snapshot taken yet)" : String(snapshotId),
        );
      }
      return snapshotDescriptor(definition.scope.worldId, summary);
    },
    async getInstrument(instrumentId) {
      const instrument = read().definition.instruments.find(
        (i) => i.instrumentId === instrumentId,
      );
      if (instrument === undefined) {
        throw new UnknownWorldEntityError("instrument", String(instrumentId));
      }
      return instrument;
    },
    async getQuote(instrumentId): Promise<Quote> {
      // W017: the quote is a projection of the authoritative book — the
      // generator fills the books with real resting liquidity, so the
      // top-of-book (bid/ask sizes + last trade) exists to project. Same
      // observability discipline as getOrderBook: the A7 firewall on the
      // underlying market events is served by getTimeline/getEvents.
      const model = read();
      const book = model.state.matching.books[String(instrumentId)];
      if (book === undefined) {
        throw new UnknownWorldEntityError("instrument", String(instrumentId));
      }
      const bestBid = bestLevel(book, "buy");
      const bestAsk = bestLevel(book, "sell");
      const levelSize = (level: { readonly entries: readonly { readonly remaining: bigint }[] }) => {
        let total = 0n;
        for (const entry of level.entries) total += entry.remaining;
        return formatScaled(total, 12) as Quantity;
      };
      return {
        instrumentId,
        ...(bestBid === undefined
          ? {}
          : { bid: bestBid.price, bidSize: levelSize(bestBid) }),
        ...(bestAsk === undefined
          ? {}
          : { ask: bestAsk.price, askSize: levelSize(bestAsk) }),
        ...(book.lastTradePrice === undefined ? {} : { last: book.lastTradePrice }),
        asOf: model.clockState.simulationTime as TimestampMs,
      };
    },
    async getOrderBook(instrumentId, depth?): Promise<OrderBookSnapshot> {
      // W014: the DOM projection over the authoritative matching book state
      // (venue truth; the A7 firewall on the underlying book-delta events is
      // served by getTimeline/getEvents).
      const model = read();
      const book = model.state.matching.books[String(instrumentId)];
      if (book === undefined) {
        throw new UnknownWorldEntityError("instrument", String(instrumentId));
      }
      return bookSnapshot(book, {
        asOf: model.clockState.simulationTime as never,
        sequence: model.journal.getCursor(),
        ...(depth === undefined ? {} : { depth }),
      });
    },
    async getTrades(instrumentId, query = {}): Promise<readonly Trade[]> {
      // W014: the Time & Sales projection — the trade tape is firewalled by
      // each trade's availableAt (venue latency policy, A7).
      const model = read();
      const at = observationTime(read);
      let trades = model.state.matching.trades.filter(
        (trade) =>
          trade.instrumentId === instrumentId &&
          (trade.availableAt === undefined || trade.availableAt <= at),
      );
      if (query.from !== undefined) {
        trades = trades.filter((trade) => trade.occurredAt >= query.from!);
      }
      if (query.to !== undefined) {
        trades = trades.filter((trade) => trade.occurredAt <= query.to!);
      }
      const projected = trades.map(({ availableAt: _availableAt, ...trade }) => trade);
      return query.limit === undefined ? projected : projected.slice(0, query.limit);
    },
    async getOrders(query = {}) {
      // W014: the order registry projection (venue truth — the registry is
      // the venue's own record; event-level observability is served by the
      // evidence/timeline ports).
      const orders = read().state.matching.orders.filter(
        (order) =>
          (query.accountId === undefined || order.accountId === query.accountId) &&
          (query.instrumentId === undefined || order.instrumentId === query.instrumentId) &&
          (query.statuses === undefined || query.statuses.includes(order.status)),
      );
      return orders;
    },
    async getPositions(accountId?: AccountId): Promise<readonly Position[]> {
      // W015: the open positions of one account (or all, in ledger order) —
      // closed records stay in state for realized-P&L truth, projections
      // show what is open.
      const model = read();
      const positions = model.state.financial.portfolio.positions.filter(
        (record) =>
          isOpenPosition(record) &&
          (accountId === undefined || String(record.accountId) === String(accountId)),
      );
      if (accountId !== undefined && ledgerOf(model.state.financial.accounts, accountId) === undefined) {
        throw new UnknownWorldEntityError("account", String(accountId));
      }
      return positions.map(projectPosition);
    },
    async getPortfolio(accountId?: AccountId): Promise<Portfolio> {
      // W015: the W003 Portfolio projection — cash, buying power, positions
      // and the realized/unrealized/total P&L at the observation time (A7:
      // asOf is the clock position; marks are the last printed trades).
      const resolved = resolveAccountId(read, accountId);
      const model = read();
      const ledger = financialLedgerOf(model.state.financial, String(resolved));
      const own = model.state.financial.portfolio.positions.filter(
        (record) => String(record.accountId) === String(resolved),
      );
      const financials = computeAccountFinancials(ledger, own);
      return projectPortfolio({
        accountId: resolved,
        worldId: model.definition.scope.worldId,
        asOf: model.clockState.simulationTime as Portfolio["asOf"],
        financials,
        positions: own,
      });
    },
    async getRisk(accountId?: AccountId): Promise<RiskState> {
      // W015: the W003 RiskState projection — the declared limits in force
      // and the breach history recorded from journaled events.
      const resolved = resolveAccountId(read, accountId);
      const model = read();
      return projectRiskState({
        worldId: model.definition.scope.worldId,
        accountId: resolved,
        asOf: model.clockState.simulationTime as RiskState["asOf"],
        risk: model.state.financial.risk,
      });
    },
    async getNews(query: NewsQuery = {}) {
      const model = read();
      const at = observationTime(read);
      let items: readonly NewsItem[] = (model.definition.informationArtifacts ?? []).filter(
        (artifact) => isArtifactObservableAt(artifact, at),
      );
      if (query.instrumentId !== undefined) {
        items = items.filter(
          (item) =>
            item.payload.instruments === undefined ||
            item.payload.instruments.length === 0 ||
            item.payload.instruments.includes(query.instrumentId!),
        );
      }
      if (query.from !== undefined) {
        items = items.filter((item) => item.availableAt >= query.from!);
      }
      if (query.to !== undefined) {
        items = items.filter((item) => item.availableAt <= query.to!);
      }
      // Deterministic definition order is preserved (like the boundary
      // computation in W004's contracts).
      return query.limit === undefined ? items : items.slice(0, query.limit);
    },
    async getTimeline(query: EventQuery = {}) {
      const { journal } = read();
      const at = observationTime(read);
      const observable = journal
        .read({ ...query, limit: undefined })
        .map((envelope) => assertObservable(envelope, at))
        .filter((envelope): envelope is WorldEventEnvelope => envelope !== undefined);
      const limited =
        query.limit === undefined ? observable : observable.slice(0, query.limit);
      const first = limited[0];
      const last = limited[limited.length - 1];
      return {
        from: query.from ?? first?.occurredAt ?? at,
        to: query.to ?? last?.occurredAt ?? at,
        events: limited,
        hasMore: query.limit !== undefined && observable.length > query.limit,
      } satisfies TimelineSlice;
    },
  };
}

/** Build the EvidencePort over a live read model plus the live manifest. */
export function createEvidencePort(
  read: () => EngineReadModel,
  getManifest: () => DeterminismManifest,
): EvidencePort {
  return {
    async getEvent(eventId) {
      const envelope = read().journal.findEvent(eventId);
      return envelope === undefined ? undefined : assertObservable(envelope, observationTime(read));
    },
    async getEvents(query: EventQuery = {}) {
      const at = observationTime(read);
      return read()
        .journal.read(query)
        .map((envelope) => assertObservable(envelope, at))
        .filter((envelope): envelope is WorldEventEnvelope => envelope !== undefined);
    },
    async getProvenance(eventId) {
      const { journal } = read();
      const record = journal.getRecordByEventId(eventId);
      if (record === undefined) {
        return undefined;
      }
      if (!isEventObservableAt(record.envelope, observationTime(read))) {
        return undefined; // the firewall applies to evidence reads too (A7)
      }
      return {
        subjectEventId: record.envelope.eventId,
        producer: record.envelope.producer,
        // Every skeleton engine event is command-caused: causationId is the
        // command id (the lifecycle's causality chain, acceptance L).
        inputs: [{ kind: "command" as const, ref: String(record.envelope.causationId) }],
        recordedAt: record.recordedAt,
      };
    },
    async getSnapshot(snapshotId: SnapshotId) {
      // W016: the event-derived snapshot registry — a snapshot this world
      // never took does not exist (undefined is the honest typed answer).
      const { definition, state } = read();
      const summary = state.snapshots.find((candidate) => candidate.snapshotId === snapshotId);
      return summary === undefined
        ? undefined
        : snapshotDescriptor(definition.scope.worldId, summary);
    },
    async getBranchLineage(worldId?: WorldId) {
      // W016: the complete ancestry chain of the requested world as this
      // engine knows it — the current world (or any ancestor in its chain)
      // via the engine-carried lineage; a direct child via the event-derived
      // branch registry (parent's lineage + the child's record). Worlds
      // outside this engine's lineage tree have no known lineage here: the
      // empty list is the honest answer (their record lives in THEIR
      // parent's journal, not this one).
      const { definition, state, lineage } = read();
      const target = worldId ?? definition.scope.worldId;
      const inChain = lineage.findIndex((record) => record.worldId === target);
      if (inChain >= 0) {
        return lineage.slice(0, inChain + 1);
      }
      const child = state.branches.find((record) => record.worldId === target);
      if (child !== undefined) {
        return [...lineage, child];
      }
      return [];
    },
    async getInformationBoundary(asOf) {
      const { definition } = read();
      return computeInformationBoundary(
        definition.informationArtifacts ?? [],
        asSimulationTime(asOf),
      );
    },
    async getDeterminismManifest() {
      return getManifest();
    },
  };
}

/** Journal-backed event lookup for the clock's jump-to-event. */
export function journalEventLookup(journal: EventJournal): ClockEventLookup {
  return {
    findEvent: (target) => journal.findEvent(target),
  };
}
