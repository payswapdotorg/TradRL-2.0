/**
 * The W062 ops-surface tests — REAL imports only (the no-shim law). The
 * readiness fixture carries the gates MEASURED at this work item's head
 * (A6: every number carried by its record, with the head SHA + the exact
 * command cited on every gate; measured by running the real battery —
 * `pnpm --filter <package> test|typecheck|lint` — before pinning). The
 * runbook-alignment law reads the canonical incident-vocabulary runbook and
 * proves its vocabularies against W061's REAL exported constants, so the
 * doc cannot drift from the owning package.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUDIT_ACTION_KINDS,
  OPS_ACTOR_KINDS,
  OPS_EVENT_KINDS,
  OPS_HEALTH_STATUSES,
} from "../packages/observability/index.js";
import {
  READINESS_BATTERIES,
  READINESS_PACKAGE_IDS,
  batteryCommandOf,
  composeReadinessChecklist,
  validateReadinessChecklist,
  type ReadinessChecklist,
  type ReadinessChecklistInput,
  type ReadinessGate,
  type ReadinessViolation,
} from "./index.js";

// ---------------------------------------------------------------------------
// The pinned MEASURED gates (A6 — carried, cited, never invented)
// ---------------------------------------------------------------------------

/** The repository head at which the pinned measurements were taken. */
const MEASURED_AT_HEAD = "eada0cef5b2cd00f374690b000cfc337a3c714fa";

/** The test counts measured at that head (the real battery output). */
const MEASURED_TEST_COUNTS: Readonly<Record<string, number>> = {
  api: 52,
  observability: 62,
  operations: 45,
  sdk: 36,
  security: 45,
  "security-service": 29,
};

function measuredGates(): readonly ReadinessGate[] {
  const gates: ReadinessGate[] = [];
  for (const packageId of READINESS_PACKAGE_IDS) {
    for (const battery of READINESS_BATTERIES) {
      gates.push({
        packageId,
        battery,
        command: batteryCommandOf(packageId, battery),
        exitCode: 0,
        testCount: battery === "test" ? MEASURED_TEST_COUNTS[packageId]! : null,
        measuredAtHead: MEASURED_AT_HEAD,
      });
    }
  }
  return gates;
}

const kindsOf = (violations: readonly ReadinessViolation[]): readonly string[] =>
  violations.map((violation) => violation.kind);

const BASE_OUTCOME = composeReadinessChecklist({ gates: measuredGates() });
if (!BASE_OUTCOME.ok) {
  throw new Error(
    `the pinned readiness checklist is unlawful: ${JSON.stringify(BASE_OUTCOME.violations)}`,
  );
}
const BASE: ReadinessChecklist = BASE_OUTCOME.checklist;

// ---------------------------------------------------------------------------
// The gate: the happy paths + the A9 twins
// ---------------------------------------------------------------------------

test("the pinned measured checklist composes and re-validates", () => {
  assert.equal(BASE.checklistId.slice(0, 4), "rcl-");
  assert.equal(BASE.gates.length, READINESS_PACKAGE_IDS.length * READINESS_BATTERIES.length);
  for (const gate of BASE.gates) {
    assert.equal(gate.exitCode, 0);
    assert.equal(gate.command, batteryCommandOf(gate.packageId, gate.battery));
    assert.equal(gate.measuredAtHead, MEASURED_AT_HEAD);
  }
  const revalidated = validateReadinessChecklist(BASE);
  assert.ok(revalidated.ok, JSON.stringify(revalidated.ok ? null : revalidated.violations));
});

test("A9 twin: the gates' input order never leaks (id + record)", () => {
  const twin = composeReadinessChecklist({
    gates: [...measuredGates()].reverse(),
  });
  assert.ok(twin.ok);
  assert.equal(twin.checklist.checklistId, BASE.checklistId);
  assert.deepEqual(twin.checklist, BASE);
});

test("A9: the same measured gates always mint the same checklist", () => {
  const again = composeReadinessChecklist({ gates: measuredGates() });
  assert.ok(again.ok);
  assert.equal(again.checklist.checklistId, BASE.checklistId);
});

// ---------------------------------------------------------------------------
// The gate: every refusal law (fail-closed, all violations collected)
// ---------------------------------------------------------------------------

test("malformed input is refused loudly", () => {
  const outcome = composeReadinessChecklist(null as unknown as ReadinessChecklistInput);
  assert.ok(!outcome.ok);
  assert.deepEqual(kindsOf(outcome.violations), ["malformed-input"]);
});

test("a red gate is refused loudly (readiness is green only)", () => {
  const gates = measuredGates().map((gate) =>
    gate.packageId === "api" && gate.battery === "test"
      ? { ...gate, exitCode: 1 }
      : gate,
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("gate-not-green"));
});

test("a test gate without a carried count is refused (A6)", () => {
  const gates = measuredGates().map((gate) =>
    gate.packageId === "sdk" && gate.battery === "test"
      ? { ...gate, testCount: null }
      : gate,
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("missing-test-count"));
});

test("a non-positive test count is refused", () => {
  const gates = measuredGates().map((gate) =>
    gate.packageId === "security" && gate.battery === "test"
      ? { ...gate, testCount: 0 }
      : gate,
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("non-positive-test-count"));
});

test("an unknown package or battery is refused (closed vocabularies)", () => {
  const unknownPackage = composeReadinessChecklist({
    gates: [
      ...measuredGates(),
      {
        packageId: "finance" as never,
        battery: "test",
        command: "pnpm --filter finance test",
        exitCode: 0,
        testCount: 3,
        measuredAtHead: MEASURED_AT_HEAD,
      },
    ],
  });
  assert.ok(!unknownPackage.ok);
  assert.ok(kindsOf(unknownPackage.violations).includes("unknown-package"));

  const unknownBattery = composeReadinessChecklist({
    gates: [
      ...measuredGates(),
      {
        packageId: "api",
        battery: "benchmark" as never,
        command: "pnpm --filter api benchmark",
        exitCode: 0,
        testCount: null,
        measuredAtHead: MEASURED_AT_HEAD,
      },
    ],
  });
  assert.ok(!unknownBattery.ok);
  assert.ok(kindsOf(unknownBattery.violations).includes("unknown-battery"));
});

test("a duplicated gate is refused (identity is exact)", () => {
  const gates = [...measuredGates(), measuredGates()[0]!];
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("duplicate-gate"));
});

test("a free-form command is refused (the command is DERIVED)", () => {
  const gates = measuredGates().map((gate) =>
    gate.packageId === "operations" && gate.battery === "lint"
      ? { ...gate, command: "pnpm test" }
      : gate,
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("command-mismatch"));
});

test("a gate without its measured head is refused", () => {
  const gates = measuredGates().map((gate) =>
    gate.packageId === "observability" && gate.battery === "typecheck"
      ? { ...gate, measuredAtHead: "" }
      : gate,
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("blank-measured-head"));
});

test("a coverage gap is refused (readiness covers the WHOLE surface)", () => {
  const gates = measuredGates().filter(
    (gate) => !(gate.packageId === "security-service" && gate.battery === "lint"),
  );
  const outcome = composeReadinessChecklist({ gates });
  assert.ok(!outcome.ok);
  const coverage = outcome.violations.find(
    (violation) => violation.kind === "coverage-gap",
  );
  assert.ok(coverage !== undefined);
  assert.ok(coverage.detail.includes("security-service lint"));
});

// ---------------------------------------------------------------------------
// The whole-record re-validation (tamper gates — every rewrite is loud)
// ---------------------------------------------------------------------------

test("a rewritten checklist id is refused loudly (id re-derivation)", () => {
  const tampered = { ...BASE, checklistId: "rcl-deadbeef" };
  const outcome = validateReadinessChecklist(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("id-mismatch"));
});

test("an edited measured number is refused (the id weighs every carried byte)", () => {
  const tampered = {
    ...BASE,
    gates: BASE.gates.map((gate) =>
      gate.packageId === "api" && gate.battery === "test"
        ? { ...gate, testCount: 999 }
        : gate,
    ),
  };
  const outcome = validateReadinessChecklist(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("id-mismatch"));
});

test("a recorded red gate is refused at re-validation exactly as at composition", () => {
  const tampered = {
    ...BASE,
    gates: BASE.gates.map((gate) =>
      gate.packageId === "sdk" && gate.battery === "typecheck"
        ? { ...gate, exitCode: 2 }
        : gate,
    ),
  };
  const outcome = validateReadinessChecklist(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("gate-not-green"));
});

test("non-canonical carriage is refused (a record IS canonical data)", () => {
  const tampered = { ...BASE, gates: [...BASE.gates].reverse() };
  const outcome = validateReadinessChecklist(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("non-canonical-record"));
});

test("a dishonest provenance record is refused", () => {
  const tampered = {
    ...BASE,
    provenance: { ...BASE.provenance, deriver: "hand-written" },
  };
  const outcome = validateReadinessChecklist(tampered);
  assert.ok(!outcome.ok);
  assert.ok(kindsOf(outcome.violations).includes("provenance-unlawful"));
});

// ---------------------------------------------------------------------------
// The runbook-alignment law (the incident vocabulary cannot drift)
// ---------------------------------------------------------------------------

test("the incident-vocabulary runbook carries W061's REAL vocabularies verbatim", () => {
  const runbook = readFileSync(
    new URL("./runbooks/incident-vocabulary.md", import.meta.url),
    "utf8",
  );
  for (const kind of OPS_EVENT_KINDS) {
    assert.ok(
      runbook.includes(`\`${kind}\``),
      `the runbook must carry the real event kind '${kind}'`,
    );
  }
  for (const action of AUDIT_ACTION_KINDS) {
    assert.ok(
      runbook.includes(`\`${action}\``),
      `the runbook must carry the real audit action '${action}'`,
    );
  }
  for (const status of OPS_HEALTH_STATUSES) {
    assert.ok(
      runbook.includes(`\`${status}\``),
      `the runbook must carry the real health status '${status}'`,
    );
  }
  for (const actor of OPS_ACTOR_KINDS) {
    assert.ok(
      runbook.includes(`\`${actor}\``),
      `the runbook must carry the real actor kind '${actor}'`,
    );
  }
});
