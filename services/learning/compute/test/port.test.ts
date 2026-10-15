/**
 * The GenerationWorkerPort contract laws (W048): the port is TYPES ONLY
 * (A14 — this package never executes a worker), so these tests prove the
 * typed handshake through a reference worker implemented IN THE TEST over
 * the REAL W047 assembly surface: the worker claims a plan's work unit and
 * emits its batch reference by assembling REAL episodes through W047's
 * `assembleEpisodes` + `assembleBatch` under the unit's DECLARED selection
 * policy — proving the plan's declared batch vocabulary is exactly the
 * vocabulary W047's assembly realizes, and the emitted reference carries
 * the W047 content-addressed batch id.
 *
 * Disclosure: the reference worker's episode CONTENT is W047's own bridge
 * fixture lineage (the fixture's binding world, not the population's
 * world) — this package never executes generation (A14); the port test
 * proves the HANDSHAKE SHAPE and the vocabulary agreement, never episode
 * content provenance.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleBatch, assembleEpisodes } from "learning-rl";
import type { GenerationUnit } from "../plan.js";
import type { GenerationWorkerPort } from "../port.js";
import { COMPUTE_SHARDING, canonicalPlan } from "./fixtures.js";
import { bridgeFixture } from "../../rl/test/fixtures.js";

/** Real episodes over the W047 bridge fixture (sessionCount aligned with the declared quota). */
function realEpisodes() {
  const base = bridgeFixture(COMPUTE_SHARDING.episodesPerUnit);
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  if (!outcome.ok) {
    throw new Error(`port fixture assembly failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.episodes;
}

/** The reference worker: a PURE, deterministic GenerationWorkerPort implementation (test-local). */
function referenceWorker(): GenerationWorkerPort {
  return {
    descriptor: { workerId: "worker-compute-fixture-1" },
    claimUnit(unit: GenerationUnit) {
      const episodes = realEpisodes();
      const batch = assembleBatch(episodes, unit.batch.selectionPolicy);
      if (!batch.ok) {
        return {
          ok: false,
          errors: [{ code: "unit-refused", message: `the assembly refused the declared policy (${batch.errors.map((entry) => entry.code).join(", ")})` }],
        };
      }
      return {
        ok: true,
        reference: {
          unitId: unit.unitId,
          batchId: batch.batch.batchId,
          episodeCount: batch.batch.episodeCount,
        },
      };
    },
  };
}

test("a reference worker claims a unit and emits a batch reference under the unit's declared policy", () => {
  const plan = canonicalPlan();
  const worker = referenceWorker();
  assert.deepEqual(worker.descriptor, { workerId: "worker-compute-fixture-1" });

  for (const unit of plan.units) {
    const outcome = worker.claimUnit(unit);
    assert.ok(outcome.ok);
    assert.ok(outcome.ok);
    assert.equal(String(outcome.reference.unitId), String(unit.unitId));
    assert.equal(String(outcome.reference.batchId).startsWith("batch-"), true);
    assert.equal(outcome.reference.episodeCount, unit.batch.declaredEpisodeCount);
    assert.equal(outcome.reference.episodeCount, COMPUTE_SHARDING.episodesPerUnit);
  }
});

test("the emitted batch realizes the unit's declared selection policy (the W047 vocabulary agreement)", () => {
  const plan = canonicalPlan();
  const episodes = realEpisodes();
  for (const unit of plan.units) {
    const batch = assembleBatch(episodes, unit.batch.selectionPolicy);
    assert.ok(batch.ok);
    assert.ok(batch.ok);
    assert.deepEqual(batch.batch.selectionPolicy, unit.batch.selectionPolicy);
    assert.deepEqual(batch.batch.selectionPolicy, plan.batchPolicy);
    assert.equal(batch.batch.episodeCount, unit.batch.declaredEpisodeCount);
    assert.deepEqual(batch.batch.episodeIds.map(String), episodes.map((episode) => String(episode.episodeId)).sort());
  }
});

test("a worker may refuse a unit loudly (the typed fail-closed refusal shape)", () => {
  const declining: GenerationWorkerPort = {
    descriptor: { workerId: "worker-compute-decliner" },
    claimUnit() {
      return { ok: false, errors: [{ code: "unit-refused", message: "declined in test" }] };
    },
  };
  const outcome = declining.claimUnit(canonicalPlan().units[0]!);
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors, [{ code: "unit-refused", message: "declined in test" }]);
});

test("each unit is cited by its own opaque id; the emitted batch id is W047's content address (disclosure: the test double reuses one episode set)", () => {
  const plan = canonicalPlan();
  const worker = referenceWorker();
  const first = worker.claimUnit(plan.units[0]!);
  const second = worker.claimUnit(plan.units[1]!);
  assert.ok(first.ok && second.ok);
  assert.notEqual(String(first.reference.unitId), String(second.reference.unitId));
  // the emitted batch id is the W047 content address over (episode ids, declared policy) —
  // the test double generates the SAME fixture episodes for both units, so the ids agree;
  // real workers generate each unit's own episodes and the ids differ.
  assert.equal(String(first.reference.batchId), String(second.reference.batchId));
});
