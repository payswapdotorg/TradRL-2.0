/**
 * The typed error families (W059) — closed wire codes, stable, fail-closed.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  API_ERROR_CODES,
  apiErrorOf,
  isApiErrorCode,
  routeTableViolation,
} from "../index.js";

describe("the wire error family (closed set, stable codes)", () => {
  it("carries the ten stable codes in canonical order", () => {
    assert.equal(API_ERROR_CODES.length, 10);
    assert.deepEqual([...API_ERROR_CODES], [...API_ERROR_CODES].sort());
    for (const code of [
      "route-not-found",
      "method-not-allowed",
      "scope-required",
      "scope-member-blank",
      "cutoff-required",
      "request-invalid",
      "response-invalid",
      "unknown-entity",
      "version-mismatch",
      "conflict",
    ]) {
      assert.ok(API_ERROR_CODES.includes(code as never), code);
    }
  });

  it("the type guard accepts only the closed set", () => {
    assert.equal(isApiErrorCode("route-not-found"), true);
    assert.equal(isApiErrorCode("teapot"), false);
    assert.equal(isApiErrorCode(42), false);
    assert.equal(isApiErrorCode(null), false);
  });

  it("apiErrorOf builds frozen envelopes, fail-closed", () => {
    const envelope = apiErrorOf("cutoff-required", "the cutoff is required", {
      route: "time-machine-view-create",
    });
    assert.equal(envelope.code, "cutoff-required");
    assert.deepEqual(envelope.details, { route: "time-machine-view-create" });
    assert.ok(Object.isFrozen(envelope));

    const plain = apiErrorOf("route-not-found", "no such route");
    assert.equal(plain.details, undefined);

    assert.throws(() => apiErrorOf("teapot" as never, "nope"), RangeError);
    assert.throws(() => apiErrorOf("conflict", "  "), RangeError);
  });

  it("every route-table violation code answers a named law", () => {
    const violation = routeTableViolation(
      "implicit-latest-cutoff",
      "never implicit-latest",
      "time-machine-view-get",
    );
    assert.equal(violation.code, "implicit-latest-cutoff");
    assert.equal(violation.routeName, "time-machine-view-get");
    assert.ok(Object.isFrozen(violation));
    const bare = routeTableViolation("scope-missing", "no scope");
    assert.equal(bare.routeName, undefined);
  });
});
