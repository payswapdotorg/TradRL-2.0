/**
 * The R016 point-in-time route law (W059) — explicit cutoffs, never
 * implicit-latest.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  POINT_IN_TIME_CUTOFF_FIELD,
  POINT_IN_TIME_LAW,
  TIME_MACHINE_ROUTE_FAMILY,
  buildRouteTable,
  pointInTimeRouteDeclarations,
  requireExplicitCutoff,
  coreRouteDeclarations,
} from "../index.js";
import type { ApiRouteDeclaration } from "../index.js";

const PIT_ROUTES = pointInTimeRouteDeclarations();
const viewCreate = PIT_ROUTES[0]!;
const viewGet = PIT_ROUTES[1]!;

describe("the time-machine family carries explicit cutoffs", () => {
  it("every time-machine route declares a required simulation-time cutoff field", () => {
    for (const route of pointInTimeRouteDeclarations()) {
      const cutoff = route.request.fields.find(
        (field) => field.name === POINT_IN_TIME_CUTOFF_FIELD,
      );
      assert.ok(cutoff !== undefined, `${route.name}: no cutoff field`);
      assert.equal(cutoff.kind, "simulation-time");
      assert.equal(cutoff.required, true);
    }
  });

  it("the view-create route takes the declared families (W050's closed set)", () => {
    const families = viewCreate.request.fields.find(
      (field) => field.name === "families",
    );
    assert.ok(families !== undefined);
    assert.equal(families.kind, "record-family-set");
    assert.equal(families.required, true);
    assert.equal(viewCreate.method, "POST");
    assert.match(viewCreate.path, /\/time-machine\/views$/);
  });

  it("the view-get route takes the opaque view id plus the declared cutoff", () => {
    assert.equal(viewGet.method, "GET");
    assert.match(viewGet.path, /\/time-machine\/views\/:viewId$/);
    assert.ok(viewGet.request.fields.some((f) => f.name === "cutoff" && f.required));
  });

  it("both routes answer point-in-time payloads citing event evidence", () => {
    assert.equal(viewCreate.response.payloadType, "AssembledPointInTimeView");
    assert.equal(viewGet.response.payloadType, "PointInTimeView");
    for (const route of [viewCreate, viewGet]) {
      assert.deepEqual(route.response.provenance, {
        kind: "evidence-projection",
        entities: ["event"],
      });
    }
  });
});

describe("requireExplicitCutoff — the loud typed violation", () => {
  it("accepts the lawful family declarations", () => {
    for (const route of pointInTimeRouteDeclarations()) {
      assert.deepEqual([...requireExplicitCutoff(route)], []);
    }
  });

  it("refuses a time-machine route with NO cutoff (implicit-latest, R016)", () => {
    const implicitLatest: ApiRouteDeclaration = {
      ...viewGet,
      request: { fields: [] },
    };
    const violations = requireExplicitCutoff(implicitLatest);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.code, "implicit-latest-cutoff");
    assert.equal(violations[0]?.routeName, "time-machine-view-get");
    assert.ok(violations[0]?.message.includes(POINT_IN_TIME_LAW));
  });

  it("refuses an OPTIONAL cutoff (an optional cutoff can still imply latest)", () => {
    const optional: ApiRouteDeclaration = {
      ...viewGet,
      request: {
        fields: viewGet.request.fields.map((field) =>
          field.name === POINT_IN_TIME_CUTOFF_FIELD
            ? { ...field, required: false }
            : field,
        ),
      },
    };
    const violations = requireExplicitCutoff(optional);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.code, "implicit-latest-cutoff");
  });

  it("refuses a cutoff of the wrong kind (latest-timestamp semantics smuggled in)", () => {
    const wrongKind: ApiRouteDeclaration = {
      ...viewGet,
      request: {
        fields: viewGet.request.fields.map((field) =>
          field.name === POINT_IN_TIME_CUTOFF_FIELD
            ? { ...field, kind: "string" }
            : field,
        ),
      },
    };
    const violations = requireExplicitCutoff(wrongKind);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.code, "implicit-latest-cutoff");
  });

  it("leaves non-time-machine families to their own laws", () => {
    const [health] = coreRouteDeclarations().filter((r) => r.name === "health");
    assert.ok(health !== undefined);
    assert.deepEqual([...requireExplicitCutoff(health)], []);
  });
});

describe("the R016 law is enforced at table construction", () => {
  it("an implicit-latest time-machine route is refused in buildRouteTable", () => {
    const implicitLatest: ApiRouteDeclaration = {
      ...viewCreate,
      name: "time-machine-view-latest",
      path: `${viewCreate.path.replace(/views$/, "latest")}`,
      request: { fields: viewCreate.request.fields.filter(
        (field) => field.name !== POINT_IN_TIME_CUTOFF_FIELD,
      ) },
    };
    const outcome = buildRouteTable([...coreRouteDeclarations(), implicitLatest, viewGet]);
    assert.ok(!outcome.ok, JSON.stringify(outcome));
    assert.ok(
      outcome.violations.some((v) => v.code === "implicit-latest-cutoff"),
      JSON.stringify(outcome.violations),
    );
  });

  it("the family tag rides on the default table's time-machine routes", () => {
    const outcome = buildRouteTable([
      ...coreRouteDeclarations(),
      ...pointInTimeRouteDeclarations(),
    ]);
    assert.ok(outcome.ok);
    for (const route of outcome.table.routes) {
      if (route.name.startsWith("time-machine-")) {
        assert.equal(route.family, TIME_MACHINE_ROUTE_FAMILY);
      }
    }
  });
});
