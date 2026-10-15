/**
 * The batch-descriptor construction laws + the TrainerPort surface (W047).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeBatchDescriptorOf, episodeBatchIdOf } from "../trainer.js";
import type { EpisodeBatchDescriptor, TrainerPort } from "../trainer.js";
import { episodeOf, episodeIdOf } from "../episode.js";
import type { EpisodeId } from "../episode.js";
import { canonicalEpisodeInput, canonicalProvenance, canonicalTrajectoryRecord } from "./fixtures.js";

function fixtureEpisodeIds(): EpisodeId[] {
  const record = canonicalTrajectoryRecord();
  const base = episodeIdOf(canonicalProvenance(record));
  const second = episodeIdOf({ ...canonicalProvenance(record), bindingId: "agent-binding-b" as never });
  const third = episodeIdOf({ ...canonicalProvenance(record), bindingId: "agent-binding-c" as never });
  return [base, second, third];
}

test("the canonical batch descriptor assembles with a content-addressed id", () => {
  const ids = fixtureEpisodeIds();
  const outcome = episodeBatchDescriptorOf(ids);
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.descriptor.episodeCount, 3);
  assert.equal(String(outcome.descriptor.batchId).startsWith("batch-"), true);
  assert.equal(outcome.descriptor.selectionPolicy, undefined);
  assert.deepEqual(outcome.descriptor.episodeIds, [...ids].sort());
});

test("input order never leaks: a permuted declaration yields the identical descriptor", () => {
  const ids = fixtureEpisodeIds();
  const forward = episodeBatchDescriptorOf(ids);
  const permuted = episodeBatchDescriptorOf([...ids].reverse());
  assert.ok(forward.ok && permuted.ok);
  assert.deepEqual(permuted.descriptor, forward.descriptor);
  assert.equal(permuted.descriptor.batchId, forward.descriptor.batchId);
});

test("an empty batch is refused", () => {
  const outcome = episodeBatchDescriptorOf([]);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "empty-batch"), true);
});

test("a duplicate episode id is refused", () => {
  const ids = fixtureEpisodeIds();
  const outcome = episodeBatchDescriptorOf([ids[0]!, ids[0]!]);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-episode-id"), true);
});

test("the declared selection policy is data: it weighs the batch id", () => {
  const ids = fixtureEpisodeIds();
  const policy = { policyId: "sel-even-passes", parameters: [{ name: "minSteps", value: 2 }] };
  const withPolicy = episodeBatchDescriptorOf(ids, policy);
  const withoutPolicy = episodeBatchDescriptorOf(ids);
  const otherPolicy = episodeBatchDescriptorOf(ids, { ...policy, policyId: "sel-other" });
  assert.ok(withPolicy.ok && withoutPolicy.ok && otherPolicy.ok);
  assert.notEqual(withPolicy.descriptor.batchId, withoutPolicy.descriptor.batchId);
  assert.notEqual(withPolicy.descriptor.batchId, otherPolicy.descriptor.batchId);
  assert.deepEqual(withPolicy.descriptor.selectionPolicy, policy);
});

test("a blank selection-policy id is refused", () => {
  const ids = fixtureEpisodeIds();
  const outcome = episodeBatchDescriptorOf(ids, { policyId: "  ", parameters: [] });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "blank-policy-id"), true);
});

test("duplicate selection-policy parameter names are refused", () => {
  const ids = fixtureEpisodeIds();
  const outcome = episodeBatchDescriptorOf(ids, {
    policyId: "sel-fixture",
    parameters: [
      { name: "minSteps", value: 2 },
      { name: "minSteps", value: 3 },
    ],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-parameter-name"), true);
});

test("the TrainerPort is satisfiable by a pure, method-neutral implementation", () => {
  const ids = fixtureEpisodeIds();
  const descriptor = episodeBatchDescriptorOf(ids);
  assert.ok(descriptor.ok);
  const trainer: TrainerPort = {
    descriptor: { trainerId: "trainer-fixture", method: "offline-rl" },
    consumeBatch: (batch: EpisodeBatchDescriptor) =>
      batch.episodeCount > 0
        ? {
            ok: true,
            receipt: {
              trainerId: "trainer-fixture",
              batchId: batch.batchId,
              episodeCount: batch.episodeCount,
            },
          }
        : {
            ok: false,
            errors: [{ code: "batch-refused", message: "the trainer refuses an empty batch (fixture law)" }],
          },
  };
  const receipt = trainer.consumeBatch(descriptor.descriptor);
  assert.ok(receipt.ok);
  assert.equal(receipt.receipt.batchId, descriptor.descriptor.batchId);
  const refusal = trainer.consumeBatch({
    batchId: descriptor.descriptor.batchId,
    episodeIds: [],
    episodeCount: 0,
    selectionPolicy: undefined,
  });
  assert.ok(!refusal.ok);
  assert.equal(refusal.errors[0]?.code, "batch-refused");
});

test("the batch id is deterministic across separate derivations (A9)", () => {
  const ids = fixtureEpisodeIds();
  assert.equal(episodeBatchIdOf(ids), episodeBatchIdOf([...ids]));
  assert.equal(episodeBatchIdOf(ids), episodeBatchIdOf([...ids].reverse()));
  const episode = episodeOf(canonicalEpisodeInput());
  assert.ok(episode.ok);
  assert.equal(episodeBatchIdOf([episode.episode.episodeId]), episodeBatchIdOf([episode.episode.episodeId]));
});
