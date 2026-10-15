/**
 * The whole-record re-validation laws (W053) — the post-mortem and the
 * lesson set re-proven from recorded data: identity re-derivations (A9),
 * canonical orders, lineage/provenance re-proofs, the A9 lesson twin, and
 * the A6 uncited-lesson refusal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLessonSet, validatePostMortem } from "../index.js";
import { postMortemDigestOf } from "../index.js";
import type { Lesson, LessonSet, PostMortem } from "../index.js";
import { aHardOutcome, aLessonSet, aPostMortem, codes } from "./fixtures.js";

describe("validatePostMortem — whole-record re-validation", () => {
  it("accepts the lawful record (the id re-derives from carried bytes, A9)", () => {
    const record = aPostMortem();
    assert.deepEqual(validatePostMortem(record), { ok: true });
    assert.equal(postMortemDigestOf(record), String(record.postMortemId));
  });

  it("refuses a tampered carried byte (the id no longer re-derives)", () => {
    const lawful = aPostMortem();
    const first = lawful.comparison.splits[0];
    assert.ok(first !== undefined);
    const tampered = {
      ...lawful,
      comparison: {
        ...lawful.comparison,
        splits: [
          { ...first, predicted: [{ ...first.predicted[0], combinedScore: 99999 }] },
          ...lawful.comparison.splits.slice(1),
        ],
      },
    } as PostMortem;
    assert.deepEqual(codes(validatePostMortem(tampered)), ["post-mortem-id-mismatch"]);
  });

  it("refuses a comparison out of canonical order", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      comparison: { ...lawful.comparison, splits: [...lawful.comparison.splits].reverse() },
    } as PostMortem;
    const result = codes(validatePostMortem(tampered));
    assert.equal(result[0], "post-mortem-id-mismatch");
    assert.ok(result.slice(1).every((code) => code === "comparison-order"));
  });

  it("refuses an incoherent lineage", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      lineage: { parent: undefined, root: "pm-not-this-one" as never, ordinal: 0 },
    } as PostMortem;
    const validation = validatePostMortem(tampered);
    assert.ok(codes(validation).includes("lineage-break"));
  });

  it("refuses a provenance that does not re-derive", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      provenance: { ...lawful.provenance, inputDigest: "deadbeef" },
    } as PostMortem;
    const validation = validatePostMortem(tampered);
    assert.ok(codes(validation).includes("provenance-mismatch"));
  });

  it("refuses a blank scope member", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      scope: { ...lawful.scope, tenantId: "" },
    } as PostMortem;
    const validation = validatePostMortem(tampered);
    assert.ok(codes(validation).includes("invalid-scope"));
  });

  it("refuses a citation outside its own vocabulary (W038/W052/W051 ids)", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      history: { ...lawful.history, historyId: "not-a-history-id" as never },
    } as PostMortem;
    const validation = validatePostMortem(tampered);
    assert.ok(codes(validation).includes("invalid-citation"));
  });

  it("refuses an incoherent carried reduction", () => {
    const lawful = aPostMortem();
    const tampered = {
      ...lawful,
      comparison: {
        ...lawful.comparison,
        reduction: { ...lawful.comparison.reduction, trajectoryCount: 99 },
      },
    } as PostMortem;
    const validation = validatePostMortem(tampered);
    assert.ok(codes(validation).includes("reduction-incoherent"));
  });

  it("refuses a malformed record", () => {
    assert.deepEqual(codes(validatePostMortem(null as never)), ["malformed-record"]);
  });
});

describe("validateLessonSet — the A9 twin + the A6 citation law", () => {
  it("accepts the lawful set against its own post-mortem", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    assert.deepEqual(validateLessonSet(set, postMortem), { ok: true });
  });

  it("refuses a set answering another post-mortem", () => {
    const set = aLessonSet(aPostMortem(aHardOutcome()));
    const other = aPostMortem();
    const validation = validateLessonSet(set, other);
    const result = codes(validation);
    assert.ok(result.length > 0 && result.every((code) => code === "post-mortem-mismatch"));
  });

  it("refuses a dropped lesson (the set no longer re-derives, A9 twin)", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const tampered = {
      ...set,
      lessons: set.lessons.slice(0, -1),
    } as LessonSet;
    const validation = validateLessonSet(tampered, postMortem);
    assert.ok(codes(validation).includes("lessons-mismatch"));
  });

  it("refuses a tampered lesson statement (the set no longer re-derives)", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const lessons = set.lessons.map((lesson, index) =>
      index === 0 ? ({ ...lesson, statement: "prose never carried" } as Lesson) : lesson,
    );
    const validation = validateLessonSet({ ...set, lessons }, postMortem);
    assert.ok(codes(validation).includes("lessons-mismatch"));
  });

  it("refuses an uncited lesson loudly (A6)", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const lessons = set.lessons.map((lesson, index) =>
      index === 0 ? ({ ...lesson, evidence: [] } as Lesson) : lesson,
    );
    const validation = validateLessonSet({ ...set, lessons } as LessonSet, postMortem);
    const result = codes(validation);
    assert.ok(result.includes("uncited-lesson"));
    if (!validation.ok) {
      const uncited = validation.errors.find((error) => error.code === "uncited-lesson");
      assert.ok(uncited !== undefined && uncited.message.includes("A6"));
    }
  });

  it("refuses lessons out of canonical lesson-id order", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const lessons = [...set.lessons].reverse();
    const validation = validateLessonSet({ ...set, lessons } as LessonSet, postMortem);
    assert.ok(codes(validation).includes("lessons-order"));
  });

  it("refuses a lesson citing another post-mortem", () => {
    const postMortem = aPostMortem();
    const set = aLessonSet(postMortem);
    const lessons = set.lessons.map((lesson, index) =>
      index === 0 ? ({ ...lesson, postMortemId: "pm-elsewhere" as never } as Lesson) : lesson,
    );
    const validation = validateLessonSet({ ...set, lessons } as LessonSet, postMortem);
    assert.ok(codes(validation).includes("post-mortem-mismatch"));
  });

  it("refuses a malformed lesson set", () => {
    assert.deepEqual(codes(validateLessonSet(null as never, aPostMortem())), ["malformed-record"]);
  });
});
