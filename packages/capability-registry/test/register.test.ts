/**
 * The W040 registration-gate tests: R052 enforced structurally (the
 * headline `unmeasured-capability` error names the law), every structure
 * law, every citation-binding law, every registry law — each violation a
 * named typed error, never silent acceptance.
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentIdOf } from "experiments";
import { createCapabilityRegistry, registerCapability } from "../register.js";
import type { RegistrationOutcome } from "../register.js";
import type { CapabilityError, CapabilityKind, CapabilityDomain } from "../descriptor.js";
import type { CapabilityId } from "../identity.js";
import {
  ORG_CAP_EXECUTION,
  OTHER_WORLD,
  SCOPE,
  SUBSTRATE_MEANREVERSION,
  experimentFixture,
  evaluationFixture,
  evidenceFixture,
  findingsFixture,
  registrationFixture,
} from "./fixtures.js";

function expectCodes(outcome: RegistrationOutcome, codes: readonly string[]): void {
  assert.equal(outcome.ok, false, `expected failure, got success`);
  if (!outcome.ok) {
    assert.deepEqual(
      outcome.errors.map((entry: CapabilityError) => entry.code),
      codes,
    );
  }
}

test("the happy path: a measured capability registers", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const registration = registrationFixture();
  const outcome = registerCapability(registry, registration);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(String(outcome.capabilityId).startsWith("cap-"), true);
    assert.equal(outcome.registry.entries.length, 1);
    const entry = outcome.registry.entries[0];
    assert.ok(entry !== undefined);
    assert.equal(entry.state, "registered");
    assert.deepEqual(entry.transitions, []);
    assert.equal(entry.descriptor.name, registration.name);
    // the recorded provenance cites the REAL canonical ids:
    const citation = entry.descriptor.provenance[0];
    assert.ok(citation !== undefined);
    const evidence = registration.evidence[0];
    assert.ok(evidence !== undefined);
    assert.deepEqual(citation.experimentId, experimentIdOf(evidence.experiment));
    assert.deepEqual(citation.evaluationId, evidence.evaluation.evaluationId);
    assert.deepEqual(citation.findingsDigest, evidence.findings.digest);
    // the provides list is stored canonically sorted:
    assert.deepEqual(entry.descriptor.providesOrganizationCapabilityIds, [ORG_CAP_EXECUTION]);
  }
});

test("R052: an unmeasured capability is refused with the law named", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const outcome = registerCapability(registry, registrationFixture({ evidence: [] }));
  expectCodes(outcome, ["unmeasured-capability"]);
  if (!outcome.ok) {
    const law = outcome.errors[0];
    assert.ok(law !== undefined);
    assert.equal(law.message.includes("R052"), true);
    assert.equal(law.message.includes("EMPIRICAL"), true);
  }
});

test("the closed vocabularies are enforced loudly", () => {
  const registry = createCapabilityRegistry(SCOPE);
  expectCodes(
    registerCapability(registry, registrationFixture({ kind: "telepathy" as CapabilityKind })),
    ["unknown-capability-kind"],
  );
  expectCodes(
    registerCapability(registry, registrationFixture({ domain: "astrology" as CapabilityDomain })),
    ["unknown-capability-domain"],
  );
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({
        bearer: { kind: "oracle" as "substrate", substrateId: SUBSTRATE_MEANREVERSION },
      }),
    ),
    // a bearer kind outside the closed set is BOTH unknown and (its member
    // misread through the wrong variant) id-less — both laws fire:
    ["unknown-bearer-kind", "blank-bearer-id"],
  );
  expectCodes(
    registerCapability(registry, registrationFixture({ bearer: { kind: "substrate", substrateId: "  " as never } })),
    ["blank-bearer-id"],
  );
});

test("blank identity and scope members are refused", () => {
  const registry = createCapabilityRegistry(SCOPE);
  expectCodes(registerCapability(registry, registrationFixture({ name: "   " })), [
    "blank-capability-name",
  ]);
  // a blank scope member also breaks scope agreement everywhere it is
  // compared (the citation's experiment scope and the registry's scope) —
  // all three laws fire, none silently dropped:
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({ scope: { tenantId: "", projectId: "p", worldId: "w" } }),
    ),
    ["blank-scope-member", "scope-mismatch", "registry-scope-mismatch"],
  );
});

test("the provides list obeys the W039 offering laws", () => {
  const registry = createCapabilityRegistry(SCOPE);
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({
        providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION, "" as never],
      }),
    ),
    ["blank-provides-member"],
  );
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({
        providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION, ORG_CAP_EXECUTION],
      }),
    ),
    ["duplicate-provides"],
  );
});

test("lineage shape is proven before lineage continuity", () => {
  const registry = createCapabilityRegistry(SCOPE);
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({ lineage: { parentCapabilityId: null, version: 0 } }),
    ),
    ["invalid-lineage-version"],
  );
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({
        lineage: { parentCapabilityId: "cap-00000000" as CapabilityId, version: 1 },
      }),
    ),
    // the genesis law AND the parent-missing law both fire (the cited
    // parent is nowhere in the registry):
    ["lineage-break", "lineage-break"],
  );
  expectCodes(
    registerCapability(
      registry,
      registrationFixture({ lineage: { parentCapabilityId: null, version: 2 } }),
    ),
    ["lineage-break"],
  );
});

test("a successor must cite a real, version-continuous parent", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const parent = registerCapability(registry, registrationFixture());
  assert.equal(parent.ok, true);
  const withParent = parent.ok ? parent.registry : registry;
  const parentId = parent.ok ? parent.capabilityId : ("cap-none" as CapabilityId);

  const foreign = registerCapability(
    withParent,
    registrationFixture({
      name: "momentum execution, re-measured",
      lineage: { parentCapabilityId: "cap-does-not-exist" as CapabilityId, version: 2 },
    }),
  );
  expectCodes(foreign, ["lineage-break"]);

  const skipped = registerCapability(
    withParent,
    registrationFixture({
      name: "momentum execution, re-measured",
      lineage: { parentCapabilityId: parentId, version: 3 },
    }),
  );
  expectCodes(skipped, ["lineage-break"]);

  const successor = registerCapability(
    withParent,
    registrationFixture({
      name: "momentum execution, re-measured",
      lineage: { parentCapabilityId: parentId, version: 2 },
    }),
  );
  assert.equal(successor.ok, true);
});

test("a citation's experiment must be measured WHERE the capability is claimed", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const experiment = experimentFixture({ tenantId: "tenant-elsewhere" });
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [{ experiment, evaluation, findings }],
  }));
  expectCodes(outcome, ["scope-mismatch"]);
});

test("a fabricated experiment binding is refused", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const claimed = experimentFixture();
  const measured = experimentFixture({ name: "exp-capability-fixture-other" });
  const evaluation = evaluationFixture(measured);
  const findings = findingsFixture(String(evaluation.evaluationId));
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [{ experiment: claimed, evaluation, findings }],
  }));
  expectCodes(outcome, ["citation-experiment-mismatch"]);
});

test("findings that verify another evaluation are refused", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const experiment = experimentFixture();
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture("expeval-someone-elses-evaluation");
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [{ experiment, evaluation, findings }],
  }));
  expectCodes(outcome, ["citation-findings-mismatch"]);
});

test("a fabricated findings digest is refused (content-addressed evidence)", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const evidence = evidenceFixture();
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [{ ...evidence, findings: { ...evidence.findings, digest: "deadbeef00" } }],
  }));
  expectCodes(outcome, ["citation-digest-mismatch"]);
});

test("findings counts that disagree with the findings are refused", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const evidence = evidenceFixture();
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [{ ...evidence, findings: { ...evidence.findings, passCount: 5 } }],
  }));
  expectCodes(outcome, ["citation-count-mismatch"]);
});

test("a FAILED measurement establishes no capability", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [evidenceFixture(["FAIL", "PASS"])],
  }));
  expectCodes(outcome, ["failed-evidence"]);
});

test("a findings report with no PASS establishes nothing", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const outcome = registerCapability(registry, registrationFixture({
    evidence: [evidenceFixture(["PARTIAL", "PARTIAL"])],
  }));
  expectCodes(outcome, ["unmeasured-evidence"]);
});

test("the registry is single-scope", () => {
  const registry = createCapabilityRegistry({ ...SCOPE, worldId: OTHER_WORLD });
  expectCodes(registerCapability(registry, registrationFixture()), [
    "registry-scope-mismatch",
  ]);
});

test("duplicate canonical identity is refused", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const first = registerCapability(registry, registrationFixture());
  assert.equal(first.ok, true);
  const second = registerCapability(
    first.ok ? first.registry : registry,
    registrationFixture(),
  );
  expectCodes(second, ["duplicate-capability"]);
});

test("registration is pure: the input registry is never mutated", () => {
  const registry = createCapabilityRegistry(SCOPE);
  const good = registerCapability(registry, registrationFixture());
  assert.equal(good.ok, true);
  assert.equal(registry.entries.length, 0);
  if (good.ok) {
    assert.equal(good.registry.entries.length, 1);
    const failed = registerCapability(good.registry, registrationFixture());
    assert.equal(failed.ok, false); // the duplicate law, tested above
    assert.equal(good.registry.entries.length, 1);
  }
});
