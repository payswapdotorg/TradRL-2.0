/**
 * Runner tests (W031): engine selection, script driving, outcomes, output
 * files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeRun, engineKindOf } from "../src/runner.js";
import { loadDefinitionFile } from "../src/definitionFile.js";
import { loadScriptFile } from "../src/scriptFile.js";
import { stableDigest } from "tradrl-world-sim/world";
import type { WorldDefinition } from "tradrl-world-sim/world";
import {
  continuationScript,
  fixtureDir,
  generatedDefinition,
  generatedScript,
  plainDefinition,
  plainScript,
  writeJson,
} from "./helpers.js";

async function runFromFiles(input: {
  readonly definition: Record<string, unknown>;
  readonly script?: readonly unknown[];
  readonly reportPath?: string;
  readonly journalPath?: string;
  readonly definitionName?: string;
}) {
  const dir = await fixtureDir("w031-run-");
  const definitionPath = await writeJson(dir, input.definitionName ?? "definition.json", input.definition);
  const loaded = await loadDefinitionFile(definitionPath);
  const entries =
    input.script === undefined
      ? []
      : (await loadScriptFile(await writeJson(dir, "script.json", input.script), loaded.definition.scope.worldId)).entries;
  return executeRun({
    definition: loaded.definition,
    definitionDigest: stableDigest(loaded.definition),
    datasets: loaded.datasets?.evidence ?? [],
    entries,
    invocation: {
      definitionPath,
      ...(input.script === undefined ? {} : { scriptPath: `${dir}/script.json` }),
      ...(input.reportPath === undefined ? {} : { reportPath: input.reportPath }),
      ...(input.journalPath === undefined ? {} : { journalPath: input.journalPath }),
    },
  });
}

test("engine selection: a regimeSchedule runs the generated market; no schedule the plain engine", async () => {
  assert.equal(engineKindOf(plainDefinition() as unknown as WorldDefinition), "headless");
  assert.equal(engineKindOf(generatedDefinition() as unknown as WorldDefinition), "generated");
  const plain = await runFromFiles({ definition: plainDefinition(), script: [{ id: "step-1", clock: { op: "step", deltaMs: 5000 } }] });
  assert.equal(plain.engine, "headless");
  assert.equal(plain.script.outcomes[0]?.status, "applied");
  const generated = await runFromFiles({ definition: generatedDefinition(), script: [{ id: "step-1", clock: { op: "step", deltaMs: 5000 } }] });
  assert.equal(generated.engine, "generated");
  // the generated market journals real events on clock advance
  assert.ok(generated.headlessReport.eventCount > 5, `expected generated events, got ${generated.headlessReport.eventCount}`);
});

test("the mixed script: acks and typed rejections are recorded outcomes, the run succeeds", async () => {
  const report = await runFromFiles({ definition: plainDefinition(), script: plainScript() });
  const outcomes = report.script.outcomes;
  assert.equal(report.script.entries, outcomes.length);

  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  assert.equal(byId.get("step-1")?.status, "applied");
  assert.equal(byId.get("buy-1")?.status, "acked");
  assert.equal((byId.get("buy-1") as { journalCursor?: number }).journalCursor, 2);
  // the A8 law: in-place backward seek is a typed clock rejection, recorded
  const rewind = byId.get("rewind-1")!;
  assert.equal(rewind.status, "rejected");
  assert.ok(rewind.status === "rejected" && rewind.code === "rewind-requires-branch");
  // unknown order: the validate stage's typed rejection
  const cancel = byId.get("cancel-1")!;
  assert.ok(cancel.driver === "command" && cancel.status === "rejected" && cancel.stage === "validate");
  assert.ok(cancel.driver === "command" && cancel.status === "rejected" && cancel.code === "unknown-order");
  // duplicate command id: typed rejection, not a crash
  assert.equal(byId.get("dup-1")?.status, "rejected");
  // jump-to-event back to the first event: rewind rejection (A8)
  const jump = byId.get("ghost-world-1")!;
  assert.ok(jump.status === "rejected" && jump.code === "rewind-requires-branch");
  // snapshot + annotation acked
  assert.equal(byId.get("snapshot-1")?.status, "acked");
  assert.equal(byId.get("annotate-1")?.status, "acked");
  // the headless report mirrors the journal (the W013 law)
  assert.equal(report.headlessReport.eventHash.length, 8);
  assert.ok(report.headlessReport.eventCount >= 4);
});

test("an empty script runs the empty world (genesis report)", async () => {
  const report = await runFromFiles({ definition: plainDefinition() });
  assert.equal(report.script.entries, 0);
  assert.equal(report.headlessReport.eventCount, 0);
  assert.ok(report.reportDigest.length > 0);
});

test("--report writes the report JSON; --journal writes the replayable journal", async () => {
  const dir = await fixtureDir("w031-run-");
  const reportPath = `${dir}/report.json`;
  const journalPath = `${dir}/journal.jsonl`;
  const report = await runFromFiles({
    definition: generatedDefinition(),
    script: generatedScript(),
    reportPath,
    journalPath,
  });
  const written = JSON.parse(await readFile(reportPath, "utf8")) as typeof report;
  assert.equal(written.reportDigest, report.reportDigest);
  assert.equal(written.headlessReport.eventHash, report.headlessReport.eventHash);

  const journalText = await readFile(journalPath, "utf8");
  const lines = journalText.split("\n").filter((line) => line.trim().length > 0);
  const header = JSON.parse(lines[0]!) as { tradrlWorldCli: string; version: number };
  assert.equal(header.tradrlWorldCli, "journal");
  assert.equal(header.version, 1);
  assert.equal(lines.length, report.headlessReport.eventCount + 1);
});

test("the invocation block records paths but the digest is path-independent", async () => {
  const dirB = await fixtureDir("w031-run-");
  const a = await runFromFiles({ definition: plainDefinition(), script: continuationScript(), definitionName: "a.json" });
  // second run from a different directory path: same content ⇒ same digest
  const definitionPath = await writeJson(dirB, "b.json", plainDefinition());
  const loaded = await loadDefinitionFile(definitionPath);
  const entries = (await loadScriptFile(await writeJson(dirB, "script.json", continuationScript()), loaded.definition.scope.worldId)).entries;
  const b = await executeRun({
    definition: loaded.definition,
    definitionDigest: stableDigest(loaded.definition),
    datasets: [],
    entries,
    invocation: { definitionPath, scriptPath: `${dirB}/script.json` },
  });
  assert.equal(a.reportDigest, b.reportDigest);
  assert.deepEqual(a.headlessReport, b.headlessReport);
  assert.notEqual(a.invocation.definitionPath, b.invocation.definitionPath);
});

test("run on a generated world with a continuation-sized script produces a real market", async () => {
  const report = await runFromFiles({ definition: generatedDefinition(), script: generatedScript() });
  assert.equal(report.engine, "generated");
  assert.ok(report.headlessReport.eventCount > 100, `expected a lively market, got ${report.headlessReport.eventCount}`);
  const byId = new Map(report.script.outcomes.map((o) => [o.id, o]));
  assert.equal(byId.get("buy-1")?.status, "acked");
  assert.equal(byId.get("scenario-1")?.status, "acked");
  // the market order filled on generated liquidity: trader has a position or realized P&L
  assert.ok(
    report.headlessReport.positions.length > 0 || report.headlessReport.pnl[0]?.realized.amount !== "0",
    "expected the human market order to trade on generated liquidity",
  );
});
