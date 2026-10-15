/**
 * The catalogue load-validation laws (W042) — over the REAL catalogue at
 * benchmarks/model-capability (imported, never re-declared) plus the
 * fail-closed violation fixtures.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { validateBenchmarkCatalogue } from "../validate.js";
import type { BenchmarkDescriptor } from "../demand.js";
import { MODEL_CAPABILITY_BENCHMARKS } from "../../../benchmarks/model-capability/model-capability-benchmarks.js";
import { benchmarkSurface } from "./fixtures.js";

test("the REAL catalogue validates at load: four unique benchmarks, closed vocabularies, one scope", () => {
  const outcome = validateBenchmarkCatalogue(MODEL_CAPABILITY_BENCHMARKS);
  deepEqual(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  deepEqual(outcome.checked, [...MODEL_CAPABILITY_BENCHMARKS].map((entry) => entry.benchmarkId).sort());
});

test("duplicate benchmark ids are refused loudly", () => {
  const catalogue = [...MODEL_CAPABILITY_BENCHMARKS, MODEL_CAPABILITY_BENCHMARKS[0]!];
  const outcome = validateBenchmarkCatalogue(catalogue);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "duplicate-benchmark"), true);
});

test("a capability kind outside W040's closed vocabulary is refused", () => {
  const catalogue: BenchmarkDescriptor[] = MODEL_CAPABILITY_BENCHMARKS.map((entry, index) =>
    index === 0 ? { ...entry, capabilityKind: "telepathy" } : entry,
  );
  const outcome = validateBenchmarkCatalogue(catalogue);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "unknown-capability-kind"), true);
});

test("a scope disagreement inside the catalogue is refused (single-scope law)", () => {
  const catalogue: BenchmarkDescriptor[] = MODEL_CAPABILITY_BENCHMARKS.map((entry, index) =>
    index === 1 ? { ...entry, scope: { ...entry.scope, tenantId: "tenant-elsewhere" } } : entry,
  );
  const outcome = validateBenchmarkCatalogue(catalogue);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "catalogue-scope-mismatch"), true);
});

test("an illegal period atom (from >= to) is refused", () => {
  const catalogue: BenchmarkDescriptor[] = MODEL_CAPABILITY_BENCHMARKS.map((entry, index) =>
    index === 0
      ? { ...entry, requiredAxes: [{ axisId: "axis-bad", kind: "period" as const, atoms: [{ kind: "period" as const, from: 200, to: 200 }] }] }
      : entry,
  );
  const outcome = validateBenchmarkCatalogue(catalogue);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "invalid-period-atom"), true);
});

test("a lineage break (dangling parent) is refused", () => {
  const catalogue: BenchmarkDescriptor[] = MODEL_CAPABILITY_BENCHMARKS.map((entry, index) =>
    index === 0 ? { ...entry, lineage: { parentBenchmarkId: "bmk-never-declared", version: 2 } } : entry,
  );
  const outcome = validateBenchmarkCatalogue(catalogue);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "lineage-break"), true);
});

test("the fixture surface carries the real catalogue (the no-shim law)", () => {
  const surface = benchmarkSurface();
  deepEqual(surface.catalogue.length, 4);
  deepEqual(surface.catalogue[0]!.benchmarkId, "bmk-execution-quality-futures-holdout");
});
