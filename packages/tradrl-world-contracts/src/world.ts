/**
 * World identity/meta, snapshot, branch, determinism and scenario contracts.
 *
 * Spec: spec/WORLD-PROTOCOL.md — Snapshots ("immutable and self-describing"),
 * Branches ("a branch never modifies its parent"), Determinism (manifest
 * contents).
 * Spec: spec/ARCHITECTURE.md §8 Simulation modes, §9 Branching.
 * Spec: spec/SIMULATION.md — Fidelity declarations ("Every World reports:
 * mode, input data source, engine, engine version, known limitations,
 * deterministic/nondeterministic declaration") and Synthetic regimes
 * ("Regime schedules are part of world metadata").
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — simulation/live boundary fails closed.
 */

import type { CommandId, SnapshotId, WorldId, WorldScope } from "./ids.js";
import type { Provenance } from "./information.js";
import type { SequenceNumber, TimestampMs } from "./primitives.js";

/** Simulation modes (ARCHITECTURE.md §8). All four are simulated execution. */
export type WorldMode =
  | "exact-replay"
  | "reactive-replay"
  | "counterfactual"
  | "live-mirror";

/**
 * Execution authority declaration. World Alpha is `simulated-only` — a
 * literal type, so granting live execution authority requires a contract
 * change, never a data change (fail-closed, A14; acceptance K).
 */
export type ExecutionAuthority = "simulated-only";

/** Determinism declaration (A9: nondeterministic modes declare sources). */
export type DeterminismDeclaration =
  | { readonly kind: "deterministic" }
  | { readonly kind: "nondeterministic"; readonly sources: readonly string[] };

/** Seeded synthetic market regimes (SIMULATION.md "Synthetic regimes"). */
export type RegimeKind =
  | "trend"
  | "mean-reversion"
  | "high-volatility"
  | "low-liquidity"
  | "shock"
  | "halt-reopen";

/** One scheduled regime window. */
export interface RegimeScheduleEntry {
  readonly regime: RegimeKind;
  readonly from: TimestampMs;
  readonly to?: TimestampMs;
  readonly parameters?: Readonly<Record<string, number>>;
}

/** A scenario is an ordered regime schedule (CommandPort.setScenario). */
export interface ScenarioDefinition {
  readonly label?: string;
  readonly entries: readonly RegimeScheduleEntry[];
}

/**
 * Fidelity + identity declaration of a world (SIMULATION.md "Fidelity
 * declarations"). The mode is always explicit and visible (R004).
 */
export interface WorldMeta {
  readonly worldId: WorldId;
  readonly scope: WorldScope;
  readonly mode: WorldMode;
  readonly executionAuthority: ExecutionAuthority;
  readonly engine: string;
  readonly engineVersion: string;
  readonly worldDefinitionVersion: string;
  readonly seed: string;
  readonly inputDataSource: string;
  readonly knownLimitations: readonly string[];
  readonly determinism: DeterminismDeclaration;
  /** Regime schedules are part of world metadata (SIMULATION.md). */
  readonly regimeSchedule?: readonly RegimeScheduleEntry[];
  /** Set for branch worlds (A8: lineage is immutable). */
  readonly parentWorldId?: WorldId;
}

/**
 * Immutable, self-describing snapshot descriptor. The snapshot *payload*
 * (world definition, clock, engine/version, seed, market/account/participant/
 * information state, journal cursor) is engine-owned; the descriptor is the
 * protocol-level handle (WORLD-PROTOCOL.md "Snapshots").
 */
export interface SnapshotDescriptor {
  readonly snapshotId: SnapshotId;
  readonly worldId: WorldId;
  readonly parentSnapshotId?: SnapshotId;
  readonly createdAt: TimestampMs;
  /** Journal position the snapshot was taken at. */
  readonly journalCursor: SequenceNumber;
  /** Content digest for verification. */
  readonly digest?: string;
}

/** Branch configuration (ARCHITECTURE.md §9). */
export interface BranchConfiguration {
  readonly label?: string;
  readonly notes?: string;
  /** Explicit altered scenario rules for counterfactual branches. */
  readonly scenarioOverride?: ScenarioDefinition;
}

/**
 * A branch record. A branch never modifies its parent: it references the
 * source snapshot and records its definition (WORLD-PROTOCOL.md "Branches").
 */
export interface BranchRecord {
  readonly worldId: WorldId;
  readonly parentWorldId: WorldId;
  readonly sourceSnapshotId: SnapshotId;
  readonly configuration: BranchConfiguration;
  readonly engine: string;
  readonly engineVersion: string;
  readonly seed: string;
  readonly createdViaCommand: CommandId;
  readonly provenance: Provenance;
  readonly createdAt: TimestampMs;
}

/**
 * Determinism manifest (WORLD-PROTOCOL.md "Determinism"): everything needed
 * to verify a determinism claim (R015 machine-verifiable).
 */
export interface DeterminismManifest {
  readonly worldDefinitionVersion: string;
  readonly engine: string;
  readonly engineVersion: string;
  readonly seed: string;
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly dependencyVersions: Readonly<Record<string, string>>;
  readonly commandStreamHash: string;
}
