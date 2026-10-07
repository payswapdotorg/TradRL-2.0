/**
 * The headless world engine — the W013 composition root, extended by W016
 * with the snapshot/branch engine.
 *
 * Spec: spec/SIMULATION.md ("Phase 1" deterministic TypeScript runtime, Node
 * headless target; "Runtime topology" — the engine composes clock, world
 * core and journal) and "Headless report".
 * Spec: spec/WORLD-PROTOCOL.md "Ports" — the engine EXPOSES the four ports
 * (QueryPort, CommandPort, ClockPort, EvidencePort); no engine-specific type
 * crosses a port (ADR-003). The members below the ports are engine-surface
 * APIs, documented per member.
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — command → validate →
 * authorize → apply domain rules → mutate authoritative state → emit ordered
 * events → append journal → publish projections → ack. State is mutated ONLY
 * by reducing journaled events, so live runs and replays advance state
 * through the same code path (A6/A9).
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — rewind is branch-creation, never
 * in-place: `createSnapshot`/`branchWorld` are REAL here (W016); a
 * `branch-world` command appends one record to the PARENT journal and the
 * engine creates the child world from the immutable source snapshot (its own
 * journal, rescoped genesis state, carried lineage).
 *
 * Determinism: every state input is (definition, journaled events, command
 * stream) — for a BRANCH world, (definition, genesis snapshot, journaled
 * events, command stream), which the determinism manifest records via
 * `inputHashes.genesisSnapshot`. Wall time is recorded on the clock axis
 * only and never enters events, digests or the manifest.
 */

import type {
  BranchConfiguration,
  ClockPort,
  CommandId,
  CommandPort,
  CommandResult,
  DeterminismManifest,
  EventId,
  EvidencePort,
  QueryPort,
  SequenceNumber,
  SnapshotId,
  TimestampMs,
  WorldCommand,
  WorldEventEnvelope,
  WorldId,
  WorldProtocol,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type { ClockState } from "tradrl-world-contracts/time";
import { asClockPort, createSimulationClock, type SimulationClock } from "../clock/index.js";
import type { EventJournal, JournalRecord } from "../journal/index.js";
import { createEventJournal, createEventJournalFromRecords } from "../journal/index.js";
import type { PendingEventDraft } from "../journal/eventJournal.js";
import { withBranchWorldId } from "../branch/definition.js";
import { branchGenesisState } from "../branch/genesis.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
import type { WorldSnapshot } from "../snapshot/capture.js";
import { snapshotFromJournalEvent } from "../snapshot/restore.js";
import { foldJournalIntoState } from "../snapshot/restore.js";
import { hydrateWorldState } from "../snapshot/stateCodec.js";
import { assertValidWorldDefinition, type WorldDefinition } from "./definition.js";
import { EngineInvariantError } from "./errors.js";
import { runCommandLifecycle } from "./lifecycle.js";
import {
  buildDeterminismManifest,
  buildHeadlessFinancialSummary,
  buildHeadlessReport,
  type HeadlessRunReport,
} from "./manifest.js";
import { canonicalString, createFnv1aHasher } from "./hashing.js";
import {
  createEvidencePort,
  createQueryPort,
  journalEventLookup,
  type EngineReadModel,
} from "./projections.js";
import { initialWorldState, reduceWorldEvent, type WorldState } from "./state.js";
import { createReduceOnlyCheck } from "../risk/index.js";

/**
 * Restore parameters: rebuild an engine from history.
 * - `journal` — full replay of a preloaded journal (W013 path).
 * - `snapshot` + optional `journalTail` — rehydrate from a snapshot payload
 *   and reduce ONLY the tail records (W016 path; faster than full replay and
 *   EXACTLY equivalent — snapshot/test/restore.test.ts proves it).
 */
export interface EngineRestore {
  /** A journal preloaded via `createEventJournalFromRecords` (full replay). */
  readonly journal?: EventJournal;
  /** A full snapshot payload to rehydrate from (same world). */
  readonly snapshot?: WorldSnapshot;
  /** Same-world records after the snapshot's cursor (reduced, not replayed). */
  readonly journalTail?: readonly JournalRecord[];
  readonly clockAt?: SimulationTimeMs;
  readonly speed?: number;
}

/** Branch genesis: birth parameters of a world created from a snapshot. */
export interface BranchGenesisOptions {
  /** The immutable source snapshot (branch origin). */
  readonly snapshot: WorldSnapshot;
  /** The recorded branch configuration (scenario override et al). */
  readonly configuration?: BranchConfiguration;
}

/** Options for `createHeadlessWorldEngine`. */
export interface HeadlessWorldEngineOptions {
  readonly definition: WorldDefinition;
  /**
   * The ancestry chain carried at creation (W016): root worlds start empty;
   * branch engines receive `[...parentLineage, ownRecord]`. Journaled on the
   * PARENT — a bare journal replay cannot recover it, so it is engine-carried.
   */
  readonly lineage?: readonly BranchLineageRecord[];
  /** Branch genesis (W016): start from a snapshot's state with a fresh journal. */
  readonly branchGenesis?: BranchGenesisOptions;
  /**
   * Host-axis clock source (A7). Default: the real host clock. Inject a
   * fixed source for tests/deterministic replays — wall time never enters
   * events, digests or the manifest, so this affects only the clock's
   * wall-axis readout.
   */
  readonly wallTimeSource?: () => WallTimeMs;
  readonly restore?: EngineRestore;
  /**
   * The explicit `publish projections` lifecycle step: called after the
   * state mutation, synchronously, with the ack and the ordered events.
   * Side-channel only — it must not mutate engine state (determinism); the
   * W018 adapter subscribes here to stream projections to the UI. NOT
   * inherited by branch child engines (each host wires its own).
   */
  readonly onPublished?: (published: {
    readonly ack: CommandResult & { status: "acked" };
    readonly events: readonly WorldEventEnvelope[];
  }) => void;
}

/** The headless engine: the four ports plus the engine-surface extras. */
export interface HeadlessWorldEngine {
  readonly worldId: WorldId;
  /** The four ports, grouped (A5). */
  readonly protocol: WorldProtocol;
  readonly query: QueryPort;
  readonly command: CommandPort;
  readonly clock: ClockPort;
  readonly evidence: EvidencePort;
  /** The authoritative history (records + digest + cursor for W016). */
  readonly journal: EventJournal;
  /** Full clock state (W004's ClockState — what W012/W018 consume). */
  clockState(): ClockState;
  /** Snapshot of the authoritative world state (engine surface, not a port). */
  worldState(): WorldState;
  /**
   * The W017 generator seam (engine surface, not a port): journal + reduce
   * generator-produced market events through the single command path. See
   * the generator module (generator/engine.ts) — the only intended caller.
   */
  applyGeneratorEvents(drafts: readonly PendingEventDraft[]): readonly WorldEventEnvelope[];
  determinismManifest(): DeterminismManifest;
  headlessReport(): HeadlessRunReport;
  /** W016: full snapshot payloads taken in this session (restore/branch inputs). */
  getSnapshotPayload(snapshotId: SnapshotId): WorldSnapshot | undefined;
  /** W016: branch engines created from this world, in creation order. */
  branchEngines(): readonly HeadlessWorldEngine[];
  /** W016: this world's ancestry chain (root-first; empty for root worlds). */
  branchLineage(): readonly BranchLineageRecord[];
}

function defaultWallTimeSource(): WallTimeMs {
  return asWallTime(Date.now());
}

function lastEventTimeOf(records: readonly JournalRecord[]): number | undefined {
  return records[records.length - 1]?.envelope.occurredAt;
}

/** Validate restore/genesis option combinations with explicit errors. */
function assertRestoreShape(options: HeadlessWorldEngineOptions): void {
  const restore = options.restore;
  if (restore === undefined) return;
  if (restore.snapshot !== undefined && restore.journal !== undefined) {
    throw new EngineInvariantError(
      "restore.snapshot and restore.journal are mutually exclusive (snapshot restore reduces only the tail)",
    );
  }
  if (restore.snapshot === undefined && restore.journalTail !== undefined) {
    throw new EngineInvariantError("restore.journalTail requires restore.snapshot");
  }
  if (
    options.branchGenesis !== undefined &&
    restore.snapshot !== undefined
  ) {
    throw new EngineInvariantError(
      "branchGenesis and restore.snapshot are mutually exclusive (a branch journal is its own world's)",
    );
  }
}

/**
 * Create the headless deterministic world engine. Genesis modes:
 * - fresh: initial state at the definition's clock origin;
 * - `restore.journal`: full deterministic replay (A9 core);
 * - `restore.snapshot` (+ `journalTail`): rehydrate the materialized state
 *   and reduce only the tail — faster than full replay, exactly equivalent;
 * - `branchGenesis.snapshot` (+ optional `restore.journal` of the branch's
 *   own records): a branch world — snapshot genesis state, own empty journal
 *   (or its own replayed journal), carried lineage.
 */
export function createHeadlessWorldEngine(
  options: HeadlessWorldEngineOptions,
): HeadlessWorldEngine {
  const { definition } = options;
  assertValidWorldDefinition(definition);
  assertRestoreShape(options);

  const wallTimeSource = options.wallTimeSource ?? defaultWallTimeSource;
  const lineage: readonly BranchLineageRecord[] = options.lineage ?? [];

  // --- journal + state genesis (the four coherent paths) --------------------
  let journal: EventJournal;
  let foldFrom: WorldState;
  let foldRecords: readonly JournalRecord[];
  let clockDefault: SimulationTimeMs;
  const snapshotPayloads = new Map<SnapshotId, WorldSnapshot>();

  if (options.branchGenesis !== undefined) {
    const genesis = options.branchGenesis;
    if (genesis.snapshot.descriptor.worldId !== genesis.snapshot.definition.scope.worldId) {
      throw new EngineInvariantError("branchGenesis snapshot is not self-consistent");
    }
    journal = options.restore?.journal ?? createEventJournal(definition.scope.worldId);
    foldFrom = branchGenesisState({
      snapshot: genesis.snapshot,
      branchWorldId: definition.scope.worldId,
      configuration: genesis.configuration,
    });
    foldRecords = journal.records();
    clockDefault =
      foldRecords.length > 0
        ? asSimulationTime(lastEventTimeOf(foldRecords)!)
        : asSimulationTime(genesis.snapshot.descriptor.createdAt);
  } else if (options.restore?.snapshot !== undefined) {
    const snapshot = options.restore.snapshot;
    if (snapshot.descriptor.worldId !== definition.scope.worldId) {
      throw new EngineInvariantError(
        `snapshot belongs to world ${String(snapshot.descriptor.worldId)}, not ${String(definition.scope.worldId)}`,
      );
    }
    if (canonicalString(snapshot.definition) !== canonicalString(definition)) {
      throw new EngineInvariantError(
        "restore.snapshot was taken under a different world definition (digest mismatch)",
      );
    }
    const tail = options.restore.journalTail ?? [];
    journal = createEventJournalFromRecords({
      worldId: definition.scope.worldId,
      records: [...snapshot.records, ...tail],
    });
    snapshotPayloads.set(snapshot.descriptor.snapshotId, snapshot);
    foldFrom = hydrateWorldState(snapshot.state);
    foldRecords = tail;
    const all = journal.records();
    clockDefault = asSimulationTime(lastEventTimeOf(all) ?? snapshot.descriptor.createdAt);
  } else if (options.restore?.journal !== undefined) {
    journal = options.restore.journal;
    foldFrom = initialWorldState(definition);
    foldRecords = journal.records();
    clockDefault = asSimulationTime(lastEventTimeOf(foldRecords) ?? definition.clock.start);
  } else {
    journal = createEventJournal(definition.scope.worldId);
    foldFrom = initialWorldState(definition);
    foldRecords = [];
    clockDefault = definition.clock.start;
  }

  // The single reduction path (live = replay): a strict ordered fold that
  // also captures full snapshot payloads at world.snapshot.created records —
  // that is how a replayed engine rebuilds its snapshot store from truth.
  const fold = foldJournalIntoState({
    definition,
    initialState: foldFrom,
    records: foldRecords,
    journalRecords: journal.records(),
  });
  let state: WorldState = fold.state;
  for (const captured of fold.capturedSnapshots) {
    snapshotPayloads.set(captured.descriptor.snapshotId, captured);
  }

  const clockInitial =
    options.restore?.clockAt !== undefined
      ? options.restore.clockAt
      : fold.lastEventTime !== undefined
        ? asSimulationTime(fold.lastEventTime)
        : clockDefault;

  const clock: SimulationClock = createSimulationClock({
    worldId: definition.scope.worldId,
    simulationTime: clockInitial,
    wallTime: definition.clock.initialWallTime,
    bounds: {
      start: definition.clock.start,
      ...(definition.clock.end === undefined ? {} : { end: definition.clock.end }),
    },
    defaultStepMs: definition.clock.defaultStepMs,
    speed: options.restore?.speed ?? definition.clock.speed,
    eventLookup: journalEventLookup(journal),
  });

  const commandStreamHasher = createFnv1aHasher();
  const genesisSnapshotDigest = options.branchGenesis?.snapshot.descriptor.digest;

  const readModel = (): EngineReadModel => ({
    definition,
    state,
    clockState: clock.state(),
    journal,
    lineage,
  });

  // The single serialization point: commands and clock operations apply in
  // arrival order. The chain swallows individual failures — every caller
  // owns its own rejection (the queue itself never breaks).
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => T): Promise<Awaited<T>> {
    const run = tail.then(work, work) as Promise<Awaited<T>>;
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const childEngines: HeadlessWorldEngine[] = [];

  function executeCommand(command: WorldCommand): CommandResult {
    // The command stream hash covers every submitted command, in order,
    // rejected ones included (A9: the full input stream).
    commandStreamHasher.update(command);
    const stateBefore = state;
    const outcome = runCommandLifecycle(command, {
      definition,
      state,
      simulationTime: clock.state().simulationTime,
      // W014 seam: the matcher reserves the journal's next dense sequences
      // so its fill drafts can cite the trade events that generated them.
      nextSequence: (journal.getCursor() + 1) as SequenceNumber,
      // W015 seam: the reduce-only position check over the live portfolio —
      // the venue-side enforcement W014 left permissive until positions
      // existed (documented known limitation, now wired).
      reduceOnlyCheck: createReduceOnlyCheck(state.financial.portfolio),
      // W016 seams: the snapshot/branch command surfaces.
      journal,
      snapshotPayloads,
    });
    if (outcome.kind === "rejected") {
      return { status: "rejected", rejection: outcome.rejection };
    }
    const sealed = journalAndReduce(outcome.drafts);
    const ack: CommandResult & { status: "acked" } = {
      status: "acked",
      ack: {
        commandId: command.commandId,
        worldId: definition.scope.worldId,
        acceptedAt: sealed.length > 0 ? sealed[sealed.length - 1]!.occurredAt : (clock.state().simulationTime as TimestampMs),
        resultingEventIds: sealed.map(
          (envelope: WorldEventEnvelope): EventId => envelope.eventId,
        ),
        journalCursor: journal.getCursor(),
      },
    };
    applyW016AckEffects(command, sealed, stateBefore);
    options.onPublished?.({ ack, events: sealed });
    return ack;
  }

  /**
   * W016 post-ack effects (after journaling + reducing, before publishing):
   * - create-snapshot: register the full snapshot payload (rebuilt from the
   *   pre-event state + the journal prefix — the same content the seam
   *   hashed, verified by digest);
   * - branch-world: create the child world from the source snapshot (own
   *   journal, rescoped genesis state, carried lineage) and hold it.
   */
  function applyW016AckEffects(
    command: WorldCommand,
    sealed: readonly WorldEventEnvelope[],
    stateBefore: WorldState,
  ): void {
    if (command.kind === "create-snapshot") {
      const event = sealed.find((envelope) => envelope.eventType === "world.snapshot.created");
      if (event === undefined) {
        throw new EngineInvariantError("create-snapshot acked without a world.snapshot.created event");
      }
      const snapshot = snapshotFromJournalEvent({
        definition,
        state: stateBefore,
        journalRecords: journal.records(),
        envelope: event,
      });
      snapshotPayloads.set(snapshot.descriptor.snapshotId, snapshot);
      return;
    }
    if (command.kind === "branch-world") {
      const branches = state.branches;
      const record = branches[branches.length - 1];
      if (record === undefined) {
        throw new EngineInvariantError("branch-world acked without a reduced branch record");
      }
      const snapshot = snapshotPayloads.get(record.sourceSnapshotId);
      if (snapshot === undefined) {
        throw new EngineInvariantError(
          `branch-world acked for snapshot ${String(record.sourceSnapshotId)} without a restorable payload`,
        );
      }
      const child = createHeadlessWorldEngine({
        definition: withBranchWorldId(snapshot.definition, record.worldId),
        lineage: [...lineage, record],
        branchGenesis: { snapshot, configuration: record.configuration },
        wallTimeSource,
      });
      childEngines.push(child);
    }
  }

  /**
   * The single journal→reduce path (A6): append ordered drafts, then advance
   * the authoritative state by reducing exactly what was journaled — the
   * same path replay uses. Shared by the command lifecycle and the W017
   * generator seam below.
   */
  function journalAndReduce(drafts: readonly PendingEventDraft[]): readonly WorldEventEnvelope[] {
    const occurredAt = clock.state().simulationTime as TimestampMs;
    const sealed = journal.append(drafts, { recordedAt: occurredAt });
    const records = journal.records();
    for (const record of records.slice(records.length - sealed.length)) {
      state = reduceWorldEvent(state, record);
    }
    return sealed;
  }

  /**
   * THE W017 SEAM (engine surface, not a World Protocol port): journal and
   * reduce market events produced by the synthetic market generator
   * (generator/engine.ts) through the exact single path commands use — so
   * generated market events advance the authoritative state and replay
   * bit-identically (A6/A9). The generator OWNS which events these are
   * (regime announcements, halt/reopen transitions, quote projections); this
   * method is deliberately mechanics-only: no lifecycle, no command-stream
   * hashing (generated events are deterministic functions of definition +
   * seed + clock operations, never commands).
   */
  function applyGeneratorEvents(
    drafts: readonly PendingEventDraft[],
  ): readonly WorldEventEnvelope[] {
    if (drafts.length === 0) {
      return [];
    }
    const sealed = journalAndReduce(drafts);
    // Publish through the same side-channel commands use: the batch's
    // causation id (a generator turn id) stands in for the command id so
    // downstream projection subscribers see generated events too (W018/W019).
    const turnId = sealed[sealed.length - 1]!.causationId as unknown as CommandId;
    const ack: CommandResult & { status: "acked" } = {
      status: "acked",
      ack: {
        commandId: turnId,
        worldId: definition.scope.worldId,
        acceptedAt: sealed[sealed.length - 1]!.occurredAt,
        resultingEventIds: sealed.map((envelope: WorldEventEnvelope): EventId => envelope.eventId),
        journalCursor: journal.getCursor(),
      },
    };
    options.onPublished?.({ ack, events: sealed });
    return sealed;
  }

  const queryPort: QueryPort = createQueryPort(readModel);
  const evidencePort: EvidencePort = createEvidencePort(readModel, () =>
    buildDeterminismManifest({
      definition,
      commandStreamHasher,
      lineage,
      ...(genesisSnapshotDigest === undefined ? {} : { genesisSnapshotDigest }),
    }),
  );
  const innerClockPort: ClockPort = asClockPort(clock, wallTimeSource);
  // Clock operations queue with commands: one authoritative ordering.
  const clockPort: ClockPort = {
    play: () => enqueue(() => innerClockPort.play()),
    pause: () => enqueue(() => innerClockPort.pause()),
    step: (deltaMs?: number) => enqueue(() => innerClockPort.step(deltaMs)),
    seek: (to) => enqueue(() => innerClockPort.seek(to)),
    jumpToEvent: (target) => enqueue(() => innerClockPort.jumpToEvent(target)),
    setSpeed: (speed: number) => enqueue(() => innerClockPort.setSpeed(speed)),
    followRealtime: (enabled: boolean) => enqueue(() => innerClockPort.followRealtime(enabled)),
    getClock: () => innerClockPort.getClock(),
  };

  const commandPort: CommandPort = {
    submitOrder: (command) => enqueue(() => executeCommand(command)),
    cancelOrder: (command) => enqueue(() => executeCommand(command)),
    replaceOrder: (command) => enqueue(() => executeCommand(command)),
    closePosition: (command) => enqueue(() => executeCommand(command)),
    addAnnotation: (command) => enqueue(() => executeCommand(command)),
    createSnapshot: (command) => enqueue(() => executeCommand(command)),
    branchWorld: (command) => enqueue(() => executeCommand(command)),
    setScenario: (command) => enqueue(() => executeCommand(command)),
  };

  const protocol: WorldProtocol = {
    query: queryPort,
    command: commandPort,
    clock: clockPort,
    evidence: evidencePort,
  };

  return {
    worldId: definition.scope.worldId,
    protocol,
    query: queryPort,
    command: commandPort,
    clock: clockPort,
    evidence: evidencePort,
    journal,
    clockState: () => clock.state(),
    worldState: () => state,
    applyGeneratorEvents,
    determinismManifest: () =>
      buildDeterminismManifest({
        definition,
        commandStreamHasher,
        lineage,
        ...(genesisSnapshotDigest === undefined ? {} : { genesisSnapshotDigest }),
      }),
    headlessReport: () =>
      buildHeadlessReport({
        worldId: definition.scope.worldId,
        mode: definition.mode,
        seed: definition.seed,
        finalSimulationTime: clock.state().simulationTime,
        journal,
        // The W015 financial summary (moved to manifest.ts with W016's
        // snapshot/branch wiring — the 400-line max-lines law).
        financial: buildHeadlessFinancialSummary({
          definition,
          financial: state.financial,
          asOf: clock.state().simulationTime as TimestampMs,
        }),
        lineage,
      }),
    getSnapshotPayload: (snapshotId) => snapshotPayloads.get(snapshotId),
    branchEngines: () => [...childEngines],
    branchLineage: () => [...lineage],
  };
}
