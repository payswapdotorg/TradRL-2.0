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
 * W015 seam boundary (typed, honest):
 * - getOrderBook / getTrades / getOrders project the authoritative matching
 *   state (orders, books, trade tape) — W014's engine surface;
 * - getPositions / getPortfolio / getRisk project the authoritative
 *   financial state (positions, P&L, margin, breaches) — W015's engine
 *   surface, exact decimal text, never fabricated (WORLD-PROTOCOL.md "UI
 *   projection law");
 * - getSnapshot (QueryPort) / getQuote still throw
 *   NotImplementedInSkeletonError (W016 / W017);
 * - EvidencePort.getSnapshot returns undefined and getBranchLineage returns
 *   the true empty lineage (snapshots/branches are W016).
 */

import type {
  AccountId,
  DeterminismManifest,
  EvidencePort,
  EventQuery,
  QueryPort,
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
  RiskState,
  Trade,
} from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, isArtifactObservableAt, isEventObservableAt } from "tradrl-world-contracts/time";
import type { ClockState } from "tradrl-world-contracts/time";
import { computeInformationBoundary } from "tradrl-world-contracts/time";
import type { EventJournal } from "../journal/eventJournal.js";
import type { ClockEventLookup } from "../clock/simulationClock.js";
import { bookSnapshot } from "../orderbook/index.js";
import {
  financialLedgerOf,
  computeAccountFinancials,
  ledgerOf,
} from "../account/index.js";
import { isOpenPosition, projectPosition, projectPortfolio } from "../portfolio/index.js";
import { projectRiskState } from "../risk/index.js";
import { NotImplementedInSkeletonError, UnknownWorldEntityError } from "./errors.js";
import { projectWorldMeta, type WorldDefinition } from "./definition.js";
import type { WorldState } from "./state.js";

/** A read-only slice of the engine the projections see. */
export interface EngineReadModel {
  readonly definition: WorldDefinition;
  readonly state: WorldState;
  readonly clockState: ClockState;
  readonly journal: EventJournal;
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

/** Build the QueryPort over a live read model. */
export function createQueryPort(read: () => EngineReadModel): QueryPort {
  return {
    async getWorldMeta() {
      const { definition, state } = read();
      return projectWorldMeta(definition, state.currentScenario);
    },
    async getSnapshot() {
      throw new NotImplementedInSkeletonError("snapshot-branch", "QueryPort.getSnapshot");
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
    async getQuote() {
      throw new NotImplementedInSkeletonError("market-generator", "QueryPort.getQuote");
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
    async getSnapshot(_snapshotId: SnapshotId) {
      // No snapshot exists in the skeleton (W016); the optional return is
      // the honest typed answer.
      return undefined;
    },
    async getBranchLineage(_worldId?: WorldId) {
      // No branches exist in the skeleton (W016); lineage is truly empty.
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
