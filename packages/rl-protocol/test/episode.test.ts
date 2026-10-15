/**
 * The episode construction-gate laws (W047) over REAL imports.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeIdOf, episodeOf } from "../episode.js";
import type { EpisodeInput } from "../episode.js";
import {
  barePnlEvaluation,
  canonicalEpisodeInput,
  canonicalProvenance,
  canonicalTrajectoryRecord,
} from "./fixtures.js";

test("the canonical episode assembles from the REAL fixture trajectory", () => {
  const record = canonicalTrajectoryRecord();
  const outcome = episodeOf(canonicalEpisodeInput(record));
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.episode.steps.length, record.stream.capsules.length);
  // carried verbatim: the steps ARE the trajectory's own capsules
  assert.deepEqual(outcome.episode.steps, record.stream.capsules);
  // carried verbatim: the reward IS the trajectory's own evaluation
  assert.equal(outcome.episode.reward, record.evaluation);
  assert.equal(String(outcome.episode.provenance.trajectoryId), String(record.trajectoryId));
  // carried verbatim: the lineage IS the trajectory's own lineage (a frozen copy)
  assert.deepEqual(outcome.episode.lineage.trajectory, record.lineage);
  assert.equal(Object.isFrozen(outcome.episode), true);
  assert.equal(Object.isFrozen(outcome.episode.provenance), true);
  assert.equal(Object.isFrozen(outcome.episode.lineage), true);
});

test("the episode id is the deterministic content address of the provenance", () => {
  const record = canonicalTrajectoryRecord();
  const provenance = canonicalProvenance(record);
  assert.equal(episodeIdOf(provenance), episodeIdOf(canonicalProvenance(record)));
  assert.equal(String(episodeIdOf(provenance)).startsWith("ep-"), true);
  const other = { ...provenance, bindingId: "agent-binding-other" as typeof provenance.bindingId };
  assert.notEqual(episodeIdOf(other), episodeIdOf(provenance));
});

test("a blank scope member is refused (scope is explicit, never defaulted)", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({
    ...input,
    scope: { ...input.scope, tenantId: "" },
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "blank-scope-member"), true);
});

test("a blank provenance citation is refused", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({
    ...input,
    provenance: { ...input.provenance, bindingId: "" as typeof input.provenance.bindingId },
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "blank-provenance-member"), true);
});

test("scope and provenance citing different experiments is refused", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({
    ...input,
    provenance: { ...input.provenance, experimentId: "exp-other" as typeof input.provenance.experimentId },
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "scope-experiment-mismatch"), true);
});

test("an episode over an empty evidence carry is refused", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({ ...input, steps: [] });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "empty-steps"), true);
});

test("a bare-P&L reward is refused loudly, naming the sole-objective law", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({ ...input, reward: barePnlEvaluation(input.reward) });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "pnl-sole-reward");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /Raw P&L is never the sole objective/);
  assert.match(refusal.message, /§13/);
});

test("an empty reward component list is also refused as not constraint-aware", () => {
  const input = canonicalEpisodeInput();
  const emptyComponents = {
    ...input.reward,
    reward: { ...input.reward.reward, components: [], total: 0 },
  };
  const outcome = episodeOf({ ...input, reward: emptyComponents });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "pnl-sole-reward"), true);
});

test("a tampered root lineage is refused (lineage is immutable)", () => {
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({
    ...input,
    lineage: { ...input.lineage, ordinal: 3 },
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-lineage"), true);
});

test("a self-parented branch lineage is refused", () => {
  const input: EpisodeInput = {
    ...canonicalEpisodeInput(),
    lineage: {
      parent: canonicalTrajectoryRecord().trajectoryId,
      root: canonicalTrajectoryRecord().trajectoryId,
      ordinal: 1,
    },
  };
  const outcome = episodeOf(input);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-lineage"), true);
});

test("a lawful branch lineage assembles (the trajectory's own lineage, carried)", () => {
  const record = canonicalTrajectoryRecord();
  const input = canonicalEpisodeInput();
  const outcome = episodeOf({
    ...input,
    lineage: { parent: "traj-parent" as typeof record.trajectoryId, root: "traj-root" as typeof record.trajectoryId, ordinal: 1 },
    provenance: { ...input.provenance, trajectoryId: "traj-branch" as typeof record.trajectoryId, experimentId: input.provenance.experimentId },
    scope: record.scope,
  });
  assert.equal(outcome.ok, true);
});
