/**
 * The whole-record re-validation laws (W047) over REAL imports — tamper
 * tests: every law re-proven from the record's bytes alone.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeOf } from "../episode.js";
import { validateEpisode, validateEpisodeBatchDescriptor } from "../validate.js";
import type { Episode } from "../episode.js";
import { episodeBatchDescriptorOf, episodeBatchIdOf } from "../trainer.js";
import { barePnlEvaluation, canonicalEpisodeInput } from "./fixtures.js";

function canonicalEpisode(): Episode {
  const outcome = episodeOf(canonicalEpisodeInput());
  assert.ok(outcome.ok);
  return outcome.episode;
}

test("the canonical episode re-validates", () => {
  assert.deepEqual(validateEpisode(canonicalEpisode()), { ok: true });
});

test("a tampered episode id fails identity re-derivation", () => {
  const episode = canonicalEpisode();
  const tampered = { ...episode, episodeId: "ep-deadbeef" as typeof episode.episodeId };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a blanked scope member is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const tampered = { ...episode, scope: { ...episode.scope, worldId: "" } };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "blank-scope-member"), true);
});

test("a blanked provenance citation is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const tampered = {
    ...episode,
    provenance: { ...episode.provenance, evaluationId: "" as typeof episode.provenance.evaluationId },
  };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "blank-provenance-member"), true);
});

test("a tampered bare-P&L reward is caught on re-validation, naming the law", () => {
  const episode = canonicalEpisode();
  const tampered = { ...episode, reward: barePnlEvaluation(episode.reward) };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "pnl-sole-reward");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /Raw P&L is never the sole objective/);
});

test("a tampered empty step carry is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const tampered = { ...episode, steps: [] };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "empty-steps"), true);
});

test("a tampered lineage is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const tampered = {
    ...episode,
    lineage: { trajectory: { ...episode.lineage.trajectory, root: "traj-other" as never } },
  };
  const outcome = validateEpisode(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-lineage"), true);
});

test("the canonical batch descriptor re-validates", () => {
  const episode = canonicalEpisode();
  const descriptor = episodeBatchDescriptorOf([episode.episodeId]);
  assert.ok(descriptor.ok);
  assert.deepEqual(validateEpisodeBatchDescriptor(descriptor.descriptor), { ok: true });
});

test("a tampered batch id fails identity re-derivation", () => {
  const episode = canonicalEpisode();
  const descriptor = episodeBatchDescriptorOf([episode.episodeId]);
  assert.ok(descriptor.ok);
  const tampered = { ...descriptor.descriptor, batchId: "batch-deadbeef" as typeof descriptor.descriptor.batchId };
  const outcome = validateEpisodeBatchDescriptor(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a permuted id list fails the canonical-order law", () => {
  const episode = canonicalEpisode();
  const other = episodeOf({
    ...canonicalEpisodeInput(),
    provenance: {
      ...canonicalEpisodeInput().provenance,
      bindingId: "agent-binding-zzz" as never,
    },
  });
  assert.ok(other.ok);
  const ids = [episode.episodeId, other.episode.episodeId].sort().reverse();
  const tampered = {
    batchId: "batch-00000000" as never,
    episodeIds: ids,
    episodeCount: ids.length,
    selectionPolicy: undefined,
  };
  const outcome = validateEpisodeBatchDescriptor(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "non-canonical-order"), true);
});

test("a count mismatch is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const descriptor = episodeBatchDescriptorOf([episode.episodeId]);
  assert.ok(descriptor.ok);
  const tampered = { ...descriptor.descriptor, episodeCount: 7 };
  const outcome = validateEpisodeBatchDescriptor(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "count-mismatch"), true);
});

test("a declared policy with duplicate parameters is caught on re-validation", () => {
  const episode = canonicalEpisode();
  const duplicateParameters = [
    { name: "a", value: 1 },
    { name: "a", value: 2 },
  ];
  // a literal descriptor (the construction gate refuses duplicate names,
  // so the re-validation law is exercised through carried data directly)
  const tampered = {
    batchId: episodeBatchIdOf([episode.episodeId], {
      policyId: "sel-fixture",
      parameters: duplicateParameters,
    }),
    episodeIds: [episode.episodeId] as typeof episode.episodeId[],
    episodeCount: 1,
    selectionPolicy: { policyId: "sel-fixture", parameters: duplicateParameters },
  };
  const outcome = validateEpisodeBatchDescriptor(tampered);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-selection-policy"), true);
});
