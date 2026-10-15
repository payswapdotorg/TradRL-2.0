/**
 * The A9 determinism twin laws (W042): same demand + same registry +
 * same skills + same benchmark surface ⇒ deep-equal plan and the same
 * canonical selection id; input declaration order NEVER leaks (A9).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { selectSubstrate } from "../select.js";
import { benchmarkSurface, extractedSkills, selectionDemand } from "./fixtures.js";
import { registryFixture } from "./evidence.js";

test("A9 twin: the same inputs produce a deep-equal plan and the same selection id", () => {
  const left = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), benchmarkSurface());
  const right = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(left.ok, true);
  deepEqual(right.ok, true);
  if (!left.ok || !right.ok) {
    return;
  }
  deepEqual(left.plan, right.plan);
  deepEqual(String(left.plan.selectionId), String(right.plan.selectionId));
});

test("A9 twin: input declaration order never leaks (candidates, skills, evaluations, catalogue reversed)", () => {
  const demand = selectionDemand();
  const surface = benchmarkSurface();
  const reordered = selectionDemand({
    candidates: [...demand.candidates].reverse(),
    benchmarkPolicy: [...demand.benchmarkPolicy].reverse(),
  });
  const reorderedSurface = benchmarkSurface({
    catalogue: [...surface.catalogue].reverse(),
    evaluations: [...surface.evaluations].reverse(),
  });
  const left = selectSubstrate(demand, registryFixture(), extractedSkills(), surface);
  const right = selectSubstrate(reordered, registryFixture(), [...extractedSkills()].reverse(), reorderedSurface);
  deepEqual(left.ok, true);
  deepEqual(right.ok, true);
  if (!left.ok || !right.ok) {
    return;
  }
  deepEqual(left.plan, right.plan);
  deepEqual(String(left.plan.selectionId), String(right.plan.selectionId));
});

test("A9 twin: a different demand produces a different selection id", () => {
  const base = selectionDemand();
  const other = selectionDemand({ position: { ...base.position, title: "risk seat" } });
  const left = selectSubstrate(base, registryFixture(), extractedSkills(), benchmarkSurface());
  const right = selectSubstrate(other, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(left.ok, true);
  deepEqual(right.ok, true);
  if (!left.ok || !right.ok) {
    return;
  }
  deepEqual(String(left.plan.selectionId) !== String(right.plan.selectionId), true);
});
