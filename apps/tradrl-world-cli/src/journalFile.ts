/**
 * Journal-file serialization and parsing (W031) — the run↔replay bridge.
 *
 * Format (JSONL, one JSON value per line, blank lines ignored):
 * - line 1, OPTIONAL header: `{"tradrlWorldCli":"journal","version":1,
 *   "definition":{…}}` — the ENGINE definition the journal was recorded
 *   under (information-artifact-merged when the run declared datasets),
 *   written by `run --journal` so the file is self-contained;
 * - then one `JournalRecord` per line: `{"entryId","envelope","recordedAt"}`
 *   (the W013/W016 journal record shape, verbatim).
 *
 * A file WITH a header is replayable standalone; a bare records file
 * requires `--definition`. Parsing is loud and typed: line numbers in every
 * violation, structural checks before the engine ever sees a record, and
 * the journal's own ordered-stream laws enforced at record-set load.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { canonicalString } from "tradrl-world-sim/world";
import type { JournalRecord } from "tradrl-world-sim/journal";
import { createEventJournalFromRecords } from "tradrl-world-sim/journal";
import { JournalLawViolationError } from "tradrl-world-sim/journal";
import { CliError } from "./errors.js";

const HEADER_MARKER = "tradrlWorldCli";
const JOURNAL_FORMAT_VERSION = 1;

/** A parsed journal file. */
export interface ParsedJournalFile {
  /** The embedded engine definition, when the first line was a header. */
  readonly headerDefinition?: WorldDefinition;
  /** The run's dataset-import evidence, when the header carries it. */
  readonly headerDatasets?: readonly unknown[];
  /** The run's recorded definition digest, when the header carries it. */
  readonly headerDefinitionDigest?: string;
  readonly records: readonly JournalRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLines(path: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CliError("journal-not-found", `no such file: ${path}`);
    }
    throw new CliError("journal-unreadable", `cannot read ${path}: ${String(code ?? error)}`);
  }
  return text.split("\n");
}

/** Parse one journal line as a header, a record, or fail with its line number. */
function parseLine(
  line: string,
  lineNumber: number,
): { header: Record<string, unknown> } | { record: JournalRecord } | { blank: true } {
  if (line.trim().length === 0) {
    return { blank: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw new CliError("journal-invalid", `journal line ${lineNumber} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) {
    throw new CliError("journal-invalid", `journal line ${lineNumber} must be an object`);
  }
  if (parsed[HEADER_MARKER] !== undefined) {
    if (parsed.version !== JOURNAL_FORMAT_VERSION) {
      throw new CliError(
        "journal-invalid",
        `journal line ${lineNumber}: unsupported journal format version ${String(parsed.version)} (expected ${JOURNAL_FORMAT_VERSION})`,
      );
    }
    if (!isRecord(parsed.definition)) {
      throw new CliError("journal-invalid", `journal line ${lineNumber}: header 'definition' must be an object`);
    }
    if (parsed.definitionDigest !== undefined && typeof parsed.definitionDigest !== "string") {
      throw new CliError("journal-invalid", `journal line ${lineNumber}: header 'definitionDigest' must be a string`);
    }
    if (parsed.datasets !== undefined && !Array.isArray(parsed.datasets)) {
      throw new CliError("journal-invalid", `journal line ${lineNumber}: header 'datasets' must be an array`);
    }
    return { header: parsed };
  }
  if (!isRecord(parsed.envelope)) {
    throw new CliError("journal-invalid", `journal line ${lineNumber}: record 'envelope' must be an object`);
  }
  if (typeof parsed.entryId !== "string" || typeof parsed.recordedAt !== "number") {
    throw new CliError(
      "journal-invalid",
      `journal line ${lineNumber}: record requires 'entryId' (string) and 'recordedAt' (number)`,
    );
  }
  return { record: parsed as unknown as JournalRecord };
}

/** Parse a journal file (header detection + loud record validation). */
export async function parseJournalFile(path: string): Promise<ParsedJournalFile> {
  const lines = await readLines(path);
  let headerDefinition: WorldDefinition | undefined;
  let headerDatasets: readonly unknown[] | undefined;
  let headerDefinitionDigest: string | undefined;
  const records: JournalRecord[] = [];
  let sawHeader = false;
  for (const [index, line] of lines.entries()) {
    const parsed = parseLine(line, index + 1);
    if ("blank" in parsed) {
      continue;
    }
    if ("header" in parsed) {
      if (sawHeader || records.length > 0) {
        throw new CliError("journal-invalid", `journal line ${index + 1}: a header may only be the first line`);
      }
      sawHeader = true;
      headerDefinition = parsed.header.definition as WorldDefinition;
      headerDatasets = parsed.header.datasets as readonly unknown[] | undefined;
      headerDefinitionDigest = parsed.header.definitionDigest as string | undefined;
      continue;
    }
    records.push(parsed.record);
  }
  return {
    ...(headerDefinition === undefined ? {} : { headerDefinition }),
    ...(headerDatasets === undefined ? {} : { headerDatasets }),
    ...(headerDefinitionDigest === undefined ? {} : { headerDefinitionDigest }),
    records,
  };
}

/** Build the engine-restorable journal from parsed records (stream laws enforced). */
export function journalFromRecords(input: {
  readonly worldId: WorldDefinition["scope"]["worldId"];
  readonly records: readonly JournalRecord[];
}) {
  try {
    return createEventJournalFromRecords(input);
  } catch (error) {
    if (error instanceof JournalLawViolationError) {
      throw new CliError("journal-invalid", `journal records violate the ordered-stream laws: ${error.message}`);
    }
    throw error;
  }
}

/** Verify every record belongs to the given world (loud, first offenders listed). */
export function assertRecordsMatchWorld(
  records: readonly JournalRecord[],
  worldId: WorldDefinition["scope"]["worldId"],
): void {
  const offenders = records
    .filter((record) => record.envelope.worldId !== worldId)
    .slice(0, 5)
    .map((record) => `sequence ${String(record.envelope.sequence)} belongs to world ${String(record.envelope.worldId)}`);
  if (offenders.length > 0) {
    throw new CliError(
      "journal-invalid",
      `journal records do not belong to world ${String(worldId)}`,
      offenders,
    );
  }
}

/** Canonically compare two definitions (the engine's own identity check). */
export function definitionsEqual(a: WorldDefinition, b: WorldDefinition): boolean {
  return canonicalString(a) === canonicalString(b);
}

/** Serialize the run's journal (header with the engine definition + records). */
export async function writeJournalFile(
  path: string,
  definition: WorldDefinition,
  records: readonly JournalRecord[],
  meta: { readonly definitionDigest: string; readonly datasets?: readonly unknown[] },
): Promise<void> {
  const lines = [
    JSON.stringify({
      [HEADER_MARKER]: "journal",
      version: JOURNAL_FORMAT_VERSION,
      definition,
      definitionDigest: meta.definitionDigest,
      ...(meta.datasets === undefined || meta.datasets.length === 0 ? {} : { datasets: meta.datasets }),
    }),
    ...records.map((record) => JSON.stringify(record)),
  ];
  try {
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    throw new CliError("journal-unwritable", `cannot write ${path}: ${String(error)}`);
  }
}
