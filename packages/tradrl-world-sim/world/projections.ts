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
 * W014 seam boundary (typed, honest):
 * - getOrderBook / getTrades / getOrders project the authoritative matching
 *   state (orders, books, trade tape) — W014's engine surface;
 * - getSnapshot (QueryPort) / getPortfolio / getRisk / getQuote still throw
 *   NotImplementedInSkeletonError (W016 / W015 / W017);
 * - getPositions returns the true empty list (positions arrive with W015);
 * - EvidencePort.getSnapshot returns undefined and getBranchLineage returns
 *   the true empty lineage (snapshots/branches are W016).
 */

import type {
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
    async getPositions(): Promise<readonly Position[]> {
      // True empty projection: positions arrive with fills (W014/W015).
      return [];
    },
    async getPortfolio(): Promise<Portfolio> {
      throw new NotImplementedInSkeletonError("account-portfolio-risk", "QueryPort.getPortfolio");
    },
    async getRisk(): Promise<RiskState> {
      throw new NotImplementedInSkeletonError("account-portfolio-risk", "QueryPort.getRisk");
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
