/**
 * Replay tests (W031): journal parsing, definition resolution (header vs
 * --definition), world/record coherence, restore + continuation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeReplay } from "../src/replay.js";
import { executeRun } from "../src/runner.js";
import { loadDefinitionFile } from "../src/definitionFile.js";
import { loadScriptFile } from "../src/scriptFile.js";
import { stableDigest } from "tradrl-world-sim/world";
import { CliError } from "../src/errors.js";
import {
  fixtureDir,
  generatedDefinition,
  generatedScript,
  plainDefinition,
  plainScript,
  writeJson,
  writeText,
} from "./helpers.js";

async function runAndJournal(definition: Record<string, unknown>, script: readonly unknown[], prefix: string) {
  const dir = await fixtureDir(prefix);
  const definitionPath = await writeJson(dir, "definition.json", definition);
  const loaded = await loadDefinitionFile(definitionPath);
  const entries = (await loadScriptFile(await writeJson(dir, "script.json", script), loaded.definition.scope.worldId)).entries;
  const report = await executeRun({
    definition: loaded.definition,
    definitionDigest: stableDigest(loaded.definition),
    datasets: loaded.datasets?.evidence ?? [],
    entries,
    invocation: {
      definitionPath,
      scriptPath: `${dir}/script.json`,
      journalPath: `${dir}/journal.jsonl`,
    },
  });
  return { dir, report, journalPath: `${dir}/journal.jsonl`, definitionPath };
}

test("replay from a self-contained journal (no --definition): restored summary + continuation", async () => {
  const { report, journalPath } = await runAndJournal(plainDefinition(), plainScript(), "w031-replay-1-");
  const replay = await executeReplay({ journalPath });
  assert.equal(replay.command, "replay");
  assert.equal(replay.restored.source, "journal-header");
  assert.equal(replay.restored.worldId, "world-w031-plain");
  assert.equal(replay.restored.eventChecksum, report.headlessReport.eventHash);
  assert.equal(replay.restored.records, report.headlessReport.eventCount);
  // the plain script included create-snapshot: the fold rebuilt the payload registry
  assert.equal(replay.restored.snapshots, 1);
  // empty continuation: the restored report equals the recorded journal state
  assert.equal(replay.headlessReport.eventHash, report.headlessReport.eventHash);
  assert.deepEqual(replay.headlessReport.balances, report.headlessReport.balances);
});

test("replay with --definition (matching): works, source = definition-file", async () => {
  const { journalPath, definitionPath } = await runAndJournal(generatedDefinition(), generatedScript(), "w031-replay-2-");
  const replay = await executeReplay({ journalPath, definitionPath });
  assert.equal(replay.restored.source, "definition-file");
  assert.ok(replay.headlessReport.eventCount > 100);
});

test("replay with a MISMATCHED definition file fails loudly", async () => {
  const { journalPath } = await runAndJournal(generatedDefinition(), generatedScript(), "w031-replay-3-");
  const otherDir = await fixtureDir("w031-replay-3b-");
  const otherDefinition = generatedDefinition();
  (otherDefinition as { seed?: string }).seed = "a-different-seed";
  const otherPath = await writeJson(otherDir, "other.json", otherDefinition);
  try {
    await executeReplay({ journalPath, definitionPath: otherPath });
    throw new Error("expected definition-mismatch");
  } catch (error) {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, "definition-mismatch");
    assert.match(error.message, /does not canonically match/);
  }
});

test("a bare records journal without --definition is a typed error", async () => {
  const { journalPath } = await runAndJournal(plainDefinition(), plainScript(), "w031-replay-4-");
  const text = await readFile(journalPath, "utf8");
  const bareDir = await fixtureDir("w031-replay-4b-");
  const barePath = await writeText(bareDir, "bare.jsonl", text.split("\n").slice(1).join("\n"));
  try {
    await executeReplay({ journalPath: barePath });
    throw new Error("expected replay-requires-definition");
  } catch (error) {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, "replay-requires-definition");
  }
  // ...and the same bare file replays fine WITH the definition file
  const { definitionPath } = { definitionPath: await writeJson(bareDir, "definition.json", plainDefinition()) };
  const replay = await executeReplay({ journalPath: barePath, definitionPath });
  assert.equal(replay.restored.source, "definition-file");
  assert.ok(replay.restored.records > 0);
});

test("records from a foreign world are rejected with the offending sequences", async () => {
  const { journalPath, dir } = await runAndJournal(plainDefinition(), plainScript(), "w031-replay-5-");
  // a BARE records journal (header stripped) + a definition for another world:
  // no header comparison applies, so the world-coherence check is the guard.
  const text = await readFile(journalPath, "utf8");
  const barePath = await writeText(dir, "bare.jsonl", text.split("\n").slice(1).join("\n"));
  const foreignDefinition = await writeJson(dir, "foreign.json", {
    ...plainDefinition("world-w031-other"),
  });
  try {
    await executeReplay({ journalPath: barePath, definitionPath: foreignDefinition });
    throw new Error("expected journal-invalid");
  } catch (error) {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, "journal-invalid");
    assert.match(error.message, /do not belong to world world-w031-other/);
    assert.ok((error.details ?? []).some((d) => d.includes("belongs to world")));
  }
});

test("corrupt journal lines are rejected with line numbers", async () => {
  const { dir } = await runAndJournal(plainDefinition(), plainScript(), "w031-replay-6-");
  const corruptPath = await writeText(dir, "corrupt.jsonl", '{"tradrlWorldCli":"journal","version":1,"definition":{}}\nnot json\n');
  try {
    await executeReplay({ journalPath: corruptPath });
    throw new Error("expected journal-invalid");
  } catch (error) {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, "journal-invalid");
    assert.match(error.message, /line 2 is not valid JSON/);
  }
  const badVersion = await writeText(
    dir,
    "badversion.jsonl",
    '{"tradrlWorldCli":"journal","version":99,"definition":{}}\n',
  );
  try {
    await executeReplay({ journalPath: badVersion });
    throw new Error("expected journal-invalid");
  } catch (error) {
    assert.match((error as Error).message, /unsupported journal format version 99/);
  }
  const missing = await writeText(dir, "missing.jsonl", "");
  try {
    await executeReplay({ journalPath: `${missing}.ghost` });
    throw new Error("expected journal-not-found");
  } catch (error) {
    assert.equal((error as CliError).code, "journal-not-found");
  }
});

test("replay continuation drives the restored world forward (generated market continues)", async () => {
  const { journalPath, dir } = await runAndJournal(generatedDefinition(), generatedScript(), "w031-replay-7-");
  const scriptPath = await writeJson(dir, "cont.json", [
    { id: "cont-step-1", clock: { op: "step", deltaMs: 5000 } },
  ]);
  const replay = await executeReplay({ journalPath, scriptPath });
  assert.equal(replay.script.entries, 1);
  assert.equal(replay.script.outcomes[0]?.status, "applied");
  assert.ok(
    replay.headlessReport.eventCount > replay.restored.eventCount,
    "the continuation must journal new events on the generated market",
  );
  assert.equal(replay.restored.clock.status, "paused");
});
