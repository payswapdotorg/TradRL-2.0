/**
 * Validation tests (W039): every model law fails closed, loudly, with the
 * law NAMED — and the honest fixture passes with the full checked list.
 *
 * Run: pnpm --filter organization test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrganizationDefinition } from "../definition.js";
import { validateOrganizationDefinition } from "../validate.js";
import {
  INSTRUMENT_ES,
  POSITION_ANALYST,
  POSITION_RISK,
  POSITION_TRADER,
  UNIT_FRONT,
  UNIT_RESEARCH,
  UNIT_RISK,
  organizationDefinition,
  riskPosition,
  traderPosition,
  violationCodes,
} from "./fixtures.js";

function expectViolation(
  definition: OrganizationDefinition,
  code: string,
): void {
  const outcome = validateOrganizationDefinition(definition);
  assert.equal(outcome.ok, false, `expected a violation (${code}), got ok`);
  assert.ok(
    outcome.errors !== undefined && outcome.errors.some((error) => error.code === code),
    `expected code '${code}' among [${violationCodes(outcome).join(", ")}] with messages: ${
      outcome.errors?.map((error) => error.message).join(" | ") ?? ""
    }`,
  );
}

describe("the honest fixture validates", () => {
  it("passes with the full checked evidence list", () => {
    const outcome = validateOrganizationDefinition(organizationDefinition());
    assert.equal(outcome.ok, true);
    assert.ok(outcome.checked.includes("composition-acyclic"));
    assert.ok(outcome.checked.includes("binding-scope-subset"));
    assert.ok(outcome.checked.includes("capability-references"));
  });
});

describe("identity laws", () => {
  it("duplicate position ids are loud", () => {
    expectViolation(
      organizationDefinition({
        positions: [traderPosition(), traderPosition(), ...organizationDefinition().positions.slice(1)],
      }),
      "duplicate-position",
    );
  });

  it("duplicate unit ids are loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        units: [...base.units, { ...base.units[0]!, name: "front office again" }],
      }),
      "duplicate-unit",
    );
  });

  it("duplicate capability declarations are loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({ capabilities: [...base.capabilities, base.capabilities[0]!] }),
      "duplicate-capability",
    );
  });

  it("blank fields are loud", () => {
    expectViolation(
      organizationDefinition({ scope: { tenantId: "", projectId: "p", worldId: "w" } }),
      "blank-field",
    );
  });
});

describe("capability laws", () => {
  it("unknown capability reference is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        positions: base.positions.map((position) =>
          position.positionId === POSITION_TRADER
            ? traderPosition({
                capabilityDemands: [{ capabilityId: "capability-unknown" as typeof position.capabilityDemands[number]["capabilityId"], rationale: "demanded nowhere" }],
              })
            : position,
        ),
      }),
      "unknown-capability",
    );
  });

  it("a blank demand rationale is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        positions: base.positions.map((position) =>
          position.positionId === POSITION_TRADER
            ? traderPosition({ capabilityDemands: [{ capabilityId: position.capabilityDemands[0]!.capabilityId, rationale: "  " }] })
            : position,
        ),
      }),
      "blank-field",
    );
  });
});

describe("requirement laws", () => {
  it("a position whose body requirement says nothing is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        positions: base.positions.map((position) =>
          position.positionId === POSITION_TRADER
            ? traderPosition({ bodyRequirement: { commandKinds: [], instruments: [], observations: [] } })
            : position,
        ),
      }),
      "position-without-requirements",
    );
  });

  it("a position whose substrate requirement says nothing is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        positions: base.positions.map((position) =>
          position.positionId === POSITION_TRADER
            ? traderPosition({ substrateRequirement: { stateMode: "declared-state", minMaxDecisionsPerView: 1, commandKinds: [] } })
            : position,
        ),
      }),
      "position-without-requirements",
    );
  });

  it("unknown command kinds / observation kinds / state modes are loud", () => {
    const base = organizationDefinition();
    const mangled = organizationDefinition({
      positions: base.positions.map((position) =>
        position.positionId === POSITION_TRADER
          ? traderPosition({
              bodyRequirement: {
                commandKinds: ["submit-order", "teleport-order" as never],
                instruments: [INSTRUMENT_ES],
                observations: ["market-quote", "tea-leaves" as never],
              },
              substrateRequirement: { stateMode: "psychic" as never, minMaxDecisionsPerView: 1, commandKinds: ["submit-order"] },
            })
          : position,
      ),
    });
    const outcome = validateOrganizationDefinition(mangled);
    assert.equal(outcome.ok, false);
    const codes = violationCodes(outcome);
    assert.ok(codes.includes("invalid-requirement"));
    assert.equal(codes.filter((code) => code === "invalid-requirement").length, 3);
  });

  it("a non-integer or sub-1 decision cap is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        positions: base.positions.map((position) =>
          position.positionId === POSITION_TRADER
            ? traderPosition({ substrateRequirement: { stateMode: "declared-state", minMaxDecisionsPerView: 0, commandKinds: ["submit-order"] } })
            : position,
        ),
      }),
      "invalid-requirement",
    );
  });
});

describe("composition laws", () => {
  it("cyclic composition is loud (A → B → A)", () => {
    expectViolation(
      organizationDefinition({
        units: [
          { unitId: UNIT_FRONT, name: "front", parentUnitId: UNIT_RESEARCH, positionIds: [POSITION_TRADER] },
          { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
          { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
        ],
      }),
      "cyclic-composition",
    );
  });

  it("a unit composing into itself is loud", () => {
    expectViolation(
      organizationDefinition({
        units: [
          { unitId: UNIT_FRONT, name: "front", parentUnitId: UNIT_FRONT, positionIds: [POSITION_TRADER] },
          { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
          { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
        ],
      }),
      "cyclic-composition",
    );
  });

  it("an unknown parent unit is loud", () => {
    expectViolation(
      organizationDefinition({
        units: [
          { unitId: UNIT_FRONT, name: "front", parentUnitId: null, positionIds: [POSITION_TRADER] },
          { unitId: UNIT_RESEARCH, name: "research", parentUnitId: "unit-ghost" as typeof UNIT_FRONT, positionIds: [POSITION_ANALYST] },
          { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
        ],
      }),
      "unknown-unit",
    );
  });

  it("a unit composing an unknown position is loud", () => {
    expectViolation(
      organizationDefinition({
        units: [
          { unitId: UNIT_FRONT, name: "front", parentUnitId: null, positionIds: [POSITION_TRADER, "position-ghost" as typeof POSITION_TRADER] },
          { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
          { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
        ],
      }),
      "unknown-position",
    );
  });

  it("a position composing into TWO units is loud", () => {
    expectViolation(
      organizationDefinition({
        units: [
          { unitId: UNIT_FRONT, name: "front", parentUnitId: null, positionIds: [POSITION_TRADER] },
          { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
          { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK, POSITION_TRADER] },
        ],
      }),
      "duplicate-membership",
    );
  });

  it("an empty organization is loud", () => {
    expectViolation(organizationDefinition({ positions: [], bindings: [], units: [] }), "empty-organization");
  });
});

describe("binding laws", () => {
  it("a duplicate binding for one position is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({ bindings: [...base.bindings, base.bindings[0]!] }),
      "duplicate-binding",
    );
  });

  it("an unbound position is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({ bindings: base.bindings.slice(0, 2) }),
      "unbound-position",
    );
  });

  it("a binding off the organization channel is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        bindings: base.bindings.map((binding) =>
          binding.positionId === POSITION_RISK ? { ...binding, grant: { ...binding.grant, channel: "operator" } } : binding,
        ),
      }),
      "invalid-channel",
    );
  });

  it("a blank grant basis is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        bindings: base.bindings.map((binding) =>
          binding.positionId === POSITION_RISK ? { ...binding, grant: { ...binding.grant, basis: "" } } : binding,
        ),
      }),
      "blank-field",
    );
  });

  it("a narrowing that WIDENS beyond the position requirement is loud (scope mismatch)", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        bindings: base.bindings.map((binding) =>
          binding.positionId === POSITION_TRADER
            ? { ...binding, scopeNarrowing: { instruments: [], commandKinds: ["branch-world"] } }
            : binding,
        ),
      }),
      "scope-mismatch",
    );
  });

  it("a narrowing instrument outside the requirement is loud", () => {
    const base = organizationDefinition();
    expectViolation(
      organizationDefinition({
        bindings: base.bindings.map((binding) =>
          binding.positionId === POSITION_TRADER
            ? { ...binding, scopeNarrowing: { instruments: ["instrument-nq" as typeof INSTRUMENT_ES] } }
            : binding,
        ),
      }),
      "scope-mismatch",
    );
  });
});

describe("lineage laws", () => {
  it("genesis with a parent is loud", () => {
    expectViolation(
      organizationDefinition({
        lineage: { parentOrganizationId: "org-00000000" as OrganizationDefinition["lineage"]["parentOrganizationId"], origin: { kind: "genesis" } },
      }),
      "invalid-lineage",
    );
  });

  it("a derived organization without a parent is loud", () => {
    expectViolation(
      organizationDefinition({
        lineage: { parentOrganizationId: null, origin: { kind: "organization", operation: "remove-position", subject: "position-x" } },
      }),
      "invalid-lineage",
    );
  });

  it("an origin kind outside W036's ABLATION_KINDS is loud", () => {
    expectViolation(
      organizationDefinition({
        lineage: {
          parentOrganizationId: "org-00000000" as OrganizationDefinition["lineage"]["parentOrganizationId"],
          origin: { kind: "holdout" as never, operation: "remove-position", subject: "position-x" },
        },
      }),
      "invalid-lineage",
    );
  });

  it("a derived organization with a blank subject is loud", () => {
    expectViolation(
      organizationDefinition({
        lineage: {
          parentOrganizationId: "org-00000000" as OrganizationDefinition["lineage"]["parentOrganizationId"],
          origin: { kind: "model-substitution", operation: "substitute-substrate-requirement", subject: "" },
        },
      }),
      "invalid-lineage",
    );
  });

  it("a minimal single-position organization is valid", () => {
    const minimal = organizationDefinition({
      positions: [riskPosition()],
      units: [],
      bindings: [
        {
          positionId: POSITION_RISK,
          grant: { grantedBy: organizationDefinition().bindings[0]!.grant.grantedBy, channel: "organization", grantedAt: 1, basis: "the sole seat is bound" },
        },
      ],
    });
    assert.equal(validateOrganizationDefinition(minimal).ok, true);
  });
});
