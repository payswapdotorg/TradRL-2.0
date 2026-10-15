/**
 * Shared deterministic fixtures for the W049 JAX-LOB adapter tests — the
 * W048 compute fixture lineage over REAL imports: REAL W047 episodes
 * assembled through the W047 bridge fixture (REAL commissioned bodies,
 * REAL bindings, REAL evaluations, REAL trajectories — the zero-drift
 * cross-package relative import the W043/W044/W045/W048 chain uses,
 * disclosed), a REAL W047 batch through the bridge's own assembleBatch,
 * and a REAL W048 generation plan through the compute package's own
 * fixtures. The `thaw` helper is the shared deep-writable clone
 * (structuredClone) — tampering a frozen record needs one.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { assembleBatch, assembleEpisodes } from "learning-rl";
import type { Episode, EpisodeBatchDescriptor } from "rl-protocol";
import type { GenerationPlan } from "learning-compute";
import { lobBatchTrainingStepsOf, lobTrainingStepsOf } from "../lob-trainer.js";
import type {
  LobBatchTrainingProjection,
  LobEpisodeTrainingProjection,
} from "../lob-trainer.js";
import { lobEnvironmentDeclarationsOf } from "../lob-generation.js";
import type { LobEnvironmentDeclarations } from "../lob-generation.js";
import type { LobBookStateDescriptor, LobEpisodeStepShape } from "../lob-vocabulary.js";
import { bridgeFixture } from "../../../../services/learning/rl/test/fixtures.js";
import {
  COMPUTE_BATCH_POLICY,
  canonicalPlan,
  thaw,
} from "../../../../services/learning/compute/test/fixtures.js";
import type { Writable } from "../../../../services/learning/compute/test/fixtures.js";

export { thaw };
export type { Writable };

/** The canonical venue shape fixture: the full closed step protocol, canonical order. */
export const LOB_SHAPE: LobEpisodeStepShape = {
  stepKinds: ["book-observation", "order-action", "execution-report", "reward-signal", "terminal-marker"],
};

/** A minimal lawful shape fixture (observation → action → reward). */
export const MINIMAL_SHAPE: LobEpisodeStepShape = {
  stepKinds: ["book-observation", "order-action", "reward-signal"],
};

/** The canonical book-state fixture: two bid levels, two ask levels, best-first, uncrossed. */
export const CANONICAL_BOOK: LobBookStateDescriptor = {
  bidLevels: [
    { price: 99.5, size: 120, orderCount: 3 },
    { price: 99.25, size: 80, orderCount: 2 },
  ],
  askLevels: [
    { price: 100.5, size: 60, orderCount: 1 },
    { price: 101, size: 200, orderCount: 5 },
  ],
};

/** REAL W047 episodes through the W047 bridge fixture (sessionCount aligned with the fixture batch). */
export function realEpisodes(sessionCount = 2): readonly Episode[] {
  const base = bridgeFixture(sessionCount);
  const outcome = assembleEpisodes({
    trajectories: base.records,
    evaluations: [base.evaluation],
    bindings: [base.agentBinding],
  });
  if (!outcome.ok) {
    throw new Error(`jax-lob fixture episode assembly failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
  }
  return outcome.episodes;
}

/** A REAL W047 batch over the REAL episodes under the compute fixture policy. */
export function realBatch(episodes: readonly Episode[] = realEpisodes()): EpisodeBatchDescriptor {
  const outcome = assembleBatch(episodes, COMPUTE_BATCH_POLICY);
  if (!outcome.ok) {
    throw new Error(`jax-lob fixture batch assembly failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
  }
  return outcome.batch;
}

let cachedEpisodeProjection: LobEpisodeTrainingProjection | undefined;

/** The canonical episode-level projection: the venue gate over the first REAL episode + the canonical shape. */
export function canonicalEpisodeProjection(): LobEpisodeTrainingProjection {
  cachedEpisodeProjection ??= (() => {
    const outcome = lobTrainingStepsOf(realEpisodes()[0]!, LOB_SHAPE);
    if (!outcome.ok) {
      throw new Error(`jax-lob fixture episode projection failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
    }
    return outcome.projection;
  })();
  return cachedEpisodeProjection;
}

let cachedBatchProjection: LobBatchTrainingProjection | undefined;

/** The canonical batch-level projection: the venue gate over the REAL batch + episodes + the canonical shape. */
export function canonicalBatchProjection(): LobBatchTrainingProjection {
  cachedBatchProjection ??= (() => {
    const episodes = realEpisodes();
    const outcome = lobBatchTrainingStepsOf(realBatch(episodes), episodes, LOB_SHAPE);
    if (!outcome.ok) {
      throw new Error(`jax-lob fixture batch projection failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
    }
    return outcome.projection;
  })();
  return cachedBatchProjection;
}

let cachedDeclarations: LobEnvironmentDeclarations | undefined;

/** The canonical environment declarations: the venue gate over the REAL W048 plan + the canonical shape. */
export function canonicalDeclarations(): LobEnvironmentDeclarations {
  cachedDeclarations ??= (() => {
    const outcome = lobEnvironmentDeclarationsOf(canonicalPlan(), LOB_SHAPE);
    if (!outcome.ok) {
      throw new Error(`jax-lob fixture environment declarations failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
    }
    return outcome.declarations;
  })();
  return cachedDeclarations;
}

/** The plan the canonical declarations descend from (the REAL W048 compute fixture plan). */
export function canonicalGenerationPlan(): GenerationPlan {
  return canonicalPlan();
}

/** Deep writable clones (for the tamper laws). */
export function thawedEpisodeProjection(): Writable<LobEpisodeTrainingProjection> {
  return thaw(canonicalEpisodeProjection());
}
export function thawedBatchProjection(): Writable<LobBatchTrainingProjection> {
  return thaw(canonicalBatchProjection());
}
export function thawedDeclarations(): Writable<LobEnvironmentDeclarations> {
  return thaw(canonicalDeclarations());
}

/** Assert helper: the fixture batch + episodes realize each other (the batch gate's precondition). */
export function assertBatchRealized(): void {
  const episodes = realEpisodes();
  const batch = realBatch(episodes);
  assert.deepEqual(
    batch.episodeIds.map(String).sort(),
    episodes.map((episode) => String(episode.episodeId)).sort(),
  );
}
