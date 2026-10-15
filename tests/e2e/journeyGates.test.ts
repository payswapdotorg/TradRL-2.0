/**
 * The refusal laws of the W064 reference journey — behavior claims pinned:
 * the gates REFUSE loudly (fail-closed, every violation typed) on tampered
 * records, cross-tenant queries (R056 named), blank §14 scope members, and
 * wire payloads that do not match the route's declared contract. The
 * journey's records are the tamper targets — the SAME records the happy
 * path composed.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeJourney } from "../../examples/reference-trading/journey.js";
import { validateKnowledgeRecord } from "../../packages/memory/index.js";
import { validatePopulation } from "../../services/populations/index.js";
import { recall } from "../../services/firm-brain/index.js";
import { validateEntitlement, verifyEntitlement } from "../../packages/entitlements/index.js";
import {
  buildSdkRequest,
  validateSdkResponse,
} from "../../packages/sdk/index.js";
import { WORLD_ALPHA_API_V1 } from "../../services/api/index.js";
import { SCOPE } from "../../examples/reference-trading/journeyFacts.js";

const journey = composeJourney();
const learning = journey.records.learning;
const founding = journey.records.founding;
const commerce = journey.records.commerce;
const governance = journey.records.governance;

test("a tampered knowledge record is refused by the memory contract's own validator", () => {
  const tampered = structuredClone(learning.knowledge[0] as unknown as Record<string, unknown>) as never;
  const record = tampered as { readonly payload: Record<string, unknown> };
  record.payload.carried = "rewritten-after-sealing" as never;
  assert.equal(validateKnowledgeRecord(tampered).ok, false);
});

test("a rewritten population member is refused by W045's own validator", () => {
  const tampered = structuredClone(founding.champion) as unknown as {
    membership: { bindingId: string }[];
  };
  tampered.membership[0]!.bindingId = "binding-00000000";
  assert.equal(validatePopulation(tampered as unknown as never).ok, false);
});

test("a cross-tenant recall query is refused loudly, naming R056", () => {
  const outcome = recall(learning.brain, {
    kind: "by-kind",
    scope: { ...SCOPE, tenantId: "tenant-not-this-one" },
    knowledgeKind: "post-mortem",
  });
  assert.equal(outcome.ok, false);
  const message = outcome.errors[0]?.message ?? "";
  assert.match(message, /R056/);
});

test("a cross-tenant entitlement use is refused loudly, naming R056", () => {
  const outcome = verifyEntitlement(commerce.entitlement, {
    scope: { tenantId: "tenant-not-this-one", principalId: "principal-reference-journey" },
    offerId: commerce.entitlement.offer.offerId,
    at: 1_700_001_800_000,
    terms: commerce.entitlement.terms,
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.refusals[0]?.message ?? "", /R056/);
});

test("a tampered entitlement is refused by W058's own validator (id re-derivation)", () => {
  const tampered = structuredClone(commerce.entitlement) as { terms: { price: { amount: number } } };
  tampered.terms.price.amount = 43;
  assert.equal(validateEntitlement(tampered as never).ok, false);
});

test("a blank §14 scope member is refused by the SDK's request builder", () => {
  const route = WORLD_ALPHA_API_V1.routes.find((candidate) => candidate.name === "time-machine-view-get");
  assert.ok(route !== undefined);
  const outcome = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: "" },
    pathParams: { viewId: String(learning.view.viewId) },
    fields: { cutoff: 1_700_044_950_000 },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors.some((error) => error.code === "scope-member-blank"), true);
});

test("a response payload whose provenance deviates from the route contract is refused", () => {
  const route = WORLD_ALPHA_API_V1.routes.find((candidate) => candidate.name === "time-machine-view-get");
  assert.ok(route !== undefined);
  const outcome = validateSdkResponse(route, {
    viewId: String(learning.view.viewId),
    cutoff: 1_700_044_950_000,
    records: learning.view.records,
    provenance: { kind: "no-declared-source" },
  });
  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.errors.some((error) => error.code === "response-provenance-mismatch"),
    true,
  );
});

test("the journey's own prepared request re-derives its content-addressed id", () => {
  const rebuilt = buildSdkRequest(WORLD_ALPHA_API_V1.tableId, routeOfView(), {
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
    pathParams: { viewId: String(learning.view.viewId) },
    fields: { cutoff: viewCutoff() },
  });
  assert.ok(rebuilt.ok);
  assert.equal(
    String(rebuilt.request.preparedRequestId),
    String(governance.preparedRequest.preparedRequestId),
  );
});

function routeOfView(): NonNullable<ReturnType<typeof findRoute>> {
  const route = findRoute();
  if (route === undefined) {
    throw new Error("the default table declares no time-machine-view-get route");
  }
  return route;
}

function findRoute() {
  return WORLD_ALPHA_API_V1.routes.find((candidate) => candidate.name === "time-machine-view-get");
}

function viewCutoff(): number {
  const cutoff = Number(governance.preparedRequest.fields.cutoff);
  assert.ok(Number.isSafeInteger(cutoff));
  return cutoff;
}
