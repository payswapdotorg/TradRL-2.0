/**
 * The carried-statistics surface (W051) — deterministic projections of the
 * record: counts, the selection funnel, redundancy — never invented, and
 * refused over malformed records (fail-closed).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import { searchOverfitStatisticsOf } from "../index.js";
import { MINUTE, T0, TRIAL_A, aHistory, tamperedEarlyView } from "./fixtures.js";

describe("the carried statistics of the canonical fixture record", () => {
  it("counts the trials, the funnel, and the redundancy from the record", () => {
    const outcome = searchOverfitStatisticsOf(aHistory());
    if (!outcome.ok) {
      assert.fail(`the fixture record must project: ${outcome.errors[0]?.message}`);
    }
    const statistics = outcome.statistics;
    assert.equal(statistics.trialCount, 3);
    assert.equal(statistics.selectionCount, 2);
    assert.equal(statistics.selectedTrialCount, 2);
    assert.equal(statistics.evidenceCitedTrialCount, 3);
    assert.deepEqual(
      statistics.funnel.map((stage) => [stage.stage, stage.count]),
      [
        ["trials", 3],
        ["evidence-cited", 3],
        ["selected", 2],
      ],
    );
    assert.ok(Math.abs(statistics.selectionRatio - 2 / 3) < 1e-12);
    assert.ok(Math.abs(statistics.trialsPerSelection! - 1.5) < 1e-12);
    assert.deepEqual(
      [
        statistics.redundancy.distinctCandidates,
        statistics.redundancy.duplicateCandidates,
        statistics.redundancy.distinctViews,
        statistics.redundancy.duplicateViews,
        statistics.redundancy.distinctOutcomes,
        statistics.redundancy.duplicateOutcomes,
      ],
      [3, 0, 2, 1, 3, 0],
    );
    assert.equal(statistics.historyId.startsWith("search-"), true);
    assert.ok(statistics.digest.length > 0);
  });

  it("projects a selection-free record with a null trials-per-selection", () => {
    const outcome = searchOverfitStatisticsOf(aHistory([TRIAL_A], []));
    if (!outcome.ok) {
      assert.fail(`the selection-free record must project: ${outcome.errors[0]?.message}`);
    }
    assert.equal(outcome.statistics.selectionCount, 0);
    assert.equal(outcome.statistics.selectedTrialCount, 0);
    assert.equal(outcome.statistics.trialsPerSelection, null);
    assert.equal(outcome.statistics.selectionRatio, 0);
    assert.deepEqual(
      outcome.statistics.funnel.map((stage) => stage.count),
      [1, 0, 0],
    );
  });
});

describe("the statistics' fail-closed seam", () => {
  it("refuses to project a tampered record (statistics over malformed data are not data)", () => {
    const history = aHistory();
    const tampered = {
      ...history,
      trials: [{ ...TRIAL_A, view: tamperedEarlyView(T0 + 9 * MINUTE) }],
    } as typeof history;
    const outcome = searchOverfitStatisticsOf(tampered);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.ok(outcome.errors.some((error) => error.code === "invalid-view"));
    }
  });

  it("refuses a non-record value without throwing", () => {
    const outcome = searchOverfitStatisticsOf("nope" as never);
    assert.equal(outcome.ok, false);
  });
});

describe("the statistics' determinism (A9)", () => {
  it("projects the same record twice to deep-equal statistics with the same digest", () => {
    const first = searchOverfitStatisticsOf(aHistory());
    const second = searchOverfitStatisticsOf(aHistory());
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.statistics),
        canonicalString(second.statistics),
      );
      assert.equal(first.statistics.digest, second.statistics.digest);
    }
  });
});
