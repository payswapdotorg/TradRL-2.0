/**
 * Tests for dataset descriptor validation (W020 `tradrl-data`).
 *
 * Laws under test (spec/SIMULATION.md "Fidelity declarations" — honest,
 * explicit, never claiming beyond the data): every declared field is
 * structurally checked; gaps are well-formed, non-overlapping and inside
 * the declared range; the determinism declaration follows A9.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCanonicalDecimalText } from "../records.js";
import {
  HISTORICAL_RECORD_KINDS,
  isHistoricalRecordKind,
  validateDatasetDescriptor,
} from "../descriptor.js";
import { aDescriptor, at, T0 } from "./fixtures.js";

test("the happy-path fixture descriptor is valid", () => {
  assert.deepEqual(validateDatasetDescriptor(aDescriptor()), []);
});

test("identity and source fields must be non-blank", () => {
  const problems = validateDatasetDescriptor(
    aDescriptor({
      datasetId: "" as never,
      source: { provider: " ", name: "", format: "" },
    }),
  );
  assert.ok(problems.some((problem) => problem.includes("datasetId")));
  assert.ok(problems.some((problem) => problem.includes("source.provider")));
  assert.ok(problems.some((problem) => problem.includes("source.name")));
  assert.ok(problems.some((problem) => problem.includes("source.format")));
});

test("granularity is required (the honest scale declaration)", () => {
  const problems = validateDatasetDescriptor(aDescriptor({ granularity: "" }));
  assert.ok(problems.some((problem) => problem.includes("granularity")));
});

test("recordKinds must be a non-empty duplicate-free set of known kinds", () => {
  assert.ok(
    validateDatasetDescriptor(aDescriptor({ recordKinds: [] })).some((problem) =>
      problem.includes("recordKinds"),
    ),
  );
  assert.ok(
    validateDatasetDescriptor(aDescriptor({ recordKinds: ["bar", "bar"] })).some((problem) =>
      problem.includes("duplicate"),
    ),
  );
  assert.ok(
    validateDatasetDescriptor(aDescriptor({ recordKinds: ["bar", "tick" as never] })).some(
      (problem) => problem.includes("not a historical record kind"),
    ),
  );
});

test("range must be finite and ordered", () => {
  assert.ok(
    validateDatasetDescriptor(
      aDescriptor({ range: { from: at(T0 + 100), to: at(T0) } }),
    ).some((problem) => problem.includes("must not exceed")),
  );
  assert.ok(
    validateDatasetDescriptor(aDescriptor({ range: { from: Number.NaN } })).some((problem) =>
      problem.includes("range.from"),
    ),
  );
});

test("gaps must be positive intervals inside the declared range", () => {
  const zeroLength = aDescriptor({
    knownGaps: [{ from: at(T0 + 60_000), to: at(T0 + 60_000) }],
  });
  assert.ok(
    validateDatasetDescriptor(zeroLength).some((problem) => problem.includes("must precede")),
  );
  const overlapping = aDescriptor({
    knownGaps: [
      { from: at(T0 + 60_000), to: at(T0 + 90_000) },
      { from: at(T0 + 80_000), to: at(T0 + 120_000) },
    ],
  });
  assert.ok(
    validateDatasetDescriptor(overlapping).some((problem) => problem.includes("overlaps")),
  );
  const outside = aDescriptor({
    knownGaps: [{ from: at(T0 - 60_000), to: at(T0 + 30_000) }],
  });
  assert.ok(
    validateDatasetDescriptor(outside).some((problem) => problem.includes("starts before")),
  );
});

test("adjacent gaps are legal (half-open intervals)", () => {
  const adjacent = aDescriptor({
    knownGaps: [
      { from: at(T0 + 60_000), to: at(T0 + 90_000) },
      { from: at(T0 + 90_000), to: at(T0 + 120_000) },
    ],
  });
  assert.deepEqual(validateDatasetDescriptor(adjacent), []);
});

test("limitations must be non-blank strings", () => {
  const problems = validateDatasetDescriptor(aDescriptor({ limitations: ["ok", ""] }));
  assert.ok(problems.some((problem) => problem.includes("limitations")));
});

test("determinism declaration follows A9 (nondeterministic sources are declared)", () => {
  assert.ok(
    validateDatasetDescriptor(
      aDescriptor({ determinism: { kind: "nondeterministic", sources: [] } }),
    ).some((problem) => problem.includes("nondeterministic")),
  );
  assert.ok(
    validateDatasetDescriptor(
      aDescriptor({ determinism: { kind: "wild" as never } }),
    ).some((problem) => problem.includes("determinism")),
  );
  assert.deepEqual(
    validateDatasetDescriptor(aDescriptor({ determinism: { kind: "deterministic" } })),
    [],
  );
});

test("record kind guards and the decimal text law (sanity)", () => {
  assert.deepEqual([...HISTORICAL_RECORD_KINDS], ["bar", "trade", "quote"]);
  assert.equal(isHistoricalRecordKind("bar"), true);
  assert.equal(isHistoricalRecordKind("tick"), false);
  assert.equal(isCanonicalDecimalText("4800.25"), true);
  assert.equal(isCanonicalDecimalText("-1"), false);
});
