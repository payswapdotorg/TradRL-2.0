/**
 * Whole-record re-validation + fail-closed construction (W059) — every law
 * probed, every id RE-DERIVED from recorded content.
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
  validateRouteTable,
} from "../index.js";
import type {
  ApiRoute,
  ApiRouteDeclaration,
  ApiRouteTable,
  RouteTableViolation,
} from "../index.js";

const ALL: readonly ApiRouteDeclaration[] = [
  ...coreRouteDeclarations(),
  ...pointInTimeRouteDeclarations(),
];

function oneRoute(name: string): ApiRouteDeclaration {
  const found = ALL.find((route) => route.name === name);
  assert.ok(found !== undefined, name);
  return found;
}

/** The violations of a build that must have failed (narrows the outcome). */
function violationsOf(
  declarations: readonly Omit<ApiRoute, "routeId">[],
): readonly RouteTableViolation[] {
  const outcome = buildRouteTable(declarations);
  assert.ok(!outcome.ok, "expected the build to fail");
  return outcome.violations;
}

describe("whole-record re-validation of the default table", () => {
  it("re-proves every law and re-derives every id", () => {
    const validation = validateRouteTable(WORLD_ALPHA_API_V1);
    assert.deepEqual(validation, { ok: true });
  });

  it("a tampered route id does not re-derive (route-id-mismatch)", () => {
    const routes = WORLD_ALPHA_API_V1.routes.map((route) => ({ ...route }));
    routes[0] = { ...routes[0]!, routeId: "rt-v1-deadbeef" as never };
    const tampered: ApiRouteTable = {
      ...WORLD_ALPHA_API_V1,
      tableId: tableIdOf("v1", routes as readonly ApiRoute[]),
      routes: routes as readonly ApiRoute[],
    };
    const validation = validateRouteTable(tampered);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.violations.some((v) => v.code === "route-id-mismatch"),
      JSON.stringify(validation.violations),
    );
  });

  it("a tampered table id does not re-derive (table-id-mismatch)", () => {
    const tampered: ApiRouteTable = {
      ...WORLD_ALPHA_API_V1,
      tableId: "rtt-deadbeef" as never,
    };
    const validation = validateRouteTable(tampered);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.violations.some((v) => v.code === "table-id-mismatch"),
      JSON.stringify(validation.violations),
    );
  });

  it("a non-canonical order is refused (non-canonical-order)", () => {
    const reversed = [...WORLD_ALPHA_API_V1.routes].reverse();
    const tampered: ApiRouteTable = {
      ...WORLD_ALPHA_API_V1,
      tableId: tableIdOf("v1", reversed),
      routes: reversed,
    };
    const validation = validateRouteTable(tampered);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.violations.some((v) => v.code === "non-canonical-order"),
      JSON.stringify(validation.violations),
    );
  });
});

describe("fail-closed construction — every law probed", () => {
  it("duplicate lineage names are refused (duplicate-route-name)", () => {
    const outcome = buildRouteTable([oneRoute("health"), oneRoute("health")]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-route-name"));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-method-path"));
  });

  it("duplicate (method, path) under different names is refused", () => {
    const health = oneRoute("health");
    const twin = { ...health, name: "health-again" };
    const outcome = buildRouteTable([health, twin]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-method-path"));
  });

  it("byte-identical declarations are refused twice-over (name AND id)", () => {
    const health = oneRoute("health");
    const copy = JSON.parse(JSON.stringify(health)) as ApiRouteDeclaration;
    const outcome = buildRouteTable([health, copy]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-route-name"));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-method-path"));
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-route-id"));
  });

  it("a renamed copy mints a different id (name is content) — no false duplicate", () => {
    const health = oneRoute("health");
    const copy = JSON.parse(JSON.stringify(health)) as ApiRouteDeclaration;
    const renamed = { ...copy, name: "heartbeat" };
    const outcome = buildRouteTable([health, renamed]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      !outcome.violations.some((v) => v.code === "duplicate-route-id"),
      "the name rides the content digest — a rename mints a new id",
    );
    assert.ok(outcome.violations.some((v) => v.code === "duplicate-method-path"));
  });

  it("unknown methods, families and payload types are refused", () => {
    const badMethod = { ...oneRoute("health"), method: "BREW" as never };
    assert.ok(
      violationsOf([badMethod]).some((v) => v.code === "unknown-method"),
    );
    const badFamily = { ...oneRoute("health"), family: "casino" as never };
    assert.ok(
      violationsOf([badFamily]).some((v) => v.code === "unknown-family"),
    );
    const badPayload = {
      ...oneRoute("health"),
      response: {
        ...oneRoute("health").response,
        payloadType: "Vibes" as never,
      },
    };
    assert.ok(
      violationsOf([badPayload]).some((v) => v.code === "unknown-payload-type"),
    );
  });

  it("path-pattern violations are refused (invalid-path)", () => {
    const trailing = { ...oneRoute("health"), path: "/v1/tenants/:tenantId/health/" };
    assert.ok(
      violationsOf([trailing]).some((v) => v.code === "invalid-path"),
    );
    const unversioned = { ...oneRoute("health"), path: "/tenants/:tenantId/health" };
    assert.ok(
      violationsOf([unversioned]).some((v) => v.code === "invalid-path"),
    );
    const double = { ...oneRoute("health"), path: "/v1//tenants/:tenantId/health" };
    assert.ok(
      violationsOf([double]).some((v) => v.code === "invalid-path"),
    );
  });

  it("duplicate field names and unknown field kinds are refused", () => {
    const dupField = {
      ...oneRoute("health"),
      response: {
        ...oneRoute("health").response,
        fields: [
          ...oneRoute("health").response.fields,
          { ...oneRoute("health").response.fields[0]! },
        ],
      },
    };
    assert.ok(
      violationsOf([dupField]).some((v) => v.code === "duplicate-field-name"),
    );
    const badKind = {
      ...oneRoute("health"),
      response: {
        ...oneRoute("health").response,
        fields: oneRoute("health").response.fields.map((field) =>
          field.name === "status" ? { ...field, kind: "vibe" as never } : field,
        ),
      },
    };
    assert.ok(
      violationsOf([badKind]).some((v) => v.code === "unknown-field-kind"),
    );
  });

  it("blank names and descriptions are refused", () => {
    const blankName = { ...oneRoute("health"), name: "  " };
    assert.ok(
      violationsOf([blankName]).some((v) => v.code === "blank-route-name"),
    );
    const blankDesc = { ...oneRoute("health"), description: "" };
    assert.ok(
      violationsOf([blankDesc]).some((v) => v.code === "blank-description"),
    );
  });

  it("route/table version disagreement is refused (version-mismatch)", () => {
    const v2 = { ...oneRoute("health"), version: "v2" as never };
    const outcome = buildRouteTable([v2], "v1");
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(outcome.violations.some((v) => v.code === "version-mismatch"));
  });

  it("violations are COLLECTED — the declarer sees all problems", () => {
    const broken = {
      ...oneRoute("health"),
      description: "  ",
      method: "BREW" as never,
      family: "casino" as never,
    };
    const outcome = buildRouteTable([broken]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    const codes = outcome.violations.map((v) => v.code);
    assert.ok(codes.includes("blank-description"));
    assert.ok(codes.includes("unknown-method"));
    assert.ok(codes.includes("unknown-family"));
  });
});

describe("the route id derivation", () => {
  it("re-derives the default table's ids from content", () => {
    for (const route of WORLD_ALPHA_API_V1.routes) {
      assert.equal(routeIdOf(route), route.routeId);
    }
  });

  it("differs when any law-bearing member differs", () => {
    const health = oneRoute("health");
    const renamed = { ...health, name: "heartbeat" };
    assert.notEqual(routeIdOf(health), routeIdOf(renamed));
    const rescoped = { ...health, scope: "tenant-project" as never, path: "/v1/tenants/:tenantId/projects/:projectId/health" };
    assert.notEqual(routeIdOf(health), routeIdOf(rescoped));
  });
});
