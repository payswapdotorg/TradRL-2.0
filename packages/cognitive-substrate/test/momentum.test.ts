/**
 * The momentum reference mind's laws (W033): warm-up honesty, the
 * lookback-cross rule, position-aware entries/exits, the rolling window,
 * and the declared confidence basis.
 *
 * Run: ../../node_modules/.bin/tsx --test test/momentum.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createMomentumSubstrate } from "../index.js";
import type { ObservedBodyView } from "../index.js";
import { INSTRUMENT, observedView, position, quote } from "./fixtures.js";

const SUBSTRATE = createMomentumSubstrate({
  substrateId: "substrate-momentum" as never,
  seed: "seed-momentum",
  instrumentId: INSTRUMENT,
  lookback: 3,
  threshold: "2",
  quantity: "1",
});

const AT = [1_700_000_000_000, 1_700_000_001_000, 1_700_000_002_000, 1_700_000_003_000];

function viewAt(bid: string, ask: string, at: number, quantity = "0"): ObservedBodyView {
  return observedView({
    quotes: [quote(bid, ask, at)],
    ownPositions: [position(quantity, at)],
    asOf: at as never,
  });
}

/** Drive the mind over views, threading state (the declared-state contract). */
function drive(views: readonly ObservedBodyView[], substrate = SUBSTRATE) {
  let state = substrate.initialState;
  const streams: unknown[] = [];
  for (const view of views) {
    const outcome = substrate.decide({ view, state });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return { streams, finalState: state };
    streams.push(outcome.stream);
    state = outcome.state ?? state;
  }
  return { streams, finalState: state };
}

test("warm-up is honest: fewer than `lookback` mids ⇒ no proposals, window grows", () => {
  const { streams, finalState } = drive([viewAt("4797.75", "4798.25", AT[0]!)]);
  assert.equal(streams.length, 1);
  const stream = streams[0] as { decisions: readonly unknown[] };
  assert.equal(stream.decisions.length, 0);
  const window = (finalState as { window: readonly string[] }).window;
  assert.deepEqual(window, ["4798"]);
});

test("a mid with no two-sided quote does not advance the window (no data, no update)", () => {
  const oneSided = observedView({
    quotes: [{ ...quote("4797.75", "4798.25", AT[0]!), ask: undefined }],
    ownPositions: [position("0")],
  });
  const { finalState } = drive([viewAt("4797.75", "4798.25", AT[0]!), oneSided]);
  const window = (finalState as { window: readonly string[] }).window;
  assert.deepEqual(window, ["4798"]);
});

test("a clear up-cross from flat proposes a market buy with rationale as data", () => {
  const { streams } = drive([
    viewAt("4797.75", "4798.25", AT[0]!),
    viewAt("4797.75", "4798.25", AT[1]!),
    viewAt("4801.75", "4802.25", AT[2]!), // mid 4802 = +4 over start (threshold 2)
  ]);
  const stream = streams[2] as {
    decisions: readonly {
      command: { kind: string; submission: { kind: string; side: string; quantity: string } };
      rationale: { rule: string; signals: readonly { name: string; value: string | number | boolean }[] };
      confidence: number;
    }[];
  };
  assert.equal(stream.decisions.length, 1);
  const decision = stream.decisions[0]!;
  assert.equal(decision.command.kind, "submit-order");
  assert.equal(decision.command.submission.kind, "market");
  assert.equal(decision.command.submission.side, "buy");
  assert.equal(decision.command.submission.quantity, "1");
  assert.equal(decision.rationale.rule, "momentum-lookback-cross");
  const byName = new Map(decision.rationale.signals.map((signal) => [signal.name, signal.value]));
  assert.equal(byName.get("mid"), "4802");
  assert.equal(byName.get("lookbackStart"), "4798");
  assert.equal(byName.get("delta"), "4");
  assert.equal(byName.get("signal"), "up");
  // declared confidence: 0.5 + 0.5 × min(4−2, 3×2)/(3×2) = 0.5 + 0.5×(2/6) ≈ 0.6666
  assert.ok(decision.confidence > 0.66 && decision.confidence < 0.67);
  assert.ok(decision.confidence >= 0.5 && decision.confidence <= 1);
});

test("a clear down-cross from flat proposes a market sell (short entry)", () => {
  const { streams } = drive([
    viewAt("4801.75", "4802.25", AT[0]!),
    viewAt("4801.75", "4802.25", AT[1]!),
    viewAt("4797.75", "4798.25", AT[2]!), // mid 4798 = −4 over start
  ]);
  const stream = streams[2] as { decisions: readonly { command: { submission: { side: string } } }[] };
  assert.equal(stream.decisions.length, 1);
  assert.equal(stream.decisions[0]?.command.submission.side, "sell");
});

test("an opposing signal against a held position proposes close-position", () => {
  const { streams } = drive([
    viewAt("4797.75", "4798.25", AT[0]!, "3"), // long 3 from the start
    viewAt("4797.75", "4798.25", AT[1]!, "3"),
    viewAt("4793.75", "4794.25", AT[2]!, "3"), // mid 4794 = −4: clear down
  ]);
  const stream = streams[2] as { decisions: readonly { command: { kind: string } }[] };
  assert.equal(stream.decisions.length, 1);
  assert.equal(stream.decisions[0]?.command.kind, "close-position");
});

test("a short position against an up signal proposes close-position", () => {
  const { streams } = drive([
    viewAt("4801.75", "4802.25", AT[0]!, "-2"),
    viewAt("4801.75", "4802.25", AT[1]!, "-2"),
    viewAt("4805.75", "4806.25", AT[2]!, "-2"), // mid 4806 = +4: clear up
  ]);
  const stream = streams[2] as { decisions: readonly { command: { kind: string } }[] };
  assert.equal(stream.decisions.length, 1);
  assert.equal(stream.decisions[0]?.command.kind, "close-position");
});

test("an agreeing signal proposes nothing (long + up = hold)", () => {
  const { streams } = drive([
    viewAt("4797.75", "4798.25", AT[0]!, "3"),
    viewAt("4797.75", "4798.25", AT[1]!, "3"),
    viewAt("4801.75", "4802.25", AT[2]!, "3"), // long and up
  ]);
  const stream = streams[2] as { decisions: readonly unknown[] };
  assert.equal(stream.decisions.length, 0);
});

test("a repeated signal proposes nothing new (it acts on CHANGES)", () => {
  const { streams } = drive([
    viewAt("4797.75", "4798.25", AT[0]!),
    viewAt("4797.75", "4798.25", AT[1]!),
    viewAt("4801.75", "4802.25", AT[2]!), // up — entry
    viewAt("4803.75", "4804.25", AT[3]!, "1"), // still up (and now long)
  ]);
  const third = streams[2] as { decisions: readonly unknown[] };
  const fourth = streams[3] as { decisions: readonly unknown[] };
  assert.equal(third.decisions.length, 1);
  assert.equal(fourth.decisions.length, 0);
});

test("the window rolls: the oldest mid drops at `lookback`", () => {
  const { streams, finalState } = drive([
    viewAt("4797.75", "4798.25", AT[0]!), // 4798
    viewAt("4798.75", "4799.25", AT[1]!), // 4799
    viewAt("4799.75", "4800.25", AT[2]!), // 4800
    viewAt("4800.75", "4801.25", AT[3]!), // 4801 — window drops 4798
  ]);
  void streams;
  const window = (finalState as { window: readonly string[] }).window;
  assert.deepEqual(window, ["4799", "4800", "4801"]);
});

test("no own-positions in the view ⇒ no proposal (the position is unknown, not guessed)", () => {
  const view = observedView({
    quotes: [quote("4799.75", "4800.25", AT[0]!)],
    ownPositions: undefined,
  });
  const first = SUBSTRATE.decide({ view, state: SUBSTRATE.initialState });
  assert.equal(first.ok, true);
  const second = SUBSTRATE.decide({
    view: observedView({
      quotes: [quote("4799.75", "4800.25", AT[1]!)],
      ownPositions: undefined,
      asOf: AT[1] as never,
    }),
    state: first.ok ? first.state : undefined,
  });
  assert.equal(second.ok, true);
  const third = SUBSTRATE.decide({
    view: observedView({
      quotes: [quote("4803.75", "4804.25", AT[2]!)], // clear up
      ownPositions: undefined,
      asOf: AT[2] as never,
    }),
    state: second.ok ? second.state : undefined,
  });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.stream.decisions.length, 0);
  // the window still advanced (observations happen even without positions)
  const window = (third.state as { window: readonly string[] }).window;
  assert.deepEqual(window, ["4800", "4800", "4804"]);
});

test("A9: the same view sequence from the same seed reproduces the same streams", () => {
  const views = [
    viewAt("4797.75", "4798.25", AT[0]!),
    viewAt("4799.75", "4800.25", AT[1]!),
    viewAt("4803.75", "4804.25", AT[2]!),
  ];
  const first = drive(views);
  const second = drive(views);
  assert.deepEqual(first, second);
});
