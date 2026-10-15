/**
 * The A9 twin laws (W047 service): identical inputs ⇒ deep-equal episodes
 * and batches with identical canonical ids; input order never leaks.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleBatch } from "../batch.js";
import { assembleEpisodes } from "../assemble.js";
import { bridgeFixture } from "./fixtures.js";

test("twin assemblies from permuted inputs are deep-equal with identical ids", () => {
  const base = bridgeFixture();
  const forward = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  const reversed = assembleEpisodes({
    trajectories: [...base.records].reverse(),
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.ok(forward.ok && reversed.ok);
  assert.deepEqual(reversed.episodes, forward.episodes);
  assert.deepEqual(
    reversed.episodes.map((episode) => episode.episodeId),
    forward.episodes.map((episode) => episode.episodeId),
  );
});

test("twin assemblies from independent REAL fixtures are deep-equal (A9 end-to-end)", () => {
  const first = bridgeFixture();
  const second = bridgeFixture();
  const left = assembleEpisodes({
    trajectories: first.records,
    evaluations: [first.evaluation],
    bindings: [first.agentBinding],
  });
  const right = assembleEpisodes({
    trajectories: second.records,
    evaluations: [second.evaluation],
    bindings: [second.agentBinding],
  });
  assert.ok(left.ok && right.ok);
  assert.deepEqual(right.episodes, left.episodes);
});

test("twin batches from permuted episodes are deep-equal with identical ids", () => {
  const base = bridgeFixture();
  const assembled = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.ok(assembled.ok);
  const policy = { policyId: "sel-twin", parameters: [{ name: "seedless", value: true }] };
  const forward = assembleBatch(assembled.episodes, policy);
  const reversed = assembleBatch([...assembled.episodes].reverse(), policy);
  assert.ok(forward.ok && reversed.ok);
  assert.deepEqual(reversed.batch, forward.batch);
  assert.equal(reversed.batch.batchId, forward.batch.batchId);
});
