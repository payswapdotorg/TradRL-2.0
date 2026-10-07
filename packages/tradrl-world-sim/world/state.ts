/**
 * The authoritative world state and its event reducer.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 (commands mutate authoritative state,
 * emit ordered events and append journal records) and A9 (determinism).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — World Engine → authoritative
 * live state; the state is advanced ONLY by reducing journaled events, so
 * live runs and journal replays advance state through the exact same code
 * path (bit-identical state — the core of deterministic replay).
 *
 * W014 seam: the order registry, fills, trades and per-instrument books
 * live in the `matching` slice (matching/state.ts). Its reducer is the
 * single reduction path — this module delegates matching/market event
 * types to it (the W013 skeleton's permanently-empty `orders` registry is
 * superseded; the matcher owns the transitions that fill it).
 */

import type {
  AnnotationId,
  CommandId,
  InstrumentId,
  ParticipantId,
  RegimeScheduleEntry,
  ScenarioDefinition,
  SequenceNumber,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { JournalRecord } from "../journal/eventJournal.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
import { isMatchingStateEventType, initialMatchingState, reduceMatchingEvent } from "../matching/index.js";
import type { MatchingState } from "../matching/index.js";
import { initialFinancialState, reduceFinancialEvent, type FinancialState } from "../account/index.js";
import { isGeneratorStateEventType } from "../generator/events.js";
import { initialMarketGeneratorState, reduceMarketGeneratorEvent } from "../generator/state.js";
import type { MarketGeneratorState } from "../generator/state.js";
import { ENGINE_ID, ENGINE_VERSION, type WorldDefinition } from "./definition.js";
import { EngineInvariantError } from "./errors.js";
import {
  isAnnotationAddedPayload,
  isBranchCreatedPayload,
  isScenarioSetPayload,
  isSnapshotCreatedPayload,
} from "./events.js";

/** One annotation on the world timeline (added via CommandPort.addAnnotation). */
export interface WorldAnnotation {
  readonly annotationId: AnnotationId;
  readonly issuedBy: ParticipantId;
  readonly instrumentId?: InstrumentId;
  /** The annotated timeline point — data chosen by the trader. */
  readonly at: TimestampMs;
  readonly text: string;
  /** Domain time when the annotation event occurred. */
  readonly addedAt: TimestampMs;
}

/**
 * Event-derived summary of one snapshot taken in this world (reduced from
 * `world.snapshot.created`; W016). The full restorable payload lives in the
 * engine's session snapshot store — this slice is what replay rebuilds.
 */
export interface SnapshotSummary {
  readonly snapshotId: SnapshotId;
  readonly journalCursor: SequenceNumber;
  readonly digest: string;
  readonly createdAt: TimestampMs;
  readonly parentSnapshotId?: SnapshotId;
  readonly label?: string;
}

/** The authoritative world state of the engine. */
export interface WorldState {
  readonly annotations: readonly WorldAnnotation[];
  /** The scenario in force; the initial scenario comes from the definition. */
  readonly currentScenario?: ScenarioDefinition;
  /** Command ids that produced journaled events (duplicate-command law). */
  readonly ackedCommandIds: ReadonlySet<CommandId>;
  /** The W014 matching slice: orders, fills, trades, books, armed stops. */
  readonly matching: MatchingState;
  /**
   * The W015 financial slice: account ledgers, positions, P&L, risk state —
   * reduced from the same journaled events (fills and trade prints).
   */
  readonly financial: FinancialState;
  /** Snapshots taken in this world — event-derived (W016, replay-safe). */
  readonly snapshots: readonly SnapshotSummary[];
  /** Branches created FROM this world — event-derived (W016, replay-safe). */
  readonly branches: readonly BranchLineageRecord[];
  /** The W017 generator slice: the regime in force per the last announcement. */
  readonly market: MarketGeneratorState;
}

/** The initial state derived from a world definition. */
export function initialWorldState(definition: WorldDefinition): WorldState {
  return Object.freeze({
    annotations: [],
    ...(definition.regimeSchedule === undefined
      ? {}
      : { currentScenario: { entries: definition.regimeSchedule } as ScenarioDefinition }),
    ackedCommandIds: new Set<CommandId>(),
    matching: initialMatchingState(definition),
    financial: initialFinancialState(definition),
    snapshots: [],
    branches: [],
    market: initialMarketGeneratorState(),
  });
}

function withAckedCommand(state: WorldState, commandId: CommandId): WorldState {
  const acked = new Set(state.ackedCommandIds);
  acked.add(commandId);
  return Object.freeze({ ...state, ackedCommandIds: acked });
}

/**
 * The state reducer: apply one journaled event. Pure; called by the live
 * engine (right after append) and by replay (in stored order) — the single
 * way state ever advances. Matching/market event types delegate to the
 * matching reducer (the same function the live matcher advanced its working
 * copy through — the single-path law). Unknown event types or malformed
 * payloads are engine invariant violations (a journal this engine version
 * cannot reduce).
 */
export function reduceWorldEvent(state: WorldState, record: JournalRecord): WorldState {
  const envelope = record.envelope;
  const payload = envelope.payload;
  switch (envelope.eventType) {
    case "world.annotation.added": {
      if (!isAnnotationAddedPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.annotation.added payload`,
        );
      }
      const annotation: WorldAnnotation = {
        annotationId: payload.annotationId,
        issuedBy: payload.issuedBy,
        ...(payload.instrumentId === undefined ? {} : { instrumentId: payload.instrumentId }),
        at: payload.at,
        text: payload.text,
        addedAt: envelope.occurredAt,
      };
      return withAckedCommand(
        Object.freeze({ ...state, annotations: [...state.annotations, annotation] }),
        // the causation of every engine event is the command that caused it
        envelope.causationId as unknown as CommandId,
      );
    }
    case "world.scenario.set": {
      if (!isScenarioSetPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.scenario.set payload`,
        );
      }
      const scenario: ScenarioDefinition = {
        ...(payload.label === undefined ? {} : { label: payload.label }),
        entries: payload.entries as readonly RegimeScheduleEntry[],
      };
      return withAckedCommand(
        Object.freeze({ ...state, currentScenario: scenario }),
        envelope.causationId as unknown as CommandId,
      );
    }
    case "world.snapshot.created": {
      // W016: the snapshot REGISTRY is event-derived (replay-safe); the full
      // restorable payload is captured by the engine/fold from the very same
      // event (snapshot/restore.ts — the state-so-far IS the snapshot state).
      if (!isSnapshotCreatedPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.snapshot.created payload`,
        );
      }
      const summary: SnapshotSummary = Object.freeze({
        snapshotId: payload.snapshotId,
        journalCursor: payload.journalCursor,
        digest: payload.digest,
        createdAt: payload.createdAt,
        ...(payload.parentSnapshotId === undefined ? {} : { parentSnapshotId: payload.parentSnapshotId }),
        ...(payload.label === undefined ? {} : { label: payload.label }),
      });
      return withAckedCommand(
        Object.freeze({
          ...state,
          snapshots: Object.freeze([...state.snapshots, summary]),
        }),
        envelope.causationId as unknown as CommandId,
      );
    }
    case "world.branch.created": {
      // W016: the branch record is journaled on the PARENT world — its
      // registry of children is event-derived (replay-safe) and every record
      // carries the complete lineage facts (parent world id, snapshot digest,
      // branch point sequence).
      if (!isBranchCreatedPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.branch.created payload`,
        );
      }
      const branchRecord: BranchLineageRecord = Object.freeze({
        worldId: payload.branchWorldId,
        parentWorldId: payload.parentWorldId,
        sourceSnapshotId: payload.sourceSnapshotId,
        configuration: payload.configuration,
        engine: payload.engine,
        engineVersion: payload.engineVersion,
        seed: payload.seed,
        createdViaCommand: payload.createdViaCommand,
        provenance: { producer: envelope.producer, recordedAt: record.recordedAt },
        createdAt: payload.createdAt,
        snapshotDigest: payload.snapshotDigest,
        branchPointSequence: payload.branchPointSequence,
      });
      // W016 (A8 / DOMAIN-MODEL "Branch lineage is immutable"): the record
      // and its registry are frozen — lineage cannot be edited in place.
      return withAckedCommand(
        Object.freeze({
          ...state,
          branches: Object.freeze([...state.branches, branchRecord]),
        }),
        envelope.causationId as unknown as CommandId,
      );
    }
    default: {
      if (isMatchingStateEventType(envelope.eventType)) {
        // The W015 seam: the same event also advances the financial slices
        // (fills move positions/cash/risk, trade prints re-mark) — the
        // financial reducer sees the POST-event matching slice (it resolves
        // fill order sides from the registry).
        const matching = reduceMatchingEvent(state.matching, envelope);
        const financial = reduceFinancialEvent(state.financial, envelope, matching);
        return withAckedCommand(
          Object.freeze(
            financial === state.financial
              ? { ...state, matching }
              : { ...state, matching, financial },
          ),
          envelope.causationId as unknown as CommandId,
        );
      }
      // The W017 seam: generator-owned market events (regime announcements,
      // quote projections) reduce in the generator slice through the same
      // function replay uses. Their causation is a generator turn id, not a
      // command id, so they never enter the acked-command set.
      if (isGeneratorStateEventType(envelope.eventType)) {
        return Object.freeze({
          ...state,
          market: reduceMarketGeneratorEvent(state.market, state.matching, envelope),
        });
      }
      throw new EngineInvariantError(
        `cannot reduce event type '${envelope.eventType}' ` +
          `(engine ${ENGINE_ID}@${ENGINE_VERSION}: this journal belongs to a later engine surface)`,
      );
    }
  }
}

/** Deterministic annotation id for the next annotation (state position + 1). */
export function nextAnnotationId(worldId: WorldId, state: WorldState): AnnotationId {
  return `ann:${String(worldId)}:${String(state.annotations.length + 1)}` as AnnotationId;
}
