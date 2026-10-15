/**
 * The provider-neutrality forbidden-key laws (W057, from the adapter's
 * side): the arena vocabulary lives HERE and ONLY here — the frozen
 * neutral layers (packages/capability-provider, contracts/capability)
 * never name arena concepts, and NOTHING arena-shaped leaks through the
 * neutral surfaces this adapter projects into them.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { arenaCapabilityProvider } from "../arena-provider.js";
import {
  ARENA_LEADERBOARD_STYLES,
  ARENA_MEASUREMENT_REGIMES,
  ARENA_ROUND_KINDS,
  ARENA_VENUE_KINDS,
} from "../arena-identity.js";
import { registerArenaFixture } from "./fixtures.js";

/** Collect every key of every object in a JSON value (the forbidden-key walk). */
function keysOf(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysOf(item, into);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      into.add(key);
      keysOf(member, into);
    }
  }
  return into;
}

test("the frozen neutral layers carry no arena vocabulary (R055, verified from the adapter's side)", async () => {
  const neutralModules = [
    "../../../capability-provider/identity.ts",
    "../../../capability-provider/registration.ts",
    "../../../capability-provider/register.ts",
    "../../../capability-provider/port.ts",
    "../../../capability-provider/match.ts",
    "../../../capability-provider/validate.ts",
    "../../../capability-provider/index.ts",
    "../../../../contracts/capability/src/capability-provider-contract.ts",
  ];
  const forbidden = /\b(arena|leaderboard|venue|round|regime|ranking)\b/i;
  for (const module of neutralModules) {
    const path = fileURLToPath(new URL(module, import.meta.url));
    const source = await readFile(path, "utf8");
    // The ONE legitimate appearance of the word "Arena" in the frozen
    // layers is the spec's own requirement citation ("R055 — 'Arena is
    // optional'") — quoting the law is not naming a provider concept.
    const quotable = source.replaceAll(/'?Arena is optional'?/g, "");
    assert.equal(
      forbidden.test(quotable),
      false,
      `${module} names an arena concept — the neutral interface is provider-neutral (R055) and FROZEN`,
    );
  }
});

test("the neutral record this adapter registers carries no arena keys (the forbidden-key law, runtime)", () => {
  const { registration } = registerArenaFixture();
  const keys = keysOf(registration.provider);
  const leaked = [...keys].filter((key) =>
    /^(arena|venue|round|regime|leaderboard|ranking|rank)/i.test(key),
  );
  assert.deepEqual(
    leaked,
    [],
    `the neutral provider record leaked arena keys: ${JSON.stringify(leaked)}`,
  );
});

test("the neutral PORT serves no arena keys either (the seam itself stays neutral)", () => {
  const { registration } = registerArenaFixture();
  const port = arenaCapabilityProvider(registration);
  const keys = keysOf(port.listOffers());
  const leaked = [...keys].filter((key) =>
    /^(arena|venue|round|regime|leaderboard|ranking|rank)/i.test(key),
  );
  assert.deepEqual(
    leaked,
    [],
    `the neutral port leaked arena keys: ${JSON.stringify(leaked)}`,
  );
});

test("the arena vocabulary is declared HERE and only here, as the closed sets", () => {
  assert.deepEqual([...ARENA_VENUE_KINDS], ["continuous-session", "periodic-batch", "staged-elimination"]);
  assert.deepEqual([...ARENA_ROUND_KINDS], ["screening", "trial", "final"]);
  assert.deepEqual([...ARENA_MEASUREMENT_REGIMES], ["single-evaluation", "consensus-of-evaluations"]);
  assert.deepEqual([...ARENA_LEADERBOARD_STYLES], ["full-roster", "top-k"]);
});
