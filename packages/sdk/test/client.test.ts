/**
 * The SDK method surface (W059) — the deterministic projection + the drift
 * guard, both directions.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  SDK_DRIFT_GUARD,
  SDK_SURFACE_ROUTE_NAMES,
  assertSdkSurfaceCoversRouteTable,
  buildSdkClient,
  sdkMethodNameOf,
} from "../index.js";
import { WORLD_ALPHA_API_V1, WORLD_ALPHA_ROUTE_NAMES } from "api";

describe("the compile-time drift guard (carried as data)", () => {
  it("the guard is true — the surface mirrors the default table exactly", () => {
    assert.equal(SDK_DRIFT_GUARD, true);
    assert.deepEqual([...SDK_SURFACE_ROUTE_NAMES], [...WORLD_ALPHA_ROUTE_NAMES]);
  });

  it("the method-name derivation is deterministic kebab→camel", () => {
    assert.equal(sdkMethodNameOf("health"), "health");
    assert.equal(sdkMethodNameOf("evidence-view"), "evidenceView");
    assert.equal(sdkMethodNameOf("time-machine-view-create"), "timeMachineViewCreate");
    assert.equal(sdkMethodNameOf("organization-compile"), "organizationCompile");
  });
});

describe("the client construction (deterministic projection)", () => {
  const outcome = buildSdkClient(WORLD_ALPHA_API_V1);

  it("builds one method per route, in the table's canonical order", () => {
    assert.ok(outcome.ok);
    const client = outcome.client;
    assert.equal(client.tableId, WORLD_ALPHA_API_V1.tableId);
    assert.equal(client.apiVersion, "v1");
    assert.equal(client.methods.length, WORLD_ALPHA_API_V1.routes.length);
    assert.deepEqual(
      client.methods.map((binding) => binding.routeName),
      WORLD_ALPHA_API_V1.routes.map((route) => route.name),
    );
    assert.deepEqual(
      client.methods.map((binding) => binding.methodName),
      WORLD_ALPHA_API_V1.routes.map((route) => sdkMethodNameOf(route.name)),
    );
  });

  it("binds every method to its route contract", () => {
    assert.ok(outcome.ok);
    for (const binding of outcome.client.methods) {
      const route = WORLD_ALPHA_API_V1.routes.find(
        (candidate) => candidate.name === binding.routeName,
      );
      assert.ok(route !== undefined, binding.routeName);
      assert.equal(binding.routeId, route.routeId);
      assert.equal(binding.method, route.method);
      assert.equal(binding.pathPattern, route.path);
      assert.equal(binding.scope, route.scope);
      assert.equal(outcome.client.byMethodName[binding.methodName], binding);
    }
  });

  it("indexes by method name and by route name", () => {
    assert.ok(outcome.ok);
    const client = outcome.client;
    assert.ok(client.byMethodName["evidenceView"] !== undefined);
    assert.ok(client.byRouteName["evidence-view"] !== undefined);
    assert.equal(
      client.byMethodName["evidenceView"],
      client.byRouteName["evidence-view"],
    );
  });
});

describe("the runtime drift guard — both directions", () => {
  it("accepts the default table", () => {
    const coverage = assertSdkSurfaceCoversRouteTable(WORLD_ALPHA_API_V1);
    assert.deepEqual(coverage, { ok: true });
  });

  it("refuses a table with a route the SDK does not mirror", () => {
    const drifted = {
      ...WORLD_ALPHA_API_V1,
      routes: [
        ...WORLD_ALPHA_API_V1.routes,
        {
          ...WORLD_ALPHA_API_V1.routes[0]!,
          name: "mystery-route",
          path: "/v1/tenants/:tenantId/mystery",
        },
      ],
    };
    const coverage = assertSdkSurfaceCoversRouteTable(drifted);
    assert.equal(coverage.ok, false);
    assert.ok(
      coverage.errors.some((error) =>
        error.message.includes("mystery-route"),
      ),
    );
    const client = buildSdkClient(drifted);
    assert.equal(client.ok, false);
  });

  it("refuses a table missing a route the SDK mirrors", () => {
    const shrunken = {
      ...WORLD_ALPHA_API_V1,
      routes: WORLD_ALPHA_API_V1.routes.filter(
        (route) => route.name !== "health",
      ),
    };
    const coverage = assertSdkSurfaceCoversRouteTable(shrunken);
    assert.equal(coverage.ok, false);
    assert.ok(
      coverage.errors.some((error) => error.message.includes("health")),
    );
    const client = buildSdkClient(shrunken);
    assert.equal(client.ok, false);
  });

  it("invoking an unknown route name is refused (unknown-route)", () => {
    const built = buildSdkClient(WORLD_ALPHA_API_V1);
    assert.ok(built.ok);
    const invoked = built.client.invoke("mystery-route", {
      scope: { tenantId: "t" },
    });
    assert.equal(invoked.ok, false);
    assert.equal(invoked.errors[0]?.code, "unknown-route");
    const received = built.client.receive("mystery-route", {});
    assert.equal(received.ok, false);
    assert.equal(received.errors[0]?.code, "unknown-route");
  });
});
