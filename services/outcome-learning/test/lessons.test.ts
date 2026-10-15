/**
 * The lesson derivation laws (W053) — the closed failure-mode taxonomy,
 * the carried statistics, the A6 evidence citation law, the A9 twin, and
 * the loud refusal over a broken post-mortem.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveLessons } from "../index.js";
import { FAILURE_MODES, LESSON_ID_PREFIX, LESSON_KINDS } from "../index.js";
import type { Lesson, PostMortem } from "../index.js";
import { aHardOutcome, aLessonSet, aPostMortem, codes } from "./fixtures.js";

const failureModesOf = (lessons: readonly Lesson[]): string[] =>
  lessons
    .filter((lesson) => lesson.failureMode !== undefined)
    .map((lesson) => String(lesson.failureMode));

describe("deriveLessons — the typed derivation", () => {
  it("derives a lawful lesson set over the carried post-mortem (A6: every lesson cites evidence)", () => {
    const postMortem = aPostMortem();
    const derived = deriveLessons(postMortem);
    assert.equal(derived.ok, true);
    if (!derived.ok) {
      return;
    }
    const set = derived.lessons;
    assert.equal(set.postMortemId, postMortem.postMortemId);
    assert.ok(set.lessons.length > 0);
    for (const lesson of set.lessons) {
      assert.ok(String(lesson.lessonId).startsWith(LESSON_ID_PREFIX));
      assert.ok(LESSON_KINDS.includes(lesson.kind));
      assert.ok(lesson.evidence.length > 0);
      assert.equal(lesson.postMortemId, postMortem.postMortemId);
      assert.ok(lesson.statement.length > 0);
      for (const line of lesson.evidence) {
        assert.ok(line.length > 0);
      }
    }
    for (const mode of failureModesOf(set.lessons)) {
      assert.ok(FAILURE_MODES.includes(mode as never));
    }
  });

  it("keeps the lessons in canonical lesson-id order (declaration order never leaks, A9)", () => {
    const set = aLessonSet();
    const ids = set.lessons.map((lesson) => String(lesson.lessonId));
    assert.deepEqual(
      ids,
      [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    assert.equal(new Set(ids).size, ids.length);
  });

  it("derives one capability-delta lesson per judged axis, citing the carried sides", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const deltas = set.lessons.filter((lesson) => lesson.kind === "capability-delta");
    assert.equal(deltas.length, postMortem.comparison.splits.length);
    for (const lesson of deltas) {
      assert.ok(lesson.axisId !== undefined);
      assert.ok(lesson.evidence.some((line) => line.includes(String(postMortem.evaluation.evaluationId))));
      assert.ok(lesson.evidence.some((line) => line.includes("carried statistics")));
    }
  });

  it("derives divergence signals whose direction matches the carried statistics", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const signals = set.lessons.filter((lesson) => lesson.kind === "divergence-signal");
    const comparable = postMortem.comparison.splits.filter(
      (split) => split.predicted.length > 0 && split.happened.length > 0,
    );
    assert.equal(signals.length, comparable.length);
    for (const lesson of signals) {
      const split = postMortem.comparison.splits.find((entry) => entry.axisId === lesson.axisId);
      assert.ok(split !== undefined);
      const trainMean =
        split.predicted.reduce((total, summary) => total + summary.combinedScore, 0) / split.predicted.length;
      const heldoutMean =
        split.happened.reduce((total, summary) => total + summary.combinedScore, 0) / split.happened.length;
      const expected = heldoutMean < trainMean ? "degraded" : heldoutMean > trainMean ? "improved" : "flat";
      assert.ok(lesson.statement.includes(expected));
    }
  });

  it("derives the selection-pressure failure mode from the history's carried counts", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    assert.ok(failureModesOf(set.lessons).includes("selection-pressure"));
    const pressure = set.lessons.find((lesson) => lesson.failureMode === "selection-pressure");
    assert.ok(pressure !== undefined);
    assert.ok(pressure.evidence.some((line) => line.includes(String(postMortem.history.historyId))));
  });

  it("derives unassigned-membership lessons only where the evaluation surfaced unassigned records", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const unassignedAxes = postMortem.comparison.splits
      .filter((split) => split.unassigned.length > 0)
      .map((split) => split.axisId);
    const lessonAxes = set.lessons
      .filter((lesson) => lesson.failureMode === "unassigned-membership")
      .map((lesson) => lesson.axisId);
    assert.deepEqual([...lessonAxes].sort(), [...unassignedAxes].sort());
  });

  it("derives the constraint-violation failure mode over the hard bundle's happened side", () => {
    const hard = aPostMortem(aHardOutcome());
    const derived = deriveLessons(hard);
    assert.equal(derived.ok, true);
    if (!derived.ok) {
      return;
    }
    const violations = derived.lessons.lessons.filter(
      (lesson) => lesson.failureMode === "constraint-violation",
    );
    assert.ok(violations.length > 0);
    for (const lesson of violations) {
      const split = hard.comparison.splits.find((entry) => entry.axisId === lesson.axisId);
      assert.ok(split !== undefined);
      const offenders = split.happened.filter(
        (summary) => summary.hardViolationCount > 0 || summary.compliance !== "compliant",
      );
      assert.equal(offenders.length > 0, true);
      for (const offender of offenders) {
        assert.ok(
          lesson.evidence.some((line) => line.includes(String(offender.trajectoryId))),
          "every offender is cited by name (A6)",
        );
      }
    }
  });

  it("A9 twin: same post-mortem ⇒ deep-equal lesson set, same digest", () => {
    const postMortem = aPostMortem();
    const first = deriveLessons(postMortem);
    const second = deriveLessons(postMortem);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.deepEqual(first.lessons, second.lessons);
    }
  });

  it("refuses loudly over a post-mortem that fails whole-record re-validation (A6/R052)", () => {
    const lawful = aPostMortem();
    const broken = {
      ...lawful,
      comparison: { ...lawful.comparison, splits: [...lawful.comparison.splits].reverse() },
    } as PostMortem;
    const derived = deriveLessons(broken);
    assert.deepEqual(codes(derived), ["invalid-post-mortem"]);
    if (!derived.ok) {
      assert.ok(derived.errors[0]!.message.includes("A6"));
      assert.ok(derived.errors[0]!.message.includes("R052"));
    }
  });
});
