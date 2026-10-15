/**
 * The A9 twin (W059) — same declarations ⇒ same table, same ids, input
 * order never matters.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  WORLD_ALPHA_API_V1,
  buildRouteTable,
  coreRouteDeclarations,
  pointInTimeRouteDeclarations,
  routeIdOf,
  tableIdOf,
} from "../index.js";

const ALL = (): readonly ReturnType<typeof coreRouteDeclarations>[number][] => [
  ...coreRouteDeclarations(),
  ...pointInTimeRouteDeclarations(),
];

describe("the A9 twin — deterministic construction", () => {
  it("building the same table twice yields deep-equal tables (ids included)", () => {
    const first = buildRouteTable(ALL());
    const second = buildRouteTable(ALL());
    assert.ok(first.ok && second.ok);
    assert.deepEqual(first.table, second.table);
    assert.equal(first.table.tableId, second.table.tableId);
  });

  it("input order never matters — the canonical order re-derives", () => {
    const forward = buildRouteTable(ALL());
    const shuffled = buildRouteTable([...ALL()].reverse());
    assert.ok(forward.ok && shuffled.ok);
    assert.deepEqual(forward.table, shuffled.table);
    assert.deepEqual(
      shuffled.table.routes.map((route) => route.name),
      [...WORLD_ALPHA_API_V1.routes].map((route) => route.name),
    );
  });

  it("the default table is byte-identical to a fresh build", () => {
    const fresh = buildRouteTable(ALL());
    assert.ok(fresh.ok);
    assert.deepEqual(fresh.table, WORLD_ALPHA_API_V1);
  });

  it("route ids are pure functions of content (no clock, no randomness)", () => {
    const [a, b] = [coreRouteDeclarations(), coreRouteDeclarations()];
    for (let index = 0; index < a.length; index += 1) {
      assert.equal(routeIdOf(a[index]!), routeIdOf(b[index]!));
    }
    assert.equal(
      tableIdOf("v1", WORLD_ALPHA_API_V1.routes),
      WORLD_ALPHA_API_V1.tableId,
    );
  });

  it("one law-bearing change breaks the id chain (content-addressed)", () => {
    const declarations = ALL();
    const mutated = declarations.map((route) =>
      route.name === "health"
        ? { ...route, visibility: "private" as const }
        : route,
    );
    const outcome = buildRouteTable(mutated);
    assert.ok(outcome.ok);
    const fresh = buildRouteTable(declarations);
    assert.ok(fresh.ok);
    assert.notEqual(outcome.table.tableId, fresh.table.tableId);
    const mutatedHealth = outcome.table.routes.find((r) => r.name === "health");
    const freshHealth = fresh.table.routes.find((r) => r.name === "health");
    assert.notEqual(mutatedHealth?.routeId, freshHealth?.routeId);
    // ...and every OTHER route id is untouched.
    const otherNames = outcome.table.routes
      .map((r) => r.name)
      .filter((name) => name !== "health");
    for (const name of otherNames) {
      assert.equal(
        outcome.table.routes.find((r) => r.name === name)?.routeId,
        fresh.table.routes.find((r) => r.name === name)?.routeId,
      );
    }
  });
});
