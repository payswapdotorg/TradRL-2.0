/**
 * Whole-record re-validation (W059 sdk) — the client surface and the
 * prepared request re-derived from their own recorded data.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildSdkClient,
  buildSdkRequest,
  validateSdkClient,
  validateSdkPreparedRequest,
} from "../index.js";
import { WORLD_ALPHA_API_V1 } from "api";
import type { ApiRoute } from "api";
import type { SdkClient, SdkPreparedRequest } from "../index.js";

const byName = (name: string): ApiRoute => {
  const route = WORLD_ALPHA_API_V1.routes.find((r) => r.name === name);
  assert.ok(route !== undefined, name);
  return route;
};

const SCOPE = {
  tenantId: "tenant-alpha",
  projectId: "project-one",
  worldId: "world-primus",
};

function buildClient(): SdkClient {
  const outcome = buildSdkClient(WORLD_ALPHA_API_V1);
  assert.ok(outcome.ok);
  return outcome.client;
}

describe("validateSdkClient — the surface re-derives", () => {
  it("re-proves the default client", () => {
    const client = buildClient();
    const validation = validateSdkClient(client, WORLD_ALPHA_API_V1);
    assert.deepEqual(validation, { ok: true });
  });

  it("refuses a client bound to a different table", () => {
    const client = buildClient();
    const otherTable = {
      ...WORLD_ALPHA_API_V1,
      tableId: "rtt-other" as never,
    };
    const validation = validateSdkClient(client, otherTable);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.errors.some((e) => e.message.includes("table id")),
      JSON.stringify(validation.errors),
    );
  });

  it("refuses a client whose recorded surface does not re-derive", () => {
    const client = buildClient();
    const tampered: SdkClient = {
      ...client,
      methods: [...client.methods.slice(1), client.methods[0]!],
    };
    const validation = validateSdkClient(tampered, WORLD_ALPHA_API_V1);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.errors.some((e) => e.message.includes("does not re-derive")),
      JSON.stringify(validation.errors),
    );
  });
});

describe("validateSdkPreparedRequest — the record re-derives", () => {
  it("re-proves a lawful prepared request", () => {
    const prepared = prepare();
    const validation = validateSdkPreparedRequest(prepared, WORLD_ALPHA_API_V1);
    assert.deepEqual(validation, { ok: true });
  });

  it("refuses a tampered prepared-request id (does not re-derive)", () => {
    const prepared = prepare();
    const tampered: SdkPreparedRequest = {
      ...prepared,
      preparedRequestId: "sdkreq-deadbeef" as never,
    };
    const validation = validateSdkPreparedRequest(tampered, WORLD_ALPHA_API_V1);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.errors.some((e) => e.message.includes("does not re-derive")),
      JSON.stringify(validation.errors),
    );
  });

  it("refuses a tampered path (does not re-derive from scope + pattern)", () => {
    const prepared = prepare();
    const tampered: SdkPreparedRequest = {
      ...prepared,
      path: "/v1/tenants/tenant-alpha/projects/project-one/worlds/world-primus/evidence",
      preparedRequestId: "sdkreq-x" as never,
    };
    const validation = validateSdkPreparedRequest(tampered, WORLD_ALPHA_API_V1);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.errors.some((e) => e.message.includes("does not re-derive")),
      JSON.stringify(validation.errors),
    );
  });

  it("refuses a route id that resolves to no route", () => {
    const prepared = prepare();
    const tampered: SdkPreparedRequest = {
      ...prepared,
      routeId: "rt-v1-nowhere" as never,
    };
    const validation = validateSdkPreparedRequest(tampered, WORLD_ALPHA_API_V1);
    assert.equal(validation.ok, false);
    assert.equal(validation.errors[0]?.code, "unknown-route");
  });

  it("refuses recorded scope members the route does not demand", () => {
    const health = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, byName("health"), {
      scope: { tenantId: "tenant-alpha" },
    });
    assert.ok(health.ok);
    const tampered: SdkPreparedRequest = {
      ...health.request,
      scope: { tenantId: "tenant-alpha", projectId: "smuggled" },
      preparedRequestId: "sdkreq-x" as never,
    };
    const validation = validateSdkPreparedRequest(tampered, WORLD_ALPHA_API_V1);
    assert.equal(validation.ok, false);
    assert.ok(
      validation.errors.some((e) => e.code === "scope-member-unexpected"),
      JSON.stringify(validation.errors),
    );
  });
});

function prepare(): SdkPreparedRequest {
  const outcome = buildSdkRequest(
    WORLD_ALPHA_API_V1.tableId,
    byName("evidence-event"),
    { scope: SCOPE, pathParams: { eventId: "evt-42" } },
  );
  assert.ok(outcome.ok);
  return outcome.request;
}
