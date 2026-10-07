/**
 * Replay (W031): rebuild the world state from a journal file (records) and
 * continue — the W016 restore path.
 *
 * The journal file is parsed (journalFile.ts), the definition resolved from
 * the file's embedded header and/or `--definition` (cross-validated
 * canonically when both exist — a replay must reproduce the recorded run's
 * definition exactly, dataset imports included), every record checked
 * against the world id, and the engine restored via
 * `createEventJournalFromRecords` + the engine's `restore.journal` genesis
 * (full deterministic replay — A9-proven exactly equivalent; snapshot
 * payloads referenced by `world.snapshot.created` records are rebuilt from
 * the journal by the engine fold, and the restored generated world's quote
 * state rehydrates from the journal tail per W017).
 *
 * The printed report carries the restored-state summary (records, digest,
 * clock, rebuilt snapshots/branches) plus the continuation report (the
 * same shape as a run report; an absent `--script` means an empty
 * continuation — the report of the restored state itself).
 */

import type { EngineRestore, HeadlessWorldEngine, WorldDefinition } from "tradrl-world-sim/world";
import {
  createHeadlessWorldEngine,
  InvalidWorldDefinitionError,
  stableDigest,
} from "tradrl-world-sim/world";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import { loadDefinitionFile } from "./definitionFile.js";
import { loadScriptFile } from "./scriptFile.js";
import type { ScriptEntry } from "./scriptFile.js";
import type { DatasetImportEvidence } from "./datasets.js";
import {
  assertRecordsMatchWorld,
  definitionsEqual,
  journalFromRecords,
  parseJournalFile,
} from "./journalFile.js";
import { buildReportCore, driveScript, engineKindOf, withDigest, type RunReport } from "./runner.js";
import { writeFile } from "node:fs/promises";
import { CliError, engineError } from "./errors.js";

/** The restored-state summary the replay report carries (digest-covered). */
export interface RestoredSummary {
  /** Which definition source rebuilt the world. */
  readonly source: "journal-header" | "definition-file";
  readonly worldId: string;
  readonly records: number;
  /** The restored journal's W004 digest (must equal the recorded run's). */
  readonly eventCount: number;
  readonly eventChecksum: string;
  readonly lastEventTime?: number;
  readonly clock: { readonly simulationTime: number; readonly status: string; readonly speed: number };
  /** `world.snapshot.created` records reduced — payloads rebuilt by the fold. */
  readonly snapshots: number;
  readonly branches: number;
}

/** The full replay report. */
export interface ReplayReport extends RunReport {
  readonly restored: RestoredSummary;
}

/** Everything `replay` needs (already-validated argv). */
export interface ReplayInputs {
  readonly journalPath: string;
  readonly definitionPath?: string;
  readonly scriptPath?: string;
  readonly reportPath?: string;
}

interface ResolvedDefinition {
  readonly definition: WorldDefinition;
  readonly definitionDigest: string;
  readonly datasets: readonly DatasetImportEvidence[];
  readonly source: "journal-header" | "definition-file";
}

async function resolveDefinition(
  journal: Awaited<ReturnType<typeof parseJournalFile>>,
  definitionPath: string | undefined,
): Promise<ResolvedDefinition> {
  if (definitionPath === undefined) {
    if (journal.headerDefinition === undefined) {
      throw new CliError(
        "replay-requires-definition",
        `the journal file carries no embedded definition header; pass --definition <file.json> (a bare records journal cannot rebuild a world alone)`,
      );
    }
    const definition = journal.headerDefinition;
    const definitionDigest = stableDigest(definition);
    if (journal.headerDefinitionDigest !== undefined && journal.headerDefinitionDigest !== definitionDigest) {
      throw new CliError(
        "journal-invalid",
        `the journal header's definition digest ${journal.headerDefinitionDigest} does not match its own definition (${definitionDigest}) — the header is corrupt`,
      );
    }
    return {
      definition,
      definitionDigest,
      datasets: (journal.headerDatasets ?? []) as readonly DatasetImportEvidence[],
      source: "journal-header",
    };
  }
  const loaded = await loadDefinitionFile(definitionPath);
  const digest = stableDigest(loaded.definition);
  if (journal.headerDefinition !== undefined) {
    if (!definitionsEqual(journal.headerDefinition, loaded.definition)) {
      throw new CliError(
        "definition-mismatch",
        `the definition file ${definitionPath} does not canonically match the journal header's definition — a replay must reproduce the recorded run's definition exactly`,
        [
          `header digest:   ${stableDigest(journal.headerDefinition)}`,
          `definition file: ${digest}`,
        ],
      );
    }
    const headerDatasets = JSON.stringify(journal.headerDatasets ?? []);
    const loadedDatasets = JSON.stringify(loaded.datasets?.evidence ?? []);
    if (headerDatasets !== loadedDatasets) {
      throw new CliError(
        "definition-mismatch",
        `the dataset imports declared by ${definitionPath} do not match the journal header's recorded imports — a replay must reproduce the recorded run's inputs exactly`,
      );
    }
  }
  return {
    definition: loaded.definition,
    definitionDigest: digest,
    datasets: loaded.datasets?.evidence ?? [],
    source: "definition-file",
  };
}

function restoreEngine(
  definition: WorldDefinition,
  restore: EngineRestore,
): HeadlessWorldEngine {
  try {
    if (engineKindOf(definition) === "generated") {
      return createGeneratedWorldEngine({ definition, restore });
    }
    return createHeadlessWorldEngine({ definition, restore });
  } catch (error) {
    if (error instanceof InvalidWorldDefinitionError) {
      throw new CliError("definition-invalid", `the engine rejected the definition: ${error.message}`, [
        error.message,
      ]);
    }
    throw engineError(error, "restoring the engine from the journal");
  }
}

/** Execute the replay: parse → resolve definition → restore → continue → report. */
export async function executeReplay(inputs: ReplayInputs): Promise<ReplayReport> {
  const journal = await parseJournalFile(inputs.journalPath);
  const resolved = await resolveDefinition(journal, inputs.definitionPath);
  assertRecordsMatchWorld(journal.records, resolved.definition.scope.worldId);
  const eventJournal = journalFromRecords({
    worldId: resolved.definition.scope.worldId,
    records: journal.records,
  });
  const engine = restoreEngine(resolved.definition, { journal: eventJournal });

  const state = engine.worldState();
  const digest = engine.journal.digest();
  const lastRecord = journal.records[journal.records.length - 1];
  const clockState = engine.clockState();
  const restored: RestoredSummary = {
    source: resolved.source,
    worldId: String(resolved.definition.scope.worldId),
    records: journal.records.length,
    eventCount: digest.eventCount,
    eventChecksum: digest.eventChecksum,
    ...(lastRecord === undefined ? {} : { lastEventTime: lastRecord.envelope.occurredAt }),
    clock: {
      simulationTime: clockState.simulationTime,
      status: clockState.status,
      speed: clockState.speed,
    },
    snapshots: state.snapshots.length,
    branches: state.branches.length,
  };

  let entries: readonly ScriptEntry[] = [];
  if (inputs.scriptPath !== undefined) {
    entries = (await loadScriptFile(inputs.scriptPath, resolved.definition.scope.worldId)).entries;
  }
  const outcomes = await driveScript(engine, entries);

  const core = buildReportCore({
    definition: resolved.definition,
    definitionDigest: resolved.definitionDigest,
    datasets: resolved.datasets,
    engine,
    outcomes,
  });
  const invocation = {
    ...(inputs.definitionPath === undefined ? {} : { definitionPath: inputs.definitionPath }),
    journalPath: inputs.journalPath,
    ...(inputs.scriptPath === undefined ? {} : { scriptPath: inputs.scriptPath }),
    ...(inputs.reportPath === undefined ? {} : { reportPath: inputs.reportPath }),
  };
  const report = withDigest(core, "replay", invocation, { restored }) as ReplayReport;
  if (inputs.reportPath !== undefined) {
    try {
      await writeFile(inputs.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (error) {
      throw new CliError("report-unwritable", `cannot write ${inputs.reportPath}: ${String(error)}`);
    }
  }
  return report;
}
