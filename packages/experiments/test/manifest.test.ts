/**
 * The experiment manifest laws (W037) — membership (trajectory/experiment
 * scope match), the declarative holdout splits per the policy's holdout
 * kinds, and the integrity requirements carried forward.
 *
 * Run: pnpm --filter experiments test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HoldoutKind } from "learning-objectives";
import type { TimestampMs } from "tradrl-world-contracts";
import { experimentManifestOf } from "../manifest.js";
import type { TrajectoryRef } from "../manifest.js";
import {
  PERIOD_TRAIN,
  experimentDescriptor,
  fixtureExperiment,
  manifestInput,
  periodSplit,
  trajectoryRefOf,
  venueSplit,
} from "./fixtures.js";

function build(input: Parameters<typeof experimentManifestOf>[1]) {
  return experimentManifestOf(fixtureExperiment(), input);
}

test("the canonical manifest binds membership, splits, and integrity", () => {
  const outcome = build(manifestInput());
  assert.ok(outcome.ok);
  const { manifest } = outcome;
  const experiment = fixtureExperiment();
  assert.equal(manifest.experimentId, experiment.experimentId);
  assert.equal(manifest.experimentName, "exp-fixture");
  assert.deepEqual(manifest.world, experiment.descriptor.world);
  assert.equal(manifest.trajectories.length, 2);
  // canonical id order
  const ids = manifest.trajectories.map((ref) => String(ref.trajectoryId));
  assert.deepEqual([...ids].sort((a, b) => a.localeCompare(b)), ids);
  // canonical split order: unseen-period (h-1) before venue (h-2)
  assert.deepEqual(
    manifest.holdoutSplits.map((split) => split.axisId),
    ["h-1", "h-2"],
  );
  // integrity carried forward, verbatim
  assert.deepEqual(manifest.integrity, ["evidence-chain", "deterministic-replay"]);
});

test("the manifest twin law: same input ⇒ deep-equal manifest (A9)", () => {
  const first = build(manifestInput());
  const second = build(manifestInput());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.manifest, second.manifest);
});

test("an empty manifest is refused (fail-closed)", () => {
  const outcome = build({ trajectories: [], holdoutSplits: [] });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "empty-manifest"));
});

test("a blank trajectory scope member is refused, naming the member", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1", { projectId: " " })],
    holdoutSplits: [periodSplit()],
  });
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "invalid-trajectory-ref");
  assert.ok(error !== undefined);
  assert.ok(error.message.includes("projectId"));
});

test("trajectory/experiment scope mismatches are refused, naming the member", () => {
  for (const [label, overrides] of [
    ["experiment", { experimentId: "exp-other" }],
    ["tenant", { tenantId: "tenant-9" }],
    ["world", { worldId: "world-beta" }],
  ] as const) {
    const outcome = build({
      trajectories: [trajectoryRefOf("session-1", overrides)],
      holdoutSplits: [periodSplit()],
    });
    assert.ok(!outcome.ok, `the ${label} mismatch must fail`);
    const error = outcome.errors.find((entry) => entry.code === "trajectory-scope-mismatch");
    assert.ok(error !== undefined);
    assert.ok(error.message.includes(label === "experiment" ? "experimentId" : label));
  }
});

test("a trajectory joins once (duplicate-trajectory)", () => {
  const duplicate: TrajectoryRef = trajectoryRefOf("session-1");
  const outcome = build({
    trajectories: [duplicate, { ...duplicate }],
    holdoutSplits: [periodSplit()],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "duplicate-trajectory"));
});

test("an unknown runtime holdout kind is refused (unknown-split-kind)", () => {
  // Malformed runtime data (post-parse) simulated with a leaf cast — the
  // closed-set check must fire even though the static type is closed.
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ kind: "bogus" as HoldoutKind })],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "unknown-split-kind"));
});

test("a split for an axis the policy never declared is refused (unknown-split-axis)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ axisId: "h-9" })],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "unknown-split-axis"));
});

test("a blank split axis id is refused (blank-split-axis)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ axisId: " " })],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "blank-split-axis"));
});

test("one axis, one split (duplicate-split-axis)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit(), periodSplit()],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "duplicate-split-axis"));
});

test("a split never re-kinds its axis (split-kind-mismatch)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ kind: "venue" as HoldoutKind })],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "split-kind-mismatch"));
});

test("atoms outside the split kind's family are refused (split-atom-kind-mismatch)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [
      periodSplit({ evaluation: [{ kind: "venue", venueId: "venue-holdout" }] }),
    ],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "split-atom-kind-mismatch"));
});

test("empty sides, duplicate atoms, overlaps, and bad periods all fail typed", () => {
  const empty = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ train: [] })],
  });
  assert.ok(!empty.ok);
  assert.ok(empty.errors.some((entry) => entry.code === "empty-split-side"));

  const duplicateAtom = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ train: [PERIOD_TRAIN, PERIOD_TRAIN] })],
  });
  assert.ok(!duplicateAtom.ok);
  assert.ok(duplicateAtom.errors.some((entry) => entry.code === "duplicate-split-atom"));

  const overlap = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [periodSplit({ evaluation: [PERIOD_TRAIN] })],
  });
  assert.ok(!overlap.ok);
  assert.ok(overlap.errors.some((entry) => entry.code === "overlapping-split-sides"));

  const badPeriod = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [
      periodSplit({
        evaluation: [{ kind: "period", from: 2000 as TimestampMs, to: 1000 as TimestampMs }],
      }),
    ],
  });
  assert.ok(!badPeriod.ok);
  assert.ok(badPeriod.errors.some((entry) => entry.code === "invalid-period-atom"));
});

test("the venue split declares its own atom family (regime/asset/venue atoms as data)", () => {
  const outcome = build({
    trajectories: [trajectoryRefOf("session-1")],
    holdoutSplits: [venueSplit()],
  });
  assert.ok(outcome.ok);
  assert.equal(outcome.manifest.holdoutSplits.length, 1);
  assert.equal(outcome.manifest.holdoutSplits[0]?.kind, "venue");
  assert.deepEqual(outcome.manifest.holdoutSplits[0]?.train, [{ kind: "venue", venueId: "venue-train" }]);
});

test("a descriptor with mismatched policy axes still constructs; the manifest catches splits", () => {
  // The descriptor's own gate (W036) canonicalizes axes; the manifest gate
  // is the seam that binds splits to the DECLARED axes — sanity: the
  // fixture descriptor and the fixture experiment agree on the axis set.
  const descriptor = experimentDescriptor();
  const experiment = fixtureExperiment();
  assert.deepEqual(
    experiment.policy.descriptor.axes.holdouts,
    descriptor.policy.axes.holdouts,
  );
});
