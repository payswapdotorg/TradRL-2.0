/**
 * The mean-reversion reference mind's laws (W033): the tape-edge zones,
 * position-aware entries/exits from the VIEW (stateless: no memory), the
 * missing-data honesty, and the nearer-edge rule for narrow tapes.
 *
 * Run: ../../node_modules/.bin/tsx --test test/meanReversion.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createMeanReversionSubstrate, validateObservedView, viewDigestOf } from "../index.js";
import { fnv1aChainHex } from "tradrl-world-sim/world";
import { INSTRUMENT, observedView, position, quote, trade } from "./fixtures.js";

const SUBSTRATE = createMeanReversionSubstrate({
  substrateId: "substrate-mr" as never,
  seed: "seed-mr",
  instrumentId: INSTRUMENT,
  threshold: "2",
  quantity: "1",
});

const AT = 1_700_000_000_000;

function view(parts: {
  bid?: string;
  ask?: string;
  tape?: readonly string[];
  quantity?: string;
  at?: number;
}): ReturnType<typeof observedView> {
  return observedView({
    quotes: [quote(parts.bid ?? "4799.75", parts.ask ?? "4800.25", parts.at ?? AT)],
    trades: (parts.tape ?? ["4799.75", "4800", "4800.25"]).map((price, index) =>
      trade(price, parts.at ?? AT, index + 1),
    ),
    ownPositions: [position(parts.quantity ?? "0", parts.at ?? AT)],
    asOf: (parts.at ?? AT) as never,
  });
}

test("a flat mind at the tape's low edge proposes a market buy (expect the bounce)", () => {
  // tape [4794, 4798, 4798.5], low edge = 4794+2 = 4796; mid 4795.75 ≤ 4796
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4795.50", ask: "4796.00", tape: ["4794", "4798", "4798.50"], quantity: "0" }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 1);
  const decision = outcome.stream.decisions[0]!;
  assert.equal(decision.command.kind, "submit-order");
  assert.equal(decision.command.submission.side, "buy");
  assert.equal(decision.rationale.rule, "mean-reversion-tape-edge");
  const byName = new Map(decision.rationale.signals.map((signal) => [signal.name, signal.value]));
  assert.equal(byName.get("tapeLow"), "4794");
  assert.equal(byName.get("tapeHigh"), "4798.5");
  assert.equal(byName.get("zone"), "low");
  // depth = 4796 − 4795.75 = 0.25 of threshold 2 → confidence 0.5 + 0.5×0.125
  assert.ok(decision.confidence > 0.56 && decision.confidence < 0.57);
});

test("a flat mind at the tape's high edge proposes a market sell (the fade)", () => {
  // tape [4795, 4801, 4801.5], high edge = 4801.5 − 2 = 4799.5; mid 4800.75 ≥ 4799.5, not in the low zone
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4800.50", ask: "4801.00", tape: ["4795", "4801", "4801.50"], quantity: "0" }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 1);
  const decision = outcome.stream.decisions[0];
  if (decision === undefined) return;
  assert.equal((decision.command as { submission: { side: string } }).submission.side, "sell");
});

test("a long position into the high edge proposes close-position (exit into strength)", () => {
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4800.50", ask: "4801.00", tape: ["4795", "4801", "4801.50"], quantity: "4" }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 1);
  assert.equal(outcome.stream.decisions[0]?.command.kind, "close-position");
});

test("a short position into the low edge proposes close-position", () => {
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4795.50", ask: "4796.00", tape: ["4794", "4798", "4798.50"], quantity: "-3" }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 1);
  assert.equal(outcome.stream.decisions[0]?.command.kind, "close-position");
});

test("a mid inside the band proposes nothing", () => {
  // tape [4790, 4800, 4810], edges 4792 / 4808; mid 4800 inside
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4799.75", ask: "4800.25", tape: ["4790", "4800", "4810"] }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 0);
});

test("missing data means no proposal: no tape / one-sided quote / no own-positions", () => {
  const noTape = SUBSTRATE.decide({ view: view({ tape: [] }) });
  assert.equal(noTape.ok && noTape.stream.decisions.length, 0);

  const oneSidedQuote = SUBSTRATE.decide({
    view: observedView({
      quotes: [{ ...quote("4795.50", "4796.00"), ask: undefined }],
      trades: [trade("4794", AT, 1), trade("4798", AT, 2)],
      ownPositions: [position("0")],
    }),
  });
  assert.equal(oneSidedQuote.ok && oneSidedQuote.stream.decisions.length, 0);

  const noPositions = SUBSTRATE.decide({
    view: observedView({
      quotes: [quote("4795.50", "4796.00")],
      trades: [trade("4794", AT, 1), trade("4798", AT, 2)],
      ownPositions: undefined,
    }),
  });
  assert.equal(noPositions.ok && noPositions.stream.decisions.length, 0);
});

test("a narrow tape (both zones) resolves to the NEARER edge", () => {
  // tape [4798, 4798.50]; edges: low 4800, high 4796.50 — the mid 4799 is
  // past BOTH (mid ≤ 4800 and mid ≥ 4796.50): distance to low edge 1, to
  // high edge 2.5 → the low zone wins → buy.
  const outcome = SUBSTRATE.decide({
    view: view({ bid: "4798.75", ask: "4799.25", tape: ["4798", "4798.50"], quantity: "0" }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 1);
  const decision = outcome.stream.decisions[0];
  if (decision === undefined) return;
  assert.equal((decision.command as { submission: { side: string } }).submission.side, "buy");
});

test("an exact boundary acts only when the seed's parity says so", () => {
  // tape low 4794, threshold 2 → the boundary is exactly mid 4796.
  const exact = view({ bid: "4795.75", ask: "4796.25", tape: ["4794", "4798", "4798.50"], quantity: "0" });
  assert.deepEqual(validateObservedView(exact), { ok: true });
  const digest = viewDigestOf(exact);
  const parity = Number.parseInt(fnv1aChainHex(["seed-mr", digest]), 16) & 1;
  const outcome = SUBSTRATE.decide({ view: exact });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, parity === 1 ? 1 : 0);
});

test("stateless-per-view: the same view always yields the same stream (no hidden state)", () => {
  const theView = view({ bid: "4795.50", ask: "4796.00", tape: ["4794", "4798", "4798.50"], quantity: "0" });
  const first = SUBSTRATE.decide({ view: theView });
  const second = SUBSTRATE.decide({ view: theView });
  const third = SUBSTRATE.decide({ view: theView });
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.notEqual((first.ok && first.stream.decisions.length) ?? 0, 0);
});
