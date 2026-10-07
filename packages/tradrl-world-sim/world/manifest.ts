/**
 * The determinism manifest and the headless run report.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Determinism" (the manifest carries world
 * definition version, engine/version, seed, input hashes, dependency/
 * runtime versions, command stream hash).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 (a determinism claim requires fixed
 * world definition, engine version, seed and command stream).
 * Spec: spec/SIMULATION.md "Headless report" — world id, mode, seed, final
 * simulation time, balances, positions, P&L, risk, event count, event hash,
 * branch lineage. The financial fields are the W015 engine surface
 * (exact decimal text, deterministic account/definition order).
 */

import type {
  AccountId,
  BranchRecord,
  DeterminismManifest,
  Money,
  Position,
  RiskState,
  WorldMode,
  WorldId,
} from "tradrl-world-contracts";
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

/** The P&L breakdown of one account (the SIMULATION.md headless report). */
export interface HeadlessPnlSummary {
  readonly accountId: AccountId;
  readonly realized: Money;
  readonly unrealized: Money;
  readonly total: Money;
}

/** The financial summary the headless report carries (W015 engine surface). */
export interface HeadlessFinancialSummary {
  /** Every declared account's balances, in definition order. */
  readonly balances: readonly Money[];
  /** Open positions (definition account order, ledger order within). */
  readonly positions: readonly Position[];
  /** Per-account realized/unrealized/total P&L. */
  readonly pnl: readonly HeadlessPnlSummary[];
  /** Per-account risk state (limits + breaches). */
  readonly risk: readonly RiskState[];
}

/**
 * The headless run report (SIMULATION.md): identity, the financial state
 * (W015), the journal digest and the (still empty) branch lineage.
 */
export interface HeadlessRunReport {
  readonly worldId: WorldId;
  readonly mode: WorldMode;
  readonly seed: string;
  readonly finalSimulationTime: SimulationTimeMs;
  readonly balances: readonly Money[];
  readonly positions: readonly Position[];
  readonly pnl: readonly HeadlessPnlSummary[];
  readonly risk: readonly RiskState[];
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
  readonly financial: HeadlessFinancialSummary;
}): HeadlessRunReport {
  const digest = input.journal.digest();
  return {
    worldId: input.worldId,
    mode: input.mode,
    seed: input.seed,
    finalSimulationTime: input.finalSimulationTime,
    balances: input.financial.balances,
    positions: input.financial.positions,
    pnl: input.financial.pnl,
    risk: input.financial.risk,
    eventCount: digest.eventCount,
    eventHash: digest.eventChecksum,
    branchLineage: [],
  };
}
