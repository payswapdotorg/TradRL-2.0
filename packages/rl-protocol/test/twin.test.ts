/**
 * The A9 twin laws (W047): identical inputs ⇒ deep-equal episodes and
 * batches with identical canonical ids; input order never leaks.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeOf } from "../episode.js";
import { episodeBatchDescriptorOf } from "../trainer.js";
import { canonicalEpisodeInput, canonicalTrajectoryRecord } from "./fixtures.js";

test("twin episodes from identical inputs are deep-equal with identical ids", () => {
  const left = episodeOf(canonicalEpisodeInput());
  const right = episodeOf(canonicalEpisodeInput());
  assert.ok(left.ok && right.ok);
  assert.deepEqual(right.episode, left.episode);
  assert.equal(right.episode.episodeId, left.episode.episodeId);
  assert.deepEqual(right.episode.provenance, left.episode.provenance);
});

test("twin episodes from identical REAL captures are deep-equal", () => {
  // two separate REAL W037 captures over the same fixture session
  const leftRecord = canonicalTrajectoryRecord();
  const rightRecord = canonicalTrajectoryRecord();
  const left = episodeOf({
    scope: leftRecord.scope,
    provenance: {
      trajectoryId: leftRecord.trajectoryId,
      bindingId: "agent-binding-twin" as never,
      evaluationId: "expeval-twin" as never,
      experimentId: leftRecord.scope.experimentId as never,
    },
    steps: [...leftRecord.stream.capsules],
    reward: leftRecord.evaluation,
    lineage: leftRecord.lineage,
  });
  const right = episodeOf({
    scope: rightRecord.scope,
    provenance: {
      trajectoryId: rightRecord.trajectoryId,
      bindingId: "agent-binding-twin" as never,
      evaluationId: "expeval-twin" as never,
      experimentId: rightRecord.scope.experimentId as never,
    },
    steps: [...rightRecord.stream.capsules],
    reward: rightRecord.evaluation,
    lineage: rightRecord.lineage,
  });
  assert.ok(left.ok && right.ok);
  assert.deepEqual(right.episode, left.episode);
  assert.equal(right.episode.episodeId, left.episode.episodeId);
});

test("twin batches from permuted declarations are deep-equal with identical ids", () => {
  const record = canonicalTrajectoryRecord();
  const ids = [
    { trajectoryId: record.trajectoryId, bindingId: "b-1" as never, evaluationId: "e-1" as never },
    { trajectoryId: record.trajectoryId, bindingId: "b-2" as never, evaluationId: "e-1" as never },
    { trajectoryId: record.trajectoryId, bindingId: "b-0" as never, evaluationId: "e-1" as never },
  ];
  const episodeIds = ids.map((provenance) => {
    const outcome = episodeOf({
      scope: record.scope,
      provenance: { ...provenance, experimentId: record.scope.experimentId as never },
      steps: [...record.stream.capsules],
      reward: record.evaluation,
      lineage: record.lineage,
    });
    assert.ok(outcome.ok);
    return outcome.episode.episodeId;
  });
  const policy = { policyId: "sel-twin", parameters: [{ name: "seedless", value: true }] };
  const forward = episodeBatchDescriptorOf(episodeIds, policy);
  const reversed = episodeBatchDescriptorOf([...episodeIds].reverse(), { ...policy });
  assert.ok(forward.ok && reversed.ok);
  assert.deepEqual(reversed.descriptor, forward.descriptor);
  assert.equal(reversed.descriptor.batchId, forward.descriptor.batchId);
  assert.deepEqual(reversed.descriptor.episodeIds, [...episodeIds].sort());
});
