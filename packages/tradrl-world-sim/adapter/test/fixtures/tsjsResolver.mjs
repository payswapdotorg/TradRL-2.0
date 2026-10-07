/**
 * Minimal ESM resolve hook for the W018 worker-thread tests: rewrites a
 * relative `.js` import specifier to its `.ts` source file when only the
 * TypeScript source exists.
 *
 * WHY THIS EXISTS (test-only): the adapter sources follow the repo's
 * NodeNext convention (`.js` specifiers between `.ts` files). The MAIN test
 * process runs under tsx, which resolves that convention — but tsx's loader
 * does not register inside a `node:worker_threads` worker, and Node's native
 * type transform does not rewrite specifiers. This 15-line hook gives the
 * worker thread exactly the tsx resolution rule the main thread has; the
 * engine itself runs on Node's native `--experimental-transform-types`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js") &&
    typeof context.parentURL === "string"
  ) {
    const jsUrl = new URL(specifier, context.parentURL);
    const tsUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    if (!existsSync(fileURLToPath(jsUrl)) && existsSync(fileURLToPath(tsUrl))) {
      return next(tsUrl.href, context);
    }
  }
  return next(specifier, context);
}
