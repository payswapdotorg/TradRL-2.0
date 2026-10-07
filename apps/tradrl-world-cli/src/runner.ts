/**
 * The headless run (W031): create the engine from a definition, drive the
 * scripted command/clock stream in order, assemble the deterministic run
 * report, and (optionally) write the report JSON and the replayable journal.
 *
 * Engine selection (the work order's law): a definition that declares a
 * `regimeSchedule` runs the W017 generated market
 * (`createGeneratedWorldEngine` — clock advance drives the seeded regime
 * timeline); otherwise the plain headless engine
 * (`createHeadlessWorldEngine`). `set-scenario` mid-script redirects a
 * generated world's schedule from the next pass (W017 semantics); on the
 * plain engine it is a recorded world fact with no generator attached.
 *
 * Determinism (A9): the run is a pure function of (definition + datasets +
 * script). Omitted `issuedAt` stamps are the CURRENT SIMULATION TIME at
 * execution; wall time never enters events, digests, the manifest or the
 * report digest. Typed command rejections and typed clock rejections are
 * honest deterministic OUTCOMES recorded per entry — the run still succeeds.
 */

import { writeFile } from "node:fs/promises";
import type {
  CommandResult,
  DeterminismManifest,
  WorldCommand,
  WorldId,
} from "tradrl-world-contracts";
import type { TimestampMs } from "tradrl-world-contracts";
import { ClockRejectionError } from "tradrl-world-sim/clock";
import { createHeadlessWorldEngine, InvalidWorldDefinitionError } from "tradrl-world-sim/world";
import type { HeadlessRunReport, HeadlessWorldEngine, WorldDefinition } from "tradrl-world-sim/world";
import { stableDigest } from "tradrl-world-sim/world";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import { writeJournalFile } from "./journalFile.js";
import { CliError, engineError } from "./errors.js";
import type { DatasetImportEvidence } from "./datasets.js";
import type { ScriptEntry } from "./scriptFile.js";

/** Which engine a definition runs (see module docs). */
export type EngineKind = "generated" | "headless";

/** The per-entry outcome of one driven script entry. */
export type ScriptOutcome =
  | { readonly id: string; readonly driver: "clock"; readonly op: string; readonly status: "applied"; readonly simulationTime: TimestampMs }
  | {
      readonly id: string;
      readonly driver: "clock";
      readonly op: string;
      readonly status: "rejected";
      readonly code: string;
      readonly message: string;
      readonly simulationTime: TimestampMs;
    }
  | {
      readonly id: string;
      readonly driver: "command";
      readonly kind: string;
      readonly commandId: string;
      readonly status: "acked";
      readonly acceptedAt: TimestampMs;
      readonly journalCursor: number;
      readonly emittedEvents: number;
    }
  | {
      readonly id: string;
      readonly driver: "command";
      readonly kind: string;
      readonly commandId: string;
      readonly status: "rejected";
      readonly stage: string;
      readonly code: string;
      readonly message: string;
    };

/** Which engine the definition runs. */
export function engineKindOf(definition: WorldDefinition): EngineKind {
  return definition.regimeSchedule === undefined ? "headless" : "generated";
}

/** Create the engine the definition declares (generated market or plain). */
export function createEngineFor(definition: WorldDefinition): HeadlessWorldEngine {
  if (engineKindOf(definition) === "generated") {
    return createGeneratedWorldEngine({ definition });
  }
  return createHeadlessWorldEngine({ definition });
}

const COMMAND_METHODS: Readonly<Record<string, keyof HeadlessWorldEngine["command"]>> = {
  "submit-order": "submitOrder",
  "cancel-order": "cancelOrder",
  "replace-order": "replaceOrder",
  "close-position": "closePosition",
  "add-annotation": "addAnnotation",
  "create-snapshot": "createSnapshot",
  "branch-world": "branchWorld",
  "set-scenario": "setScenario",
};

/** Fill the CLI-fillable envelope fields (worldId, issuedAt) of one command. */
function fillCommandEnvelope(command: WorldCommand, worldId: WorldId, simulationTime: TimestampMs): WorldCommand {
  return {
    ...command,
    worldId,
    issuedAt: (command.issuedAt ?? simulationTime) as TimestampMs,
  };
}

/**
 * Drive every script entry in order against the engine. Typed rejections
 * (command lifecycle + clock) are recorded outcomes; thrown engine errors
 * fail the run (they are invariant violations, not user outcomes).
 */
export async function driveScript(
  engine: HeadlessWorldEngine,
  entries: readonly ScriptEntry[],
): Promise<readonly ScriptOutcome[]> {
  const worldId = engine.worldId;
  const outcomes: ScriptOutcome[] = [];
  for (const entry of entries) {
    if (entry.clock !== undefined) {
      const op = entry.clock;
      const simulationTimeBefore = engine.clockState().simulationTime as TimestampMs;
      try {
        switch (op.op) {
          case "step":
            await engine.clock.step(op.deltaMs);
            break;
          case "seek":
            await engine.clock.seek(op.to as TimestampMs);
            break;
          case "pause":
            await engine.clock.pause();
            break;
          case "play":
            await engine.clock.play();
            break;
          case "set-speed":
            await engine.clock.setSpeed(op.speed);
            break;
          case "follow-realtime":
            await engine.clock.followRealtime(op.enabled);
            break;
          case "jump-to-event":
            await engine.clock.jumpToEvent(op.target as never);
            break;
        }
        outcomes.push({
          id: entry.id,
          driver: "clock",
          op: op.op,
          status: "applied",
          simulationTime: engine.clockState().simulationTime as TimestampMs,
        });
      } catch (error) {
        if (error instanceof ClockRejectionError) {
          outcomes.push({
            id: entry.id,
            driver: "clock",
            op: op.op,
            status: "rejected",
            code: error.rejection.code,
            message: error.rejection.message,
            simulationTime: simulationTimeBefore,
          });
          continue;
        }
        throw engineError(error, `script entry '${entry.id}' (clock ${op.op})`);
      }
      continue;
    }
    const command = entry.command!;
    const executable = fillCommandEnvelope(command, worldId, engine.clockState().simulationTime as TimestampMs);
    const method = COMMAND_METHODS[command.kind]!;
    let result: CommandResult;
    try {
      result = (await engine.command[method](executable as never)) as CommandResult;
    } catch (error) {
      throw engineError(error, `script entry '${entry.id}' (command ${command.kind})`);
    }
    if (result.status === "acked") {
      outcomes.push({
        id: entry.id,
        driver: "command",
        kind: command.kind,
        commandId: String(executable.commandId),
        status: "acked",
        acceptedAt: result.ack.acceptedAt,
        journalCursor: result.ack.journalCursor,
        emittedEvents: result.ack.resultingEventIds.length,
      });
      continue;
    }
    outcomes.push({
      id: entry.id,
      driver: "command",
      kind: command.kind,
      commandId: String(executable.commandId),
      status: "rejected",
      stage: result.rejection.stage,
      code: result.rejection.code,
      message: result.rejection.message,
    });
  }
  return outcomes;
}

/** The stable (digest-covered) core of a run report. */
export interface ReportCore {
  readonly engine: EngineKind;
  readonly definition: {
    readonly worldId: string;
    readonly seed: string;
    readonly mode: string;
    readonly worldDefinitionVersion: string;
    readonly definitionDigest: string;
  };
  readonly datasets: readonly DatasetImportEvidence[];
  readonly script: { readonly entries: number; readonly outcomes: readonly ScriptOutcome[] };
  readonly headlessReport: HeadlessRunReport;
  readonly determinismManifest: DeterminismManifest;
}

/** The full run report (the invocation block is excluded from the digest). */
export interface RunReport extends ReportCore {
  readonly command: "run" | "replay";
  /** Deterministic digest of the core (A9): same definition+script ⇒ same digest. */
  readonly reportDigest: string;
  readonly invocation: {
    readonly definitionPath?: string;
    readonly scriptPath?: string;
    readonly reportPath?: string;
    readonly journalPath?: string;
  };
}

/** Assemble the report core from the run's end state. */
export function buildReportCore(input: {
  readonly definition: WorldDefinition;
  readonly definitionDigest: string;
  readonly datasets: readonly DatasetImportEvidence[];
  readonly engine: HeadlessWorldEngine;
  readonly outcomes: readonly ScriptOutcome[];
}): ReportCore {
  const { engine } = input;
  return {
    engine: engineKindOf(input.definition),
    definition: {
      worldId: String(input.definition.scope.worldId),
      seed: input.definition.seed,
      mode: input.definition.mode,
      worldDefinitionVersion: input.definition.worldDefinitionVersion,
      definitionDigest: input.definitionDigest,
    },
    datasets: input.datasets,
    script: { entries: input.outcomes.length, outcomes: input.outcomes },
    headlessReport: engine.headlessReport(),
    determinismManifest: engine.determinismManifest(),
  };
}

/** Attach the digest + invocation block to a report core. */
export function withDigest(
  core: ReportCore,
  command: "run" | "replay",
  invocation: RunReport["invocation"],
  extraStable?: Record<string, unknown>,
): RunReport {
  return {
    command,
    ...core,
    ...(extraStable ?? {}),
    reportDigest: stableDigest({ command, ...core, ...(extraStable ?? {}) }),
    invocation,
  };
}

async function writeReportFile(path: string, report: RunReport): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new CliError("report-unwritable", `cannot write ${path}: ${String(error)}`);
  }
}

/** Everything `run` needs (already-validated inputs). */
export interface RunInputs {
  readonly definition: WorldDefinition;
  readonly definitionDigest: string;
  readonly datasets: readonly DatasetImportEvidence[];
  readonly entries: readonly ScriptEntry[];
  readonly invocation: RunReport["invocation"];
}

/** Execute the run: engine → script → report → optional output files. */
export async function executeRun(inputs: RunInputs): Promise<RunReport> {
  let engine: HeadlessWorldEngine;
  try {
    engine = createEngineFor(inputs.definition);
  } catch (error) {
    if (error instanceof InvalidWorldDefinitionError) {
      throw new CliError("definition-invalid", `the engine rejected the definition: ${error.message}`, [
        error.message,
      ]);
    }
    throw engineError(error, "engine creation");
  }
  const outcomes = await driveScript(engine, inputs.entries);
  const core = buildReportCore({
    definition: inputs.definition,
    definitionDigest: inputs.definitionDigest,
    datasets: inputs.datasets,
    engine,
    outcomes,
  });
  const report = withDigest(core, "run", inputs.invocation);
  if (inputs.invocation.reportPath !== undefined) {
    await writeReportFile(inputs.invocation.reportPath, report);
  }
  if (inputs.invocation.journalPath !== undefined) {
    await writeJournalFile(inputs.invocation.journalPath, inputs.definition, engine.journal.records(), {
      definitionDigest: inputs.definitionDigest,
      datasets: inputs.datasets,
    });
  }
  return report;
}
