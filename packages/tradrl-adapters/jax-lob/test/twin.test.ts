/**
 * The A9 determinism twin (W049): every gate, run twice over freshly
 * built identical inputs, yields deep-equal outputs with IDENTICAL
 * content-addressed ids — no clocks, no randomness, no env reads, input
 * order never leaks. The REAL fixture chain (bridge episodes, compute
 * plans) is rebuilt from scratch per twin member.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { planGeneration } from "learning-compute";
import { lobBookStateOf, lobExecutionEventOf } from "../lob-vocabulary.js";
import { lobBatchTrainingStepsOf, lobTrainingStepsOf } from "../lob-trainer.js";
import { lobEnvironmentDeclarationsOf } from "../lob-generation.js";
import { validateLobBatchTrainingProjection, validateLobEnvironmentDeclarations, validateLobEpisodeTrainingProjection } from "../validate.js";
import { CANONICAL_BOOK, LOB_SHAPE, realBatch, realEpisodes } from "./fixtures.js";
import {
  COMPUTE_BATCH_POLICY,
  COMPUTE_SHARDING,
  canonicalPopulation,
} from "../../../../services/learning/compute/test/fixtures.js";

test("the book-state twin: identical descriptors seal deep-equal with identical ids", () => {
  const first = lobBookStateOf(CANONICAL_BOOK);
  const second = lobBookStateOf(CANONICAL_BOOK);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.book, second.book);
  assert.equal(String(first.book.bookStateId), String(second.book.bookStateId));
});

test("the execution-event twin: identical events seal deep-equal", () => {
  const descriptor = { eventKind: "execution" as const, side: "ask" as const, orderKind: "market" as const, size: 7 };
  const first = lobExecutionEventOf(descriptor);
  const second = lobExecutionEventOf(descriptor);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.event, second.event);
});

test("the episode-projection twin: freshly assembled REAL episodes project deep-equal, identical mapping ids", () => {
  const first = lobTrainingStepsOf(realEpisodes()[0]!, LOB_SHAPE);
  const second = lobTrainingStepsOf(realEpisodes()[0]!, LOB_SHAPE);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.projection, second.projection);
  assert.equal(String(first.projection.mappingId), String(second.projection.mappingId));
});

test("the batch-projection twin: permuted handed order never leaks (identical canonical projection)", () => {
  const episodesA = realEpisodes();
  const episodesB = [...realEpisodes()].reverse();
  const first = lobBatchTrainingStepsOf(realBatch(episodesA), episodesA, LOB_SHAPE);
  const second = lobBatchTrainingStepsOf(realBatch(episodesB), episodesB, LOB_SHAPE);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.projection, second.projection);
  assert.equal(String(first.projection.mappingId), String(second.projection.mappingId));
});

test("the environment-declarations twin: freshly planned REAL plans project deep-equal, identical ids", () => {
  const firstPlan = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const secondPlan = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  assert.ok(firstPlan.ok && secondPlan.ok);
  assert.equal(String(firstPlan.plan.planId), String(secondPlan.plan.planId));

  const first = lobEnvironmentDeclarationsOf(firstPlan.plan, LOB_SHAPE);
  const second = lobEnvironmentDeclarationsOf(secondPlan.plan, LOB_SHAPE);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.declarations, second.declarations);
  assert.equal(String(first.declarations.mappingId), String(second.declarations.mappingId));
  assert.equal(
    String(first.declarations.environments[0]!.environmentId),
    String(second.declarations.environments[0]!.environmentId),
  );
});

test("the re-validation twin: identical proofs over freshly built twins", () => {
  const episodes = realEpisodes();
  const firstEpisode = lobTrainingStepsOf(episodes[0]!, LOB_SHAPE);
  const secondEpisode = lobTrainingStepsOf(realEpisodes()[0]!, LOB_SHAPE);
  assert.ok(firstEpisode.ok && secondEpisode.ok);
  assert.deepEqual(
    validateLobEpisodeTrainingProjection(firstEpisode.projection),
    validateLobEpisodeTrainingProjection(secondEpisode.projection),
  );

  const batch = lobBatchTrainingStepsOf(realBatch(episodes), episodes, LOB_SHAPE);
  const batchTwin = lobBatchTrainingStepsOf(realBatch(realEpisodes()), realEpisodes(), LOB_SHAPE);
  assert.ok(batch.ok && batchTwin.ok);
  assert.deepEqual(
    validateLobBatchTrainingProjection(batch.projection),
    validateLobBatchTrainingProjection(batchTwin.projection),
  );

  const firstPlan = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const secondPlan = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  assert.ok(firstPlan.ok && secondPlan.ok);
  const declarations = lobEnvironmentDeclarationsOf(firstPlan.plan, LOB_SHAPE);
  const declarationTwin = lobEnvironmentDeclarationsOf(secondPlan.plan, LOB_SHAPE);
  assert.ok(declarations.ok && declarationTwin.ok);
  assert.deepEqual(
    validateLobEnvironmentDeclarations(declarations.declarations),
    validateLobEnvironmentDeclarations(declarationTwin.declarations),
  );
});
