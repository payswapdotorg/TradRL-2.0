/**
 * The A9 twin (W059 sdk) — same table ⇒ deep-equal client surface; same
 * input ⇒ same prepared id; refusals deep-equal too.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSdkClient, buildSdkRequest } from "../index.js";
import { WORLD_ALPHA_API_V1 } from "api";

function surfaceOf(client: import("../index.js").SdkClient): unknown {
  return client.methods.map((binding) => ({
    methodName: binding.methodName,
    routeName: binding.routeName,
    routeId: binding.routeId,
    method: binding.method,
    pathPattern: binding.pathPattern,
    scope: binding.scope,
  }));
}

const SCOPE = {
  tenantId: "tenant-alpha",
  projectId: "project-one",
  worldId: "world-primus",
};

describe("the A9 twin — the deterministic projection", () => {
  it("two clients over the same table project the identical surface", () => {
    const first = buildSdkClient(WORLD_ALPHA_API_V1);
    const second = buildSdkClient(WORLD_ALPHA_API_V1);
    assert.ok(first.ok && second.ok);
    assert.equal(first.client.tableId, second.client.tableId);
    assert.equal(first.client.apiVersion, second.client.apiVersion);
    // The surface is DATA (the closures are per-client; the contracts are
    // not) — the deterministic projection is compared member-for-member.
    assert.deepEqual(surfaceOf(first.client), surfaceOf(second.client));
    assert.deepEqual(
      Object.keys(first.client.byMethodName).sort(),
      Object.keys(second.client.byMethodName).sort(),
    );
    assert.deepEqual(
      Object.keys(first.client.byRouteName).sort(),
      Object.keys(second.client.byRouteName).sort(),
    );
  });

  it("the method bindings carry no hidden state — the projection is pure", () => {
    const first = buildSdkClient(WORLD_ALPHA_API_V1);
    const second = buildSdkClient(WORLD_ALPHA_API_V1);
    assert.ok(first.ok && second.ok);
    assert.deepEqual(surfaceOf(first.client), surfaceOf(second.client));
  });

  it("the same request input deep-equals, refusals included", () => {
    const route = WORLD_ALPHA_API_V1.routes.find((r) => r.name === "evidence-event");
    assert.ok(route !== undefined);
    const good = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: SCOPE,
      pathParams: { eventId: "evt-7" },
    });
    const goodAgain = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: SCOPE,
      pathParams: { eventId: "evt-7" },
    });
    assert.deepEqual(good, goodAgain);

    const bad = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: { ...SCOPE, worldId: "" },
    });
    const badAgain = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: { ...SCOPE, worldId: "" },
    });
    assert.deepEqual(bad, badAgain);
    assert.equal(bad.ok, false);
  });

  it("the invoke/receive conveniences delegate deterministically", () => {
    const client = buildSdkClient(WORLD_ALPHA_API_V1);
    assert.ok(client.ok);
    const viaInvoke = client.client.invoke("evidence-event", {
      scope: SCOPE,
      pathParams: { eventId: "evt-7" },
    });
    const viaBinding = client.client.byRouteName["evidence-event"]!.buildRequest({
      scope: SCOPE,
      pathParams: { eventId: "evt-7" },
    });
    assert.deepEqual(viaInvoke, viaBinding);
  });
});
