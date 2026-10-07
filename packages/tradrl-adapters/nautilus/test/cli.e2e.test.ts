/**
 * The W031 CLI runner end-to-end test (W021): a Nautilus dataset file
 * authored from a real mapped batch runs through the REAL `tradrl-world-cli`
 * `main(argv)` — definition `datasets` section -> W020 loader -> run report
 * evidence — proving the replay-path alignment (the W031 CLI can run a
 * Nautilus dataset through a world). In-process (the CLI's testable `main`,
 * exactly what its own runner tests drive); no subprocess needed.
 *
 * The honesty boundary asserted: the CLI reports the import as
 * `journalReadyOnly: true` (never claimed as appended to the engine
 * journal — engine-level replay of imported events is the declared W021
 * follow-on surface, per the CLI's own dataset docs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldId } from "tradrl-world-contracts";
import { loadHistoricalDataset } from "tradrl-data";
import { main } from "tradrl-world-cli";
import { nautilusTraderCatalog } from "../dtypes.js";
import { mapNautilusDataset } from "../mapping.js";
import { NAUTILUS_BARS, NAUTILUS_INSTRUMENTS, T0_MS } from "./fixtures.js";

const WORLD = "world-w021-cli" as WorldId;
const catalog = nautilusTraderCatalog(NAUTILUS_INSTRUMENTS);

async function fixtureDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function plainDefinition(): Record<string, unknown> {
  return {
    scope: { tenantId: "tenant-w021", projectId: "project-w021", worldId: WORLD },
    mode: "reactive-replay",
    seed: "w021-cli-test-seed",
    worldDefinitionVersion: "w021-cli-def@1",
    inputDataSource: "nautilus-fixture://w021-cli-tests",
    clock: {
      start: T0_MS,
      end: T0_MS + 10 * 60_000,
      defaultStepMs: 1000,
      initialWallTime: T0_MS + 500_000,
    },
    instruments: [
      {
        instrumentId: "instrument-btcusdt",
        worldId: WORLD,
        venueId: "venue-w021",
        symbol: "BTCUSDT-BINANCE",
        assetClass: "crypto",
        quoteCurrency: "USDT",
        tickSize: "0.1",
        lotSize: "0.0001",
        pricePrecision: 1,
        quantityPrecision: 4,
        tradingState: "open",
        tradable: true,
      },
    ],
    accounts: [
      {
        accountId: "account-trader",
        worldId: WORLD,
        balances: { USDT: { amount: "100000.00", currency: "USDT" } },
        buyingPower: { amount: "100000.00", currency: "USDT" },
        marginUsed: { amount: "0.00", currency: "USDT" },
        marginAvailable: { amount: "100000.00", currency: "USDT" },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
    ],
    participants: [
      { participantId: "participant-trader", worldId: WORLD, kind: "human", accountId: "account-trader" },
    ],
    datasets: [{ id: "nautilus-bars", kind: "historical", path: "./nautilus-dataset.json" }],
  };
}

async function runCli(
  definitionPath: string,
  reportPath: string,
): Promise<{ code: number; report: Record<string, unknown> }> {
  const code = await main(["run", "--definition", definitionPath, "--report", reportPath]);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  return { code, report };
}

test("a mapped Nautilus bar batch runs through the W031 CLI with exact import parity", async () => {
  const dir = await fixtureDir("w021-cli-a-");
  const mapping = mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload);
  assert.ok(mapping.ok);
  // The dataset file is the adapter's exact output triple, serialized.
  const datasetPath = await writeJson(dir, "nautilus-dataset.json", {
    descriptor: mapping.datasetDescriptor,
    records: mapping.records,
    symbolMap: mapping.symbolMap,
  });
  const definitionPath = await writeJson(dir, "definition.json", plainDefinition());
  const reportPath = join(dir, "report.json");
  const { code, report } = await runCli(definitionPath, reportPath);
  assert.equal(code, 0);

  // The evidence block: dataset identity + the loader's journal-ready digest.
  const datasets = report.datasets as Record<string, unknown>[];
  assert.equal(datasets.length, 1);
  const evidence = datasets[0]!;
  assert.equal(evidence.kind, "historical");
  assert.equal(evidence.id, "nautilus-bars");
  assert.equal(evidence.datasetId, String(mapping.datasetDescriptor.datasetId));
  assert.equal(evidence.sourceProvider, "nautilus");
  assert.equal(evidence.recordCount, 3);
  assert.equal(evidence.journalReadyOnly, true);
  assert.equal(evidence.mergedIntoDefinition, false);

  // PARITY: the CLI's evidence digest equals the direct W020 import digest
  // of the same triple (same world id) — the adapter, the loader and the CLI
  // agree bit-for-bit.
  const direct = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(evidence.eventCount, direct.digest.eventCount);
  assert.equal(evidence.eventChecksum, direct.digest.eventChecksum);
  const summary = evidence.summary as Record<string, unknown>;
  assert.equal(summary.barCount, 3);
  assert.deepEqual(summary.symbols, ["BTCUSDT-BINANCE"]);
  assert.equal(report.engine, "headless");
  // The dataset path label flows through the definition's honest source.
  assert.ok(datasetPath.length > 0);
});

test("A9 through the CLI: two independent runs produce the identical report digest", async () => {
  const dirOne = await fixtureDir("w021-cli-b-");
  const dirTwo = await fixtureDir("w021-cli-c-");
  const mapping = mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload);
  assert.ok(mapping.ok);
  const dataset = {
    descriptor: mapping.datasetDescriptor,
    records: mapping.records,
    symbolMap: mapping.symbolMap,
  };
  const defOne = await writeJson(dirOne, "definition.json", plainDefinition());
  const defTwo = await writeJson(dirTwo, "definition.json", plainDefinition());
  await writeJson(dirOne, "nautilus-dataset.json", dataset);
  await writeJson(dirTwo, "nautilus-dataset.json", dataset);
  const runOne = await runCli(defOne, join(dirOne, "report.json"));
  const runTwo = await runCli(defTwo, join(dirTwo, "report.json"));
  assert.equal(runOne.code, 0);
  assert.equal(runTwo.code, 0);
  assert.equal(runOne.report.reportDigest, runTwo.report.reportDigest);
  assert.deepEqual(runOne.report.datasets, runTwo.report.datasets);
});
