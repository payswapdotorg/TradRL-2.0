/**
 * The clean-room provenance laws (W049): the adapter's public surface
 * exposes NOTHING derived from third-party code. A vocabulary-law scan
 * over the package's OWN source bytes: zero upstream-derivation markers,
 * zero third-party imports (only this repository's own workspace
 * packages + node builtins + relative fixture-lineage imports), zero
 * third-party npm dependencies, and the exported closed vocabularies
 * pinned exactly. The register's binding JAX-LOB ruling
 * (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md) is cited in the README; this
 * test is the machine-checked side of that declaration.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  LOB_EXECUTION_EVENT_KINDS,
  LOB_ORDER_KINDS,
  LOB_SIDES,
  LOB_STEP_KINDS,
} from "../lob-vocabulary.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Every TypeScript source of the package (root modules + tests). */
function sourceFiles(): string[] {
  const root = readdirSync(packageRoot)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(packageRoot, name));
  const tests = readdirSync(join(packageRoot, "test"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(packageRoot, "test", name));
  return [...root, ...tests];
}

/** The closed import-specifier law: repo packages, node builtins, relative imports — nothing else. */
const ALLOWED_SPECIFIERS = new Set(["rl-protocol", "learning-compute", "trajectory", "learning-rl"]);

const IMPORT_PATTERN = /^\s*import\s+(?:type\s+)?[^"'=]*?from\s+["']([^"']+)["']/gm;

test("zero upstream-derivation markers anywhere in the package source", () => {
  // The upstream markers are assembled at runtime so this scan never
  // carries the literal markers it forbids (a self-scanning law needs that).
  const forbidden = [
    ["Kang", "Oxford"].join(""),
    ["Alpha", "Trade"].join(""),
    ["Market", "Sim"].join(""),
  ];
  const copyrightMarker = ["Copy", "right"].join("");
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const marker of forbidden) {
      assert.equal(
        text.includes(marker),
        false,
        `${file} carries an upstream-derivation marker — clean-room violation`,
      );
    }
    assert.equal(text.includes(copyrightMarker), false, `${file} carries a vend notice line — no vendored file carries one`);
  }
});

test("every import in the package source is a repo package, a node builtin, or relative", () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1]!;
      const lawful =
        specifier.startsWith("node:") ||
        specifier.startsWith("./") ||
        specifier.startsWith("../") ||
        ALLOWED_SPECIFIERS.has(specifier);
      assert.equal(
        lawful,
        true,
        `${file} imports '${specifier}' — the adapter imports ONLY this repository's own packages, node builtins, and relative fixture-lineage modules (zero third-party code)`,
      );
    }
  }
});

test("the package carries zero third-party npm dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = Object.entries(manifest.dependencies ?? {});
  assert.deepEqual(
    dependencies.map(([name]) => name).sort(),
    ["learning-compute", "learning-rl", "rl-protocol", "trajectory"],
  );
  for (const [name, range] of dependencies) {
    assert.equal(
      range.startsWith("workspace:"),
      true,
      `the dependency '${name}' is not a workspace package — zero third-party npm dependencies (clean-room law)`,
    );
  }
});

test("the exported closed vocabularies are exactly the declared paper-concept sets (no upstream API shapes)", () => {
  assert.deepEqual(LOB_SIDES, ["bid", "ask"]);
  assert.deepEqual(LOB_ORDER_KINDS, ["limit", "market", "cancel", "amend"]);
  assert.deepEqual(LOB_EXECUTION_EVENT_KINDS, ["submission", "cancellation", "execution", "amendment"]);
  assert.deepEqual(LOB_STEP_KINDS, [
    "book-observation",
    "order-action",
    "execution-report",
    "reward-signal",
    "terminal-marker",
  ]);
});

test("the package source never references the register's forbidden upstream code paths", () => {
  const externalHost = ["github", ".com/"].join("");
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes(externalHost), false, `${file} references an external repository host — zero fetched or ported sources`);
  }
});
