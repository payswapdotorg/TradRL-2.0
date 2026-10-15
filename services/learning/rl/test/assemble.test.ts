/**
 * The bridge gate laws (W047) over REAL imports: REAL W037 trajectories +
 * a REAL W038 experiment evaluation + REAL W044 bindings, every refusal
 * law exercised loudly.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateExperiment } from "evaluation";
import { experimentManifestOf } from "experiments";
import { validateEpisode } from "rl-protocol";
import { assembleEpisodes } from "../assemble.js";
import { validateEpisodeProvenance } from "../validate.js";
import {
  barePnlEvaluationOf,
  bridgeFixture,
  deviantTrajectory,
  organizationBindingFixture,
  organizationSeatTrajectory,
} from "./fixtures.js";

test("the canonical bridge assembles REAL episodes with full provenance", () => {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.episodes.length, base.records.length);
  for (const [index, episode] of outcome.episodes.entries()) {
    const record = base.records.find(
      (entry) => String(entry.trajectoryId) === String(episode.provenance.trajectoryId),
    );
    assert.ok(record !== undefined);
    assert.deepEqual(episode.steps, record.stream.capsules);
    assert.equal(episode.reward, record.evaluation);
    assert.equal(String(episode.provenance.bindingId), String(base.agentBinding.bindingId));
    assert.equal(String(episode.provenance.evaluationId), String(base.evaluation.evaluationId));
    assert.equal(String(episode.provenance.experimentId), String(base.experiment.experimentId));
    assert.equal(String(episode.episodeId).startsWith("ep-"), true);
    assert.deepEqual(validateEpisode(episode), { ok: true });
    assert.deepEqual(
      validateEpisodeProvenance(episode, {
        trajectory: record,
        evaluation: base.evaluation,
        binding: base.agentBinding,
      }),
      { ok: true },
    );
    void index;
  }
  // canonical output order: input order never leaks
  const ids = outcome.episodes.map((episode) => String(episode.episodeId));
  assert.deepEqual(ids, [...ids].sort());
});

test("an empty assembly is refused", () => {
  const outcome = assembleEpisodes({ trajectories: [], evaluations: [], bindings: [] });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "empty-assembly"), true);
});

test("a malformed trajectory is refused with W037's own errors carried verbatim", () => {
  const base = bridgeFixture();
  const tampered = {
    ...base.records[0]!,
    session: { ...base.records[0]!.session, passCount: 99 },
  };
  const outcome = assembleEpisodes({
    trajectories: [tampered],
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const malformed = outcome.errors.find((entry) => entry.code === "malformed-trajectory");
  assert.ok(malformed !== undefined);
  assert.ok(malformed.trajectoryErrors !== undefined);
  assert.equal(
    malformed.trajectoryErrors.some((entry) => entry.code === "binding-stream-mismatch"),
    true,
  );
});

test("a trajectory with no proving binding is refused", () => {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "missing-binding"), true);
});

test("a scope disagreement between trajectory and binding is refused", () => {
  const base = bridgeFixture();
  const deviant = deviantTrajectory(base, { tenantId: "tenant-elsewhere" });
  const outcome = assembleEpisodes({
    trajectories: [deviant],
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "scope-disagreement"), true);
});

test("a world disagreement between trajectory and binding is refused", () => {
  const base = bridgeFixture();
  const deviant = deviantTrajectory(base, { worldId: "world-elsewhere" });
  const outcome = assembleEpisodes({
    trajectories: [deviant],
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "world-disagreement"), true);
});

test("a session whose mind is not the binding's substrate is refused", () => {
  const base = bridgeFixture();
  const deviant = deviantTrajectory(base, { substrateId: "substrate-elsewhere" });
  const outcome = assembleEpisodes({
    trajectories: [deviant],
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "session-disagreement"), true);
});

test("a trajectory whose experiment has no W038 evaluation is refused", () => {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "missing-experiment-evaluation"), true);
});

test("an evaluation whose carried summary disagrees with the record is refused", () => {
  const base = bridgeFixture();
  const tamperedEvaluation = {
    ...base.evaluation,
    trajectories: base.evaluation.trajectories.map((summary, index) =>
      index === 0 ? { ...summary, combinedScore: 999 } : summary,
    ),
  };
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [tamperedEvaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "evaluation-mismatch"), true);
});

test("a bare-P&L reward signal is refused loudly, naming the sole-objective law", () => {
  const base = bridgeFixture();
  const bare = base.records.map((record) => barePnlEvaluationOf(record));
  const outcome = assembleEpisodes({
    trajectories: bare,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "bare-pnl-reward");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /Raw P&L is never the sole objective/);
  assert.match(refusal.message, /§13/);
});

test("a trajectory assembled twice is refused (one trajectory, one episode)", () => {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: [base.records[0]!, base.records[0]!],
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-episode"), true);
});

test("an organization binding proves its seats' minds (the org path)", () => {
  const base = bridgeFixture();
  const orgRecord = organizationSeatTrajectory(base);
  const manifest = experimentManifestOf(base.experiment, {
    trajectories: [
      ...base.records.map((record) => ({ trajectoryId: record.trajectoryId, scope: record.scope })),
      { trajectoryId: orgRecord.trajectoryId, scope: orgRecord.scope },
    ],
    holdoutSplits: [],
  });
  assert.equal(manifest.ok, true);
  assert.ok(manifest.ok);
  const evaluation = evaluateExperiment({
    manifest: manifest.manifest,
    records: [...base.records, orgRecord],
    policy: base.experiment.policy,
  });
  assert.equal(evaluation.ok, true);
  assert.ok(evaluation.ok);
  const outcome = assembleEpisodes({
    trajectories: [...base.records, orgRecord],
    evaluations: [evaluation.evaluation],
    bindings: [base.agentBinding, organizationBindingFixture()],
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.episodes.length, 3);
  const orgEpisode = outcome.episodes.find(
    (episode) => String(episode.provenance.trajectoryId) === String(orgRecord.trajectoryId),
  );
  assert.ok(orgEpisode !== undefined);
  assert.equal(String(orgEpisode.provenance.bindingId).startsWith("binding-"), true);
  assert.deepEqual(
    validateEpisodeProvenance(orgEpisode, {
      trajectory: orgRecord,
      evaluation: evaluation.evaluation,
      binding: organizationBindingFixture(),
    }),
    { ok: true },
  );
});

test("the sealed-episode re-validation catches a citation mismatch", () => {
  const base = bridgeFixture();
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  assert.ok(outcome.ok);
  const episode = outcome.episodes[0]!;
  const otherSources = {
    trajectory: base.records[1]!,
    evaluation: base.evaluation,
    binding: base.agentBinding,
  };
  const validation = validateEpisodeProvenance(episode, otherSources);
  assert.ok(!validation.ok);
  assert.equal(validation.errors.some((entry) => entry.code === "citation-mismatch"), true);
});
