/**
 * The walker-law tests (W038): the deterministic experiment evaluation, the
 * compliance dimension, the A9 twin, and every fail-closed gate.
 *
 * Run: cd packages/evaluation && ../../../node_modules/.bin/tsx --test test/*.test.ts
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExperiment, EXPERIMENT_EVALUATION_ID_PREFIX } from "../walker.js";
import type { TrajectoryRecord } from "trajectory";
import type { ExperimentManifest } from "experiments";
import {
  fixtureBundle,
  hardFixtureBundle,
  recordOf,
} from "./fixtures.js";

test("the happy-path walk: typed, ordered, compliance-carrying, content-addressed", () => {
  const bundle = fixtureBundle();
  const outcome = evaluateExperiment(bundle);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const evaluation = outcome.evaluation;
  assert.ok(evaluation.evaluationId.startsWith(EXPERIMENT_EVALUATION_ID_PREFIX));
  assert.equal(evaluation.experimentId, bundle.manifest.experimentId);
  assert.equal(evaluation.policyId, "pol-fixture");
  assert.equal(evaluation.trajectories.length, 3);
  // Canonical trajectory-id order.
  const ids = evaluation.trajectories.map((summary) => String(summary.trajectoryId));
  assert.deepEqual([...ids].sort((a, b) => a.localeCompare(b)), ids);
  // Canonical split order: unseen-period (h-1) before venue (h-2).
  assert.deepEqual(
    evaluation.holdoutSplits.map((aggregation) => aggregation.axisId),
    ["h-1", "h-2"],
  );
  // Integrity carried verbatim.
  assert.deepEqual(evaluation.integrity, ["evidence-chain", "deterministic-replay"]);
  // §13: the compliance dimension is present, never a bare P&L.
  assert.equal(evaluation.reduction.compliance, "compliant");
  assert.equal(evaluation.reduction.trajectoryCount, 3);
  assert.equal(evaluation.reduction.hardViolationCount, 0);
});

test("A9 twin: same manifest + records + policy → deep-equal evaluation, same id", () => {
  const bundle = fixtureBundle();
  const first = evaluateExperiment(bundle);
  const second = evaluateExperiment(fixtureBundle());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.deepEqual(first.evaluation, second.evaluation);
  assert.equal(first.evaluation.evaluationId, second.evaluation.evaluationId);
});

test("A9 input-order invariance: permuted record input → identical evaluation", () => {
  const bundle = fixtureBundle();
  const straight = evaluateExperiment(bundle);
  const permuted = evaluateExperiment({
    ...bundle,
    records: [...bundle.records].reverse(),
  });
  assert.equal(straight.ok, true);
  assert.equal(permuted.ok, true);
  if (!straight.ok || !permuted.ok) {
    return;
  }
  assert.equal(straight.evaluation.evaluationId, permuted.evaluation.evaluationId);
  assert.deepEqual(straight.evaluation, permuted.evaluation);
});

test("the split aggregation: train/evaluation sides by data, venue not-derivable", () => {
  const bundle = fixtureBundle();
  const outcome = evaluateExperiment(bundle);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const period = outcome.evaluation.holdoutSplits[0];
  const venue = outcome.evaluation.holdoutSplits[1];
  assert.equal(period?.derivation, "period-instants");
  // session-1 and session-3 ran at instants 100/200 (train); session-2 at 1100/1500.
  assert.equal(period?.train.length, 2);
  assert.equal(period?.evaluation.length, 1);
  assert.equal(venue?.derivation, "not-derivable");
  assert.equal(venue?.unassigned.length, 3);
});

test("the soft-penalty fold: a command under a zero turnover budget prices into the reduction", () => {
  const bundle = fixtureBundle();
  const outcome = evaluateExperiment(bundle);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  // session-3 issued one command; tb-1 (maxCommandsPerView 0) is penalized.
  assert.ok(outcome.evaluation.reduction.appliedSoftPenaltyTotal > 0);
  const penalized = outcome.evaluation.trajectories.find(
    (summary) => summary.appliedSoftPenaltyTotal > 0,
  );
  assert.ok(penalized !== undefined);
});

test("the ranking: tied evaluations fall to the canonical id tiebreak; a permutation of all ids", () => {
  const bundle = fixtureBundle();
  const outcome = evaluateExperiment(bundle);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const ranking = outcome.evaluation.reduction.ranking.map((id) => String(id));
  assert.equal(ranking.length, 3);
  const ids = bundle.records.map((record) => String(record.trajectoryId));
  assert.deepEqual([...ranking].sort((a, b) => a.localeCompare(b)), [...ids].sort((a, b) => a.localeCompare(b)));
  // session-1 and session-2 evaluate identically → canonical id order between them.
  const session1 = bundle.records.find((record) => record.scope.sessionId === "session-1");
  const session2 = bundle.records.find((record) => record.scope.sessionId === "session-2");
  if (session1 !== undefined && session2 !== undefined) {
    const first = ranking.indexOf(String(session1.trajectoryId));
    const second = ranking.indexOf(String(session2.trajectoryId));
    assert.ok(first >= 0 && second >= 0);
    assert.ok(Math.abs(first - second) === 1);
  }
});

test("the compliance GATE: one hard-violating trajectory makes the experiment non-compliant", () => {
  const bundle = hardFixtureBundle();
  const outcome = evaluateExperiment(bundle);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const evaluation = outcome.evaluation;
  assert.equal(evaluation.reduction.compliance, "non-compliant");
  assert.ok(evaluation.reduction.hardViolationCount >= 1);
  // The dimension rides on every summary too (§13: never a bare P&L).
  assert.ok(evaluation.trajectories.every((summary) => summary.compliance === "non-compliant"));
});

// --- the fail-closed gates -----------------------------------------------------

function rewalk(bundle: ReturnType<typeof fixtureBundle>, records: readonly TrajectoryRecord[]) {
  return evaluateExperiment({ ...bundle, records });
}

test("fail-closed: no records → empty-records", () => {
  const bundle = fixtureBundle();
  const outcome = rewalk(bundle, []);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "empty-records"));
  // Every member is also missing — both laws surface, nothing silently skips.
  assert.ok(outcome.errors.some((error) => error.code === "missing-record"));
});

test("fail-closed: a record that is not a manifest member → unknown-record", () => {
  const bundle = fixtureBundle();
  const stranger = recordOf({ sessionId: "session-9", instants: [100, 200] });
  const outcome = rewalk(bundle, [...bundle.records, stranger]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "unknown-record"));
});

test("fail-closed: a duplicate record → duplicate-record", () => {
  const bundle = fixtureBundle();
  const outcome = rewalk(bundle, [bundle.records[0] as TrajectoryRecord, bundle.records[0] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "duplicate-record"));
});

test("fail-closed: a scope disagreement → record-scope-mismatch", () => {
  const bundle = fixtureBundle();
  const drifted: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    scope: { ...(bundle.records[0] as TrajectoryRecord).scope, sessionId: "session-other" },
  };
  const outcome = rewalk(bundle, [drifted, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "record-scope-mismatch"));
});

test("fail-closed: a stream-world disagreement → world-mismatch", () => {
  const bundle = fixtureBundle();
  const drifted: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    stream: { ...(bundle.records[0] as TrajectoryRecord).stream, worldId: "world-beta" },
  };
  const outcome = rewalk(bundle, [drifted, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "world-mismatch"));
});

test("fail-closed: a world-digest disagreement → world-digest-mismatch", () => {
  const bundle = fixtureBundle();
  const drifted: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    determinism: { ...(bundle.records[0] as TrajectoryRecord).determinism, worldDefinitionDigest: "other-digest" },
  };
  const outcome = rewalk(bundle, [drifted, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "world-digest-mismatch"));
});

test("fail-closed: a record evaluated under another policy → policy-id-mismatch", () => {
  const bundle = fixtureBundle();
  const drifted: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    evaluation: { ...(bundle.records[0] as TrajectoryRecord).evaluation, policyId: "pol-other" },
  };
  const outcome = rewalk(bundle, [drifted, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "policy-id-mismatch"));
});

test("fail-closed: a malformed record → malformed-record with the W037 errors carried verbatim", () => {
  const bundle = fixtureBundle();
  const malformed: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    session: { ...(bundle.records[0] as TrajectoryRecord).session, status: "attached" as never },
  };
  const outcome = rewalk(bundle, [malformed, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const error = outcome.errors.find((entry) => entry.code === "malformed-record");
  assert.ok(error !== undefined);
  assert.ok((error?.recordErrors ?? []).some((carried) => carried.code === "non-terminal-session"));
});

test("fail-closed: a broken integrity carry-forward → integrity-carry-mismatch", () => {
  const bundle = fixtureBundle();
  const broken: ExperimentManifest = { ...bundle.manifest, integrity: ["evidence-chain"] };
  const outcome = evaluateExperiment({ ...bundle, manifest: broken });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "integrity-carry-mismatch"));
});

test("fail-closed: an unknown holdout kind → unknown-holdout-kind", () => {
  const bundle = fixtureBundle();
  const poisoned: ExperimentManifest = {
    ...bundle.manifest,
    holdoutSplits: [
      ...bundle.manifest.holdoutSplits,
      { axisId: "h-9", kind: "bogus" as never, train: [], evaluation: [] },
    ],
  };
  const outcome = evaluateExperiment({ ...bundle, manifest: poisoned });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "unknown-holdout-kind"));
});

test("fail-closed: a split naming an undeclared axis → unknown-holdout-axis", () => {
  const bundle = fixtureBundle();
  const poisoned: ExperimentManifest = {
    ...bundle.manifest,
    holdoutSplits: [
      ...bundle.manifest.holdoutSplits,
      {
        axisId: "h-9",
        kind: "venue",
        train: [{ kind: "venue", venueId: "a" }],
        evaluation: [{ kind: "venue", venueId: "b" }],
      },
    ],
  };
  const outcome = evaluateExperiment({ ...bundle, manifest: poisoned });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "unknown-holdout-axis"));
});

test("fail-closed: a split that re-kinds its axis → split-kind-mismatch", () => {
  const bundle = fixtureBundle();
  const poisoned: ExperimentManifest = {
    ...bundle.manifest,
    holdoutSplits: bundle.manifest.holdoutSplits.map((split) =>
      split.axisId === "h-1" ? { ...split, kind: "walk-forward" as never } : split,
    ),
  };
  const outcome = evaluateExperiment({ ...bundle, manifest: poisoned });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "split-kind-mismatch"));
});

test("fail-closed: a non-finite fold total → reduction-overflow (never a silent clamp)", () => {
  const bundle = fixtureBundle();
  const overflowed: TrajectoryRecord = {
    ...(bundle.records[0] as TrajectoryRecord),
    evaluation: { ...(bundle.records[0] as TrajectoryRecord).evaluation, combinedScore: Number.POSITIVE_INFINITY },
  };
  const outcome = rewalk(bundle, [overflowed, bundle.records[1] as TrajectoryRecord, bundle.records[2] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => error.code === "reduction-overflow"));
});

test("fail-closed: a member without a record → missing-record (no silent skip)", () => {
  const bundle = fixtureBundle();
  const outcome = rewalk(bundle, [bundle.records[0] as TrajectoryRecord]);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const missing = outcome.errors.filter((error) => error.code === "missing-record");
  assert.equal(missing.length, 2);
});
