/**
 * The route-table data laws (W059) — the default table, the §14 scope/path
 * coherence, the W028 provenance carriage, the closed vocabularies.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  API_METHODS,
  API_ROUTE_SCOPE_KINDS,
  PROVENANCE_ENTITY_KINDS,
  RECORD_FAMILY_VOCABULARY,
  REQUEST_FIELD_KINDS,
  RESPONSE_FIELD_KINDS,
  ROUTE_PAYLOAD_TYPES,
  ROUTE_PAYLOAD_TYPE_NAMES,
  SCOPE_MEMBERS_OF,
  WORLD_ALPHA_API_V1,
  WORLD_ALPHA_ROUTE_NAMES,
  coreRouteDeclarations,
  parsePathPattern,
  pointInTimeRouteDeclarations,
  buildRouteTable,
} from "../index.js";
import { TIME_MACHINE_FAMILIES } from "tradrl-time-machine";

describe("the default World-Alpha route table", () => {
  it("builds fail-closed with all ten routes", () => {
    const table = WORLD_ALPHA_API_V1;
    assert.equal(table.apiVersion, "v1");
    assert.equal(table.routes.length, 10);
    assert.match(table.tableId, /^rtt-/);
    for (const route of table.routes) {
      assert.match(route.routeId, /^rt-v1-/);
      assert.ok(Object.isFrozen(route));
    }
    assert.ok(Object.isFrozen(table.routes));
  });

  it("carries the routes in canonical (name) order matching the drift anchor", () => {
    const names = WORLD_ALPHA_API_V1.routes.map((route) => route.name);
    assert.deepEqual(names, [...WORLD_ALPHA_ROUTE_NAMES]);
    assert.deepEqual(names, [...names].sort());
  });

  it("declares the platform routes public and every other route private", () => {
    const byVisibility = new Map(
      WORLD_ALPHA_API_V1.routes.map((route) => [route.name, route.visibility]),
    );
    assert.equal(byVisibility.get("health"), "public");
    assert.equal(byVisibility.get("route-table"), "public");
    for (const route of WORLD_ALPHA_API_V1.routes) {
      if (route.name !== "health" && route.name !== "route-table") {
        assert.equal(route.visibility, "private", route.name);
      }
    }
  });
});

describe("§14 — the scope is explicit and IS the path", () => {
  it("every route's scope members appear exactly once among its path parameters", () => {
    for (const route of WORLD_ALPHA_API_V1.routes) {
      const { params } = parsePathPattern(route.path);
      const members = SCOPE_MEMBERS_OF[route.scope];
      for (const member of members) {
        assert.equal(
          params.filter((param) => param === member).length,
          1,
          `${route.name}: scope member ${member} must ride the path exactly once`,
        );
      }
    }
  });

  it("every route path starts with its version segment", () => {
    for (const route of WORLD_ALPHA_API_V1.routes) {
      assert.ok(route.path.startsWith(`/${route.version}/`), route.path);
    }
  });

  it("an unscoped route is refused loudly (scope-missing)", () => {
    const [evidence] = coreRouteDeclarations().filter(
      (route) => route.name === "evidence-view",
    );
    assert.ok(evidence !== undefined);
    const unscoped = { ...evidence, scope: "none" as never };
    const outcome = buildRouteTable([unscoped]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "scope-missing"),
      JSON.stringify(outcome.violations),
    );
  });

  it("a scope/path mismatch is refused loudly (scope-mismatch)", () => {
    const [evidence] = coreRouteDeclarations().filter(
      (route) => route.name === "evidence-view",
    );
    assert.ok(evidence !== undefined);
    const mismatched = {
      ...evidence,
      scope: "tenant-project-world" as const,
      path: "/v1/projects/:projectId/worlds/:worldId/evidence",
    };
    const outcome = buildRouteTable([mismatched]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "scope-mismatch"),
      JSON.stringify(outcome.violations),
    );
  });
});

describe("W028 — the provenance citation law", () => {
  it("every data-carrying response cites provenance and carries it on the wire", () => {
    for (const route of WORLD_ALPHA_API_V1.routes) {
      const { fields, provenance } = route.response;
      assert.ok(fields.length > 0, `${route.name}: no fields`);
      assert.ok(provenance !== undefined, `${route.name}: no citation`);
      const wire = fields.filter((field) => field.kind === "provenance-citation");
      assert.equal(wire.length, 1, `${route.name}: provenance wire field`);
      if (provenance.kind === "evidence-projection") {
        assert.ok(provenance.entities.length > 0);
        for (const entity of provenance.entities) {
          assert.ok(PROVENANCE_ENTITY_KINDS.includes(entity));
        }
      } else {
        assert.equal(provenance.kind, "no-declared-source");
      }
    }
  });

  it("the evidence routes project W028's own entity vocabulary", () => {
    const evidenceView = WORLD_ALPHA_API_V1.routes.find(
      (route) => route.name === "evidence-view",
    );
    assert.deepEqual(evidenceView?.response.provenance, {
      kind: "evidence-projection",
      entities: ["event", "artifact", "dataset"],
    });
  });

  it("a data-carrying response without a citation is refused (provenance-missing)", () => {
    const [health] = coreRouteDeclarations().filter(
      (route) => route.name === "health",
    );
    assert.ok(health !== undefined);
    const uncited = {
      ...health,
      response: { ...health.response, provenance: undefined as never },
    };
    const outcome = buildRouteTable([uncited]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "provenance-missing"),
      JSON.stringify(outcome.violations),
    );
  });

  it("a citation naming a non-W028 entity is refused (provenance-entities-empty)", () => {
    const [evidenceEvent] = coreRouteDeclarations().filter(
      (route) => route.name === "evidence-event",
    );
    assert.ok(evidenceEvent !== undefined);
    const fabricated = {
      ...evidenceEvent,
      response: {
        ...evidenceEvent.response,
        provenance: {
          kind: "evidence-projection",
          entities: ["vibes" as never],
        } as never,
      },
    };
    const outcome = buildRouteTable([fabricated]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "provenance-entities-empty"),
      JSON.stringify(outcome.violations),
    );
  });

  it("a response without a provenance wire field is refused (provenance-field-missing)", () => {
    const [health] = coreRouteDeclarations().filter(
      (route) => route.name === "health",
    );
    assert.ok(health !== undefined);
    const noWire = {
      ...health,
      response: {
        ...health.response,
        fields: health.response.fields.filter(
          (field) => field.kind !== "provenance-citation",
        ),
      },
    };
    const outcome = buildRouteTable([noWire]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "provenance-field-missing"),
      JSON.stringify(outcome.violations),
    );
  });
});

describe("the closed vocabularies are the consumed packages' own sets", () => {
  it("the record-family vocabulary IS W050's TIME_MACHINE_FAMILIES", () => {
    assert.deepEqual([...RECORD_FAMILY_VOCABULARY], [...TIME_MACHINE_FAMILIES]);
  });

  it("the payload-type registry covers exactly the closed vocabulary", () => {
    assert.deepEqual(
      Object.keys(ROUTE_PAYLOAD_TYPES).sort(),
      [...ROUTE_PAYLOAD_TYPE_NAMES].sort(),
    );
  });

  it("the method/scope/field-kind vocabularies are closed and canonical", () => {
    assert.deepEqual([...API_METHODS], ["DELETE", "GET", "PATCH", "POST", "PUT"]);
    assert.deepEqual([...API_ROUTE_SCOPE_KINDS], [
      "tenant",
      "tenant-project",
      "tenant-project-world",
    ]);
    assert.deepEqual([...REQUEST_FIELD_KINDS], [...REQUEST_FIELD_KINDS].sort());
    assert.deepEqual([...RESPONSE_FIELD_KINDS], [...RESPONSE_FIELD_KINDS].sort());
    assert.deepEqual(SCOPE_MEMBERS_OF["tenant-project-world"], [
      "tenantId",
      "projectId",
      "worldId",
    ]);
  });

  it("the time-machine family is declared by point-in-time.ts", () => {
    const pitRoutes = pointInTimeRouteDeclarations();
    assert.equal(pitRoutes.length, 2);
    for (const route of pitRoutes) {
      assert.equal(route.family, "time-machine");
      assert.equal(route.method === "POST" || route.method === "GET", true);
    }
  });
});
