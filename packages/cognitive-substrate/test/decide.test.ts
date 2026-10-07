/**
 * The substrate-interface laws (W033): the state modes, the fail-closed
 * decide, deterministic identities, the A9 twin runs, and the purity pin
 * (no IO / clock / RNG anywhere in the package sources — the substrate
 * contract, enforced by a source scan).
 *
 * Run: ../../node_modules/.bin/tsx --test test/decide.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createMeanReversionSubstrate, createMomentumSubstrate } from "../index.js";
import type { ObservedBodyView, SubstrateState } from "../index.js";
import { fnv1aChainHex } from "tradrl-world-sim/world";
import { INSTRUMENT, observedView, quote, trade, position } from "./fixtures.js";

const MOMENTUM = createMomentumSubstrate({
  substrateId: "substrate-momentum" as never,
  seed: "seed-momentum",
  instrumentId: INSTRUMENT,
  lookback: 3,
  threshold: "2",
  quantity: "1",
});

const MR = createMeanReversionSubstrate({
  substrateId: "substrate-mr" as never,
  seed: "seed-mr",
  instrumentId: INSTRUMENT,
  threshold: "2",
  quantity: "1",
});

test("a declared-state substrate without state is loud (state-required)", () => {
  const outcome = MOMENTUM.decide({ view: observedView() });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(outcome.errors.map((one) => one.code), ["state-required"]);
});

test("a declared-state substrate with a foreign state is loud (malformed-state)", () => {
  const foreign: SubstrateState = { substrateId: "someone-else", window: [], lastSignal: "flat" };
  const outcome = MOMENTUM.decide({ view: observedView(), state: foreign });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(outcome.errors.map((one) => one.code), ["malformed-state"]);
});

test("a stateless-per-view substrate handed state is loud (unexpected-state)", () => {
  const outcome = MR.decide({
    view: observedView(),
    state: { anything: true },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(outcome.errors.map((one) => one.code), ["unexpected-state"]);
});

test("decide is fail-closed: an out-of-grant view is a typed error, never silently seen", () => {
  const beyond: ObservedBodyView = observedView({
    observations: ["market-quote", "own-positions"],
    trades: [trade("4800")],
  });
  const outcome = MOMENTUM.decide({ view: beyond, state: MOMENTUM.initialState });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(outcome.errors.map((one) => one.code), ["observation-kind-not-in-view"]);
});

test("decide returns the next state for declared-state substrates (the seeded state machine threads)", () => {
  const first = MOMENTUM.decide({ view: observedView(), state: MOMENTUM.initialState });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.notEqual(first.state, undefined);
  const state = first.state as { window: readonly string[] };
  assert.equal(state.window.length, 1);

  const second = MOMENTUM.decide({
    view: observedView({ quotes: [quote("4800.75", "4801.25")], asOf: 1_700_000_001_000 as never }),
    state: first.state,
  });
  assert.equal(second.ok, true);
});

test("decision ids are deterministic and derived from the cited view digest", () => {
  const outcome = MR.decide({
    view: observedView({ ownPositions: [position("0")], quotes: [quote("4797", "4797.5")] }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const decision = outcome.stream.decisions[0];
  assert.notEqual(decision, undefined);
  if (decision === undefined) return;
  assert.equal(
    String(decision.decisionId),
    `${String(MR.descriptor.substrateId)}:${outcome.stream.viewDigest}:0`,
  );
  assert.equal(decision.viewDigest, outcome.stream.viewDigest);
  assert.equal(decision.command.issuedAt, outcome.stream.asOf);
});

test("A9 twin runs: same views + same seed ⇒ identical DecisionStreams, wall clocks apart", async () => {
  const view = observedView();
  const firstRun = MOMENTUM.decide({ view, state: MOMENTUM.initialState });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const secondRun = MOMENTUM.decide({ view, state: MOMENTUM.initialState });
  assert.deepEqual(firstRun, secondRun);

  const mrFirst = MR.decide({ view: observedView() });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const mrSecond = MR.decide({ view: observedView() });
  assert.deepEqual(mrFirst, mrSecond);
});

test("a different seed can flip exactly the ambiguous case, never a clear one", () => {
  // Warm-up to a full window whose last mid is EXACTLY +threshold over its
  // start: mid 4798, 4798, then 4800 with threshold 2 — the exact tie.
  const viewAt = (bid: string, ask: string, at: number) =>
    observedView({
      quotes: [quote(bid, ask, at)],
      ownPositions: [position("0")],
      asOf: at as never,
    });
  const warm = viewAt("4797.75", "4798.25", 1_700_000_000_000);
  const tie = viewAt("4799.75", "4800.25", 1_700_000_003_000);
  const digest = require_viewDigest(MOMENTUM.decide({ view: tie, state: MOMENTUM.initialState }));

  // find two seeds with opposite parity on the SAME view digest
  const parityOf = (seed: string) => Number.parseInt(fnv1aChainHex([seed, digest]), 16) & 1;
  let oddSeed = "seed-odd-1";
  let evenSeed = "seed-even-1";
  for (let index = 1; parityOf(oddSeed) !== 1; index += 1) oddSeed = `seed-odd-${String(index)}`;
  for (let index = 1; parityOf(evenSeed) !== 0; index += 1) evenSeed = `seed-even-${String(index)}`;

  const make = (seed: string) =>
    createMomentumSubstrate({
      substrateId: `substrate-${seed}` as never,
      seed,
      instrumentId: INSTRUMENT,
      lookback: 3,
      threshold: "2",
      quantity: "1",
    });

  const oddSubstrate = make(oddSeed);
  const evenSubstrate = make(evenSeed);
  const run = (substrate: ReturnType<typeof make>) => {
    const first = substrate.decide({ view: warm, state: substrate.initialState });
    const second = substrate.decide({
      view: warm,
      state: first.ok ? first.state : undefined,
    });
    const third = substrate.decide({
      view: tie,
      state: second.ok ? second.state : undefined,
    });
    assert.equal(third.ok, true);
    return third.ok ? third.stream.decisions : [];
  };

  // the odd-parity seed lets the exact boundary count as a signal; the
  // even-parity seed holds it flat — the ONLY thing a seed may flip.
  const oddDecisions = run(oddSubstrate);
  const evenDecisions = run(evenSubstrate);
  assert.equal(oddDecisions.length, 1);
  assert.equal(evenDecisions.length, 0);
  assert.equal(oddDecisions[0]?.command.kind, "submit-order");

  // a CLEAR signal is identical under both seeds (same command, same rationale rule)
  const clear = viewAt("4801.75", "4802.25", 1_700_000_006_000); // mid 4802 = +4 over start
  const runClear = (substrate: ReturnType<typeof make>) => {
    const first = substrate.decide({ view: warm, state: substrate.initialState });
    const second = substrate.decide({
      view: warm,
      state: first.ok ? first.state : undefined,
    });
    const third = substrate.decide({
      view: clear,
      state: second.ok ? second.state : undefined,
    });
    assert.equal(third.ok, true);
    return third.ok ? third.stream.decisions : [];
  };
  const oddClear = runClear(oddSubstrate);
  const evenClear = runClear(evenSubstrate);
  assert.equal(oddClear.length, 1);
  assert.equal(evenClear.length, 1);
  const odd = oddClear[0];
  const even = evenClear[0];
  if (odd === undefined || even === undefined) return;
  assert.equal(odd.command.kind, even.command.kind);
  assert.deepEqual(
    (odd.command as { submission: unknown }).submission,
    (even.command as { submission: unknown }).submission,
  );
  assert.deepEqual(odd.rationale.rule, even.rationale.rule);
  assert.deepEqual(odd.confidence, even.confidence);
});

/** The stream's view digest (the citation) from a decide outcome — test helper. */
function require_viewDigest(
  outcome: { readonly ok: boolean; readonly stream?: { readonly viewDigest: string } },
): string {
  assert.equal(outcome.ok, true);
  assert.notEqual(outcome.stream, undefined);
  return outcome.stream?.viewDigest ?? "";
}

test("the purity pin: no IO, no clock reads, no RNG anywhere in the package sources", () => {
  // The substrate contract as a source-scan law: the only effects a
  // substrate may produce are its returned data. Wall time, randomness and
  // filesystem/network/process access are all banned from the src surface
  // (tests are exempt — THEY may use setTimeout to space twin runs apart).
  const banned: readonly { readonly pattern: RegExp; readonly why: string }[] = [
    { pattern: /\bDate\.now\b/, why: "wall-clock reads" },
    { pattern: /\bnew Date\b/, why: "wall-clock construction" },
    { pattern: /\bMath\.random\b/, why: "unseeded randomness" },
    { pattern: /\bcrypto\b/, why: "entropy sources" },
    { pattern: /\bperformance\.now\b/, why: "high-resolution clocks" },
    { pattern: /\bprocess\.hrtime\b/, why: "high-resolution clocks" },
    { pattern: /\bsetTimeout\b/, why: "timers" },
    { pattern: /\bsetInterval\b/, why: "timers" },
    { pattern: /\bfetch\s*\(/, why: "network IO" },
    { pattern: /require\(\s*["']node:(fs|net|http|child_process)/, why: "system IO" },
    { pattern: /\bfrom\s+["']node:(fs|net|http|child_process)/, why: "system IO" },
  ];
  const srcDir = new URL("../", import.meta.url).pathname;
  const violations: string[] = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts")) {
      continue;
    }
    const source = readFileSync(`${srcDir}${name}`, "utf8");
    for (const rule of banned) {
      if (rule.pattern.test(source)) {
        violations.push(`${name}: ${rule.why}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
