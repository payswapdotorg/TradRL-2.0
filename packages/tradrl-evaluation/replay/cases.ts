/**
 * The check-case machinery (W022 internal): run one case against the REAL
 * adapter/loader surfaces, observe what happened, and evaluate the case's
 * expectation against the observation — a pure verdict, always.
 *
 * Execution vs evaluation are SEPARATE by design (the falsifiability seam):
 * `observe` drives the real `tradrl-adapters-nautilus` / `tradrl-data`
 * surfaces; `expectation.verify` is a pure function of the observation —
 * so this package's own tests can feed MUTATED observations to the pure
 * half and prove every check family can actually fail (a check that cannot
 * fail is worthless).
 *
 * Fail-closed law: a case whose execution throws produces a `harness-error`
 * observation and a FAILED verdict — the harness never interprets its own
 * crash as a pass. Observations are plain data (JSON-serializable evidence).
 */

import type { HistoricalRecord } from "tradrl-world-contracts/data";
import type { NautilusMappingViolation } from "tradrl-adapters-nautilus/errors";
import { mapNautilusDataset, mapNautilusRecord } from "tradrl-adapters-nautilus/mapping";
import type { DatasetViolation, HistoricalImportSummary } from "tradrl-data";
import { DatasetImportError, loadHistoricalDataset } from "tradrl-data";
import type { CaseVerdict } from "./findings.js";

/** What one mapping attempt actually produced (plain data). */
export type MappingObservation =
  | { readonly kind: "mapped"; readonly record: HistoricalRecord }
  | { readonly kind: "rejected"; readonly violations: readonly NautilusMappingViolation[] };

/** What one dataset import actually produced (plain data). */
export type ImportObservation =
  | {
      readonly kind: "imported";
      readonly recordCount: number;
      readonly eventCount: number;
      readonly eventChecksum: string;
      readonly summary: HistoricalImportSummary;
    }
  | { readonly kind: "import-threw"; readonly violations: readonly DatasetViolation[] };

/** Everything a case can observe (plus the fail-closed harness error). */
export type CaseObservation =
  | MappingObservation
  | BatchObservation
  | ImportObservation
  | { readonly kind: "harness-error"; readonly message: string };

/** What one batch mapping actually produced (plain data). */
export type BatchObservation =
  | {
      readonly kind: "mapped-batch";
      readonly records: readonly HistoricalRecord[];
      readonly datasetId: string;
      readonly range: { readonly from?: number; readonly to?: number };
      readonly knownGaps: readonly { readonly from: number; readonly to: number; readonly reason?: string }[];
      readonly limitations: readonly string[];
    }
  | { readonly kind: "rejected"; readonly violations: readonly NautilusMappingViolation[] };

/** One case's expectation — a pure, violatable predicate over the observation. */
export interface CaseExpectation {
  /** The expectation in force (one line, deterministic). */
  readonly describe: string;
  /** Returns undefined when the observation satisfies the expectation, else the violation. */
  readonly verify: (observation: CaseObservation) => string | undefined;
}

/** One check case: identity + prose + expectation + the real-surface execution. */
export interface FidelityCase {
  readonly id: string;
  readonly describe: string;
  readonly expectation: CaseExpectation;
  readonly observe: () => CaseObservation;
}

/** Render one observation as a deterministic one-line summary (evidence text). */
export function describeObservation(observation: CaseObservation): string {
  switch (observation.kind) {
    case "mapped":
      return `mapped a ${observation.record.kind} record (${JSON.stringify(observation.record)})`;
    case "mapped-batch": {
      const first = observation.records[0];
      const last = observation.records[observation.records.length - 1];
      return `mapped a batch of ${String(observation.records.length)} record(s), datasetId ${observation.datasetId}, knownGaps ${String(observation.knownGaps.length)}, range ${JSON.stringify(observation.range)}; first ${JSON.stringify(first)}; last ${JSON.stringify(last)}`;
    }
    case "rejected":
      return `rejected with ${String(observation.violations.length)} violation(s) [${observation.violations
        .map((violation) => violation.kind)
        .join(", ")}]: ${observation.violations.map((violation) => violation.detail).join(" | ")}`;
    case "imported":
      return `imported ${String(observation.recordCount)} record(s) as ${String(observation.eventCount)} event(s), eventChecksum ${observation.eventChecksum}`;
    case "import-threw":
      return `import rejected with ${String(observation.violations.length)} violation(s) [${observation.violations
        .map((violation) => violation.kind)
        .join(", ")}]: ${observation.violations.map((violation) => violation.detail).join(" | ")}`;
    case "harness-error":
      return `harness error: ${observation.message}`;
  }
}

/** Expect the row to map, and the mapped record to satisfy a violatable property. */
export function expectMappedRecord(
  describe: string,
  property: (record: HistoricalRecord) => string | undefined,
): CaseExpectation {
  return {
    describe,
    verify: (observation) => {
      if (observation.kind !== "mapped") {
        return `expected the adapter to map the row to ${describe}, observed: ${describeObservation(observation)}`;
      }
      return property(observation.record);
    },
  };
}

/** Expect the adapter to reject loudly with the named violation kind (and a detail needle). */
export function expectRejectedWith(
  describe: string,
  kind: NautilusMappingViolation["kind"],
  detailNeedle?: string,
): CaseExpectation {
  return {
    describe,
    verify: (observation) => {
      if (observation.kind !== "rejected") {
        return `expected a loud typed rejection, observed: ${describeObservation(observation)}`;
      }
      const violations = observation.violations;
      if (!violations.some((violation) => violation.kind === kind)) {
        return `expected a '${kind}' violation, observed kinds [${violations.map((v) => v.kind).join(", ")}]`;
      }
      if (detailNeedle !== undefined && !violations.some((violation) => violation.detail.includes(detailNeedle))) {
        return `expected the '${kind}' detail to name '${detailNeedle}', observed: ${describeObservation(observation)}`;
      }
      return undefined;
    },
  };
}

/** Expect the batch to map, and the mapped batch to satisfy a violatable property. */
export function expectMappedBatch(
  describe: string,
  property: (batch: Extract<BatchObservation, { readonly kind: "mapped-batch" }>) => string | undefined,
): CaseExpectation {
  return {
    describe,
    verify: (observation) => {
      if (observation.kind !== "mapped-batch") {
        return `expected the adapter to map the batch, observed: ${describeObservation(observation)}`;
      }
      return property(observation);
    },
  };
}

/** Expect the import to succeed, and its outcome to satisfy a violatable property. */
export function expectImported(
  describe: string,
  property?: (outcome: Extract<ImportObservation, { readonly kind: "imported" }>) => string | undefined,
): CaseExpectation {
  return {
    describe,
    verify: (observation) => {
      if (observation.kind !== "imported") {
        return `expected the W020 loader to import the dataset, observed: ${describeObservation(observation)}`;
      }
      return property === undefined ? undefined : property(observation);
    },
  };
}

/** Expect the W020 loader to reject the dataset loudly with the named violation kind. */
export function expectImportThrows(
  describe: string,
  kind: DatasetViolation["kind"],
  detailNeedle?: string,
): CaseExpectation {
  return {
    describe,
    verify: (observation) => {
      if (observation.kind !== "import-threw") {
        return `expected the W020 loader to reject the import ('${kind}'), observed: ${describeObservation(observation)}`;
      }
      const violations = observation.violations;
      if (!violations.some((violation) => violation.kind === kind)) {
        return `expected an '${kind}' import violation, observed kinds [${violations.map((v) => v.kind).join(", ")}]`;
      }
      if (detailNeedle !== undefined && !violations.some((violation) => violation.detail.includes(detailNeedle))) {
        return `expected the '${kind}' detail to name '${detailNeedle}', observed: ${describeObservation(observation)}`;
      }
      return undefined;
    },
  };
}

/**
 * Run one case: execute (fail-closed), then evaluate. Pure in the verdict:
 * same execution result ⇒ same verdict, always.
 */
export function runCase(test: FidelityCase): CaseVerdict {
  let observation: CaseObservation;
  try {
    observation = test.observe();
  } catch (error) {
    observation = {
      kind: "harness-error",
      message: `${String((error as Error)?.name ?? "Error")}: ${String((error as Error)?.message ?? error)}`,
    };
  }
  const problem =
    observation.kind === "harness-error"
      ? // Fail-closed: the harness crashing is never a held expectation.
        `the harness itself failed while running this case (${observation.message})`
      : test.expectation.verify(observation);
  return Object.freeze({
    caseId: test.id,
    describe: test.describe,
    expected: test.expectation.describe,
    observed: describeObservation(observation),
    ...(problem === undefined ? {} : { problem }),
  });
}

/** Run a case list in order (deterministic evidence order). */
export function runCases(cases: readonly FidelityCase[]): readonly CaseVerdict[] {
  return cases.map((one) => runCase(one));
}

// --- shared real-surface observers (the `observe` closures check modules use) ----

/**
 * Observe ONE dtype row through the REAL adapter's single-record surface.
 * Structural failures (catalog/dtype) surface as ordinary rejections — the
 * observation never interprets, it records.
 */
export function observeMapping(
  catalog: Parameters<typeof mapNautilusRecord>[0],
  dtypeId: string,
  raw: unknown,
  context?: Parameters<typeof mapNautilusRecord>[3],
): MappingObservation {
  const result = mapNautilusRecord(catalog, dtypeId, raw, context);
  return result.ok
    ? { kind: "mapped", record: result.record }
    : { kind: "rejected", violations: result.violations };
}

/**
 * Observe ONE catalog batch through the REAL adapter's batch engine — the
 * exact triple `loadHistoricalDataset` consumes (records kept in the
 * documented partition order, the built W020 descriptor, the symbol map).
 */
export function observeBatch(
  catalog: Parameters<typeof mapNautilusDataset>[0],
  dtypeId: string,
  rows: readonly unknown[],
  context?: Parameters<typeof mapNautilusDataset>[3],
): BatchObservation {
  const result = mapNautilusDataset(catalog, dtypeId, rows, context);
  if (!result.ok) {
    return { kind: "rejected", violations: result.violations };
  }
  return {
    kind: "mapped-batch",
    records: [...result.records],
    datasetId: String(result.datasetDescriptor.datasetId),
    range: {
      ...(result.datasetDescriptor.range.from === undefined ? {} : { from: result.datasetDescriptor.range.from }),
      ...(result.datasetDescriptor.range.to === undefined ? {} : { to: result.datasetDescriptor.range.to }),
    },
    knownGaps: [...result.datasetDescriptor.knownGaps],
    limitations: [...result.datasetDescriptor.limitations],
  };
}

/**
 * Observe one dataset import through the REAL W020 loader: a mapped batch's
 * exact output triple (records, descriptor, symbolMap) is imported for the
 * world; `DatasetImportError` becomes the typed `import-threw` observation
 * (any other throw escapes to the fail-closed harness-error path).
 */
export function observeImport(
  outcome: {
    readonly records: readonly HistoricalRecord[];
    readonly datasetDescriptor: Parameters<typeof loadHistoricalDataset>[0]["descriptor"];
    readonly symbolMap: Parameters<typeof loadHistoricalDataset>[0]["symbolMap"];
  },
  worldId: Parameters<typeof loadHistoricalDataset>[0]["worldId"],
): ImportObservation {
  try {
    const imported = loadHistoricalDataset({
      worldId,
      descriptor: outcome.datasetDescriptor,
      records: [...outcome.records],
      symbolMap: outcome.symbolMap,
    });
    return {
      kind: "imported",
      recordCount: imported.records.length,
      eventCount: imported.digest.eventCount,
      eventChecksum: imported.digest.eventChecksum,
      summary: imported.summary,
    };
  } catch (error) {
    if (error instanceof DatasetImportError) {
      return { kind: "import-threw", violations: error.violations };
    }
    throw error;
  }
}
