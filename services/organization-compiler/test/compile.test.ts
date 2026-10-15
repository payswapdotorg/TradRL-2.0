/**
 * Compile tests (W039): the resolved plan, the A9 twin law, the canonical
 * execution order, and every fail-closed seam — with W034's verdicts
 * carried VERBATIM.
 *
 * Run: pnpm --filter organization-compiler test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BodyDescriptor } from "agent-body";
import type { OrganizationComponentRegistry } from "../registry.js";
import { validateComponentRegistry } from "../registry.js";
import { canonicalExecutionOrder, compileOrganization } from "../compile.js";
import type { CompiledOrganization, OrganizationCompileOutcome } from "../compile.js";
import type { OrganizationDefinition } from "organization";
import { organizationIdOf, validateOrganizationDefinition } from "organization";
import {
  CAPABILITY_LIQUIDITY,
  CAPABILITY_MOMENTUM,
  CAPABILITY_RISK,
  GRANTED_AT,
  INSTRUMENT_ES,
  POSITION_ANALYST,
  POSITION_RISK,
  POSITION_TRADER,
  UNIT_FRONT,
  UNIT_RESEARCH,
  UNIT_RISK,
  alphaBody,
  betaBody,
  componentRegistry,
  organizationDefinition,
  registeredBodies,
  registeredSubstrates,
  statelessSubstrate,
} from "./fixtures.js";

function compiledOf(outcome: OrganizationCompileOutcome): CompiledOrganization {
  assert.equal(outcome.ok, true, `expected a successful compile, got: ${JSON.stringify(outcome.ok ? null : outcome.error)}`);
  if (outcome.ok) {
    return outcome.compiled;
  }
  throw new Error("unreachable");
}

describe("the honest compile", () => {
  it("resolves every position to the deterministic first-eligible pair", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    assert.equal(compiled.bindings.length, 3);
    const byPosition = new Map(compiled.bindings.map((binding) => [String(binding.positionId), binding]));
    // The alpha body is the FIRST eligible body for the trader seat
    // (sorted identity, no backtracking); the analyst and risk seats need
    // the beta body (NQ coverage).
    assert.equal(String(byPosition.get(String(POSITION_TRADER))?.bodyId), "body-compiler-alpha");
    assert.equal(String(byPosition.get(String(POSITION_TRADER))?.substrateId), "substrate-compiler-alpha-momentum");
    assert.equal(String(byPosition.get(String(POSITION_ANALYST))?.bodyId), "body-compiler-beta");
    assert.equal(String(byPosition.get(String(POSITION_ANALYST))?.substrateId), "substrate-compiler-beta-stateless");
    assert.equal(String(byPosition.get(String(POSITION_RISK))?.substrateId), "substrate-compiler-alpha-momentum");
  });

  it("carries the W034 grant and the requirement-derived scope", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    const trader = compiled.bindings.find((binding) => String(binding.positionId) === String(POSITION_TRADER));
    assert.ok(trader !== undefined);
    assert.equal(trader.grant.channel, "organization");
    assert.equal(trader.grant.grantedAt, GRANTED_AT);
    assert.equal(trader.grant.basis, "the organization binds the execution seat");
    assert.deepEqual(trader.scope.instruments.map(String), [String(INSTRUMENT_ES)]);
    assert.deepEqual(trader.scope.commandKinds, ["submit-order", "close-position"]);
    // The analyst binding declares no narrowing: its scope is the whole
    // body requirement.
    const analyst = compiled.bindings.find((binding) => String(binding.positionId) === String(POSITION_ANALYST));
    assert.ok(analyst !== undefined);
    assert.deepEqual(analyst.scope.observations, ["market-quote", "market-trades"]);
  });

  it("cites the W034 compatibility evidence (R051)", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    for (const binding of compiled.bindings) {
      assert.ok(binding.compatibility.checked.includes("embodied-command-kinds"));
      // The no-world branch: attach constraints are NOT claimed.
      assert.equal(binding.compatibility.checked.includes("body-attachment"), false);
    }
  });

  it("lists every position's satisfied capability demands (sorted)", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    const trader = compiled.bindings.find((binding) => String(binding.positionId) === String(POSITION_TRADER));
    assert.ok(trader !== undefined);
    assert.deepEqual(trader.satisfiedCapabilities.map(String), [String(CAPABILITY_MOMENTUM)]);
  });

  it("uses the canonical A6-friendly execution order", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    assert.deepEqual(
      compiled.executionOrder.map(String),
      [String(POSITION_TRADER), String(POSITION_ANALYST), String(POSITION_RISK)],
    );
    // Root positions first, then depth-first over sorted root units.
    const definition = organizationDefinition();
    assert.deepEqual(
      canonicalExecutionOrder(definition).map(String),
      [String(POSITION_TRADER), String(POSITION_ANALYST), String(POSITION_RISK)],
    );
    const rooted = organizationDefinition({
      units: [
        { unitId: UNIT_FRONT, name: "front", parentUnitId: null, positionIds: [POSITION_TRADER] },
        { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [] },
        { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
      ],
    });
    // The analyst seat is root-level now: root positions come FIRST.
    assert.deepEqual(
      canonicalExecutionOrder(rooted).map(String),
      [String(POSITION_ANALYST), String(POSITION_TRADER), String(POSITION_RISK)],
    );
  });

  it("derives the compiled id from the content (orgc-<digest>)", () => {
    const compiled = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    assert.match(compiled.compiledOrganizationId, /^orgc-[0-9a-f]{8}$/);
    assert.equal(compiled.organizationId, organizationIdOf(organizationDefinition()));
  });
});

describe("A9 determinism", () => {
  it("twin: the same definition + registry compile byte-identically", () => {
    const left = compileOrganization(organizationDefinition(), componentRegistry());
    const right = compileOrganization(organizationDefinition(), componentRegistry());
    assert.deepEqual(left, right);
    assert.equal(
      compiledOf(left).compiledOrganizationId,
      compiledOf(right).compiledOrganizationId,
    );
  });

  it("registry declaration order is irrelevant (canonical candidate order)", () => {
    const forward = compileOrganization(organizationDefinition(), componentRegistry());
    const reversed = compileOrganization(
      organizationDefinition(),
      componentRegistry({
        bodies: [...registeredBodies()].reverse(),
        substrates: [...registeredSubstrates()].reverse(),
      }),
    );
    assert.deepEqual(forward, reversed);
  });

  it("a different registry yields a different compiled id", () => {
    const base = compiledOf(compileOrganization(organizationDefinition(), componentRegistry()));
    const swapped = compiledOf(
      compileOrganization(organizationDefinition(), componentRegistry({
        bodies: [
          { body: alphaBody(), providesCapabilities: [CAPABILITY_MOMENTUM, CAPABILITY_LIQUIDITY] },
          { body: betaBody(), providesCapabilities: [CAPABILITY_RISK] },
        ],
      })),
    );
    assert.notEqual(base.compiledOrganizationId, swapped.compiledOrganizationId);
  });
});

describe("fail-closed seams", () => {
  it("definition-invalid: the model's own laws refuse the definition (verbatim)", () => {
    const base = organizationDefinition();
    const invalid: OrganizationDefinition = organizationDefinition({
      capabilities: base.capabilities.slice(0, 2), // drops the liquidity capability
    });
    const outcome = compileOrganization(invalid, componentRegistry());
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "definition-invalid");
    assert.ok(outcome.error.validationErrors?.some((error) => error.code === "unknown-capability"));
  });

  it("registry-invalid: duplicate components are loud (verbatim)", () => {
    const registry = componentRegistry({
      bodies: [...registeredBodies(), { body: alphaBody(), providesCapabilities: [] }],
    });
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "registry-invalid");
    assert.ok(outcome.error.registryErrors?.some((error) => error.code === "duplicate-body"));
  });

  it("registry-invalid: a W032-invalid body is carried verbatim", () => {
    const registry = componentRegistry({
      bodies: [
        { body: alphaBody({ embodiment: { ...alphaBody().embodiment, commandKinds: ["teleport-order" as never] } }), providesCapabilities: [] },
        { body: betaBody(), providesCapabilities: [CAPABILITY_LIQUIDITY, CAPABILITY_RISK] },
      ],
    });
    assert.equal(validateComponentRegistry(registry).ok, false);
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "registry-invalid");
    assert.ok(outcome.error.registryErrors?.some((error) => error.code === "invalid-body"));
  });

  it("registry-scope-mismatch: a foreign registry is loud", () => {
    // The registry is INTERNALLY consistent (components agree with its
    // scope) but disagrees with the ORGANIZATION's scope.
    const foreign = {
      tenantId: "tenant-elsewhere",
      projectId: "project-elsewhere",
      worldId: "world-elsewhere",
    } as BodyDescriptor["scope"];
    const registry = componentRegistry({
      scope: { tenantId: "tenant-elsewhere", projectId: "project-elsewhere", worldId: "world-elsewhere" },
      bodies: [
        { body: alphaBody({ scope: foreign }), providesCapabilities: [CAPABILITY_MOMENTUM] },
        { body: betaBody({ scope: foreign }), providesCapabilities: [CAPABILITY_LIQUIDITY, CAPABILITY_RISK] },
      ],
    });
    assert.equal(validateComponentRegistry(registry).ok, true);
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "registry-scope-mismatch");
  });

  it("unresolvable-position: no registered body covers the seat", () => {
    const registry = componentRegistry({
      bodies: [{ body: alphaBody(), providesCapabilities: [CAPABILITY_MOMENTUM] }],
    });
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "unresolvable-position");
    assert.equal(outcome.error.positionId, String(POSITION_ANALYST));
    assert.match(outcome.error.message, /instruments/);
  });

  it("unresolvable-position: no registered substrate satisfies the seat", () => {
    const registry = componentRegistry({
      substrates: [{ substrate: statelessSubstrate(), providesCapabilities: [CAPABILITY_LIQUIDITY] }],
    });
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "unresolvable-position");
    assert.equal(outcome.error.positionId, String(POSITION_TRADER));
    assert.match(outcome.error.message, /state mode/);
  });

  it("missing-capability: the deterministic pair lacks a demand (never re-picked)", () => {
    const registry = componentRegistry({
      bodies: [
        { body: alphaBody(), providesCapabilities: [CAPABILITY_MOMENTUM] },
        { body: betaBody(), providesCapabilities: [CAPABILITY_LIQUIDITY] },
      ],
    });
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "missing-capability");
    assert.equal(outcome.error.positionId, String(POSITION_RISK));
    assert.equal(outcome.error.capabilityId, String(CAPABILITY_RISK));
  });

  it("incompatible-binding: W034's rate verdict is carried verbatim", () => {
    const base = organizationDefinition();
    const narrowed = organizationDefinition({
      bindings: base.bindings.map((binding) =>
        binding.positionId === POSITION_TRADER
          ? { ...binding, scopeNarrowing: { decisionRate: { maxDecisionsPerView: 1 } } }
          : binding,
      ),
    });
    const outcome = compileOrganization(narrowed, componentRegistry());
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "incompatible-binding");
    assert.ok(outcome.error.incompatibilities?.some((entry) => entry.code === "rate-beyond-grant"));
  });

  it("incompatible-binding: W034's embodiment verdict is carried verbatim", () => {
    const registry: OrganizationComponentRegistry = componentRegistry({
      bodies: [
        // The alpha body STILL covers the trader requirement, but its
        // embodiment no longer admits the substrate's extra kind.
        { body: alphaBody({ embodiment: { ...alphaBody().embodiment, commandKinds: ["submit-order", "close-position"] } }), providesCapabilities: [CAPABILITY_MOMENTUM] },
        { body: betaBody(), providesCapabilities: [CAPABILITY_LIQUIDITY, CAPABILITY_RISK] },
      ],
    });
    const outcome = compileOrganization(organizationDefinition(), registry);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, "incompatible-binding");
    assert.ok(outcome.error.incompatibilities?.some((entry) => entry.code === "command-kind-not-embodied"));
    assert.equal(outcome.error.positionId, String(POSITION_TRADER));
  });
});

describe("purity", () => {
  it("never mutates the definition or the registry", () => {
    const definition = organizationDefinition();
    const registry = componentRegistry();
    const definitionSnapshot = structuredClone(definition);
    const registrySnapshot = structuredClone<OrganizationComponentRegistry>(registry);
    compileOrganization(definition, registry);
    assert.deepEqual(definition, definitionSnapshot);
    assert.deepEqual(
      { scope: registry.scope, bodies: registry.bodies, substrates: registry.substrates },
      { scope: registrySnapshot.scope, bodies: registrySnapshot.bodies, substrates: registrySnapshot.substrates },
    );
    // Model validation still passes afterwards (no in-place corruption).
    assert.equal(validateOrganizationDefinition(definition).ok, true);
  });

  it("compiles a derived (ablated) definition too — the ablation seam", () => {
    // A model-side ablation (remove the analyst seat) compiles cleanly
    // with the SAME registry: the compiler consumes derived definitions.
    const base = organizationDefinition();
    const ablated: OrganizationDefinition = {
      ...base,
      positions: base.positions.filter((position) => position.positionId !== POSITION_ANALYST),
      units: base.units.map((unit) =>
        unit.unitId === UNIT_RESEARCH ? { ...unit, positionIds: [] } : unit,
      ),
      bindings: base.bindings.filter((binding) => binding.positionId !== POSITION_ANALYST),
      lineage: { parentOrganizationId: organizationIdOf(base), origin: { kind: "organization", operation: "remove-position", subject: String(POSITION_ANALYST) } },
    };
    const compiled = compiledOf(compileOrganization(ablated, componentRegistry()));
    assert.equal(compiled.bindings.length, 2);
    assert.deepEqual(
      compiled.executionOrder.map(String),
      [String(POSITION_TRADER), String(POSITION_RISK)],
    );
  });
});
