/**
 * The production-readiness CHECKLIST CONTRACT (W062 `ops/`) — typed,
 * validated data: the battery surface a production deployment requires,
 * every gate a PROVEN CITATION of a real battery command over a real
 * package.
 *
 * A6 (evidence-linked truth): every number on a readiness record is CARRIED
 * by the gate record itself — the measured exit code, the measured test
 * count, and the head SHA at which they were measured. This contract never
 * invents, infers, or re-measures a number; it REFUSES a gate that is not
 * green, a gate whose command is not the derived real command, and a
 * checklist that does not cover the WHOLE closed package surface.
 *
 * The closed package vocabulary is PROVEN against the real merged-dep
 * surfaces through the anchor registry: each package id is bound to a REAL
 * exported const of that package (`READINESS_PACKAGE_ANCHORS` — the W059
 * `ROUTE_PAYLOAD_TYPES` compile-time drift-guard pattern: if a consumed
 * package renames its anchor, this contract stops type-checking).
 *
 * A9: the checklist id is content-addressed (`rcl-<digest>`) over canonical
 * data — the gates' input order never leaks. A13/A14: typed data + its gate
 * only — this contract never runs a battery (the operator runs the commands;
 * the record carries what was measured).
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "../packages/trajectory/index.js";
import { WORLD_ALPHA_API_V1 } from "../services/api/index.js";
import { SDK_SURFACE_ROUTE_NAMES } from "../packages/sdk/index.js";
import {
  OPERATIONS_ROUTE_NAMES,
  OPS_EVENT_KINDS,
} from "../packages/observability/index.js";
import { SECURITY_PROVENANCE_LAWS } from "../packages/security/index.js";
import { OPERATIONS_REPORT_ID_PREFIX } from "../services/operations/index.js";
import { SECRET_ENFORCEMENT_ID_PREFIX } from "../services/security/index.js";

// ---------------------------------------------------------------------------
// The laws this contract names (citations, never measurements)
// ---------------------------------------------------------------------------

/** A6 — every number is carried by a cited record, never invented. */
export const EVIDENCE_LAW =
  "spec/ARCHITECTURE-LOCK.md A6 — evidence-linked truth: every number is carried by a cited record" as const;
/** A9 — determinism: same gates ⇒ deep-equal checklist, same canonical id. */
export const OPS_DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;
/** A13/A14 — typed data + gates only; never executes a battery. */
export const OPS_NO_EXECUTION_LAW =
  "spec/ARCHITECTURE-LOCK.md A13/A14 — compose typed records; never execute, never spawn, never serve" as const;
/** The laws every readiness provenance record cites. */
export const READINESS_PROVENANCE_LAWS: readonly string[] = [
  EVIDENCE_LAW,
  OPS_DETERMINISM_LAW,
  OPS_NO_EXECUTION_LAW,
];

// ---------------------------------------------------------------------------
// The closed vocabularies (each package PROVEN against a real surface)
// ---------------------------------------------------------------------------

/** The closed package vocabulary — the six real battery surfaces of this
 * work item's dependency family (the merged W059/W060/W061 surfaces). */
export const READINESS_PACKAGE_IDS = [
  "api",
  "observability",
  "operations",
  "sdk",
  "security",
  "security-service",
] as const;
export type ReadinessPackageId = (typeof READINESS_PACKAGE_IDS)[number];

/**
 * The anchor registry — each package id bound to a REAL exported const of
 * that package (values are never read; the binding is the compile-time
 * drift guard). The incident vocabulary anchor additionally pins W061's
 * closed event-kind set for the runbooks' alignment law.
 */
export const READINESS_PACKAGE_ANCHORS: Readonly<
  Record<ReadinessPackageId, unknown>
> = {
  api: WORLD_ALPHA_API_V1,
  observability: OPERATIONS_ROUTE_NAMES,
  operations: OPERATIONS_REPORT_ID_PREFIX,
  sdk: SDK_SURFACE_ROUTE_NAMES,
  security: SECURITY_PROVENANCE_LAWS,
  "security-service": SECRET_ENFORCEMENT_ID_PREFIX,
};

/** W061's own closed operational event-kind vocabulary — re-exported as the
 * ops incident vocabulary (the runbooks cite it; never re-declared). */
export const INCIDENT_EVENT_KINDS: readonly string[] = OPS_EVENT_KINDS;

/** The closed battery vocabulary, canonical order. */
export const READINESS_BATTERIES = ["lint", "test", "typecheck"] as const;
export type ReadinessBattery = (typeof READINESS_BATTERIES)[number];

/**
 * The REAL battery command for one gate — DERIVED from the package id + the
 * battery (never free-form): `pnpm --filter <package> <battery>`. A carried
 * command that differs is a loud violation (the command cannot drift from
 * the surface it claims to have measured).
 */
export function batteryCommandOf(
  packageId: ReadinessPackageId,
  battery: ReadinessBattery,
): string {
  return `pnpm --filter ${packageId} ${battery}`;
}

// ---------------------------------------------------------------------------
// The gate + the checklist (typed data, content-addressed — A9)
// ---------------------------------------------------------------------------

/**
 * ONE readiness gate: a measured battery run over one real package, CARRIED
 * as data (A6). `exitCode` + `testCount` are the MEASURED results (the test
 * count only exists for `test` batteries — carried, never inferred);
 * `measuredAtHead` is the repository head at which the run measured (declared
 * data — A9 has no clocks).
 */
export interface ReadinessGate {
  readonly packageId: ReadinessPackageId;
  readonly battery: ReadinessBattery;
  readonly command: string;
  readonly exitCode: number;
  readonly testCount: number | null;
  readonly measuredAtHead: string;
}

/** The checklist's deterministic provenance record. */
export interface ReadinessProvenance {
  readonly deriver: "compose-readiness-checklist";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/** The production-readiness checklist: the canonically ordered gates + the
 * content-addressed `rcl-<digest>` id. */
export interface ReadinessChecklist {
  readonly checklistId: string;
  readonly gates: readonly ReadinessGate[];
  readonly provenance: ReadinessProvenance;
}

/** The composition input (the measured gates, carried as data). */
export interface ReadinessChecklistInput {
  readonly gates: readonly ReadinessGate[];
}

/** Every law a readiness declaration can violate (closed set). */
export type ReadinessViolationKind =
  | "malformed-input"
  | "unknown-package"
  | "unknown-battery"
  | "duplicate-gate"
  | "command-mismatch"
  | "gate-not-green"
  | "missing-test-count"
  | "non-positive-test-count"
  | "blank-measured-head"
  | "coverage-gap"
  | "non-canonical-record"
  | "id-mismatch"
  | "provenance-unlawful";

/** One typed readiness violation (fail-closed; the law named in the detail). */
export interface ReadinessViolation {
  readonly kind: ReadinessViolationKind;
  readonly detail: string;
}

/** Canonical gate order: by package id, then battery (both closed sets). */
export function canonicalGates(
  gates: readonly ReadinessGate[],
): readonly ReadinessGate[] {
  return [...gates].sort(
    (left, right) =>
      `${String(left.packageId)}|${String(left.battery)}` <
        `${String(right.packageId)}|${String(right.battery)}`
        ? -1
        : `${String(left.packageId)}|${String(left.battery)}`
            > `${String(right.packageId)}|${String(right.battery)}`
          ? 1
          : 0,
  );
}

/** The canonical content a checklist id addresses (every carried byte). */
export function canonicalReadinessContent(
  checklist: Omit<ReadinessChecklist, "checklistId">,
): Record<string, unknown> {
  return {
    gates: canonicalGates(checklist.gates).map((gate) => [
      gate.battery,
      gate.command,
      gate.exitCode,
      gate.measuredAtHead,
      gate.packageId,
      gate.testCount,
    ]),
  };
}

/** The content-addressed checklist id: `rcl-<digest>` (A9). */
export function readinessChecklistIdOf(
  checklist: Omit<ReadinessChecklist, "checklistId">,
): string {
  return `rcl-${canonicalDigestHex(canonicalReadinessContent(checklist))}`;
}

/** The input digest (the provenance member), canonical (A9). */
export function readinessInputDigestOf(input: ReadinessChecklistInput): string {
  return canonicalDigestHex({
    gates: canonicalGates(input.gates).map((gate) => [
      gate.battery,
      gate.command,
      gate.exitCode,
      gate.measuredAtHead,
      gate.packageId,
      gate.testCount,
    ]),
  });
}

// ---------------------------------------------------------------------------
// The gate laws (fail-closed, all violations collected — shared by the
// composition gate and the whole-record re-validation)
// ---------------------------------------------------------------------------

/** The per-gate laws (vocabularies, derived command, green exit, A6 counts). */
export function gateViolations(gate: unknown): readonly ReadinessViolation[] {
  const violations: ReadinessViolation[] = [];
  if (
    typeof gate !== "object" ||
    gate === null ||
    Array.isArray(gate)
  ) {
    return [
      {
        kind: "malformed-input",
        detail: "a readiness gate is not typed data — a package id, a battery, the command, the measured exit code, the test count and the measured head are required",
      },
    ];
  }
  const record = gate as Record<string, unknown>;
  const packageId = String(record.packageId);
  if (!(READINESS_PACKAGE_IDS as readonly string[]).includes(packageId)) {
    violations.push({
      kind: "unknown-package",
      detail: `the package '${packageId}' is outside the closed readiness vocabulary — readiness covers ${READINESS_PACKAGE_IDS.join(" / ")} only (the real battery surfaces of this dependency family)`,
    });
  }
  const battery = String(record.battery);
  if (!(READINESS_BATTERIES as readonly string[]).includes(battery)) {
    violations.push({
      kind: "unknown-battery",
      detail: `the battery '${battery}' is outside the closed vocabulary — a gate measures ${READINESS_BATTERIES.join(" / ")} only`,
    });
  }
  if (
    (READINESS_PACKAGE_IDS as readonly string[]).includes(packageId) &&
    (READINESS_BATTERIES as readonly string[]).includes(battery)
  ) {
    const derived = batteryCommandOf(
      packageId as ReadinessPackageId,
      battery as ReadinessBattery,
    );
    if (String(record.command) !== derived) {
      violations.push({
        kind: "command-mismatch",
        detail: `the carried command '${String(record.command)}' is not the derived real command '${derived}' — a gate's command is derived from its package + battery, never free-form`,
      });
    }
  }
  if (record.exitCode !== 0) {
    violations.push({
      kind: "gate-not-green",
      detail: `the gate '${packageId} ${battery}' measured exit code ${String(record.exitCode)} — production readiness is GREEN ONLY; a red gate is refused loudly, never silently recorded as ready`,
    });
  }
  if (battery === "test") {
    if (record.testCount === null || record.testCount === undefined) {
      violations.push({
        kind: "missing-test-count",
        detail: `the test gate '${packageId}' carries no test count — a measured number is CARRIED by its record (${EVIDENCE_LAW}), never omitted`,
      });
    } else if (
      typeof record.testCount !== "number" ||
      !Number.isSafeInteger(record.testCount) ||
      record.testCount < 1
    ) {
      violations.push({
        kind: "non-positive-test-count",
        detail: `the test gate '${packageId}' carries the test count '${String(record.testCount)}' — a real suite runs at least one test`,
      });
    }
  }
  if (typeof record.measuredAtHead !== "string" || record.measuredAtHead.length === 0) {
    violations.push({
      kind: "blank-measured-head",
      detail: `the gate '${packageId}' carries no measured-at head — a measurement's provenance is explicit (the head SHA it was measured at), never blank`,
    });
  }
  return violations;
}

/** The coverage law: EVERY package × EVERY battery is carried (the whole
 * closed surface — a readiness checklist that skips a real battery surface
 * of the dependency family is refused loudly). */
export function coverageViolations(
  gates: readonly ReadinessGate[],
): readonly ReadinessViolation[] {
  const present = new Set(
    gates.map((gate) => `${String(gate?.packageId)}|${String(gate?.battery)}`),
  );
  const violations: ReadinessViolation[] = [];
  for (const packageId of READINESS_PACKAGE_IDS) {
    for (const battery of READINESS_BATTERIES) {
      if (!present.has(`${packageId}|${battery}`)) {
        violations.push({
          kind: "coverage-gap",
          detail: `no gate carries '${packageId} ${battery}' — production readiness covers the WHOLE closed surface (every package × every battery), never a subset`,
        });
      }
    }
  }
  return violations;
}

/** The duplicate-gate law (a package + battery is measured exactly once). */
export function duplicateGateViolations(
  gates: readonly ReadinessGate[],
): readonly ReadinessViolation[] {
  const seen = new Set<string>();
  const violations: ReadinessViolation[] = [];
  for (const gate of gates) {
    const key = `${String(gate?.packageId)}|${String(gate?.battery)}`;
    if (seen.has(key)) {
      violations.push({
        kind: "duplicate-gate",
        detail: `the gate '${key.replace("|", " ")}' is carried twice — one measurement per package × battery, identity is exact`,
      });
    }
    seen.add(key);
  }
  return violations;
}
