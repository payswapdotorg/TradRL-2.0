/**
 * The composition-gate laws (W055) — REAL imports only: every fixture is
 * built through the REAL gates (see ./fixtures.ts), every refusal law is
 * pinned, every carried-verbatim carry is proven present.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeImprovementCycle } from "../index.js";
import type { ImprovementCycleInput, ImprovementCycleId } from "../index.js";
import { foundBrain } from "firm-brain";
import {
  SCOPE,
  aCycleInput,
  codes,
  theAdversarialPairing,
  theCurriculum,
  theFedBrain,
  theForgedPlan,
  thePostMortem,
  theSelfPlayPairing,
  theSkills,
  theSteps,
} from "./fixtures.js";

test("the happy path seals the improvement cycle", () => {
  const outcome = composeImprovementCycle(aCycleInput());
  assert.ok(outcome.ok);
  assert.match(outcome.cycle.cycleId, /^impcycle-[0-9a-f]+$/);
  assert.equal(outcome.cycle.kind, "improvement-cycle");
  assert.equal(outcome.cycle.scope.tenantId, SCOPE.tenantId);
  assert.deepEqual(outcome.cycle.steps.map((step) => step.kind), ["observe", "post-mortem", "brain-update", "curriculum-adjustment", "re-selection", "re-commissioning"]);
  assert.equal(outcome.cycle.lineage.ordinal, 0);
  assert.equal(outcome.cycle.lineage.parent, undefined);
  assert.equal(outcome.cycle.lineage.root, outcome.cycle.cycleId);
});

test("a malformed input is refused loudly", () => {
  const outcome = composeImprovementCycle({} as unknown as ImprovementCycleInput);
  assert.ok(!outcome.ok);
  assert.deepEqual(codes(outcome), ["malformed-input"]);
});

test("a blank scope member is the invalid-scope refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, scope: { ...input.scope, worldId: "" } });
  assert.ok(!outcome.ok);
  assert.equal(codes(outcome)[0], "invalid-scope");
});

test("a missing loop step is the loud A6 missing-step refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.filter((step) => step.kind !== "observe") });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "missing-step" && error.stepKind === "observe" && error.message.includes("A6")));
});

test("an uncited step is the loud A6 uncited-step refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.map((step) => step.kind === "observe" ? { kind: "observe", observations: [] } : step) });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "uncited-step" && error.message.includes("A6")));
});

test("an unknown step kind is refused loudly", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: [...input.steps.slice(0, 5), { kind: "turbo-boost" } as never] });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "unknown-step-kind"));
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "missing-step" && error.stepKind === "re-commissioning"));
});

test("a tampered post-mortem is refused with W053's errors carried verbatim", () => {
  const input = aCycleInput();
  const tampered = { ...thePostMortem(), evaluation: { ...thePostMortem().evaluation, passCount: 999 } } as never;
  const outcome = composeImprovementCycle({ ...input, postMortem: tampered });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-post-mortem");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.postMortemErrors ?? []).length > 0);
});

test("a tampered brain generation is refused with W054's errors carried verbatim", () => {
  const input = aCycleInput();
  const tampered = { ...theFedBrain(), generation: 7 } as never;
  const outcome = composeImprovementCycle({ ...input, brain: tampered });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-brain");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.brainErrors ?? []).some((error) => error.code === "brain-id-mismatch"));
});

test("a tampered curriculum is refused with W046's errors carried verbatim", () => {
  const input = aCycleInput();
  const tampered = { ...theCurriculum(), activeStage: 9 } as never;
  const outcome = composeImprovementCycle({ ...input, curriculum: tampered });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-curriculum");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.curriculumErrors ?? []).length > 0);
});

test("a tampered pairing plan is refused with W046's errors carried verbatim", () => {
  const input = aCycleInput();
  const tampered = { ...theSelfPlayPairing(), memberCount: 99 } as never;
  const outcome = composeImprovementCycle({ ...input, pairings: [tampered, theAdversarialPairing()] });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-pairing");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.pairingErrors ?? []).length > 0);
});

test("a tampered skill record is refused with W041's errors carried verbatim", () => {
  const input = aCycleInput();
  const first = theSkills()[0];
  assert.ok(first !== undefined);
  const tampered = { ...first, summary: { ...first.summary, trajectoryCount: 99 } } as never;
  const outcome = composeImprovementCycle({ ...input, skills: [tampered, ...theSkills().slice(1)] });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-skill");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.skillErrors ?? []).length > 0);
});

test("a cross-tenant cited brain is the loud R056 cross-tenant refusal", () => {
  const input = aCycleInput();
  const founded = foundBrain({ ...SCOPE, tenantId: "tenant-somewhere-else" });
  assert.ok(founded.ok);
  const foreign = founded.brain;
  const outcome = composeImprovementCycle({ ...input, brain: foreign, steps: input.steps.map((step) => step.kind === "brain-update" ? { kind: "brain-update", citation: { brainId: String(foreign.brainId), generation: foreign.generation, recordCount: foreign.records.length } } : step) });
  assert.ok(!outcome.ok);
  const crossTenant = outcome.errors.find((error) => error.code === "cross-tenant");
  assert.ok(crossTenant !== undefined);
  assert.match(crossTenant.message, /R056/);
});

test("a same-tenant other-world cited curriculum is the §14 scope-mismatch refusal", () => {
  const input = aCycleInput();
  const foreign = { ...theCurriculum(), scope: { ...theCurriculum().scope, worldId: "world-somewhere-else" } } as never;
  const outcome = composeImprovementCycle({ ...input, curriculum: foreign });
  assert.ok(!outcome.ok);
  const mismatch = outcome.errors.find((error) => error.code === "scope-mismatch");
  assert.ok(mismatch !== undefined);
  assert.match(mismatch.message, /§14/);
});

test("an observation citing a record the brain does not carry is the unknown-citation refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.map((step) => step.kind === "observe" ? { kind: "observe", observations: [{ recordId: "mem-does-not-exist", kind: "post-mortem" }] } : step) });
  assert.ok(!outcome.ok);
  const unknown = outcome.errors.find((error) => error.code === "unknown-citation");
  assert.ok(unknown !== undefined);
  assert.match(unknown.message, /A6/);
});

test("a brain-update citation disagreeing with the cited brain is the citation-mismatch refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.map((step) => step.kind === "brain-update" ? { kind: "brain-update", citation: { brainId: String(theFedBrain().brainId), generation: theFedBrain().generation + 5, recordCount: theFedBrain().records.length } } : step) });
  assert.ok(!outcome.ok);
  assert.ok(codes(outcome).includes("citation-mismatch"));
});

test("an adjustment proposal to a stage the curriculum does not carry is the adjustment-incoherent refusal", () => {
  const input = aCycleInput();
  const curriculum = theCurriculum();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.map((step) => step.kind === "curriculum-adjustment" ? { kind: "curriculum-adjustment", citation: step.citation, declaration: { action: "advance-stage" as const, toStage: curriculum.stages.length } } : step) });
  assert.ok(!outcome.ok);
  const incoherent = outcome.errors.find((error) => error.code === "adjustment-incoherent");
  assert.ok(incoherent !== undefined);
  assert.match(incoherent.message, /incoherent/);
});

test("a re-selection citation naming an unprovided pairing is the unknown-citation refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, pairings: [theAdversarialPairing()] });
  assert.ok(!outcome.ok);
  assert.ok(codes(outcome).includes("unknown-citation"));
});

test("a re-commissioning citation disagreeing with the forged plan is the citation-mismatch refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: input.steps.map((step) => step.kind === "re-commissioning" ? { kind: "re-commissioning", skillCitations: step.skillCitations, planCitations: [{ planId: String(theForgedPlan().planId), endowmentCount: theForgedPlan().endowment.entries.length + 3 }], declaration: step.declaration } : step) });
  assert.ok(!outcome.ok);
  assert.ok(codes(outcome).includes("citation-mismatch"));
});

test("a continuation without a chain root is the lineage-break refusal", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, lineage: { parent: "impcycle-00000000" as ImprovementCycleId } });
  assert.ok(!outcome.ok);
  assert.deepEqual(codes(outcome), ["lineage-break"]);
});

test("a lawful continuation seals with the parent carried verbatim (the lineage rides beside the id — the W053/W054 convention)", () => {
  const first = composeImprovementCycle(aCycleInput());
  assert.ok(first.ok);
  const second = composeImprovementCycle({ ...aCycleInput(), lineage: { parent: first.cycle.cycleId, root: first.cycle.lineage.root, ordinal: 1 } });
  assert.ok(second.ok);
  assert.equal(second.cycle.lineage.parent, first.cycle.cycleId);
  assert.equal(second.cycle.lineage.ordinal, 1);
  assert.equal(second.cycle.lineage.root, first.cycle.lineage.root);
  assert.equal(second.cycle.cycleId, first.cycle.cycleId);
});

test("the sealed step order is the canonical loop order whatever the input order", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: [...input.steps].reverse() });
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.cycle.steps.map((step) => step.kind), ["observe", "post-mortem", "brain-update", "curriculum-adjustment", "re-selection", "re-commissioning"]);
});

test("the full loop's refusal collects every violation, never silently repairing", () => {
  const input = aCycleInput();
  const outcome = composeImprovementCycle({ ...input, steps: theSteps().slice(0, 2) as never, scope: { ...SCOPE, tenantId: "" } });
  assert.ok(!outcome.ok);
  const invalid = outcome.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).filter((error) => error.code === "missing-step").length >= 4);
});
