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
 * (exact decimal text, deterministic account/definition order) — the
 * summary builder lives here too (split out of engine.ts when W016's
 * snapshot/branch wiring pushed that file past the repo's 400-line
 * max-lines law; the same precedent as W014's matching/state.ts split and
 * W015's lifecycle.ts → validate.ts + orderCommands.ts).
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
import type { TimestampMs } from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import {
  financialLedgerOf,
  financialsOf,
  projectBalances,
  type FinancialState,
} from "../account/index.js";
import { formatSignedMoney, isOpenPosition, projectPosition } from "../portfolio/index.js";
import { projectRiskState } from "../risk/index.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
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
  /** The world's ancestry chain (W016) — hashed into inputHashes.lineage. */
  readonly lineage?: readonly BranchLineageRecord[];
  /** Genesis snapshot digest (W016) — present only for branch worlds. */
  readonly genesisSnapshotDigest?: string;
}

/**
 * The live determinism manifest. `inputHashes.worldDefinition` is the
 * canonical digest of the whole definition; `commandStreamHash` covers EVERY
 * command submitted through the CommandPort in order (acknowledged and
 * rejected alike — rejections are deterministic too); wall time never enters.
 * W016: `inputHashes.lineage` records the branch lineage chain (A8 — the
 * chain is immutable and part of the run's identity) and
 * `inputHashes.genesisSnapshot` names the snapshot a BRANCH world was born
 * from (a branch run is a function of its genesis snapshot, which its own
 * journal cannot express). A snapshot-RESTORED engine deliberately does NOT
 * record it — restore is exactly equivalent to full replay, so the manifests
 * must be identical.
 */
export function buildDeterminismManifest(inputs: ManifestInputs): DeterminismManifest {
  const { definition, commandStreamHasher } = inputs;
  const lineage = inputs.lineage ?? [];
  return {
    worldDefinitionVersion: definition.worldDefinitionVersion,
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    seed: definition.seed,
    inputHashes: {
      worldDefinition: stableDigest(definition),
      lineage: stableDigest(lineage),
      ...(inputs.genesisSnapshotDigest === undefined
        ? {}
        : { genesisSnapshot: inputs.genesisSnapshotDigest }),
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

/**
 * Build the SIMULATION.md financial summary (balances, positions, P&L,
 * risk) from the live financial slice — deterministic account order (the
 * definition), exact decimal text. Pure: a function of the definition, the
 * event-derived financial state and the observation time.
 */
export function buildHeadlessFinancialSummary(input: {
  readonly definition: WorldDefinition;
  readonly financial: FinancialState;
  readonly asOf: TimestampMs;
}): HeadlessFinancialSummary {
  const { definition, financial, asOf } = input;
  const balances: Money[] = [];
  const positions: Position[] = [];
  const pnl: HeadlessPnlSummary[] = [];
  const risk: RiskState[] = [];
  for (const account of definition.accounts) {
    const accountId = String(account.accountId);
    const ledger = financialLedgerOf(financial, accountId);
    balances.push(...projectBalances(ledger));
    const own = financial.portfolio.positions.filter(
      (record) => String(record.accountId) === accountId,
    );
    positions.push(...own.filter(isOpenPosition).map(projectPosition));
    const financials = financialsOf(financial, accountId);
    const money = (scaled: bigint): Money => ({
      amount: formatSignedMoney(scaled) as Money["amount"],
      currency: financials.baseCurrency as Money["currency"],
    });
    pnl.push({
      accountId: account.accountId,
      realized: money(financials.realizedPnl),
      unrealized: money(financials.unrealizedPnl),
      total: money(financials.realizedPnl + financials.unrealizedPnl),
    });
    risk.push(
      projectRiskState({
        worldId: definition.scope.worldId,
        accountId: account.accountId,
        asOf,
        risk: financial.risk,
      }),
    );
  }
  return { balances, positions, pnl, risk };
}

/** Build the headless report from the live engine state. */
export function buildHeadlessReport(input: {
  readonly worldId: WorldId;
  readonly mode: WorldMode;
  readonly seed: string;
  readonly finalSimulationTime: SimulationTimeMs;
  readonly journal: EventJournal;
  readonly financial: HeadlessFinancialSummary;
  /** The world's ancestry chain (W016) — reported as branchLineage. */
  readonly lineage?: readonly BranchLineageRecord[];
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
    branchLineage: (input.lineage ?? []) as readonly BranchRecord[],
  };
}
