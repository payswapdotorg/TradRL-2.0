/**
 * The request-builder + response-validator laws (W059) — the §14 scope law,
 * the path law, the closed field schemas, the W028 citation match. The SDK
 * never trusts the wire.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  SDK_PREPARED_REQUEST_ID_PREFIX,
  buildSdkRequest,
  validateSdkResponse,
} from "../index.js";
import { WORLD_ALPHA_API_V1 } from "api";
import type { ApiRoute } from "api";

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

describe("the §14 scope law", () => {
  it("builds a world-scoped request with the explicit scope", () => {
    const outcome = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-view"),
      { scope: SCOPE },
    );
    assert.ok(outcome.ok);
    assert.equal(
      outcome.request.path,
      "/v1/tenants/tenant-alpha/projects/project-one/worlds/world-primus/evidence",
    );
    assert.equal(outcome.request.method, "GET");
    assert.match(outcome.request.preparedRequestId, /^sdkreq-/);
    assert.equal(outcome.request.tableId, WORLD_ALPHA_API_V1.tableId);
  });

  it("refuses a blank scope member (scope-member-blank)", () => {
    const outcome = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-view"),
      { scope: { ...SCOPE, worldId: "  " } },
    );
    assert.equal(outcome.ok, false);
    assert.ok(outcome.errors.some((e) => e.code === "scope-member-blank"));
  });

  it("refuses a missing demanded member, and an undeclared member", () => {
    const missing = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-view"),
      { scope: { tenantId: "t", projectId: "p" } },
    );
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === "scope-member-blank"));

    const extra = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("health"),
      { scope: { ...SCOPE } },
    );
    assert.equal(extra.ok, false);
    assert.ok(extra.errors.some((e) => e.code === "scope-member-unexpected"));
  });
});

describe("the path law", () => {
  it("substitutes record-id params from pathParams", () => {
    const outcome = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-event"),
      { scope: SCOPE, pathParams: { eventId: "evt-42" } },
    );
    assert.ok(outcome.ok);
    assert.ok(outcome.request.path.endsWith("/evidence/events/evt-42"));
  });

  it("refuses missing, blank and unknown path params", () => {
    const missing = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-event"),
      { scope: SCOPE },
    );
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === "path-param-missing"));

    const blank = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-event"),
      { scope: SCOPE, pathParams: { eventId: " " } },
    );
    assert.equal(blank.ok, false);
    assert.ok(blank.errors.some((e) => e.code === "path-param-blank"));

    const unknown = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("evidence-event"),
      { scope: SCOPE, pathParams: { eventId: "evt-1", vibe: "x" } },
    );
    assert.equal(unknown.ok, false);
    assert.ok(unknown.errors.some((e) => e.code === "path-param-unknown"));
  });
});

describe("the closed field schemas (W050's own gates)", () => {
  it("builds the point-in-time view-create request with the explicit cutoff", () => {
    const outcome = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("time-machine-view-create"),
      {
        scope: SCOPE,
        fields: { cutoff: 86_400_000, families: ["market-event", "news"] },
      },
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.request.fields.cutoff, 86_400_000);
    assert.deepEqual(outcome.request.fields.families, ["market-event", "news"]);
    assert.equal(outcome.request.method, "POST");
  });

  it("refuses an illegal cutoff (W050's isLegalCutoff gate)", () => {
    for (const cutoff of [-1, 1.5, Number.NaN, "soon"] as never[]) {
      const outcome = buildSdkRequest(
        WORLD_ALPHA_API_V1.tableId,
        byName("time-machine-view-create"),
        { scope: SCOPE, fields: { cutoff, families: ["news"] } },
      );
      assert.equal(outcome.ok, false, `cutoff ${String(cutoff)}`);
      assert.ok(
        outcome.errors.some((e) => e.code === "field-kind"),
        JSON.stringify(outcome.errors),
      );
    }
  });

  it("refuses families outside W050's closed set", () => {
    const outcome = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("time-machine-view-create"),
      { scope: SCOPE, fields: { cutoff: 0, families: ["gossip"] } },
    );
    assert.equal(outcome.ok, false);
    assert.ok(
      outcome.errors.some((e) => e.code === "field-kind"),
      JSON.stringify(outcome.errors),
    );
  });

  it("refuses missing required fields and unknown fields", () => {
    const missing = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("time-machine-view-create"),
      { scope: SCOPE, fields: { cutoff: 0 } },
    );
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === "field-missing"));

    const unknown = buildSdkRequest(
      WORLD_ALPHA_API_V1.tableId,
      byName("time-machine-view-create"),
      { scope: SCOPE, fields: { cutoff: 0, families: ["news"], asOf: "latest" } },
    );
    assert.equal(unknown.ok, false);
    assert.ok(unknown.errors.some((e) => e.code === "field-unknown"));
  });
});

describe("the response validator (the SDK never trusts the wire)", () => {
  it("validates a lawful evidence response", () => {
    const validated = validateSdkResponse(byName("evidence-view"), {
      summary: { events: 3 },
      events: [],
      artifacts: [],
      datasets: [],
      provenance: { kind: "evidence-projection", entities: ["event", "artifact", "dataset"] },
    });
    assert.ok(validated.ok);
    assert.equal(validated.response.routeName, "evidence-view");
    assert.ok(Object.isFrozen(validated.response.payload));
  });

  it("refuses a payload that is not an object", () => {
    for (const payload of [null, "ok", 42, [1], undefined]) {
      const validated = validateSdkResponse(byName("health"), payload);
      assert.equal(validated.ok, false);
      assert.equal(validated.errors[0]?.code, "response-not-object");
    }
  });

  it("refuses missing required fields, wrong kinds, and undeclared fields", () => {
    const missing = validateSdkResponse(byName("health"), {
      status: "ok",
      apiVersion: "v1",
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === "response-field-missing"));

    const wrongKind = validateSdkResponse(byName("health"), {
      status: "ok",
      apiVersion: "v1",
      provenance: { kind: "no-declared-source" },
      extra: "undeclared",
    });
    assert.equal(wrongKind.ok, false);
    assert.ok(wrongKind.errors.some((e) => e.code === "response-field-unknown"));

    const badInteger = validateSdkResponse(byName("time-machine-view-get"), {
      viewId: "pitv-1",
      cutoff: "0",
      records: [],
      provenance: { kind: "evidence-projection", entities: ["event"] },
    });
    assert.equal(badInteger.ok, false);
    assert.ok(badInteger.errors.some((e) => e.code === "response-field-kind"));
  });

  it("refuses a wire citation that does not match the declared one", () => {
    const mismatched = validateSdkResponse(byName("evidence-view"), {
      summary: {},
      events: [],
      artifacts: [],
      datasets: [],
      provenance: { kind: "evidence-projection", entities: ["event"] },
    });
    assert.equal(mismatched.ok, false);
    assert.ok(
      mismatched.errors.some((e) => e.code === "response-provenance-mismatch"),
      JSON.stringify(mismatched.errors),
    );

    const fabricated = validateSdkResponse(byName("evidence-view"), {
      summary: {},
      events: [],
      artifacts: [],
      datasets: [],
      provenance: { kind: "no-declared-source" },
    });
    assert.equal(fabricated.ok, false);
    assert.ok(
      fabricated.errors.some((e) => e.code === "response-provenance-mismatch"),
    );
  });

  it("the honest no-declared-source marker matches the declared marker", () => {
    const validated = validateSdkResponse(byName("health"), {
      status: "healthy",
      apiVersion: "v1",
      provenance: { kind: "no-declared-source" },
    });
    assert.ok(validated.ok);
  });
});

describe("the prepared-request id is content-addressed", () => {
  it("the same input mints the same id; any change mints another", () => {
    const route = byName("evidence-event");
    const first = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: SCOPE,
      pathParams: { eventId: "evt-42" },
    });
    const second = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: SCOPE,
      pathParams: { eventId: "evt-42" },
    });
    assert.ok(first.ok && second.ok);
    assert.equal(first.request.preparedRequestId, second.request.preparedRequestId);

    const changed = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: SCOPE,
      pathParams: { eventId: "evt-43" },
    });
    assert.ok(changed.ok);
    assert.notEqual(
      first.request.preparedRequestId,
      changed.request.preparedRequestId,
    );
    assert.ok(
      first.request.preparedRequestId.startsWith(
        SDK_PREPARED_REQUEST_ID_PREFIX,
      ),
    );
  });
});
