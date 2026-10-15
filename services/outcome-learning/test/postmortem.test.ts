/**
 * The PostMortem gate laws (W053) — pinned over REAL W038/W051/W052
 * records: the seal, the A9 twin, the carry-never-re-score law, and every
 * refusal law.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { derivePostMortem } from "../index.js";
import { POST_MORTEM_ID_PREFIX } from "../index.js";
import type { PostMortemInput } from "../index.js";
import {
  aFamily,
  aForeignExperimentHistory,
  aForeignScopeFamily,
  aHardOutcome,
  aPostMortem,
  aSoftOutcome,
  aStrangerFamily,
  codes,
} from "./fixtures.js";

const inputOf = (outcome = aSoftOutcome()): PostMortemInput => ({
  evaluation: { evaluation: outcome.evaluation, findings: outcome.findings },
  family: outcome.family,
  history: outcome.history,
});

describe("derivePostMortem — the seal", () => {
  it("seals a lawful post-mortem over a REAL completed evaluation", () => {
    const derived = derivePostMortem(inputOf());
    assert.equal(derived.ok, true);
    if (derived.ok) {
      const record = derived.postMortem;
      assert.ok(String(record.postMortemId).startsWith(POST_MORTEM_ID_PREFIX));
      assert.equal(record.evaluation.evaluationId, aSoftOutcome().evaluation.evaluationId);
      assert.equal(record.family.familyId, aFamily().familyId);
      assert.equal(record.lineage.parent, undefined);
      assert.equal(record.lineage.root, record.postMortemId);
      assert.equal(record.lineage.ordinal, 0);
      assert.equal(record.provenance.deriver, "derive-post-mortem");
    }
  });

  it("CARRIES the evaluation's own comparison — never re-scored (R052/A6)", () => {
    const outcome = aSoftOutcome();
    const derived = derivePostMortem(inputOf(outcome));
    assert.equal(derived.ok, true);
    if (!derived.ok) {
      return;
    }
    const comparison = derived.postMortem.comparison;
    // one entry per family-judged split (all 8 walk-forward folds)
    assert.equal(comparison.splits.length, outcome.family.splits.length);
    const axisIds = comparison.splits.map((split) => split.axisId);
    assert.deepEqual(
      axisIds,
      [...axisIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    // the carried reduction IS the evaluation's own reduction, verbatim
    assert.equal(comparison.reduction, outcome.evaluation.reduction);
    // fold 0: session-1 predicted (train), session-2 happened (held-out), session-3 unassigned
    const foldZero = comparison.splits[0]!;
    assert.equal(foldZero.predicted.length, 1);
    assert.equal(foldZero.happened.length, 1);
    assert.equal(foldZero.unassigned.length, 1);
    assert.deepEqual(
      foldZero.predicted.map((summary) => String(summary.trajectoryId)),
      outcome.evaluation.holdoutSplits[0]!.train.map((summary) => String(summary.trajectoryId)),
    );
  });

  it("cites the family through W052's own citation seam + the history counts verbatim", () => {
    const outcome = aSoftOutcome();
    const derived = derivePostMortem(inputOf(outcome));
    if (!derived.ok) {
      assert.fail("expected a lawful post-mortem");
    }
    assert.equal(derived.postMortem.family.familyId, outcome.family.familyId);
    assert.equal(derived.postMortem.family.kind, "walk-forward");
    assert.equal(derived.postMortem.history.historyId, outcome.history.historyId);
    assert.equal(derived.postMortem.history.trialCount, 2);
    assert.equal(derived.postMortem.history.selectionCount, 1);
    assert.equal(derived.postMortem.history.selectedTrialCount, 1);
    assert.equal(derived.postMortem.evaluation.findingsDigest, String(outcome.findings.digest));
  });

  it("seals a continuation with the carried parent/root/ordinal", () => {
    const root = aPostMortem();
    const derived = derivePostMortem({
      ...inputOf(),
      lineage: { parent: root.postMortemId, root: root.lineage.root, ordinal: 1 },
    });
    assert.equal(derived.ok, true);
    if (derived.ok) {
      assert.equal(derived.postMortem.lineage.parent, root.postMortemId);
      assert.equal(derived.postMortem.lineage.root, root.postMortemId);
      assert.equal(derived.postMortem.lineage.ordinal, 1);
    }
  });

  it("seals the hard bundle too (hard violations carried, not repaired)", () => {
    const derived = derivePostMortem(inputOf(aHardOutcome()));
    assert.equal(derived.ok, true);
  });
});

describe("derivePostMortem — the A9 twin", () => {
  it("same evaluation + family + history ⇒ deep-equal post-mortem, same id", () => {
    const outcome = aSoftOutcome();
    const first = derivePostMortem(inputOf(outcome));
    const second = derivePostMortem(inputOf(outcome));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(first.postMortem.postMortemId, second.postMortem.postMortemId);
      assert.deepEqual(first.postMortem, second.postMortem);
    }
  });

  it("any byte of carried outcome content flips the id", () => {
    const outcome = aSoftOutcome();
    const other = aHardOutcome();
    const first = derivePostMortem(inputOf(outcome));
    const second = derivePostMortem(inputOf(other));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.notEqual(first.postMortem.postMortemId, second.postMortem.postMortemId);
    }
  });
});

describe("derivePostMortem — the refusal laws (fail-closed)", () => {
  it("refuses a malformed input loudly", () => {
    assert.deepEqual(codes(derivePostMortem(null as never)), ["malformed-input"]);
    assert.deepEqual(
      codes(derivePostMortem({ family: aFamily(), history: aSoftOutcome().history } as never)),
      ["malformed-input"],
    );
  });

  it("refuses an evaluation whose own id does not re-derive (W038 A9)", () => {
    const outcome = aSoftOutcome();
    const tampered = {
      ...inputOf(outcome),
      evaluation: {
        evaluation: {
          ...outcome.evaluation,
          reduction: { ...outcome.evaluation.reduction, combinedScoreTotal: 12345 },
        },
        findings: outcome.findings,
      },
    };
    assert.deepEqual(codes(derivePostMortem(tampered)), ["invalid-evaluation"]);
  });

  it("refuses findings whose digest does not re-prove through W038's own machinery", () => {
    const outcome = aSoftOutcome();
    const tampered = {
      ...inputOf(outcome),
      evaluation: {
        evaluation: outcome.evaluation,
        findings: { ...outcome.findings, digest: "deadbeef" },
      },
    };
    assert.deepEqual(codes(derivePostMortem(tampered)), ["invalid-findings"]);
  });

  it("refuses findings answering another subject", () => {
    const outcome = aSoftOutcome();
    const tampered = {
      ...inputOf(outcome),
      evaluation: {
        evaluation: outcome.evaluation,
        findings: { ...outcome.findings, subject: "expeval-somewhere-else" },
      },
    };
    const subjectCodes = codes(derivePostMortem(tampered));
    assert.ok(subjectCodes.length > 0 && subjectCodes.every((code) => code === "invalid-findings"));
  });

  it("refuses a family that fails W052's whole-record re-validation (errors carried verbatim)", () => {
    const outcome = aSoftOutcome();
    const brokenFamily = { ...outcome.family, range: { from: 9999, to: 1 } };
    const derived = derivePostMortem({ ...inputOf(outcome), family: brokenFamily as never });
    assert.deepEqual(codes(derived), ["invalid-family"]);
    if (!derived.ok) {
      const error = derived.errors[0]!;
      assert.ok(error.familyErrors !== undefined && error.familyErrors.length > 0);
      assert.ok(error.familyErrors.every((carried) => typeof carried.message === "string"));
    }
  });

  it("refuses a history that fails W051's whole-record re-validation (errors carried verbatim)", () => {
    const outcome = aSoftOutcome();
    const reordered = [...outcome.history.trials].reverse();
    const derived = derivePostMortem({
      ...inputOf(outcome),
      history: { ...outcome.history, trials: reordered } as never,
    });
    assert.deepEqual(codes(derived), ["invalid-history"]);
    if (!derived.ok) {
      const error = derived.errors[0]!;
      assert.ok(error.historyErrors !== undefined && error.historyErrors.length > 0);
    }
  });

  it("refuses a scope disagreement between the family and the history", () => {
    const outcome = aSoftOutcome();
    const derived = derivePostMortem({ ...inputOf(outcome), family: aForeignScopeFamily() });
    assert.deepEqual(codes(derived), ["scope-mismatch"]);
  });

  it("refuses an experiment disagreement between the history and the evaluation", () => {
    const outcome = aSoftOutcome();
    const derived = derivePostMortem({ ...inputOf(outcome), history: aForeignExperimentHistory("exp-somewhere-else") });
    assert.deepEqual(codes(derived), ["experiment-mismatch"]);
  });

  it("refuses a family that did not judge this evaluation", () => {
    const outcome = aSoftOutcome();
    const stranger = aStrangerFamily();
    const derived = derivePostMortem({ ...inputOf(outcome), family: stranger });
    const result = codes(derived);
    assert.ok(result.length === stranger.splits.length && result.every((code) => code === "family-did-not-judge"));
    if (!derived.ok) {
      assert.equal(derived.errors[0]!.entryId, "axis-stranger-fold-0");
    }
  });

  it("refuses lineage breaks (root must cite its own id; continuations carry the chain)", () => {
    const badRoot = derivePostMortem({
      ...inputOf(),
      lineage: { root: "pm-not-this-one" as never, ordinal: 0 },
    });
    assert.deepEqual(codes(badRoot), ["lineage-break"]);
    const badOrdinal = derivePostMortem({
      ...inputOf(),
      lineage: { parent: aPostMortem().postMortemId, root: aPostMortem().postMortemId, ordinal: 0 },
    });
    assert.deepEqual(codes(badOrdinal), ["lineage-break"]);
  });
});
