#!/usr/bin/env node
/**
 * The `tradrl-world` bin (W031).
 *
 * The app is TypeScript-source-exported (the tradrl-world-sim package
 * convention: package "exports" point at .ts sources; the whole repo runs
 * sources through tsx — the sim package's own test scripts do exactly this).
 * This bootstrap resolves the repo's tsx loader from this bin's location
 * (works both in a registered workspace install and in a bare worktree with
 * only the root node_modules present) and re-execs node with the loader
 * attached and the TypeScript CLI as the entry.
 *
 * Honest failure: if tsx cannot be resolved, a typed bootstrap error goes to
 * stderr and the process exits non-zero. No args are interpreted here —
 * `src/cli.ts` owns parsing, help and error reporting.
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, "..", "src", "entry.ts");

function fail(code, message) {
  process.stderr.write(`tradrl-world: ${code}: ${message}\n`);
  process.exit(2);
}

let loaderUrl;
try {
  // Resolves the tsx package's "." export (its ESM loader) from this bin's
  // location: apps/tradrl-world-cli/node_modules, then apps/node_modules,
  // then the workspace root node_modules.
  loaderUrl = pathToFileURL(require.resolve("tsx")).href;
} catch (error) {
  fail(
    "bootstrap-loader-missing",
    `cannot resolve the tsx TypeScript loader from ${here} (${String(error)}); ` +
      "install the workspace (pnpm install) or run through the repo root's tsx",
  );
}

const child = spawnSync(
  process.execPath,
  ["--import", loaderUrl, cliEntry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (child.error) {
  fail("bootstrap-failed", String(child.error));
}
process.exit(child.status ?? 1);
