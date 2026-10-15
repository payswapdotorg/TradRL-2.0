/**
 * The summary-law tests (W038): the carried outcome summary + the holdout
 * membership derivation (data comparison, never statistics).
 *
 * Run: cd packages/evaluation && ../../../node_modules/.bin/tsx --test test/*.test.ts
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holdoutMembershipOf,
  holdoutSplitAggregationOf,
  trajectoryOutcomeSummaryOf,
} from "../summary.js";
import {
  PERIOD_EVAL,
  PERIOD_TRAIN,
  SPLIT_H1,
  SPLIT_H2,
  recordOf,
} from "./fixtures.js";
import type { HoldoutSplitDescriptor } from "experiments";

test("the outcome summary is CARRIED from the record's own evaluation (never re-scored)", () => {
  const record = recordOf({ sessionId: "session-1", instants: [100, 200] });
  const summary = trajectoryOutcomeSummaryOf(record);
  assert.equal(summary.trajectoryId, record.trajectoryId);
  assert.equal(summary.policyId, record.evaluation.policyId);
  assert.equal(summary.combinedScore, record.evaluation.combinedScore);
  assert.equal(summary.appliedSoftPenaltyTotal, record.evaluation.appliedSoftPenaltyTotal);
  assert.equal(summary.hardViolationCount, record.evaluation.constraints.hardViolationCount);
  assert.equal(summary.compliance, record.evaluation.compliance);
  // §13: the compliance dimension ALWAYS rides along — never a bare P&L.
  assert.ok(summary.compliance === "compliant" || summary.compliance === "non-compliant");
});

test("period membership: all instants in train atoms → train side", () => {
  const record = recordOf({ sessionId: "session-1", instants: [100, 200] });
  const membership = holdoutMembershipOf(record, SPLIT_H1);
  assert.deepEqual(membership, { derivation: "period-instants", assignment: "train" });
});

test("period membership: all instants in evaluation atoms → evaluation side", () => {
  const record = recordOf({ sessionId: "session-1", instants: [1100, 1500] });
  const membership = holdoutMembershipOf(record, SPLIT_H1);
  assert.deepEqual(membership, { derivation: "period-instants", assignment: "evaluation" });
});

test("period membership: mixed sides → unassigned (contamination surfaced, never resolved)", () => {
  const record = recordOf({ sessionId: "session-1", instants: [100, 1500] });
  assert.deepEqual(holdoutMembershipOf(record, SPLIT_H1), {
    derivation: "period-instants",
    assignment: "unassigned",
  });
});

test("period membership: an instant outside both atoms → unassigned", () => {
  const record = recordOf({ sessionId: "session-1", instants: [1100, 3000] });
  assert.equal(holdoutMembershipOf(record, SPLIT_H1).assignment, "unassigned");
});

test("period membership: an instant on BOTH sides → unassigned (never silently picked)", () => {
  const bothSides: HoldoutSplitDescriptor = {
    axisId: "h-1",
    kind: "unseen-period",
    train: [PERIOD_TRAIN],
    // Overlapping interval atoms are disjoint DATA (different atoms) — the
    // manifest gate admits them; the derivation must surface instant 500.
    evaluation: [{ kind: "period" as const, from: 500 as never, to: 1500 as never }],
  };
  const record = recordOf({ sessionId: "session-1", instants: [500] });
  assert.equal(holdoutMembershipOf(record, bothSides).assignment, "unassigned");
});

test("asset membership: touched instrument on the evaluation side → evaluation", () => {
  const assetSplit: HoldoutSplitDescriptor = {
    axisId: "h-3",
    kind: "asset",
    train: [{ kind: "asset", instrumentId: "ins-EQ0" as never }],
    evaluation: [{ kind: "asset", instrumentId: "ins-EQ1" as never }],
  };
  const record = recordOf({
    sessionId: "session-1",
    instants: [100, 200],
    orderKind: "market",
    instrumentId: "ins-EQ1",
  });
  assert.deepEqual(holdoutMembershipOf(record, assetSplit), {
    derivation: "asset-instruments",
    assignment: "evaluation",
  });
});

test("asset membership: no touched instruments → unassigned (nothing derived from nothing)", () => {
  const assetSplit: HoldoutSplitDescriptor = {
    axisId: "h-3",
    kind: "asset",
    train: [{ kind: "asset", instrumentId: "ins-EQ0" as never }],
    evaluation: [{ kind: "asset", instrumentId: "ins-EQ1" as never }],
  };
  const record = recordOf({ sessionId: "session-1", instants: [100, 200] });
  assert.deepEqual(holdoutMembershipOf(record, assetSplit), {
    derivation: "asset-instruments",
    assignment: "unassigned",
  });
});

test("regime/venue kinds are typed not-derivable — membership is never fabricated", () => {
  const record = recordOf({ sessionId: "session-1", instants: [100, 200] });
  assert.deepEqual(holdoutMembershipOf(record, SPLIT_H2), {
    derivation: "not-derivable",
    assignment: "unassigned",
  });
  const regimeSplit: HoldoutSplitDescriptor = {
    axisId: "h-4",
    kind: "regime",
    train: [{ kind: "regime", regimeId: "calm" }],
    evaluation: [{ kind: "regime", regimeId: "stressed" }],
  };
  assert.deepEqual(holdoutMembershipOf(record, regimeSplit), {
    derivation: "not-derivable",
    assignment: "unassigned",
  });
});

test("the aggregation groups carried summaries per side, canonical id order, split verbatim", () => {
  const trainRecord = recordOf({ sessionId: "session-1", instants: [100, 200] });
  const evaluationRecord = recordOf({ sessionId: "session-2", instants: [1100, 1500] });
  const straddling = recordOf({ sessionId: "session-0", instants: [100, 1500] });
  const aggregation = holdoutSplitAggregationOf(SPLIT_H1, [
    straddling,
    evaluationRecord,
    trainRecord,
  ]);
  assert.equal(aggregation.axisId, "h-1");
  assert.equal(aggregation.kind, "unseen-period");
  assert.equal(aggregation.derivation, "period-instants");
  assert.deepEqual(aggregation.split, SPLIT_H1);
  assert.deepEqual(
    aggregation.train.map((summary) => String(summary.trajectoryId)),
    [String(trainRecord.trajectoryId)],
  );
  assert.deepEqual(
    aggregation.evaluation.map((summary) => String(summary.trajectoryId)),
    [String(evaluationRecord.trajectoryId)],
  );
  assert.deepEqual(
    aggregation.unassigned.map((summary) => String(summary.trajectoryId)),
    [String(straddling.trajectoryId)],
  );
  // The summaries are CARRIED (the same values the records own).
  assert.equal(aggregation.train[0]?.combinedScore, trainRecord.evaluation.combinedScore);
});

test("PERIOD_TRAIN/PERIOD_EVAL atoms are disjoint declared data", () => {
  assert.notDeepEqual(PERIOD_TRAIN, PERIOD_EVAL);
  assert.equal(PERIOD_TRAIN.kind, "period");
  assert.equal(PERIOD_EVAL.kind, "period");
});
