/**
 * The whole-record re-validation laws (W049): every sealed projection
 * re-proves from its own recorded data — identity re-derivations, the
 * canonical step sequence, the canonical episode order, the projection
 * coverage, the canonical shard order — and every drift is refused by
 * name.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LobEnvironmentId } from "../lob-generation.js";
import {
  validateLobBatchTrainingProjection,
  validateLobEpisodeTrainingProjection,
  validateLobEnvironmentDeclarations,
} from "../validate.js";
import {
  canonicalBatchProjection,
  canonicalDeclarations,
  canonicalEpisodeProjection,
  thawedBatchProjection,
  thawedDeclarations,
  thawedEpisodeProjection,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// The happy re-validations
// ---------------------------------------------------------------------------

test("the canonical episode projection re-proves", () => {
  const proof = validateLobEpisodeTrainingProjection(canonicalEpisodeProjection());
  assert.ok(proof.ok);
  assert.ok(proof.ok);
  assert.deepEqual(proof.checked, ["kind", "citation", "step-count", "shape", "step-sequence", "identity"]);
});

test("the canonical batch projection re-proves", () => {
  const proof = validateLobBatchTrainingProjection(canonicalBatchProjection());
  assert.ok(proof.ok);
  assert.ok(proof.ok);
  assert.deepEqual(proof.checked, ["kind", "citation", "episode-order", "counts", "shape", "episode-projections", "identity"]);
});

test("the canonical environment declarations re-prove", () => {
  const proof = validateLobEnvironmentDeclarations(canonicalDeclarations());
  assert.ok(proof.ok);
  assert.ok(proof.ok);
  assert.deepEqual(proof.checked, ["kind", "citation", "unit-count", "shard-order", "environments", "shape", "identity"]);
});

// ---------------------------------------------------------------------------
// The episode-projection drift laws
// ---------------------------------------------------------------------------

test("a drifted mapping id is refused (identity-mismatch)", () => {
  const tampered = thawedEpisodeProjection();
  tampered.mappingId = "lobtrain-notthecontentaddress" as typeof tampered.mappingId;
  const proof = validateLobEpisodeTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a drifted training-step sequence is refused (step-sequence-mismatch)", () => {
  const tampered = thawedEpisodeProjection();
  tampered.trainingSteps = tampered.trainingSteps.slice(0, tampered.trainingSteps.length - 1);
  const proof = validateLobEpisodeTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "step-sequence-mismatch"), true);
});

test("a drifted shape is refused (invalid-step-shape, vocabulary errors carried)", () => {
  const tampered = thawedEpisodeProjection();
  tampered.shape = { stepKinds: ["order-action"] };
  const proof = validateLobEpisodeTrainingProjection(tampered);
  assert.ok(!proof.ok);
  const refusal = proof.errors.find((entry) => entry.code === "invalid-step-shape");
  assert.ok(refusal !== undefined);
  assert.equal(refusal!.vocabularyErrors !== undefined, true);
  assert.equal(refusal!.vocabularyErrors!.some((entry) => entry.code === "missing-step-kind"), true);
});

test("a drifted step count is refused (invalid-step-count)", () => {
  const tampered = thawedEpisodeProjection();
  tampered.stepCount = 0;
  const proof = validateLobEpisodeTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "invalid-step-count"), true);
});

// ---------------------------------------------------------------------------
// The batch-projection drift laws
// ---------------------------------------------------------------------------

test("a non-canonical episode order is refused (non-canonical-episode-order)", () => {
  const tampered = thawedBatchProjection();
  tampered.episodeIds = [...tampered.episodeIds].reverse();
  const proof = validateLobBatchTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "non-canonical-episode-order"), true);
});

test("a drifted episode count is refused (count-mismatch)", () => {
  const tampered = thawedBatchProjection();
  tampered.episodeCount = tampered.episodeCount + 1;
  const proof = validateLobBatchTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "count-mismatch"), true);
});

test("a drifted episode projection is refused (episode-projection-mismatch)", () => {
  const tampered = thawedBatchProjection();
  tampered.episodeProjections[0]!.stepCount = tampered.episodeProjections[0]!.stepCount + 1;
  const proof = validateLobBatchTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "episode-projection-mismatch"), true);
});

test("a drifted batch mapping id is refused (identity-mismatch)", () => {
  const tampered = thawedBatchProjection();
  tampered.mappingId = "lobtrain-notthecontentaddress" as typeof tampered.mappingId;
  const proof = validateLobBatchTrainingProjection(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

// ---------------------------------------------------------------------------
// The environment-declaration drift laws
// ---------------------------------------------------------------------------

test("a drifted shard order is refused (shard-order)", () => {
  const tampered = thawedDeclarations();
  tampered.environments[1]!.shardIndex = 7;
  const proof = validateLobEnvironmentDeclarations(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "shard-order"), true);
});

test("a drifted environment id is refused (identity-mismatch)", () => {
  const tampered = thawedDeclarations();
  tampered.environments[0]!.environmentId = "lobenv-notthecontentaddress" as LobEnvironmentId;
  const proof = validateLobEnvironmentDeclarations(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a drifted declared episode count is refused (invalid-declaration)", () => {
  const tampered = thawedDeclarations();
  tampered.environments[0]!.declaredEpisodeCount = 0;
  const proof = validateLobEnvironmentDeclarations(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "invalid-declaration"), true);
});

test("a drifted unit count is refused (unit-count-mismatch)", () => {
  const tampered = thawedDeclarations();
  tampered.unitCount = tampered.unitCount + 1;
  const proof = validateLobEnvironmentDeclarations(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "unit-count-mismatch"), true);
});

test("a drifted environment shape is refused (invalid-declaration + invalid-step-shape)", () => {
  const tampered = thawedDeclarations();
  tampered.shape = { stepKinds: ["reward-signal"] };
  const proof = validateLobEnvironmentDeclarations(tampered);
  assert.ok(!proof.ok);
  assert.equal(proof.errors.some((entry) => entry.code === "invalid-step-shape"), true);
  // every environment's shape no longer agrees with the declarations'
  assert.equal(proof.errors.some((entry) => entry.code === "invalid-declaration"), true);
  // and the mapping id no longer addresses the drifted record
  assert.equal(proof.errors.some((entry) => entry.code === "identity-mismatch"), true);
});
