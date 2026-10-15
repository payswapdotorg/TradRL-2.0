/**
 * Operations-route tests (W061 `observability`) — the ops surface aligned
 * with W059's route-table vocabulary: closed methods, §14 scope members as
 * path parameters (through W059's own parser), provenance citations, and
 * the drift anchor twin.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONS_ROUTE_NAMES,
  operationsRouteDeclarations,
  validateOperationsRoutes,
  type OpsRouteDeclaration,
} from "../index.js";

test("the default operations route declarations are lawful", () => {
  assert.deepEqual(validateOperationsRoutes(operationsRouteDeclarations()), []);
});

test("the drift anchor names the default declarations exactly", () => {
  assert.deepEqual(
    operationsRouteDeclarations().map((route) => route.name),
    OPERATIONS_ROUTE_NAMES,
  );
});

test("every ops route is private, v1, operations-family, world-scoped", () => {
  for (const route of operationsRouteDeclarations()) {
    assert.equal(route.family, "operations");
    assert.equal(route.visibility, "private");
    assert.equal(route.version, "v1");
    assert.equal(route.scope, "tenant-project-world");
  }
});

test("a §14 scope member missing from the path is a loud violation", () => {
  const declaration: OpsRouteDeclaration = {
    ...operationsRouteDeclarations()[0]!,
    path: "/v1/tenants/:tenantId/projects/:projectId/audit",
  };
  const violations = validateOperationsRoutes([declaration]);
  assert.ok(violations.some((violation) => violation.kind === "scope-param-missing"));
});

test("a path parameter outside the route's scope is a loud violation", () => {
  const declaration: OpsRouteDeclaration = {
    ...operationsRouteDeclarations()[0]!,
    path: "/v1/tenants/:tenantId/projects/:projectId/worlds/:worldId/audit/:actorId",
  };
  const violations = validateOperationsRoutes([declaration]);
  assert.ok(violations.some((violation) => violation.kind === "extra-scope-param"));
});

test("a duplicate route name is refused", () => {
  const [first, second] = operationsRouteDeclarations();
  const violations = validateOperationsRoutes([first!, second!, { ...first! }]);
  assert.ok(violations.some((violation) => violation.kind === "duplicate-route-name"));
});

test("a method outside W059's closed set is refused", () => {
  const declaration = {
    ...operationsRouteDeclarations()[0]!,
    method: "TRACE" as never,
  } as OpsRouteDeclaration;
  const violations = validateOperationsRoutes([declaration]);
  assert.ok(violations.some((violation) => violation.kind === "unknown-method"));
});

test("a payload type outside the closed set is refused", () => {
  const declaration = {
    ...operationsRouteDeclarations()[0]!,
    response: {
      ...operationsRouteDeclarations()[0]!.response,
      payloadType: "AuditFeeling" as never,
    },
  } as OpsRouteDeclaration;
  const violations = validateOperationsRoutes([declaration]);
  assert.ok(violations.some((violation) => violation.kind === "unknown-payload-type"));
});

test("a response without a provenance citation is refused", () => {
  const base = operationsRouteDeclarations()[0]!;
  const declaration = {
    ...base,
    response: { ...base.response, provenance: undefined },
  } as unknown as OpsRouteDeclaration;
  const violations = validateOperationsRoutes([declaration]);
  assert.ok(violations.some((violation) => violation.kind === "provenance-missing"));
});

test("a blank route name or path is refused", () => {
  const blankName = { ...operationsRouteDeclarations()[0]!, name: "" };
  const violations = validateOperationsRoutes([blankName]);
  assert.ok(violations.some((violation) => violation.kind === "blank-route-name"));
  const blankPath = { ...operationsRouteDeclarations()[0]!, path: "" };
  const pathViolations = validateOperationsRoutes([blankPath]);
  assert.ok(pathViolations.some((violation) => violation.kind === "blank-path"));
});
