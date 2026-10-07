/**
 * THE DETERMINISM GOLDEN (W031) — the A9 claim end to end through the CLI.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the same (definition, script) ⇒ the
 * same report digest. Two INDEPENDENT runs (fresh engines, different temp
 * dirs) must agree on every digest-bearing surface: the report digest, the
 * headless report (journal digest + financial summary), the determinism
 * manifest and every script outcome. A different script must DIVERGE. And
 * the run↔replay equivalence: restoring a run's journal and continuing must
 * reproduce the unbroken run's journal bit-for-bit (the W016/W017 restore
 * law, driven from the CLI surface).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRun } from "../src/runner.js";
import { executeReplay } from "../src/replay.js";
import { loadDefinitionFile, type LoadedDefinition } from "../src/definitionFile.js";
import { loadScriptFile, type ScriptEntry } from "../src/scriptFile.js";
import { stableDigest } from "tradrl-world-sim/world";
import {
  continuationScript,
  fixtureDir,
  generatedDefinition,
  generatedScript,
  plainDefinition,
  plainScript,
  writeJson,
} from "./helpers.js";

interface Prepared {
  readonly definition: LoadedDefinition;
  readonly entries: readonly ScriptEntry[];
  readonly dir: string;
}

async function prepare(
  definition: Record<string, unknown>,
  script: readonly unknown[] | undefined,
  prefix: string,
): Promise<Prepared> {
  const dir = await fixtureDir(prefix);
  const definitionPath = await writeJson(dir, "definition.json", definition);
  const loaded = await loadDefinitionFile(definitionPath);
  const entries =
    script === undefined
      ? []
      : (await loadScriptFile(await writeJson(dir, "script.json", script), loaded.definition.scope.worldId)).entries;
  return { definition: loaded, entries, dir };
}

function runOf(prepared: Prepared, invocation: Record<string, string> = {}) {
  return executeRun({
    definition: prepared.definition.definition,
    definitionDigest: stableDigest(prepared.definition.definition),
    datasets: prepared.definition.datasets?.evidence ?? [],
    entries: prepared.entries,
    invocation: { definitionPath: `${prepared.dir}/definition.json`, ...invocation },
  });
}

test("A9 golden: two independent plain runs ⇒ identical report digests", async () => {
  const one = await prepare(plainDefinition(), plainScript(), "w031-golden-a-");
  const two = await prepare(plainDefinition(), plainScript(), "w031-golden-b-");
  const reportOne = await runOf(one);
  const reportTwo = await runOf(two);
  assert.equal(reportOne.reportDigest, reportTwo.reportDigest);
  assert.deepEqual(reportOne.headlessReport, reportTwo.headlessReport);
  assert.deepEqual(reportOne.determinismManifest, reportTwo.determinismManifest);
  assert.deepEqual(reportOne.script.outcomes, reportTwo.script.outcomes);
  assert.ok(reportOne.headlessReport.eventCount >= 4);
});

test("A9 golden: two independent GENERATED runs ⇒ identical report digests", async () => {
  const one = await prepare(generatedDefinition(), generatedScript(), "w031-golden-gen-a-");
  const two = await prepare(generatedDefinition(), generatedScript(), "w031-golden-gen-b-");
  const reportOne = await runOf(one);
  const reportTwo = await runOf(two);
  assert.equal(reportOne.reportDigest, reportTwo.reportDigest);
  assert.deepEqual(reportOne.headlessReport, reportTwo.headlessReport);
  assert.deepEqual(reportOne.determinismManifest, reportTwo.determinismManifest);
  assert.ok(reportOne.headlessReport.eventCount > 100, "expected a lively generated market");
});

test("A9 sensitivity: a different script ⇒ a different report digest", async () => {
  const base = await prepare(generatedDefinition(), generatedScript(), "w031-golden-s1-");
  const variantScript = [...generatedScript()];
  (variantScript[2] as { clock: { to: number } }).clock.to = 1_700_044_800_000 + 35_000;
  const variant = await prepare(generatedDefinition(), variantScript, "w031-golden-s2-");
  const reportBase = await runOf(base);
  const reportVariant = await runOf(variant);
  assert.notEqual(reportBase.reportDigest, reportVariant.reportDigest);
  assert.notEqual(reportBase.headlessReport.eventHash, reportVariant.headlessReport.eventHash);
});

test("run↔replay equivalence: restored + continued reproduces the unbroken journal", async () => {
  // The unbroken run: full script in one engine.
  const full = [...generatedScript(), ...continuationScript()];
  const unbroken = await prepare(generatedDefinition(), full, "w031-golden-full-");
  const unbrokenReport = await runOf(unbroken, { journalPath: `${unbroken.dir}/journal.jsonl` });

  // The split run: first half, journal written; replay + continuation.
  const firstHalf = generatedScript();
  const split = await prepare(generatedDefinition(), firstHalf, "w031-golden-split-");
  const splitReport = await runOf(split, { journalPath: `${split.dir}/journal.jsonl` });
  const contDir = await fixtureDir("w031-golden-cont-");
  const contScriptPath = await writeJson(contDir, "cont.json", continuationScript());
  const replay = await executeReplay({
    journalPath: `${split.dir}/journal.jsonl`,
    scriptPath: contScriptPath,
  });

  // The journals are bit-identical (the W016/W017 restore law): same events,
  // same digest, same financial report.
  assert.equal(
    replay.headlessReport.eventHash,
    unbrokenReport.headlessReport.eventHash,
    "restored+continued journal must equal the unbroken journal",
  );
  assert.equal(replay.headlessReport.eventCount, unbrokenReport.headlessReport.eventCount);
  assert.deepEqual(replay.headlessReport.balances, unbrokenReport.headlessReport.balances);
  assert.deepEqual(replay.headlessReport.positions, unbrokenReport.headlessReport.positions);
  assert.deepEqual(replay.headlessReport.pnl, unbrokenReport.headlessReport.pnl);
  // the restored summary itself reports the recorded prefix faithfully
  assert.equal(replay.restored.source, "journal-header");
  assert.equal(replay.restored.eventChecksum, splitReport.headlessReport.eventHash);
  assert.equal(replay.restored.records, splitReport.headlessReport.eventCount);
  // HONEST difference, asserted: the restored engine's command-stream hash
  // covers only the continuation commands (a fresh hasher at restore), so
  // the manifests differ there while every event-derived figure matches.
  assert.notEqual(
    replay.determinismManifest.commandStreamHash,
    unbrokenReport.determinismManifest.commandStreamHash,
  );
  assert.equal(
    replay.determinismManifest.inputHashes.worldDefinition,
    unbrokenReport.determinismManifest.inputHashes.worldDefinition,
  );
});

test("run↔replay equivalence: empty continuation reproduces the recorded report exactly", async () => {
  const prepared = await prepare(generatedDefinition(), generatedScript(), "w031-golden-rc-");
  const report = await runOf(prepared, { journalPath: `${prepared.dir}/journal.jsonl` });
  const replay = await executeReplay({ journalPath: `${prepared.dir}/journal.jsonl` });
  assert.equal(replay.restored.eventChecksum, report.headlessReport.eventHash);
  assert.equal(replay.headlessReport.eventHash, report.headlessReport.eventHash);
  assert.deepEqual(replay.headlessReport.balances, report.headlessReport.balances);
  assert.deepEqual(replay.headlessReport.positions, report.headlessReport.positions);
  assert.deepEqual(replay.headlessReport.pnl, report.headlessReport.pnl);
  // an honest, documented difference: the live run's clock advanced past the
  // last event when the script's final op was a clock move; the restored
  // clock starts AT the last event time.
  assert.ok(replay.headlessReport.finalSimulationTime <= report.headlessReport.finalSimulationTime);
});
