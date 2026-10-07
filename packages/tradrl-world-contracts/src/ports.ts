/**
 * The four canonical World Protocol ports — TYPE-ONLY interfaces.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports":
 * - QueryPort: getWorldMeta, getSnapshot, getInstrument, getQuote,
 *   getOrderBook, getTrades, getOrders, getPositions, getPortfolio, getRisk,
 *   getNews, getTimeline
 * - CommandPort: submitOrder, cancelOrder, replaceOrder, closePosition,
 *   addAnnotation, createSnapshot, branchWorld, setScenario
 * - ClockPort: play, pause, step, seek, jumpToEvent, setSpeed,
 *   followRealtime, getClock
 * - EvidencePort: getEvent, getEvents, getProvenance, getSnapshot,
 *   getBranchLineage, getInformationBoundary, getDeterminismManifest
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A5 — every world implementation exposes
 * exactly these four ports; human UI, agents, headless tests and external
 * simulation engines all use them. ADR-003: NO engine-specific type may leak
 * through these interfaces — every referenced type is defined in this
 * contracts package.
 *
 * Methods are async: the command lifecycle (validate → authorize → apply →
 * mutate → emit → journal → publish → ack) is not instantaneous and ports
 * cross worker/process adapter boundaries (SIMULATION.md runtime topology).
 */

import type { Instrument } from "./instrument.js";
import type { Order, OrderQuery } from "./orders.js";
import type {
  AccountId,
  EventId,
  InstrumentId,
  SnapshotId,
  WorldId,
} from "./ids.js";
import type { SequenceNumber, TimestampMs } from "./primitives.js";
import type {
  NewsQuery,
  NewsItem,
  OrderBookSnapshot,
  Quote,
  Trade,
  TradeQuery,
} from "./market.js";
import type {
  Portfolio,
  Position,
} from "./portfolio.js";
import type { RiskState } from "./risk.js";
import type {
  BranchRecord,
  DeterminismManifest,
  SnapshotDescriptor,
  WorldMeta,
} from "./world.js";
import type {
  EventQuery,
  ProvenanceRecord,
  TimelineSlice,
  WorldEventEnvelope,
} from "./events.js";
import type {
  AddAnnotationCommand,
  BranchWorldCommand,
  CancelOrderCommand,
  ClosePositionCommand,
  CommandResult,
  CreateSnapshotCommand,
  ReplaceOrderCommand,
  SetScenarioCommand,
  SubmitOrderCommand,
} from "./commands.js";
import type { InformationBoundaryState } from "./information.js";

/**
 * Read-side projections of authoritative world state. Polling these is never
 * authoritative (A6); projections may batch/conflate but never fabricate
 * financial facts (WORLD-PROTOCOL.md "UI projection law").
 */
export interface QueryPort {
  getWorldMeta(): Promise<WorldMeta>;
  /** Latest snapshot descriptor, or a specific one by id. */
  getSnapshot(snapshotId?: SnapshotId): Promise<SnapshotDescriptor>;
  getInstrument(instrumentId: InstrumentId): Promise<Instrument>;
  getQuote(instrumentId: InstrumentId): Promise<Quote>;
  getOrderBook(instrumentId: InstrumentId, depth?: number): Promise<OrderBookSnapshot>;
  getTrades(instrumentId: InstrumentId, query?: TradeQuery): Promise<readonly Trade[]>;
  getOrders(query?: OrderQuery): Promise<readonly Order[]>;
  getPositions(accountId?: AccountId): Promise<readonly Position[]>;
  getPortfolio(accountId?: AccountId): Promise<Portfolio>;
  getRisk(accountId?: AccountId): Promise<RiskState>;
  getNews(query?: NewsQuery): Promise<readonly NewsItem[]>;
  getTimeline(query?: EventQuery): Promise<TimelineSlice>;
}

/**
 * The single typed command boundary. Human and agent actions terminate here
 * (A4/A15; WORLD-PROTOCOL.md "Human/agent symmetry"). Venue is reachable via
 * queries; commands mutate world state only through the lifecycle.
 */
export interface CommandPort {
  submitOrder(command: SubmitOrderCommand): Promise<CommandResult>;
  cancelOrder(command: CancelOrderCommand): Promise<CommandResult>;
  replaceOrder(command: ReplaceOrderCommand): Promise<CommandResult>;
  closePosition(command: ClosePositionCommand): Promise<CommandResult>;
  addAnnotation(command: AddAnnotationCommand): Promise<CommandResult>;
  createSnapshot(command: CreateSnapshotCommand): Promise<CommandResult>;
  branchWorld(command: BranchWorldCommand): Promise<CommandResult>;
  setScenario(command: SetScenarioCommand): Promise<CommandResult>;
}

/** Clock run status. */
export type ClockStatus = "playing" | "paused";

/**
 * Minimal clock view returned by `ClockPort.getClock`. The full time system
 * (wallTime/simulationTime/eventTime distinctions, clock entities) is owned
 * by W004 (`packages/tradrl-world-contracts/time/`).
 */
export interface ClockView {
  readonly simulationTime: TimestampMs;
  readonly status: ClockStatus;
  /** Speed multiplier; 1 = realtime. */
  readonly speed: number;
  readonly followingRealtime: boolean;
}

/** Simulation clock controls (acceptance E: play/pause/step/speed/seek/jump). */
export interface ClockPort {
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Advance simulation time by `deltaMs` (one tick when omitted). */
  step(deltaMs?: number): Promise<void>;
  /** Move simulation time to an absolute point. */
  seek(to: TimestampMs): Promise<void>;
  /** Jump to the event with the given id or world sequence. */
  jumpToEvent(target: EventId | SequenceNumber): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  followRealtime(enabled: boolean): Promise<void>;
  getClock(): Promise<ClockView>;
}

/**
 * Evidence/audit port: ordered events, provenance, snapshots, branch
 * lineage, the information boundary and the determinism manifest.
 * Everything needed for R073 (auditable operations without private
 * chain-of-thought).
 */
export interface EvidencePort {
  getEvent(eventId: EventId): Promise<WorldEventEnvelope | undefined>;
  getEvents(query: EventQuery): Promise<readonly WorldEventEnvelope[]>;
  getProvenance(eventId: EventId): Promise<ProvenanceRecord | undefined>;
  getSnapshot(snapshotId: SnapshotId): Promise<SnapshotDescriptor | undefined>;
  getBranchLineage(worldId?: WorldId): Promise<readonly BranchRecord[]>;
  getInformationBoundary(asOf: TimestampMs): Promise<InformationBoundaryState>;
  getDeterminismManifest(): Promise<DeterminismManifest>;
}

/** The complete World Protocol: every world implementation exposes all four. */
export interface WorldProtocol {
  readonly query: QueryPort;
  readonly command: CommandPort;
  readonly clock: ClockPort;
  readonly evidence: EvidencePort;
}
