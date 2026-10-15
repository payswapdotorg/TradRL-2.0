/**
 * The W041 identity tests: the canonical skill id family (A9 — the same
 * capability + the same measured evidence always yield the same id; any
 * differing byte yields a different one; evidence declaration order and
 * key insertion order never leak) and the extraction run id (the registry
 * fingerprint + the sorted batch).
 *
 * Run: pnpm --filter skills test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fnv1a32 as registryFnv1a32 } from "capability-registry";
import {
  EXTRACTION_ID_PREFIX,
  SKILL_ID_PREFIX,
  canonicalJson,
  canonicalSkill,
  extractionIdOf,
  fnv1a32,
  skillIdOf,
  stableDigest,
} from "../identity.js";
import type { SkillCanonicalInput } from "../identity.js";
import { MOMENTUM_CAPABILITY_ID, SCOPE, SUBSTRATE_MOMENTUM } from "./registry.js";
import { fixtureTrajectories } from "./fixtures.js";

function canonicalInput(overrides: Partial<SkillCanonicalInput> = {}): SkillCanonicalInput {
  return {
    capabilityId: String(MOMENTUM_CAPABILITY_ID),
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", id: String(SUBSTRATE_MOMENTUM) },
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
    trajectoryIds: fixtureTrajectories().map((record) => String(record.trajectoryId)),
    lineage: { parentSkillId: null, version: 1 },
    ...overrides,
  };
}

test("the skill id is deterministic over the same derivation", () => {
  assert.deepEqual(skillIdOf(canonicalInput()), skillIdOf(canonicalInput()));
  assert.equal(String(skillIdOf(canonicalInput())).startsWith(SKILL_ID_PREFIX), true);
});

test("rebuilding the evidence batch from scratch yields the same id (A9 through the W037 seam)", () => {
  const first = skillIdOf(canonicalInput());
  const second = skillIdOf(canonicalInput({
    trajectoryIds: fixtureTrajectories().map((record) => String(record.trajectoryId)),
  }));
  assert.deepEqual(first, second);
});

test("any differing derivation byte yields a different skill id", () => {
  const base = skillIdOf(canonicalInput());
  assert.notEqual(skillIdOf(canonicalInput({ capabilityId: "cap-other" })), base);
  assert.notEqual(skillIdOf(canonicalInput({ kind: "market-making" })), base);
  assert.notEqual(skillIdOf(canonicalInput({ domain: "equities" })), base);
  assert.notEqual(
    skillIdOf(canonicalInput({ bearer: { kind: "substrate", id: "substrate-other" } })),
    base,
  );
  assert.notEqual(
    skillIdOf(canonicalInput({ scope: { ...SCOPE, worldId: "world-skill-other" } })),
    base,
  );
  assert.notEqual(
    skillIdOf(canonicalInput({ lineage: { parentSkillId: null, version: 2 } })),
    base,
  );
  const extended = fixtureTrajectories().map((record) => String(record.trajectoryId));
  extended.push("traj-extra");
  assert.notEqual(skillIdOf(canonicalInput({ trajectoryIds: extended })), base);
});

test("evidence declaration order never leaks into the id (the projection sorts it)", () => {
  const ordered = canonicalInput().trajectoryIds;
  const reversed = [...ordered].reverse();
  assert.deepEqual(
    skillIdOf(canonicalInput({ trajectoryIds: reversed })),
    skillIdOf(canonicalInput({ trajectoryIds: ordered })),
  );
  assert.deepEqual(
    canonicalSkill(canonicalInput({ trajectoryIds: reversed })),
    canonicalSkill(canonicalInput({ trajectoryIds: ordered })),
  );
});

test("key insertion order never leaks into the id (the serializer sorts keys)", () => {
  const input = canonicalInput();
  const reordered: SkillCanonicalInput = {
    lineage: input.lineage,
    trajectoryIds: input.trajectoryIds,
    scope: input.scope,
    bearer: input.bearer,
    domain: input.domain,
    kind: input.kind,
    capabilityId: input.capabilityId,
  };
  assert.deepEqual(skillIdOf(reordered), skillIdOf(input));
});

test("canonical JSON sorts keys recursively, keeps array order, omits undefined", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson("text"), '"text"');
  assert.equal(canonicalJson(null), "null");
});

test("canonical JSON fails closed on non-JSON values", () => {
  assert.throws(() => canonicalJson(() => 0), /unsupported value/);
});

test("fnv1a32 is the repo hashing family (byte-compatible with W040's own)", () => {
  assert.equal(fnv1a32(""), "811c9dc5");
  for (const sample of ["a", "skill", "trajectory-id-1", "extraction", "u-252-code"]) {
    assert.equal(fnv1a32(sample), registryFnv1a32(sample));
  }
  assert.notEqual(fnv1a32("a"), fnv1a32("b"));
});

test("stableDigest is canonicalJson followed by fnv1a32", () => {
  assert.equal(stableDigest({ b: 1, a: 2 }), fnv1a32(canonicalJson({ a: 2, b: 1 })));
});

test("the extraction id is deterministic and batch-order-independent", () => {
  const input = {
    registryFingerprint: "fingerprint-fixture",
    trajectoryIds: fixtureTrajectories().map((record) => String(record.trajectoryId)),
  };
  const first = extractionIdOf(input);
  assert.deepEqual(extractionIdOf(input), first);
  assert.deepEqual(
    extractionIdOf({ ...input, trajectoryIds: [...input.trajectoryIds].reverse() }),
    first,
  );
  assert.equal(String(first).startsWith(EXTRACTION_ID_PREFIX), true);
});

test("a differing registry fingerprint or batch yields a different extraction id", () => {
  const input = {
    registryFingerprint: "fingerprint-fixture",
    trajectoryIds: fixtureTrajectories().map((record) => String(record.trajectoryId)),
  };
  assert.notEqual(
    extractionIdOf({ ...input, registryFingerprint: "fingerprint-other" }),
    extractionIdOf(input),
  );
  const extended = [...input.trajectoryIds];
  extended.push("traj-extra");
  assert.notEqual(extractionIdOf({ ...input, trajectoryIds: extended }), extractionIdOf(input));
});
