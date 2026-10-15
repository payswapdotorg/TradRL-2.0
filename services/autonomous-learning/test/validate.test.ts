/**
 * The whole-cycle re-validation laws (W055) — REAL imports only; every
 * re-derivation refusal is pinned (A9: recorded data is re-proven, never
 * trusted).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeImprovementCycle, validateImprovementCycle } from "../index.js";
import type { ImprovementCycle } from "../index.js";
import { aCycleInput, codes, theSteps } from "./fixtures.js";

function aSealedCycle(): ImprovementCycle {
  const outcome = composeImprovementCycle(aCycleInput());
  if (!outcome.ok) {
    throw new Error(`fixture cycle failed to compose: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.cycle;
}

test("the sealed cycle re-validates from its own recorded data", () => {
  const validation = validateImprovementCycle(aSealedCycle());
  assert.deepEqual(validation, { ok: true });
});

test("a rewritten cycle id is the cycle-id-mismatch refusal (A9)", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, cycleId: "impcycle-deadbeef" as ImprovementCycle["cycleId"] });
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("cycle-id-mismatch"));
});

test("a rewritten step list is caught by the id re-derivation (A9)", () => {
  const cycle = aSealedCycle();
  const observe = cycle.steps.find((step) => step.kind === "observe");
  assert.ok(observe !== undefined && observe.kind === "observe");
  const tampered = { ...cycle, steps: cycle.steps.map((step) => step.kind === "observe" ? { ...observe, observations: observe.observations.slice(0, 1) } : step) } as ImprovementCycle;
  const validation = validateImprovementCycle(tampered);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("cycle-id-mismatch"));
});

test("a non-cycle record kind is the invalid-kind refusal", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, kind: "improvement-spree" } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("invalid-kind"));
});

test("a blank scope member is the invalid-scope refusal (§14)", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, scope: { ...cycle.scope, tenantId: "" } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("invalid-scope"));
});

test("a recorded cycle with a missing step is the invalid-step refusal (A6, carried verbatim)", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, steps: cycle.steps.filter((step) => step.kind !== "re-selection") } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  const invalid = validation.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "missing-step" && error.stepKind === "re-selection"));
  assert.ok(codes(validation).includes("cycle-id-mismatch") || codes(validation).includes("non-canonical-order"));
});

test("a recorded cycle whose steps are out of loop order is the non-canonical-order refusal (A9)", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, steps: [...theSteps()].reverse() } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("non-canonical-order"));
  assert.ok(codes(validation).includes("cycle-id-mismatch"));
});

test("a recorded cycle with an uncited observe step is the A6 refusal", () => {
  const cycle = aSealedCycle();
  const emptied = cycle.steps.map((step) => step.kind === "observe" ? { kind: "observe" as const, observations: [] } : step);
  const validation = validateImprovementCycle({ ...cycle, steps: emptied } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  const invalid = validation.errors.find((error) => error.code === "invalid-step");
  assert.ok(invalid !== undefined);
  assert.ok((invalid.stepErrors ?? []).some((error) => error.code === "uncited-step"));
});

test("a root cycle declaring a parent is the lineage-break refusal", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, lineage: { ...cycle.lineage, parent: cycle.cycleId } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("lineage-break"));
});

test("a continuation declaring no parent is the lineage-break refusal", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, lineage: { parent: undefined, root: cycle.lineage.root, ordinal: 3 } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("lineage-break"));
});

test("a rewritten provenance digest is the provenance-mismatch refusal (A9)", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, provenance: { ...cycle.provenance, inputDigest: "00000000" } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("provenance-mismatch"));
});

test("a rewritten law list is the provenance-mismatch refusal", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, provenance: { ...cycle.provenance, laws: ["a-law-of-my-own"] } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("provenance-mismatch"));
});

test("a bogus deriver name is the provenance-mismatch refusal", () => {
  const cycle = aSealedCycle();
  const validation = validateImprovementCycle({ ...cycle, provenance: { ...cycle.provenance, deriver: "improve-autonomously" } } as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.ok(codes(validation).includes("provenance-mismatch"));
});

test("malformed input is refused with named errors, never thrown at", () => {
  const validation = validateImprovementCycle(null as unknown as ImprovementCycle);
  assert.ok(!validation.ok);
  assert.deepEqual(codes(validation), ["malformed-record"]);
});
