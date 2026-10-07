/**
 * Script-file loading + validation tests (W031).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScriptFile, validateScriptEntry } from "../src/scriptFile.js";
import { CliError } from "../src/errors.js";
import {
  continuationScript,
  fixtureDir,
  generatedScript,
  plainScript,
  writeJson,
  writeText,
} from "./helpers.js";

const WORLD = "world-w031-plain" as never;

async function assertScriptInvalid(run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof CliError, `expected CliError, got ${String(error)}`);
    assert.equal(error.code, "script-invalid");
    return error;
  }
  throw new Error("expected a script-invalid error; the load succeeded");
}

test("the mixed plain script loads: every clock op and command kind", async () => {
  const dir = await fixtureDir("w031-script-");
  const path = await writeJson(dir, "script.json", [
    ...plainScript(),
    { id: "pause-1", clock: { op: "pause" } },
    { id: "play-1", clock: { op: "play" } },
    { id: "follow-1", clock: { op: "follow-realtime", enabled: false } },
    { id: "close-1", command: { kind: "close-position", commandId: "cmd-close-1", issuedBy: "participant-trader", accountId: "account-trader", instrumentId: "instrument-btcusd" } },
  ]);
  const loaded = await loadScriptFile(path, WORLD);
  assert.equal(loaded.entries.length, 16);
  const drivers = loaded.entries.map((entry) => (entry.clock !== undefined ? "clock" : "command"));
  assert.deepEqual(drivers.filter((d) => d === "clock").length > 0, true);
  assert.deepEqual(drivers.filter((d) => d === "command").length > 0, true);
});

test("the generated script and the continuation script load", async () => {
  const dir = await fixtureDir("w031-script-");
  const gen = await writeJson(dir, "gen.json", generatedScript());
  assert.equal((await loadScriptFile(gen, "world-w031-gen" as never)).entries.length, 5);
  const cont = await writeJson(dir, "cont.json", continuationScript());
  assert.equal((await loadScriptFile(cont, "world-w031-gen" as never)).entries.length, 2);
});

test("missing / unparseable script files are typed errors", async () => {
  const dir = await fixtureDir("w031-script-");
  try {
    await loadScriptFile(`${dir}/ghost.json`, WORLD);
    throw new Error("expected script-not-found");
  } catch (error) {
    assert.equal((error as CliError).code, "script-not-found");
  }
  const bad = await writeText(dir, "bad.json", "]]]");
  try {
    await loadScriptFile(bad, WORLD);
    throw new Error("expected script-invalid-json");
  } catch (error) {
    assert.equal((error as CliError).code, "script-invalid-json");
  }
});

test("the script file must be an array", async () => {
  const dir = await fixtureDir("w031-script-");
  const path = await writeJson(dir, "object.json", { entries: [] });
  const error = await assertScriptInvalid(() => loadScriptFile(path, WORLD));
  assert.match(error.message, /must be a JSON array/);
});

test("entry ids are explicit and unique; exactly one driver per entry", async () => {
  const seen = new Set<string>();
  const base = { commandId: "cmd-x", issuedBy: "participant-trader" };
  const submit = {
    kind: "submit-order",
    ...base,
    accountId: "account-trader",
    instrumentId: "instrument-btcusd",
    submission: { kind: "limit", side: "buy", quantity: "1", limitPrice: "4800", constraints: { timeInForce: "GTC" } },
  };
  const cases: readonly [unknown, RegExp][] = [
    [{ clock: { op: "pause" } }, /'id' must be a non-blank string/],
    [{ id: "both-drivers", clock: { op: "pause" }, command: submit }, /exactly one of 'clock' or 'command'/],
    [{ id: "neither-driver" }, /exactly one of 'clock' or 'command'/],
    [{ id: "bad-kind", command: { kind: "time-travel" } }, /unknown command kind 'time-travel'/],
    [{ id: "bad-op", clock: { op: "warp", to: 5 } }, /unknown clock op 'warp'/],
    [{ id: "bad-seek", clock: { op: "seek" } }, /requires a finite 'to'/],
    [{ id: "bad-step", clock: { op: "step", deltaMs: "lots" } }, /'deltaMs' must be a finite number/],
    [{ id: "bad-follow", clock: { op: "follow-realtime", enabled: "yes" } }, /requires 'enabled' \(boolean\)/],
  ];
  for (const [entry, pattern] of cases) {
    const error = await new Promise<CliError>((resolve) => {
      try {
        validateScriptEntry(entry, 0, WORLD, seen);
        resolve(new CliError("script-invalid", "NO ERROR THROWN"));
      } catch (thrown) {
        resolve(thrown as CliError);
      }
    });
    assert.equal(error.code, "script-invalid", `case ${JSON.stringify(entry).slice(0, 60)}`);
    assert.match(error.message, pattern);
  }
  // duplicate ids are rejected
  seen.add("dup");
  try {
    validateScriptEntry({ id: "dup", clock: { op: "pause" } }, 1, WORLD, seen);
    throw new Error("expected duplicate id rejection");
  } catch (error) {
    assert.match((error as Error).message, /duplicate entry id 'dup'/);
  }
});

test("command structure is validated loudly (all problems collected)", async () => {
  const seen = new Set<string>();
  const broken = {
    id: "broken-submit",
    command: {
      kind: "submit-order",
      commandId: " ",
      issuedBy: "",
      accountId: "",
      submission: { kind: "synthetic-option", side: "up", quantity: 7, constraints: { timeInForce: "ETA" } },
    },
  };
  let error: CliError | undefined;
  try {
    validateScriptEntry(broken, 0, WORLD, seen);
  } catch (thrown) {
    error = thrown as CliError;
  }
  assert.ok(error);
  const details = error.details ?? [];
  assert.ok(details.length >= 5, `expected all problems collected, got: ${details.join(" | ")}`);
  assert.ok(details.some((d) => d.includes("commandId")));
  assert.ok(details.some((d) => d.includes("issuedBy")));
  assert.ok(details.some((d) => d.includes("accountId")));
  assert.ok(details.some((d) => d.includes("submission.kind")));
  assert.ok(details.some((d) => d.includes("timeInForce")));
});

test("a present-but-mismatched worldId fails at load; omitted worldId is accepted", async () => {
  const seen = new Set<string>();
  const good = {
    id: "a",
    command: {
      kind: "add-annotation",
      commandId: "cmd-ann-1",
      issuedBy: "participant-trader",
      at: 1,
      text: "hello",
    },
  };
  // omitted worldId: fine
  validateScriptEntry(good, 0, WORLD, seen);
  // explicit matching worldId: fine
  validateScriptEntry({ ...good, id: "b", command: { ...good.command, worldId: "world-w031-plain" } }, 0, WORLD, seen);
  // mismatched: loud load failure (the problem is in the collected details)
  try {
    validateScriptEntry({ ...good, id: "c", command: { ...good.command, worldId: "world-other" } }, 0, WORLD, seen);
    throw new Error("expected worldId mismatch rejection");
  } catch (error) {
    const cliError = error as CliError;
    const everything = `${cliError.message} ${(cliError.details ?? []).join(" ")}`;
    assert.match(everything, /does not match the definition's world/);
  }
});

test("optional issuedAt and correlationId shapes are validated", async () => {
  const seen = new Set<string>();
  const base = {
    id: "ann",
    command: { kind: "add-annotation", commandId: "cmd-ann-1", issuedBy: "participant-trader", text: "x", at: 1 },
  };
  const problemsOf = (thrown: unknown): string => {
    const cliError = thrown as CliError;
    return `${cliError.message} ${(cliError.details ?? []).join(" ")}`;
  };
  try {
    validateScriptEntry({ ...base, id: "ann-issued-at", command: { ...base.command, issuedAt: "now" } }, 0, WORLD, seen);
    throw new Error("expected issuedAt rejection");
  } catch (error) {
    assert.match(problemsOf(error), /'issuedAt' must be a finite timestamp/);
  }
  try {
    validateScriptEntry({ ...base, id: "ann-correlation", command: { ...base.command, correlationId: "" } }, 0, WORLD, seen);
    throw new Error("expected correlationId rejection");
  } catch (error) {
    assert.match(problemsOf(error), /'correlationId' must be a non-blank string/);
  }
});
