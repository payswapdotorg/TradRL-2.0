/**
 * The trajectory identity laws (W037) — the canonical id encoding over the
 * tenant/project/world/experiment/session scope, opaque and never parsed.
 *
 * Run: pnpm --filter trajectory test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAJECTORY_ID_PREFIX,
  blankTrajectoryScopeMembers,
  canonicalDigestHex,
  canonicalString,
  canonicalTrajectoryScope,
  trajectoryIdOf,
} from "../identity.js";
import { SCOPE, scopeOf } from "./fixtures.js";

test("the canonical serializer is key-order independent and omits undefined (A9)", () => {
  assert.equal(canonicalString({ b: 1, a: 2 }), canonicalString({ a: 2, b: 1 }));
  assert.equal(canonicalString({ a: 1, b: undefined }), canonicalString({ a: 1 }));
  assert.equal(canonicalString([1, 2]), "[1,2]");
  assert.equal(canonicalString(null), "null");
  assert.equal(canonicalString("x"), '"x"');
});

test("the canonical digest is deterministic and content-addressed", () => {
  assert.equal(canonicalDigestHex({ a: 1, b: [2, 3] }), canonicalDigestHex({ b: [2, 3], a: 1 }));
  assert.notEqual(canonicalDigestHex({ a: 1 }), canonicalDigestHex({ a: 2 }));
});

test("the same scope always yields the same opaque trajectory id (A9 twin)", () => {
  const first = trajectoryIdOf(SCOPE);
  const second = trajectoryIdOf(scopeOf());
  assert.equal(first, second);
  assert.ok(first.startsWith(TRAJECTORY_ID_PREFIX));
  assert.ok(/^traj-[0-9a-f]{8}$/.test(first));
});

test("a scope differing in any member yields a different id", () => {
  const base = trajectoryIdOf(SCOPE);
  for (const member of ["tenantId", "projectId", "worldId", "experimentId", "sessionId"] as const) {
    const varied = trajectoryIdOf(scopeOf({ [member]: `${SCOPE[member]}-other` }));
    assert.notEqual(varied, base, `varying '${member}' must change the id`);
  }
});

test("the canonical scope encoding is key-order independent", () => {
  const encoded = canonicalTrajectoryScope(SCOPE);
  assert.equal(encoded, canonicalString(SCOPE));
  assert.ok(encoded.includes("tenant-1"));
});

test("blank scope members are named, fail-closed (never defaulted)", () => {
  assert.deepEqual(blankTrajectoryScopeMembers(SCOPE), []);
  const blanks = blankTrajectoryScopeMembers(scopeOf({ projectId: "  ", sessionId: "" }));
  assert.deepEqual(blanks, ["projectId", "sessionId"]);
});
