/**
 * The `datasets` section (W031): optional dataset import declared on the
 * definition file, loaded through the W020 (`tradrl-data`) and W027
 * (`tradrl-information`) loaders.
 *
 * Honesty law (the W020/W027 boundary): both loaders produce JOURNAL-READY
 * event records (drafts + sealed records + a W004 digest) — but engine-level
 * replay of imported events is the W021 adapter surface (the sim reducers
 * fail closed on foreign producers by design). The CLI therefore:
 * - merges INFORMATION dataset artifacts into the definition's
 *   `informationArtifacts` (the W027 `toDefinitionInformationArtifacts`
 *   identity-preserving view — the A7 firewall governs them exactly as
 *   hand-authored artifacts) — these are the only imported facts that enter
 *   the engine's world;
 * - records every import's journal-ready digest + summary as run-report
 *   evidence (`journalReadyOnly: true` — never claimed as appended).
 */

import { resolve } from "node:path";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { InformationArtifact, NewsPayload } from "tradrl-world-contracts";
import type { DatasetDescriptor, HistoricalRecord } from "tradrl-world-contracts/data";
import type {
  InformationDatasetDescriptor,
  InformationRecord,
  InformationSourceDeclaration,
} from "tradrl-world-contracts/information-data";
import { loadHistoricalDataset } from "tradrl-data";
import { DatasetImportError } from "tradrl-data";
import type { HistoricalImportOutcome } from "tradrl-data";
import type { RecordSymbolMap } from "tradrl-data";
import { loadInformationDataset } from "tradrl-information";
import { InformationImportError } from "tradrl-information";
import type { InformationImportOutcome } from "tradrl-information";
import { toDefinitionInformationArtifacts } from "tradrl-information";
import { readJsonFile } from "./jsonFile.js";
import { CliError } from "./errors.js";

/** One dataset declaration from the definition file's `datasets` section. */
export interface DatasetDeclaration {
  readonly id: string;
  readonly kind: "historical" | "information";
  readonly path: string;
}

/**
 * Validate the raw `datasets` section (loud, typed). `undefined` means the
 * section is absent (no datasets); anything else must be an array of
 * declarations with unique non-blank ids, a known kind and a non-blank path.
 */
export function parseDatasetDeclarations(
  raw: unknown,
  definitionPath: string,
): readonly DatasetDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CliError(
      "definition-invalid",
      `${definitionPath}: 'datasets' must be an array of { id, kind, path } declarations`,
    );
  }
  const declarations: DatasetDeclaration[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const where = `${definitionPath}: datasets[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new CliError("definition-invalid", `${where}: must be an object`);
    }
    const { id, kind, path } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new CliError("definition-invalid", `${where}: 'id' must be a non-blank string`);
    }
    if (seenIds.has(id)) {
      throw new CliError("definition-invalid", `${where}: duplicate dataset id '${id}'`);
    }
    seenIds.add(id);
    if (kind !== "historical" && kind !== "information") {
      throw new CliError(
        "definition-invalid",
        `${where}: 'kind' must be 'historical' (W020) or 'information' (W027), got '${String(kind)}'`,
      );
    }
    if (typeof path !== "string" || path.trim().length === 0) {
      throw new CliError("definition-invalid", `${where}: 'path' must be a non-blank string`);
    }
    declarations.push({ id, kind, path });
  }
  return declarations;
}

/** The per-dataset import evidence the run report carries. */
export interface DatasetImportEvidence {
  readonly id: string;
  readonly kind: "historical" | "information";
  readonly datasetId: string;
  readonly sourceProvider: string;
  readonly recordCount: number;
  /** The import's journal-ready digest (W004) — deterministic A9 evidence. */
  readonly eventCount: number;
  readonly eventChecksum: string;
  /** The loader's summary, verbatim (per-kind counts, symbols, extent). */
  readonly summary: Record<string, unknown>;
  /** Honesty: journal-ready at the loader level; NOT appended to the engine journal. */
  readonly journalReadyOnly: true;
  /** Information datasets: artifacts merged into the engine definition. */
  readonly mergedIntoDefinition: boolean;
}

/** Everything the `datasets` section produced for one definition load. */
export interface LoadedDatasets {
  /** The definition the engine will run (information artifacts merged). */
  readonly mergedDefinition: WorldDefinition;
  readonly evidence: readonly DatasetImportEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ImportViolation {
  readonly kind: string;
  readonly detail: string;
}

function violationLines(error: unknown, id: string): CliError {
  const violations: readonly ImportViolation[] =
    error instanceof DatasetImportError || error instanceof InformationImportError
      ? error.violations
      : [{ kind: (error as Error).name, detail: (error as Error).message }];
  return new CliError(
    "dataset-import-violations",
    `dataset '${id}' failed import validation (${violations.length} violation${violations.length > 1 ? "s" : ""})`,
    violations.map((v) => `${v.kind}: ${v.detail}`),
  );
}

function requireShape(
  parsed: Record<string, unknown>,
  field: "descriptor" | "records" | "symbolMap" | "sources",
  id: string,
  path: string,
  kind: "array" | "object",
): void {
  const value = parsed[field];
  const ok = kind === "array" ? Array.isArray(value) : isRecord(value);
  if (!ok) {
    throw new CliError(
      "dataset-import-violations",
      `dataset '${id}' (${path}): '${field}' must be ${kind === "array" ? "an array" : "an object"}`,
    );
  }
}

async function readDatasetFile(id: string, path: string): Promise<Record<string, unknown>> {
  const parsed = await readJsonFile(path, {
    notFound: "dataset-not-found",
    unreadable: "dataset-unreadable",
    invalidJson: "dataset-invalid-json",
  });
  if (!isRecord(parsed)) {
    throw new CliError("dataset-invalid-json", `${path}: a dataset file must be a JSON object`);
  }
  return parsed;
}

function historicalEvidence(id: string, outcome: HistoricalImportOutcome): DatasetImportEvidence {
  return {
    id,
    kind: "historical",
    datasetId: String(outcome.descriptor.datasetId),
    sourceProvider: outcome.descriptor.source.provider,
    recordCount: outcome.records.length,
    eventCount: outcome.digest.eventCount,
    eventChecksum: outcome.digest.eventChecksum,
    summary: outcome.summary as unknown as Record<string, unknown>,
    journalReadyOnly: true,
    mergedIntoDefinition: false,
  };
}

function informationEvidence(id: string, outcome: InformationImportOutcome): DatasetImportEvidence {
  return {
    id,
    kind: "information",
    datasetId: String(outcome.descriptor.datasetId),
    sourceProvider: outcome.descriptor.source.provider,
    recordCount: outcome.records.length,
    eventCount: outcome.digest.eventCount,
    eventChecksum: outcome.digest.eventChecksum,
    summary: outcome.summary as unknown as Record<string, unknown>,
    journalReadyOnly: true,
    mergedIntoDefinition: true,
  };
}

/**
 * Load every declared dataset (in declaration order — deterministic), merge
 * information artifacts into the definition, and collect the import
 * evidence. Relative dataset paths resolve against the definition file's
 * directory.
 */
export async function loadDeclaredDatasets(
  declarations: readonly DatasetDeclaration[],
  baseDir: string,
  definition: WorldDefinition,
): Promise<LoadedDatasets> {
  const evidence: DatasetImportEvidence[] = [];
  const importedArtifacts: InformationArtifact<NewsPayload>[] = [];
  for (const declaration of declarations) {
    const path = resolve(baseDir, declaration.path);
    const parsed = await readDatasetFile(declaration.id, path);
    if (declaration.kind === "historical") {
      requireShape(parsed, "descriptor", declaration.id, path, "object");
      requireShape(parsed, "records", declaration.id, path, "array");
      requireShape(parsed, "symbolMap", declaration.id, path, "object");
      if (parsed.sources !== undefined) {
        throw new CliError(
          "dataset-import-violations",
          `dataset '${declaration.id}' (${path}): 'sources' is the information kind's field (historical datasets declare no sources)`,
        );
      }
      let outcome: HistoricalImportOutcome;
      try {
        outcome = loadHistoricalDataset({
          worldId: definition.scope.worldId,
          descriptor: parsed.descriptor as DatasetDescriptor,
          records: parsed.records as HistoricalRecord[],
          symbolMap: parsed.symbolMap as Record<string, string> as RecordSymbolMap,
        });
      } catch (error) {
        throw violationLines(error, declaration.id);
      }
      evidence.push(historicalEvidence(declaration.id, outcome));
      continue;
    }
    requireShape(parsed, "descriptor", declaration.id, path, "object");
    requireShape(parsed, "records", declaration.id, path, "array");
    requireShape(parsed, "symbolMap", declaration.id, path, "object");
    requireShape(parsed, "sources", declaration.id, path, "array");
    let outcome: InformationImportOutcome;
    try {
      outcome = loadInformationDataset({
        worldId: definition.scope.worldId,
        descriptor: parsed.descriptor as InformationDatasetDescriptor,
        records: parsed.records as InformationRecord[],
        sources: parsed.sources as InformationSourceDeclaration[],
        symbolMap: parsed.symbolMap as Record<string, string> as RecordSymbolMap,
      });
    } catch (error) {
      throw violationLines(error, declaration.id);
    }
    importedArtifacts.push(...toDefinitionInformationArtifacts(outcome.artifacts));
    evidence.push(informationEvidence(declaration.id, outcome));
  }
  // The merged definition must stay CANONICALLY IDENTICAL to the authored
  // one when nothing was imported into it: `informationArtifacts: []` would
  // be a different value than `undefined` under the definition digest, and a
  // historical-only import owns no artifacts at all. Attach the merged
  // surface only when information artifacts actually exist.
  const hasHandArtifacts = definition.informationArtifacts !== undefined && definition.informationArtifacts.length > 0;
  const mergedDefinition: WorldDefinition =
    importedArtifacts.length === 0 && !hasHandArtifacts
      ? definition
      : {
          ...definition,
          informationArtifacts: [...(definition.informationArtifacts ?? []), ...importedArtifacts],
        };
  return { mergedDefinition, evidence };
}
