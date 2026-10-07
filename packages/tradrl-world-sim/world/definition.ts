/**
 * The world definition: the immutable, explicit input a headless engine run
 * is a function of (A9: fixed world definition + engine version + seed +
 * command stream ⇒ identical run).
 *
 * Spec: spec/SIMULATION.md "Fidelity declarations" (mode, input data source,
 * engine, engine version, known limitations, determinism declaration;
 * "Regime schedules are part of world metadata") and "Runtime topology".
 * Spec: spec/WORLD-PROTOCOL.md "Snapshots" (a snapshot embeds the world
 * definition — W016 will serialize this shape) and "Determinism".
 * Spec: spec/DOMAIN-MODEL.md — instruments/venues/accounts/participants are
 * world entities; ids are opaque.
 *
 * The skeleton definition carries the STATIC world (identity, instruments,
 * accounts, participants, information artifacts, initial scenario, clock
 * genesis). Domain-RULED state (order books, fills, positions, risk) is
 * owned by W014/W015 and never appears here.
 */

import type {
  Account,
  Instrument,
  InformationArtifact,
  NewsPayload,
  Participant,
  RegimeScheduleEntry,
  ScenarioDefinition,
  WorldMeta,
  WorldMode,
  WorldScope,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { InvalidWorldDefinitionError } from "./errors.js";

/** Engine identity constants (determinism manifest inputs, A9). */
export const ENGINE_ID = "tradrl-world-sim";
export const ENGINE_VERSION = "0.1.0-skeleton";
/**
 * The contracts dependency version recorded in the determinism manifest.
 * Asserted against the real package manifest by tests (world/test).
 */
export const CONTRACTS_DEPENDENCY_VERSION = "0.1.0";

/** Skeleton limitations reported in WorldMeta.knownLimitations. */
export const SKELETON_KNOWN_LIMITATIONS: readonly string[] = [
  "W013 skeleton: no order book / matching — order commands are typed not-implemented-in-skeleton rejections (W014)",
  "W013 skeleton: no account/portfolio/risk engine — financial projections are typed not-implemented-in-skeleton rejections (W015)",
  "W013 skeleton: no snapshot/branch engine — snapshot/branch commands are typed not-implemented-in-skeleton rejections (W016)",
  "W013 skeleton: no synthetic market generator — no market events are produced by clock advance (W017)",
  "W013 skeleton: no worker/process adapter — in-process headless use only (W018)",
];

/** Clock genesis: how the simulation clock is born at engine creation. */
export interface ClockGenesis {
  /** The world origin on the simulation axis. */
  readonly start: SimulationTimeMs;
  /** Finite replay worlds declare an end; open synthetic worlds omit it. */
  readonly end?: SimulationTimeMs;
  readonly defaultStepMs?: number;
  readonly speed?: number;
  readonly initialWallTime: WallTimeMs;
}

/**
 * The world definition. Everything here is declaration, not derived state.
 */
export interface WorldDefinition {
  readonly scope: WorldScope;
  readonly mode: WorldMode;
  readonly seed: string;
  readonly worldDefinitionVersion: string;
  readonly inputDataSource: string;
  readonly knownLimitations?: readonly string[];
  /** Initial scenario (regime schedule) — world metadata (SIMULATION.md). */
  readonly regimeSchedule?: readonly RegimeScheduleEntry[];
  readonly clock: ClockGenesis;
  readonly instruments: readonly Instrument[];
  readonly accounts: readonly Account[];
  readonly participants: readonly Participant[];
  /** Information world subset: news artifacts behind the A7 firewall. */
  readonly informationArtifacts?: readonly InformationArtifact<NewsPayload>[];
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRegimeKind(kind: unknown): boolean {
  return (
    kind === "trend" ||
    kind === "mean-reversion" ||
    kind === "high-volatility" ||
    kind === "low-liquidity" ||
    kind === "shock" ||
    kind === "halt-reopen"
  );
}

/** Structural validation of a world definition (fails fast at creation). */
export function validateWorldDefinition(definition: WorldDefinition): readonly string[] {
  const errors: string[] = [];
  const { scope, clock, instruments, accounts, participants } = definition;

  if (!isNonBlank(definition.seed)) errors.push("seed must be a non-blank string");
  if (!isNonBlank(definition.worldDefinitionVersion)) {
    errors.push("worldDefinitionVersion must be a non-blank string");
  }
  if (!isNonBlank(definition.inputDataSource)) {
    errors.push("inputDataSource must be a non-blank string");
  }
  if (
    definition.mode !== "exact-replay" &&
    definition.mode !== "reactive-replay" &&
    definition.mode !== "counterfactual" &&
    definition.mode !== "live-mirror"
  ) {
    errors.push(`mode '${String(definition.mode)}' is not a WorldMode`);
  }
  if (!isNonBlank(scope.tenantId) || !isNonBlank(scope.projectId) || !isNonBlank(scope.worldId)) {
    errors.push("scope ids must be non-blank strings");
  }

  if (!Number.isFinite(clock.start)) errors.push("clock.start must be finite");
  if (clock.end !== undefined && (!Number.isFinite(clock.end) || clock.end < clock.start)) {
    errors.push("clock.end must be finite and not precede clock.start");
  }
  if (clock.defaultStepMs !== undefined && !(clock.defaultStepMs > 0)) {
    errors.push("clock.defaultStepMs must be positive when present");
  }
  if (clock.speed !== undefined && !(clock.speed > 0)) {
    errors.push("clock.speed must be positive when present");
  }

  const instrumentIds = new Set<string>();
  for (const instrument of instruments) {
    if (instrumentIds.has(String(instrument.instrumentId))) {
      errors.push(`duplicate instrumentId ${String(instrument.instrumentId)}`);
    }
    instrumentIds.add(String(instrument.instrumentId));
    if (!isNonBlank(instrument.symbol)) {
      errors.push(`instrument ${String(instrument.instrumentId)}: symbol must be non-blank`);
    }
    if (!(Number(instrument.tickSize) > 0)) {
      errors.push(`instrument ${String(instrument.instrumentId)}: tickSize must be positive`);
    }
    if (!(Number(instrument.lotSize) > 0)) {
      errors.push(`instrument ${String(instrument.instrumentId)}: lotSize must be positive`);
    }
  }

  const accountIds = new Set<string>();
  for (const account of accounts) {
    if (accountIds.has(String(account.accountId))) {
      errors.push(`duplicate accountId ${String(account.accountId)}`);
    }
    accountIds.add(String(account.accountId));
    if (account.permissions.liveExecutionAllowed !== false) {
      errors.push(`account ${String(account.accountId)}: live execution must be disallowed (A14)`);
    }
  }

  const participantIds = new Set<string>();
  for (const participant of participants) {
    if (participantIds.has(String(participant.participantId))) {
      errors.push(`duplicate participantId ${String(participant.participantId)}`);
    }
    participantIds.add(String(participant.participantId));
    if (!accountIds.has(String(participant.accountId))) {
      errors.push(
        `participant ${String(participant.participantId)} references unknown account ${String(participant.accountId)}`,
      );
    }
  }

  const artifactIds = new Set<string>();
  for (const artifact of definition.informationArtifacts ?? []) {
    if (artifactIds.has(String(artifact.artifactId))) {
      errors.push(`duplicate informationArtifactId ${String(artifact.artifactId)}`);
    }
    artifactIds.add(String(artifact.artifactId));
    if (!Number.isFinite(artifact.availableAt)) {
      errors.push(`artifact ${String(artifact.artifactId)}: availableAt must be finite (A7)`);
    }
    if (artifact.worldId !== definition.scope.worldId) {
      errors.push(`artifact ${String(artifact.artifactId)}: worldId must match the world scope`);
    }
  }

  for (const entry of definition.regimeSchedule ?? []) {
    if (!isValidRegimeKind(entry.regime)) {
      errors.push(`regime schedule: '${String(entry.regime)}' is not a RegimeKind`);
    }
    if (!Number.isFinite(entry.from)) {
      errors.push("regime schedule: from must be finite");
    }
    if (entry.to !== undefined && (!Number.isFinite(entry.to) || entry.to < entry.from)) {
      errors.push("regime schedule: to must be finite and not precede from");
    }
  }

  return errors;
}

/** Assert a definition is valid (engine creation fails fast). */
export function assertValidWorldDefinition(definition: WorldDefinition): void {
  const errors = validateWorldDefinition(definition);
  if (errors.length > 0) {
    throw new InvalidWorldDefinitionError(errors);
  }
}

/** Project the fidelity declaration (WorldMeta) from definition + state. */
export function projectWorldMeta(
  definition: WorldDefinition,
  currentScenario: ScenarioDefinition | undefined,
): WorldMeta {
  return {
    worldId: definition.scope.worldId,
    scope: definition.scope,
    mode: definition.mode,
    executionAuthority: "simulated-only",
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    worldDefinitionVersion: definition.worldDefinitionVersion,
    seed: definition.seed,
    inputDataSource: definition.inputDataSource,
    knownLimitations: [
      ...SKELETON_KNOWN_LIMITATIONS,
      ...(definition.knownLimitations ?? []),
    ],
    // The skeleton is deterministic: fixed definition/version/seed/command
    // stream reproduce the identical journal digest (A9, proven by the
    // golden test). No nondeterministic sources are consulted.
    determinism: { kind: "deterministic" },
    ...(currentScenario === undefined && definition.regimeSchedule === undefined
      ? {}
      : {
          regimeSchedule: (currentScenario?.entries ?? definition.regimeSchedule) as readonly RegimeScheduleEntry[],
        }),
  };
}
