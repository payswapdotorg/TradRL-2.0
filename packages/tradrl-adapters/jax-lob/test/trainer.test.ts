/**
 * The TrainerPort-facing projection laws (W049): how a W047 episode/batch
 * maps to LOB-style training steps — the happy paths over REAL W047
 * episodes/batches, W047's OWN errors carried VERBATIM on malformed
 * inputs, the vocabulary refusals, the realization and scope laws.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEpisode } from "rl-protocol";
import { lobBatchTrainingStepsOf, lobTrainingStepsOf } from "../lob-trainer.js";
import { lobEpisodeStepShapeOf } from "../lob-vocabulary.js";
import type { LobEpisodeStepShape, LobStepKind } from "../lob-vocabulary.js";
import {
  LOB_SHAPE,
  MINIMAL_SHAPE,
  canonicalBatchProjection,
  realBatch,
  realEpisodes,
  thaw,
  thawedBatchProjection,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// The episode gate — happy paths over REAL episodes
// ---------------------------------------------------------------------------

test("a REAL episode projects to canonical LOB training steps", () => {
  const episodes = realEpisodes();
  const episode = episodes[0]!;
  const outcome = lobTrainingStepsOf(episode, LOB_SHAPE);
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  const projection = outcome.projection;
  assert.equal(String(projection.mappingId).startsWith("lobtrain-"), true);
  assert.equal(projection.episodeId, episode.episodeId);
  assert.equal(projection.stepCount, episode.steps.length);
  assert.equal(projection.trainingSteps.length, episode.steps.length * LOB_SHAPE.stepKinds.length);
  // dense ordinals from 0, canonical per-step order
  projection.trainingSteps.forEach((step, ordinal) => {
    assert.equal(step.stepOrdinal, ordinal);
    assert.equal(step.stepKind, LOB_SHAPE.stepKinds[ordinal % LOB_SHAPE.stepKinds.length]);
    assert.equal(step.episodeStepIndex, Math.floor(ordinal / LOB_SHAPE.stepKinds.length));
  });
  assert.equal(Object.isFrozen(projection), true);
});

test("the mapping id is the content address of (episode id, shape) — a different shape, a different id", () => {
  const episode = realEpisodes()[0]!;
  const full = lobTrainingStepsOf(episode, LOB_SHAPE);
  const minimal = lobTrainingStepsOf(episode, MINIMAL_SHAPE);
  assert.ok(full.ok && minimal.ok);
  assert.notEqual(String(full.projection.mappingId), String(minimal.projection.mappingId));
  assert.equal(minimal.projection.trainingSteps.length, episode.steps.length * 3);
});

// ---------------------------------------------------------------------------
// The episode gate — W047's own errors carried VERBATIM
// ---------------------------------------------------------------------------

test("a tampered episode is refused with W047's own errors carried verbatim (invalid-episode)", () => {
  const tampered = thaw(realEpisodes()[0]!);
  tampered.scope = { ...tampered.scope, experimentId: "" };
  const direct = validateEpisode(tampered);
  assert.ok(!direct.ok);

  const outcome = lobTrainingStepsOf(tampered, LOB_SHAPE);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-episode");
  assert.ok(refusal !== undefined);
  assert.deepEqual(refusal!.episodeErrors, direct.errors);
});

test("a bare-P&L reward episode is refused with W047's own §13 error carried verbatim", () => {
  const tampered = thaw(realEpisodes()[0]!);
  const financialOnly = tampered.reward.reward.components.filter((component) => component.kind === "realized-pnl");
  tampered.reward = {
    ...tampered.reward,
    reward: { ...tampered.reward.reward, components: financialOnly },
  };
  const direct = validateEpisode(tampered);
  assert.ok(!direct.ok);
  assert.equal(direct.errors.some((entry) => entry.code === "pnl-sole-reward"), true);

  const outcome = lobTrainingStepsOf(tampered, LOB_SHAPE);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-episode");
  assert.ok(refusal !== undefined);
  assert.deepEqual(refusal!.episodeErrors, direct.errors);
});

test("a malformed shape is refused with the venue vocabulary's errors carried verbatim (invalid-step-shape)", () => {
  const episode = realEpisodes()[0]!;
  const malformed: LobEpisodeStepShape = {
    stepKinds: ["book-observation", "order-action", "reward-signal", "level-2-snapshot" as LobStepKind],
  };
  const direct = lobEpisodeStepShapeOf(malformed);
  assert.ok(!direct.ok);

  const outcome = lobTrainingStepsOf(episode, malformed);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-step-shape");
  assert.ok(refusal !== undefined);
  assert.deepEqual(refusal!.vocabularyErrors, direct.errors);
});

// ---------------------------------------------------------------------------
// The batch gate — happy paths over REAL batches
// ---------------------------------------------------------------------------

test("a REAL batch + its realizing episodes project canonically (input order never leaks)", () => {
  const episodes = [...realEpisodes()].reverse(); // permuted input
  const batch = realBatch([...realEpisodes()]); // canonical batch over the same episodes
  const outcome = lobBatchTrainingStepsOf(batch, episodes, LOB_SHAPE);
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  const projection = outcome.projection;
  assert.equal(String(projection.mappingId).startsWith("lobtrain-"), true);
  assert.equal(projection.batchId, batch.batchId);
  assert.equal(projection.episodeCount, episodes.length);
  assert.deepEqual(
    projection.episodeIds.map(String),
    episodes.map((episode) => String(episode.episodeId)).sort(),
  );
  assert.deepEqual(
    projection.episodeProjections.map((entry) => String(entry.episodeId)),
    episodes.map((episode) => String(episode.episodeId)).sort(),
  );
  assert.equal(Object.isFrozen(projection), true);
});

test("the batch-level projection equals the composition of its episode projections", () => {
  const projection = canonicalBatchProjection();
  for (const episodeProjection of projection.episodeProjections) {
    const expected = lobTrainingStepsOf(
      realEpisodes().find((episode) => String(episode.episodeId) === String(episodeProjection.episodeId))!,
      LOB_SHAPE,
    );
    assert.ok(expected.ok);
    assert.deepEqual(episodeProjection, expected.projection);
  }
});

// ---------------------------------------------------------------------------
// The batch gate — the refusal laws
// ---------------------------------------------------------------------------

test("a tampered batch descriptor is refused with W047's own batch errors carried verbatim (invalid-batch)", () => {
  const episodes = realEpisodes();
  const tampered = thaw(realBatch(episodes));
  tampered.episodeCount = tampered.episodeCount + 1;

  const outcome = lobBatchTrainingStepsOf(tampered, episodes, LOB_SHAPE);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-batch");
  assert.ok(refusal !== undefined);
  assert.equal(refusal!.batchErrors !== undefined, true);
  assert.equal(refusal!.batchErrors!.some((entry) => entry.code === "count-mismatch"), true);
});

test("a handed realization that misses a batch episode is refused (batch-realization-mismatch)", () => {
  const episodes = realEpisodes();
  const batch = realBatch(episodes);
  const outcome = lobBatchTrainingStepsOf(batch, episodes.slice(0, 1), LOB_SHAPE);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-realization-mismatch"), true);
});

test("a foreign episode is refused (batch-realization-mismatch)", () => {
  const episodes = realEpisodes();
  const batch = realBatch(episodes);
  const foreign = realEpisodes(3); // a third episode the batch does not cite
  const outcome = lobBatchTrainingStepsOf(batch, [...episodes, foreign[foreign.length - 1]!], LOB_SHAPE);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-realization-mismatch"), true);
});

test("a handed episode duplicated is refused (batch-realization-mismatch)", () => {
  const episodes = realEpisodes();
  const batch = realBatch(episodes);
  const outcome = lobBatchTrainingStepsOf(batch, [episodes[0]!, episodes[0]!], LOB_SHAPE);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-realization-mismatch"), true);
});

test("episodes that disagree on scope are refused (scope-mismatch)", () => {
  const episodes = realEpisodes();
  const drifted = thaw(episodes[1]!);
  drifted.scope = { ...drifted.scope, tenantId: "tenant-foreign" };
  const batch = realBatch(episodes);
  const outcome = lobBatchTrainingStepsOf(batch, [episodes[0]!, drifted], LOB_SHAPE);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "scope-mismatch"), true);
});

test("a malformed shape is refused at the batch gate too (invalid-step-shape)", () => {
  const episodes = realEpisodes();
  const malformed: LobEpisodeStepShape = { stepKinds: ["order-action"] };
  const outcome = lobBatchTrainingStepsOf(realBatch(episodes), episodes, malformed);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-step-shape"), true);
});

// ---------------------------------------------------------------------------
// Frozen-record sanity (the tamper helper needs the canonical record frozen)
// ---------------------------------------------------------------------------

test("the canonical batch projection is a frozen record", () => {
  const projection = thawedBatchProjection(); // thaw proves the original is structuredClone-able
  assert.notEqual(projection.mappingId, "");
  assert.equal(canonicalBatchProjection().episodeCount, realEpisodes().length);
});
