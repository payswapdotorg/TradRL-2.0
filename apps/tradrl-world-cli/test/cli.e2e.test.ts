/**
 * End-to-end tests through the real bin (W031): the spawn path proves the
 * bootstrap (tsx loader resolution), stdout discipline (report JSON on
 * stdout, errors on stderr), exit codes and the A9 claim across two real
 * processes (the strongest form of "two independent runs").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  fixtureDir,
  generatedDefinition,
  generatedScript,
  plainDefinition,
  plainScript,
  writeJson,
} from "./helpers.js";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "tradrl-world.mjs");

interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function spawnBin(args: readonly string[]): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { maxBuffer: 32 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
  }
}

test("bin: --help exits 0 with the honest usage text on stdout", async () => {
  const result = await spawnBin(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /tradrl-world run --definition/);
  assert.match(result.stdout, /tradrl-world replay --journal/);
  assert.match(result.stdout, /Exit codes:/);
  assert.equal(result.stderr, "");
});

test("bin: usage errors exit 1 with the typed code on stderr", async () => {
  const unknown = await spawnBin(["teleport", "--definition", "x.json"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /usage-error/);
  assert.match(unknown.stderr, /unknown command 'teleport'/);

  const missing = await spawnBin(["run"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /run requires --definition/);

  const badFlag = await spawnBin(["run", "--definition", "a.json", "--warp", "b.json"]);
  assert.equal(badFlag.code, 1);
  assert.match(badFlag.stderr, /unknown option --warp/);
});

test("bin: invalid input exits 2 with the typed code + JSON error on stderr", async () => {
  const result = await spawnBin(["run", "--definition", "/tmp/w031-does-not-exist-ghost.json"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /definition-not-found/);
  assert.match(result.stderr, /"code":"definition-not-found"/);
  assert.equal(result.stdout, "");
});

test("bin: A9 across two real processes — identical stdout reports", async () => {
  const dirOne = await fixtureDir("w031-e2e-a-");
  const dirTwo = await fixtureDir("w031-e2e-b-");
  const defOne = await writeJson(dirOne, "definition.json", generatedDefinition());
  const scriptOne = await writeJson(dirOne, "script.json", generatedScript());
  const defTwo = await writeJson(dirTwo, "definition.json", generatedDefinition());
  const scriptTwo = await writeJson(dirTwo, "script.json", generatedScript());

  const one = await spawnBin(["run", "--definition", defOne, "--script", scriptOne]);
  assert.equal(one.code, 0, `stderr: ${one.stderr}`);
  const two = await spawnBin(["run", "--definition", defTwo, "--script", scriptTwo]);
  assert.equal(two.code, 0, `stderr: ${two.stderr}`);

  const reportOne = JSON.parse(one.stdout) as { invocation: Record<string, string>; reportDigest: string };
  const reportTwo = JSON.parse(two.stdout) as { invocation: Record<string, string>; reportDigest: string };
  assert.equal(reportOne.reportDigest, reportTwo.reportDigest);
  // the invocation block (paths) is the only allowed difference
  const stripInvocation = (report: { invocation: Record<string, string> }) => {
    const { invocation: _invocation, ...rest } = report;
    return rest;
  };
  assert.deepEqual(stripInvocation(reportOne), stripInvocation(reportTwo));
});

test("bin: run writes the journal; replay continues it in a second process", async () => {
  const dir = await fixtureDir("w031-e2e-replay-");
  const definition = await writeJson(dir, "definition.json", plainDefinition());
  const script = await writeJson(dir, "script.json", plainScript());
  const journal = join(dir, "journal.jsonl");
  const run = await spawnBin(["run", "--definition", definition, "--script", script, "--journal", journal]);
  assert.equal(run.code, 0, `stderr: ${run.stderr}`);

  const continuation = await writeJson(dir, "cont.json", [{ id: "cont-1", clock: { op: "step", deltaMs: 1000 } }]);
  const replay = await spawnBin(["replay", "--journal", journal, "--script", continuation]);
  assert.equal(replay.code, 0, `stderr: ${replay.stderr}`);
  const replayReport = JSON.parse(replay.stdout) as {
    command: string;
    restored: { records: number; eventChecksum: string };
    headlessReport: { eventHash: string };
  };
  assert.equal(replayReport.command, "replay");
  const runReport = JSON.parse(run.stdout) as { headlessReport: { eventHash: string; eventCount: number } };
  assert.equal(replayReport.headlessReport.eventHash, runReport.headlessReport.eventHash);
  assert.equal(replayReport.restored.records, runReport.headlessReport.eventCount);
});
