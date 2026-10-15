/**
 * The walk-forward generator's laws (W052) — the rolling window sequence:
 * every boundary an explicit W004 timestamp, the sealed W050 cutoff per
 * fold (R016), disjoint + covering tiling, and every refusal law pinned.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import { isLegalCutoff } from "tradrl-time-machine";
import { generateWalkForward } from "../index.js";
import type { WalkForwardWindowPolicy } from "../index.js";
import { DAY, WF_FROM, WF_TO, WF_TRAIN, WF_EVAL, codes } from "./fixtures.js";

const POLICY: WalkForwardWindowPolicy = {
  axisId: "axis-wf",
  trainWindowMs: WF_TRAIN,
  evaluationWindowMs: WF_EVAL,
};

const RANGE = { from: WF_FROM, to: WF_TO };

describe("the walk-forward happy path", () => {
  it("rolls the exact fold sequence over the clean ten-day range", () => {
    const outcome = generateWalkForward(RANGE, POLICY);
    assert.ok(outcome.ok);
    const { folds, splits } = outcome.generation;
    assert.equal(folds.length, 8);
    assert.equal(splits.length, 8);

    const fold0 = folds[0]!;
    assert.deepEqual(fold0.train, { kind: "period", from: WF_FROM, to: (WF_FROM + 2 * DAY - 1) });
    assert.deepEqual(fold0.evaluation, {
      kind: "period",
      from: (WF_FROM + 2 * DAY) as typeof WF_FROM,
      to: (WF_FROM + 3 * DAY - 1) as typeof WF_FROM,
    });
    assert.equal(fold0.foldIndex, 0);
    assert.equal(fold0.axisId, "axis-wf-fold-0");

    const fold1 = folds[1]!;
    assert.deepEqual(fold1.train, {
      kind: "period",
      from: (WF_FROM + DAY) as typeof WF_FROM,
      to: (WF_FROM + 3 * DAY - 1) as typeof WF_FROM,
    });
    assert.deepEqual(fold1.evaluation, {
      kind: "period",
      from: (WF_FROM + 3 * DAY) as typeof WF_FROM,
      to: (WF_FROM + 4 * DAY - 1) as typeof WF_FROM,
    });

    const fold7 = folds[7]!;
    assert.deepEqual(fold7.train, {
      kind: "period",
      from: (WF_FROM + 7 * DAY) as typeof WF_FROM,
      to: (WF_FROM + 9 * DAY - 1) as typeof WF_FROM,
    });
    assert.deepEqual(fold7.evaluation, {
      kind: "period",
      from: (WF_FROM + 9 * DAY) as typeof WF_FROM,
      to: WF_TO,
    });
  });

  it("seals every fold's cutoff at its train side's end (the R016 seam)", () => {
    const outcome = generateWalkForward(RANGE, POLICY);
    assert.ok(outcome.ok);
    for (const fold of outcome.generation.folds) {
      assert.equal(Number(fold.cutoff), Number(fold.train.to));
      assert.ok(isLegalCutoff(Number(fold.cutoff)));
      // The leak-proof direction: every evaluation-side instant is
      // post-cutoff, every train-side instant at-or-below it.
      assert.ok(Number(fold.train.from) <= Number(fold.cutoff));
      assert.ok(Number(fold.evaluation.from) > Number(fold.cutoff));
    }
  });

  it("derives one W037-shaped split descriptor per fold", () => {
    const outcome = generateWalkForward(RANGE, POLICY);
    assert.ok(outcome.ok);
    const { folds, splits } = outcome.generation;
    splits.forEach((split, index) => {
      assert.equal(split.kind, "walk-forward");
      assert.equal(split.axisId, folds[index]!.axisId);
      assert.deepEqual(split.train, [folds[index]!.train]);
      assert.deepEqual(split.evaluation, [folds[index]!.evaluation]);
    });
  });

  it("tiles the evaluation span disjointly and covers the whole range", () => {
    const outcome = generateWalkForward(RANGE, POLICY);
    assert.ok(outcome.ok);
    const { folds } = outcome.generation;
    assert.equal(Number(folds[0]!.train.from), Number(WF_FROM));
    for (let index = 1; index < folds.length; index += 1) {
      assert.equal(
        Number(folds[index]!.evaluation.from),
        Number(folds[index - 1]!.evaluation.to) + 1,
      );
    }
    assert.equal(Number(folds[folds.length - 1]!.evaluation.to), Number(WF_TO));
  });

  it("clips the final evaluation window to the range's end", () => {
    const to = (WF_FROM + 10 * DAY - 301) as typeof WF_FROM;
    const outcome = generateWalkForward({ from: WF_FROM, to }, POLICY);
    assert.ok(outcome.ok);
    const { folds } = outcome.generation;
    assert.equal(folds.length, 8);
    assert.equal(Number(folds[7]!.evaluation.to), Number(to));
    assert.equal(Number(folds[7]!.evaluation.from), WF_FROM + 9 * DAY);
  });

  it("rolls a single one-millisecond evaluation window on the minimal range", () => {
    const to = (WF_FROM + WF_TRAIN) as typeof WF_FROM;
    const outcome = generateWalkForward({ from: WF_FROM, to }, POLICY);
    assert.ok(outcome.ok);
    assert.equal(outcome.generation.folds.length, 1);
    const fold = outcome.generation.folds[0]!;
    assert.equal(Number(fold.evaluation.from), WF_FROM + WF_TRAIN);
    assert.equal(Number(fold.evaluation.to), WF_FROM + WF_TRAIN);
  });
});

describe("the walk-forward A9 twin (determinism)", () => {
  it("re-rolls the deep-equal sequence from the same range + policy", () => {
    const left = generateWalkForward(RANGE, POLICY);
    const right = generateWalkForward(
      { from: WF_FROM, to: WF_TO },
      { axisId: "axis-wf", trainWindowMs: WF_TRAIN, evaluationWindowMs: WF_EVAL },
    );
    assert.ok(left.ok && right.ok);
    assert.equal(canonicalString(left.generation), canonicalString(right.generation));
  });
});

describe("the walk-forward refusal laws", () => {
  it("refuses a blank axis id", () => {
    const outcome = generateWalkForward(RANGE, { ...POLICY, axisId: "" });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["blank-family-axis"]);
  });

  it("refuses non-positive-integer window policies", () => {
    for (const [trainWindowMs, evaluationWindowMs] of [
      [0, WF_EVAL],
      [WF_TRAIN, -1],
      [WF_TRAIN, 0.5],
      [Number.NaN, WF_EVAL],
    ] as const) {
      const outcome = generateWalkForward(RANGE, { ...POLICY, trainWindowMs, evaluationWindowMs });
      assert.ok(!outcome.ok, `${String(trainWindowMs)}/${String(evaluationWindowMs)} must refuse`);
      assert.deepEqual(codes(outcome), ["invalid-window-policy"]);
    }
  });

  it("refuses malformed ranges (the W004/W037 period law)", () => {
    const inverted = generateWalkForward({ from: WF_TO, to: WF_FROM }, POLICY);
    assert.ok(!inverted.ok);
    assert.deepEqual(codes(inverted), ["invalid-range"]);
    const nonFinite = generateWalkForward(
      { from: Number.POSITIVE_INFINITY as typeof WF_FROM, to: WF_TO },
      POLICY,
    );
    assert.ok(!nonFinite.ok);
    assert.deepEqual(codes(nonFinite), ["invalid-range"]);
  });

  it("refuses range instants that are not cutoff-grade (sealed W050 cutoffs)", () => {
    const outcome = generateWalkForward({ from: -1 as typeof WF_FROM, to: WF_TO }, POLICY);
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["invalid-range"]);
    assert.match(outcome.errors[0]!.message, /cutoff/);
  });

  it("refuses a range too short to roll one evaluation window", () => {
    const outcome = generateWalkForward(
      { from: WF_FROM, to: (WF_FROM + WF_TRAIN - 1) as typeof WF_FROM },
      POLICY,
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["range-too-short"]);
  });
});
