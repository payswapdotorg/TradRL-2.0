/**
 * The batch gate laws (W047) over REAL assembled episodes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleBatch } from "../batch.js";
import { assembleEpisodes } from "../assemble.js";
import { bridgeFixture } from "./fixtures.js";

function canonicalEpisodes() {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.ok(outcome.ok);
  return { base, episodes: outcome.episodes };
}

test("the canonical batch assembles with a content-addressed id", () => {
  const { episodes } = canonicalEpisodes();
  const outcome = assembleBatch(episodes);
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.batch.episodeCount, episodes.length);
  assert.equal(String(outcome.batch.batchId).startsWith("batch-"), true);
  const ids = episodes.map((episode) => String(episode.episodeId)).sort();
  assert.deepEqual(outcome.batch.episodeIds.map(String), ids);
  assert.equal(outcome.batch.selectionPolicy, undefined);
});

test("the declared selection policy rides as data and weighs the id", () => {
  const { episodes } = canonicalEpisodes();
  const policy = { policyId: "sel-rl-fixture", parameters: [{ name: "minSteps", value: 3 }] };
  const withPolicy = assembleBatch(episodes, policy);
  const withoutPolicy = assembleBatch(episodes);
  assert.ok(withPolicy.ok && withoutPolicy.ok);
  assert.deepEqual(withPolicy.batch.selectionPolicy, policy);
  assert.notEqual(withPolicy.batch.batchId, withoutPolicy.batch.batchId);
});

test("an empty batch is refused", () => {
  const outcome = assembleBatch([]);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "empty-batch"), true);
});

test("a duplicate episode is refused", () => {
  const { episodes } = canonicalEpisodes();
  const outcome = assembleBatch([episodes[0]!, episodes[0]!]);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-episode"), true);
});

test("a tampered episode is refused through the protocol's own re-validation", () => {
  const { episodes } = canonicalEpisodes();
  const tampered = { ...episodes[0]!, episodeId: "ep-deadbeef" as typeof episodes[number]["episodeId"] };
  const outcome = assembleBatch([tampered, ...episodes.slice(1)]);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const malformed = outcome.errors.find((entry) => entry.code === "malformed-episode");
  assert.ok(malformed !== undefined);
  assert.ok(malformed.episodeErrors !== undefined);
  assert.equal(
    malformed.episodeErrors.some((entry) => entry.code === "identity-mismatch"),
    true,
  );
});

test("an unlawful selection policy is refused with the protocol's errors carried", () => {
  const { episodes } = canonicalEpisodes();
  const outcome = assembleBatch(episodes, {
    policyId: "  ",
    parameters: [{ name: "a", value: 1 }, { name: "a", value: 2 }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-selection-policy");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.batchErrors !== undefined);
  assert.equal(refusal.batchErrors.some((entry) => entry.code === "blank-policy-id"), true);
  assert.equal(refusal.batchErrors.some((entry) => entry.code === "duplicate-parameter-name"), true);
});
