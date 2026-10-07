/**
 * The determinism manifest and the headless run report.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Determinism" (the manifest carries world
 * definition version, engine/version, seed, input hashes, dependency/
 * runtime versions, command stream hash).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 (a determinism claim requires fixed
 * world definition, engine version, seed and command stream).
 * Spec: spec/SIMULATION.md "Headless report" (world id, mode, seed, final
 * simulation time, balances, positions, P&L, risk, event count, event hash,
 * branch lineage — the financial fields arrive with W015 and are explicitly
 * absent here).
 */

import type { BranchRecord, DeterminismManifest, WorldMode, WorldId } from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import type { EventJournal } from "../journal/eventJournal.js";
import type { Fnv1aHasher } from "./hashing.js";
import {
  CONTRACTS_DEPENDENCY_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  type WorldDefinition,
} from "./definition.js";
import { stableDigest } from "./hashing.js";

/** Manifest inputs owned by the engine. */
export interface ManifestInputs {
  readonly definition: WorldDefinition;
  readonly commandStreamHasher: Fnv1aHasher;
}

/**
 * The live determinism manifest. `inputHashes.worldDefinition` is the
 * canonical digest of the whole definition; `commandStreamHash` covers EVERY
 * command submitted through the CommandPort in order (acknowledged and
 * rejected alike — rejections are deterministic too); wall time never enters.
 */
export function buildDeterminismManifest(inputs: ManifestInputs): DeterminismManifest {
  const { definition, commandStreamHasher } = inputs;
  return {
    worldDefinitionVersion: definition.worldDefinitionVersion,
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    seed: definition.seed,
    inputHashes: {
      worldDefinition: stableDigest(definition),
    },
    dependencyVersions: {
      [ENGINE_ID]: ENGINE_VERSION,
      "tradrl-world-contracts": CONTRACTS_DEPENDENCY_VERSION,
      node: process.versions.node,
    },
    commandStreamHash: commandStreamHasher.hex(),
  };
}

/**
 * The headless run report (SIMULATION.md) as far as the skeleton reaches:
 * financial fields (balances/positions/P&L/risk) land with W014/W015 and are
 * deliberately not faked here.
 */
export interface HeadlessRunReport {
  readonly worldId: WorldId;
  readonly mode: WorldMode;
  readonly seed: string;
  readonly finalSimulationTime: SimulationTimeMs;
  readonly eventCount: number;
  readonly eventHash: string;
  readonly branchLineage: readonly BranchRecord[];
}

/** Build the headless report from the live engine state. */
export function buildHeadlessReport(input: {
  readonly worldId: WorldId;
  readonly mode: WorldMode;
  readonly seed: string;
  readonly finalSimulationTime: SimulationTimeMs;
  readonly journal: EventJournal;
}): HeadlessRunReport {
  const digest = input.journal.digest();
  return {
    worldId: input.worldId,
    mode: input.mode,
    seed: input.seed,
    finalSimulationTime: input.finalSimulationTime,
    eventCount: digest.eventCount,
    eventHash: digest.eventChecksum,
    branchLineage: [],
  };
}
