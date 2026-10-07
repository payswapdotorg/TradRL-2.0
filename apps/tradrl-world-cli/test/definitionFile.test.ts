/**
 * Definition-file loading + loud validation tests (W031).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDefinitionFile } from "../src/definitionFile.js";
import { CliError } from "../src/errors.js";
import {
  fixtureDir,
  historicalDatasetFile,
  informationDatasetFile,
  plainDefinition,
  writeJson,
  writeText,
} from "./helpers.js";

async function assertCliError(code: string, run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof CliError, `expected CliError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected a ${code} error; the load succeeded`);
}

test("a valid definition loads; datasets section stripped; artifacts merged", async () => {
  const dir = await fixtureDir("w031-def-");
  const definition = plainDefinition();
  (definition as { informationArtifacts?: unknown[] }).informationArtifacts = [
    {
      artifactId: "artifact-hand-1",
      worldId: "world-w031-plain",
      source: "hand-authored",
      createdAt: 1_700_044_800_000,
      availableAt: 1_700_044_800_000,
      scope: "news",
      version: "1",
      payload: { type: "information.news.published", headline: "hand artifact" },
    },
  ];
  const path = await writeJson(dir, "definition.json", {
    ...definition,
    datasets: [{ id: "info-1", kind: "information", path: "info-dataset.json" }],
  });
  await writeJson(dir, "info-dataset.json", informationDatasetFile());

  const loaded = await loadDefinitionFile(path);
  assert.equal(loaded.definition.scope.worldId, "world-w031-plain");
  assert.equal(loaded.datasetDeclarations.length, 1);
  assert.equal(loaded.datasets?.evidence.length, 1);
  // the CLI-owned key never reaches the engine definition
  assert.equal("datasets" in loaded.definition, false);
  // hand artifact + 2 imported records merged, in order
  assert.equal(loaded.definition.informationArtifacts?.length, 3);
  assert.equal(loaded.definition.informationArtifacts?.[0]?.artifactId, "artifact-hand-1");
});

test("missing / unreadable / unparseable definition files are typed errors", async () => {
  const dir = await fixtureDir("w031-def-");
  await assertCliError("definition-not-found", () =>
    loadDefinitionFile(joinMissing(dir)));
  const badJson = await writeText(dir, "bad.json", "{not json");
  await assertCliError("definition-invalid-json", () => loadDefinitionFile(badJson));
});

test("an invalid definition reports EVERY violation (the engine's validator)", async () => {
  const dir = await fixtureDir("w031-def-");
  const broken = plainDefinition();
  broken.seed = " ";
  broken.mode = "wonderland" as never;
  (broken.instruments as Record<string, unknown>[]).push({
    instrumentId: "instrument-btcusd",
    symbol: "BTC-USD",
    tickSize: 0,
    lotSize: 0,
  });
  const path = await writeJson(dir, "broken.json", broken);
  const error = await assertCliError("definition-invalid", () => loadDefinitionFile(path));
  const details = error.details ?? [];
  assert.ok(details.length >= 4, `expected every violation collected, got ${details.length}`);
  assert.ok(details.some((d) => d.includes("seed")));
  assert.ok(details.some((d) => d.includes("WorldMode")));
  assert.ok(details.some((d) => d.includes("duplicate instrumentId")));
});

test("unknown top-level keys are rejected loudly (never a silent digest change)", async () => {
  const dir = await fixtureDir("w031-def-");
  const path = await writeJson(dir, "typo.json", {
    ...plainDefinition(),
    instrumentss: [],
  });
  const error = await assertCliError("definition-invalid", () => loadDefinitionFile(path));
  assert.match(error.message, /'instrumentss'/);
});

test("regime schedule parameters must be string→number records (fail at load)", async () => {
  const dir = await fixtureDir("w031-def-");
  const definition = plainDefinition();
  (definition as { regimeSchedule?: unknown }).regimeSchedule = [
    { regime: "trend", from: 1_700_044_800_000, to: 1_700_044_820_000, parameters: { anchorPrice: "4800" } },
  ];
  const path = await writeJson(dir, "gen.json", definition);
  const error = await assertCliError("definition-invalid", () => loadDefinitionFile(path));
  assert.ok((error.details ?? []).some((d) => d.includes("anchorPrice")));
});

test("the datasets section shape is validated (id/kind/path laws)", async () => {
  const dir = await fixtureDir("w031-def-");
  const cases: readonly [unknown, RegExp][] = [
    [{ id: "a", kind: "information", path: "x.json" }, /'datasets' must be an array/],
    [[{ kind: "information", path: "x.json" }], /'id' must be a non-blank string/],
    [[{ id: "a", kind: "telepathy", path: "x.json" }], /'kind' must be 'historical' \(W020\) or 'information' \(W027\)/],
    [[{ id: "a", kind: "information" }], /'path' must be a non-blank string/],
    [
      [
        { id: "a", kind: "information", path: "x.json" },
        { id: "a", kind: "historical", path: "y.json" },
      ],
      /duplicate dataset id 'a'/,
    ],
  ];
  for (const [datasets, pattern] of cases) {
    const path = await writeJson(dir, "datasets.json", { ...plainDefinition(), datasets });
    const error = await assertCliError("definition-invalid", () => loadDefinitionFile(path));
    assert.match(error.message, pattern);
  }
});

test("a historical dataset loads as journal-ready evidence only (definition unchanged)", async () => {
  const dir = await fixtureDir("w031-def-");
  const path = await writeJson(dir, "definition.json", {
    ...plainDefinition(),
    datasets: [{ id: "hist-1", kind: "historical", path: "hist-dataset.json" }],
  });
  await writeJson(dir, "hist-dataset.json", historicalDatasetFile());
  const loaded = await loadDefinitionFile(path);
  const evidence = loaded.datasets?.evidence[0]!;
  assert.equal(evidence.kind, "historical");
  assert.equal(evidence.journalReadyOnly, true);
  assert.equal(evidence.mergedIntoDefinition, false);
  assert.equal(evidence.recordCount, 2);
  assert.equal(evidence.eventCount, 2);
  assert.match(evidence.eventChecksum, /^[0-9a-f]{8}$/);
  assert.equal(loaded.definition.informationArtifacts, undefined);
});

function joinMissing(dir: string): string {
  return `${dir}/does-not-exist.json`;
}
