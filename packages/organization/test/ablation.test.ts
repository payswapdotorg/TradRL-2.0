/**
 * Ablation tests (W039): R053 + §13 — the typed pure derivation laws.
 * Every operation produces a NEW valid definition with a derived
 * identity and an immutable lineage citing the parent; the input is
 * never mutated; law-violating results are refused loudly.
 *
 * Run: pnpm --filter organization test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ablatePosition,
  ablateUnit,
  substituteBodyRequirement,
  substituteSubstrateRequirement,
} from "../ablation.js";
import type { OrganizationAblationOutcome } from "../ablation.js";
import { organizationIdOf } from "../identity.js";
import { validateOrganizationDefinition } from "../validate.js";
import type { OrganizationDefinition } from "../definition.js";
import {
  POSITION_ANALYST,
  POSITION_RISK,
  POSITION_TRADER,
  UNIT_FRONT,
  UNIT_RESEARCH,
  UNIT_RISK,
  organizationDefinition,
  riskPosition,
} from "./fixtures.js";

function okDefinition(outcome: OrganizationAblationOutcome): OrganizationDefinition {
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    return outcome.definition;
  }
  throw new Error("unreachable");
}

describe("ablatePosition (the organization axis)", () => {
  it("removes the position, its binding and every unit membership", () => {
    const base = organizationDefinition();
    const result = okDefinition(ablatePosition(base, POSITION_ANALYST));
    assert.equal(result.positions.some((position) => position.positionId === POSITION_ANALYST), false);
    assert.equal(result.bindings.some((binding) => binding.positionId === POSITION_ANALYST), false);
    assert.equal(
      result.units.some((unit) => unit.positionIds.includes(POSITION_ANALYST)),
      false,
    );
    // The seat count drops by exactly one; nothing else is dropped.
    assert.equal(result.positions.length, base.positions.length - 1);
  });

  it("produces a VALID definition with a lineage citing the parent", () => {
    const base = organizationDefinition();
    const parentId = organizationIdOf(base);
    const result = okDefinition(ablatePosition(base, POSITION_ANALYST));
    assert.equal(validateOrganizationDefinition(result).ok, true);
    assert.deepEqual(result.lineage, {
      parentOrganizationId: parentId,
      origin: { kind: "organization", operation: "remove-position", subject: String(POSITION_ANALYST) },
    });
    assert.notEqual(organizationIdOf(result), parentId);
  });

  it("never mutates the input (immutability + purity)", () => {
    const base = organizationDefinition();
    const snapshot = structuredClone(base);
    ablatePosition(base, POSITION_RISK);
    assert.deepEqual(base, snapshot);
  });

  it("is deterministic (A9 twin: same operation twice, deep-equal + same id)", () => {
    const base = organizationDefinition();
    const left = okDefinition(ablatePosition(base, POSITION_TRADER));
    const right = okDefinition(ablatePosition(base, POSITION_TRADER));
    assert.deepEqual(left, right);
    assert.equal(organizationIdOf(left), organizationIdOf(right));
  });

  it("refuses to remove the last position (empty organization, carried verbatim)", () => {
    const base = organizationDefinition();
    const sole = organizationDefinition({
      positions: [riskPosition()],
      units: [],
      bindings: [base.bindings[2]!],
    });
    assert.equal(validateOrganizationDefinition(sole).ok, true);
    const outcome = ablatePosition(sole, POSITION_RISK);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "ablation-invalid");
    assert.ok(outcome.error.validationErrors?.some((error) => error.code === "empty-organization"));
  });

  it("refuses an unknown position loudly", () => {
    const outcome = ablatePosition(organizationDefinition(), "position-ghost" as typeof POSITION_TRADER);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "unknown-position");
  });
});

describe("ablateUnit (the organization axis)", () => {
  it("absorbs the removed child unit's positions into the parent unit", () => {
    const base = organizationDefinition();
    const result = okDefinition(ablateUnit(base, UNIT_RESEARCH));
    assert.equal(result.units.some((unit) => unit.unitId === UNIT_RESEARCH), false);
    const front = result.units.find((unit) => unit.unitId === UNIT_FRONT);
    assert.ok(front !== undefined);
    assert.ok(front.positionIds.includes(POSITION_ANALYST));
    assert.equal(validateOrganizationDefinition(result).ok, true);
    assert.equal(result.positions.length, base.positions.length);
  });

  it("reparents child units of the removed unit deterministically", () => {
    const base = organizationDefinition();
    // Give the research unit a child so reparenting is observable.
    const nested = organizationDefinition({
      units: [
        ...base.units,
        { unitId: "unit-micro" as typeof UNIT_RISK, name: "micro research", parentUnitId: UNIT_RESEARCH, positionIds: [] },
      ],
    });
    const result = okDefinition(ablateUnit(nested, UNIT_RESEARCH));
    const micro = result.units.find((unit) => unit.unitId === "unit-micro");
    assert.ok(micro !== undefined);
    assert.equal(micro.parentUnitId, UNIT_FRONT);
    assert.equal(result.units.some((unit) => unit.unitId === UNIT_RESEARCH), false);
  });

  it("root unit ablation turns its positions into direct organization members", () => {
    const base = organizationDefinition();
    const result = okDefinition(ablateUnit(base, UNIT_FRONT));
    // front office was a root unit: its trader position is now root-level
    // (a member of NO unit), still declared and still bound.
    assert.equal(
      result.units.some((unit) => unit.positionIds.includes(POSITION_TRADER)),
      false,
    );
    assert.ok(result.positions.some((position) => position.positionId === POSITION_TRADER));
    assert.ok(result.bindings.some((binding) => binding.positionId === POSITION_TRADER));
    assert.equal(validateOrganizationDefinition(result).ok, true);
    assert.deepEqual(result.lineage.origin, {
      kind: "organization",
      operation: "remove-unit",
      subject: String(UNIT_FRONT),
    });
  });

  it("refuses an unknown unit loudly", () => {
    const outcome = ablateUnit(organizationDefinition(), "unit-ghost" as typeof UNIT_FRONT);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "unknown-unit");
  });
});

describe("substitution (the model-substitution axis)", () => {
  it("substituteSubstrateRequirement swaps the mind requirement and files under model-substitution", () => {
    const base = organizationDefinition();
    const result = okDefinition(
      substituteSubstrateRequirement(base, POSITION_TRADER, {
        stateMode: "stateless-per-view",
        minMaxDecisionsPerView: 3,
        commandKinds: ["submit-order", "cancel-order"],
      }),
    );
    const trader = result.positions.find((position) => position.positionId === POSITION_TRADER);
    assert.ok(trader !== undefined);
    assert.equal(trader.substrateRequirement.stateMode, "stateless-per-view");
    assert.equal(trader.substrateRequirement.minMaxDecisionsPerView, 3);
    assert.deepEqual(result.lineage.origin, {
      kind: "model-substitution",
      operation: "substitute-substrate-requirement",
      subject: String(POSITION_TRADER),
    });
    assert.equal(validateOrganizationDefinition(result).ok, true);
    assert.notEqual(organizationIdOf(result), organizationIdOf(base));
  });

  it("substituteBodyRequirement files under organization and refuses narrowing violations", () => {
    const base = organizationDefinition();
    const swapped = okDefinition(
      substituteBodyRequirement(base, POSITION_TRADER, {
        commandKinds: ["submit-order", "cancel-order", "close-position"],
        instruments: base.positions[0]!.bodyRequirement.instruments,
        observations: base.positions[0]!.bodyRequirement.observations,
      }),
    );
    assert.deepEqual(swapped.lineage.origin, {
      kind: "organization",
      operation: "substitute-body-requirement",
      subject: String(POSITION_TRADER),
    });
    // The trader binding narrows instruments to instrument-es, which the
    // new requirement still covers — valid. Now drop the instruments to
    // nothing and the narrowing widens: refused, carried verbatim.
    const refused = substituteBodyRequirement(base, POSITION_TRADER, {
      commandKinds: ["submit-order"],
      instruments: [],
      observations: ["market-quote"],
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "ablation-invalid");
    assert.ok(refused.error.validationErrors?.some((error) => error.code === "scope-mismatch"));
  });

  it("refuses an unknown position loudly", () => {
    const outcome = substituteSubstrateRequirement(
      organizationDefinition(),
      "position-ghost" as typeof POSITION_TRADER,
      { stateMode: "stateless-per-view", minMaxDecisionsPerView: 1, commandKinds: ["submit-order"] },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "unknown-position");
  });

  it("is deterministic (A9 twin)", () => {
    const base = organizationDefinition();
    const left = okDefinition(
      substituteSubstrateRequirement(base, POSITION_ANALYST, {
        minMaxDecisionsPerView: 4,
        commandKinds: ["submit-order"],
      }),
    );
    const right = okDefinition(
      substituteSubstrateRequirement(base, POSITION_ANALYST, {
        minMaxDecisionsPerView: 4,
        commandKinds: ["submit-order"],
      }),
    );
    assert.deepEqual(left, right);
    assert.equal(organizationIdOf(left), organizationIdOf(right));
  });
});
