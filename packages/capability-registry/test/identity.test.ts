/**
 * The W040 identity tests: the canonical id family (A9 — same
 * declarations + same measured citations ⇒ same id; any differing byte ⇒
 * a different one; declaration order of the sorted collections never
 * matters).
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_ID_PREFIX,
  canonicalCapabilityRegistration,
  canonicalJson,
  capabilityIdOf,
  fnv1a32,
  stableDigest,
} from "../identity.js";
import type { CapabilityId } from "../identity.js";
import { canonicalRegistration } from "../register.js";
import { ORG_CAP_EXECUTION, registrationFixture } from "./fixtures.js";

test("the capability id is deterministic over the same registration", () => {
  const registration = registrationFixture();
  const first = capabilityIdOf(canonicalRegistration(registration));
  const second = capabilityIdOf(canonicalRegistration(registration));
  assert.deepEqual(first, second);
  assert.equal(String(first).startsWith(CAPABILITY_ID_PREFIX), true);
});

test("rebuilding the fixtures from scratch yields the same id (A9 through the W037 seam)", () => {
  const first = capabilityIdOf(canonicalRegistration(registrationFixture()));
  const second = capabilityIdOf(canonicalRegistration(registrationFixture()));
  assert.deepEqual(first, second);
});

test("any differing declaration byte yields a different id", () => {
  const base = canonicalRegistration(registrationFixture());
  const renamed = canonicalRegistration(
    registrationFixture({ name: "momentum execution under stress, revised" }),
  );
  assert.notEqual(String(capabilityIdOf(base)), String(capabilityIdOf(renamed)));

  const rekinded = canonicalRegistration(
    registrationFixture({ kind: "risk-control" as const }),
  );
  assert.notEqual(String(capabilityIdOf(base)), String(capabilityIdOf(rekinded)));

  const relineaged = canonicalRegistration(
    registrationFixture({
      lineage: { parentCapabilityId: "cap-00000000" as CapabilityId, version: 2 },
    }),
  );
  assert.notEqual(String(capabilityIdOf(base)), String(capabilityIdOf(relineaged)));
});

test("the canonical projection erases declaration order of the sorted collections", () => {
  const registration = registrationFixture({
    providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION, ORG_CAP_EXECUTION],
  });
  const canonical = canonicalCapabilityRegistration(
    canonicalRegistration(registration),
  );
  // duplicate-provides is a GATE law; the canonical projection still sorts.
  assert.deepEqual(canonical.providesOrganizationCapabilityIds, [ORG_CAP_EXECUTION, ORG_CAP_EXECUTION]);

  const one = canonicalCapabilityRegistration({
    name: "order-independence",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", id: "substrate-x" },
    scope: { tenantId: "t", projectId: "p", worldId: "w" },
    providesOrganizationCapabilityIds: ["capability-b", "capability-a"],
    lineage: { parentCapabilityId: null, version: 1 },
    provenance: [
      { experimentId: "exp-b", evaluationId: "expeval-b", findingsDigest: "digest-b" },
      { experimentId: "exp-a", evaluationId: "expeval-a", findingsDigest: "digest-a" },
    ],
  });
  const two = canonicalCapabilityRegistration({
    name: "order-independence",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", id: "substrate-x" },
    scope: { tenantId: "t", projectId: "p", worldId: "w" },
    providesOrganizationCapabilityIds: ["capability-a", "capability-b"],
    lineage: { parentCapabilityId: null, version: 1 },
    provenance: [
      { experimentId: "exp-a", evaluationId: "expeval-a", findingsDigest: "digest-a" },
      { experimentId: "exp-b", evaluationId: "expeval-b", findingsDigest: "digest-b" },
    ],
  });
  assert.deepEqual(one, two);
  assert.deepEqual(capabilityIdOf(one), capabilityIdOf(two));
});

test("the hashing family is the W016 discipline (canonical JSON + FNV-1a)", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: true, c: null }] }), '{"a":[2,{"c":null,"d":true}],"b":1}');
  assert.equal(canonicalJson({ x: undefined, y: 3 }), '{"y":3}');
  assert.equal(fnv1a32(""), "811c9dc5");
  assert.equal(stableDigest({ a: 1 }), fnv1a32(canonicalJson({ a: 1 })));
});
