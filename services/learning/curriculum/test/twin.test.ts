/**
 * The A9 determinism twin (W046, per-package law): same population + same
 * stages + same evidence ⇒ deep-equal curricula with identical canonical
 * ids — at founding AND through the progression gate — with every input
 * order permuted (declaration order, difficulty order, requirement order,
 * evidence order). Input order NEVER leaks.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { foundCurriculum } from "../curriculum.js";
import { advanceStage } from "../progression.js";
import type { StageEvidence } from "../progression.js";
import { canonicalCurriculum, canonicalEvidence, canonicalStages, curriculumPopulation, thaw } from "./fixtures.js";

test("THE TWIN: permuted declarations found the deep-equal curriculum, same canonical id", () => {
  const population = curriculumPopulation();
  const canonical = foundCurriculum(population, canonicalStages());
  // permute stage order, difficulty order, requirement order — all at once
  const permuted = thaw(canonicalStages());
  permuted.reverse();
  for (const stage of permuted) {
    stage.difficulty.reverse();
    stage.threshold.requirements.reverse();
  }
  const twin = foundCurriculum(population, permuted);
  if (!canonical.ok || !twin.ok) {
    assert.fail("expected both to found");
  }
  assert.deepEqual(twin.curriculum, canonical.curriculum);
  assert.equal(String(twin.curriculum.curriculumId), String(canonical.curriculum.curriculumId));
  assert.deepEqual(twin.curriculum.stages[0]!.difficulty, canonical.curriculum.stages[0]!.difficulty);
  assert.deepEqual(twin.curriculum.stages[0]!.threshold.requirements, canonical.curriculum.stages[0]!.threshold.requirements);
});

test("THE TWIN: permuted evidence unseals the deep-equal next generation, same canonical id", () => {
  const { curriculum } = canonicalCurriculum();
  const evidence = canonicalEvidence();
  const first = advanceStage(curriculum, evidence);
  const twin = advanceStage(curriculum, {
    evaluations: [...evidence.evaluations].reverse(),
    findings: [...evidence.findings].reverse(),
  } satisfies StageEvidence);
  if (!first.ok || !twin.ok) {
    assert.fail("expected both to unseal");
  }
  assert.deepEqual(twin.curriculum, first.curriculum);
  assert.equal(String(twin.curriculum.curriculumId), String(first.curriculum.curriculumId));
  assert.deepEqual(twin.gate, first.gate);
});

test("THE TWIN: advancing the twin of the founding record yields the twin of the advanced record", () => {
  const { curriculum } = canonicalCurriculum();
  const twinFounding = foundCurriculum(curriculumPopulation(), canonicalStages());
  if (!twinFounding.ok) {
    assert.fail("expected the twin founding to succeed");
  }
  assert.deepEqual(twinFounding.curriculum, curriculum);
  const advanced = advanceStage(curriculum, canonicalEvidence());
  const twinAdvanced = advanceStage(twinFounding.curriculum, canonicalEvidence());
  if (!advanced.ok || !twinAdvanced.ok) {
    assert.fail("expected both advances to unseal");
  }
  assert.deepEqual(twinAdvanced.curriculum, advanced.curriculum);
});
