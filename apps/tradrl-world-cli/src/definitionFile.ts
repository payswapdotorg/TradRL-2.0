/**
 * Definition-file loading and loud validation (W031).
 *
 * The definition file is the WorldDefinition JSON (W013's
 * `world/definition.ts` shape) plus ONE CLI-owned optional section:
 * `datasets` — an ordered array of dataset declarations loaded through the
 * W020 (`tradrl-data`) / W027 (`tradrl-information`) loaders (see
 * datasets.ts).
 *
 * Validation is loud and typed, never silent:
 * - unreadable/missing file / broken JSON → typed errors with the parse
 *   message;
 * - unknown top-level keys → rejected (a typo must never silently change the
 *   definition digest);
 * - the WorldDefinition itself is validated by the engine's own complete
 *   validator (`validateWorldDefinition` — every violation collected);
 * - the `datasets` section shape is validated here (the loaders own the
 *   dataset-file content validation).
 */

import { dirname, resolve } from "node:path";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { validateWorldDefinition } from "tradrl-world-sim/world";
import { CliError } from "./errors.js";
import { readJsonFile } from "./jsonFile.js";
import {
  loadDeclaredDatasets,
  parseDatasetDeclarations,
  type DatasetDeclaration,
  type LoadedDatasets,
} from "./datasets.js";

/** The recognized WorldDefinition top-level keys (W013's shape) + `datasets`. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "scope",
  "mode",
  "seed",
  "worldDefinitionVersion",
  "inputDataSource",
  "knownLimitations",
  "regimeSchedule",
  "clock",
  "instruments",
  "venues",
  "accounts",
  "participants",
  "riskLimits",
  "informationArtifacts",
  "datasets",
]);

/** One loaded definition file: the engine definition + dataset evidence. */
export interface LoadedDefinition {
  /** The engine definition (datasets stripped; information artifacts merged). */
  readonly definition: WorldDefinition;
  readonly datasetDeclarations: readonly DatasetDeclaration[];
  readonly datasets: LoadedDatasets | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load and validate a definition file: shape-validate the `datasets`
 * section, strip it, run the engine's complete definition validator, then
 * load the declared datasets (information artifacts merged into the
 * definition the engine will run — the merged definition is the one whose
 * digest and journal the run reports).
 */
export async function loadDefinitionFile(path: string): Promise<LoadedDefinition> {
  const parsed = await readJsonFile(path, {
    notFound: "definition-not-found",
    unreadable: "definition-unreadable",
    invalidJson: "definition-invalid-json",
  });
  if (!isRecord(parsed)) {
    throw new CliError("definition-invalid", `${path}: the definition file must be a JSON object`);
  }
  const unknownKeys = Object.keys(parsed).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new CliError(
      "definition-invalid",
      `${path}: unknown top-level key${unknownKeys.length > 1 ? "s" : ""} ${unknownKeys.map((k) => `'${k}'`).join(", ")} (WorldDefinition fields + 'datasets' are recognized; a typo must never silently change the definition digest)`,
    );
  }

  const declarations = parseDatasetDeclarations(parsed.datasets, path);
  const { datasets: _datasets, ...definitionCandidate } = parsed;

  const definition = definitionCandidate as unknown as WorldDefinition;
  const violations = validateWorldDefinition(definition);
  if (violations.length > 0) {
    throw new CliError("definition-invalid", `${path}: invalid world definition`, violations);
  }
  // Structural check beyond the engine's definition validator: regime
  // schedule parameters must be string→number records (the W017 profiles
  // read them as numbers; string values would surface later as an engine
  // invariant on the first announcement — fail loud at load instead).
  for (const [index, entry] of (definition.regimeSchedule ?? []).entries()) {
    if (entry.parameters !== undefined) {
      const bad = Object.entries(entry.parameters).filter(([, value]) => typeof value !== "number" || !Number.isFinite(value));
      if (bad.length > 0) {
        throw new CliError(
          "definition-invalid",
          `${path}: regimeSchedule[${index}] parameters must be string→number records`,
          bad.map(([key]) => `parameter '${key}' must be a finite number`),
        );
      }
    }
  }

  const datasets =
    declarations.length > 0
      ? await loadDeclaredDatasets(declarations, dirname(resolve(path)), definition)
      : undefined;

  return {
    definition: datasets?.mergedDefinition ?? definition,
    datasetDeclarations: declarations,
    datasets,
  };
}
