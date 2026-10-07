/**
 * Descriptor + record-law tests (W027 `tradrl-information`).
 *
 * Spec: spec/SIMULATION.md "Fidelity declarations"; the W020
 * `descriptor.test.ts`/`records.test.ts` laws applied to the information
 * kinds. Everything here is pure — no engine, no journal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INFORMATION_RECORD_KINDS,
  isInformationRecordKind,
  validateInformationDatasetDescriptor,
} from "../descriptor.js";
import {
  isAnalystNoteRecord,
  isEventRecord,
  isNewsItemRecord,
  isResearchReportRecord,
  isCanonicalDecimalText,
  sortInformationRecords,
} from "../records.js";
import { aDescriptor, aNewsItem, aResearchReport, anEvent, at } from "./fixtures.js";

test("the happy-path fixture descriptor is valid", () => {
  assert.deepEqual(validateInformationDatasetDescriptor(aDescriptor()), []);
});

test("identity and source fields must be non-blank", () => {
  const problems = validateInformationDatasetDescriptor(
    aDescriptor({
      datasetId: "" as never,
      source: { provider: " ", name: "", format: "", obtained: "" },
    }),
  );
  assert.ok(problems.some((problem) => problem.includes("datasetId")));
  assert.ok(problems.some((problem) => problem.includes("source.provider")));
  assert.ok(problems.some((problem) => problem.includes("source.name")));
  assert.ok(problems.some((problem) => problem.includes("source.format")));
  assert.ok(problems.some((problem) => problem.includes("source.obtained")));
});

test("granularity is required (the honest scale declaration)", () => {
  const problems = validateInformationDatasetDescriptor(aDescriptor({ granularity: "" }));
  assert.deepEqual(problems, ["granularity must be a non-blank string (the honest scale declaration)"]);
});

test("recordKinds must be a non-empty duplicate-free set of information kinds", () => {
  assert.deepEqual(
    validateInformationDatasetDescriptor(aDescriptor({ recordKinds: [] })),
    ["recordKinds must be a non-empty array"],
  );
  const problems = validateInformationDatasetDescriptor(
    aDescriptor({ recordKinds: ["news", "news", "blog-post"] as never }),
  );
  assert.ok(problems.some((problem) => problem.includes("'blog-post' is not an information record kind")));
  assert.ok(problems.some((problem) => problem.includes("duplicate kind 'news'")));
  assert.ok(isInformationRecordKind("news"));
  assert.ok(!isInformationRecordKind("blog-post"));
  assert.deepEqual(INFORMATION_RECORD_KINDS, [
    "research-report",
    "news",
    "event",
    "analyst-note",
  ]);
});

test("range must be finite and ordered", () => {
  const problems = validateInformationDatasetDescriptor(
    aDescriptor({ range: { from: at(5), to: at(1) } }),
  );
  assert.ok(problems.some((problem) => problem.includes("must not exceed")));
  const nan = validateInformationDatasetDescriptor(
    aDescriptor({ range: { from: Number.NaN as never } }),
  );
  assert.ok(nan.some((problem) => problem.includes("range.from must be a finite timestamp")));
});

test("gaps must be positive intervals inside the declared range", () => {
  const problems = validateInformationDatasetDescriptor(
    aDescriptor({
      knownGaps: [
        { from: at(10), to: at(10) },
        { from: at(5), to: at(6), reason: " " },
      ] as never,
    }),
  );
  assert.ok(problems.some((problem) => problem.includes("from 10 must precede to 10")));
  assert.ok(problems.some((problem) => problem.includes("reason must be a non-blank string")));
  const outside = validateInformationDatasetDescriptor(
    aDescriptor({
      range: { from: at(100), to: at(200) },
      knownGaps: [{ from: at(1), to: at(400) }],
    }),
  );
  assert.ok(outside.some((problem) => problem.includes("starts before range.from")));
  assert.ok(outside.some((problem) => problem.includes("ends after range.to")));
});

test("limitations must be non-blank strings", () => {
  const problems = validateInformationDatasetDescriptor(aDescriptor({ limitations: ["ok", ""] }));
  assert.deepEqual(problems, ["limitations: every entry must be a non-blank string"]);
});

test("determinism declaration follows A9 (nondeterministic sources are declared)", () => {
  const problems = validateInformationDatasetDescriptor(
    aDescriptor({ determinism: { kind: "sometimes" } as never }),
  );
  assert.deepEqual(problems, [
    "determinism must declare kind 'deterministic' or 'nondeterministic'",
  ]);
  const undeclared = validateInformationDatasetDescriptor(
    aDescriptor({ determinism: { kind: "nondeterministic" } as never }),
  );
  assert.deepEqual(undeclared, [
    "determinism: a nondeterministic dataset must declare its non-empty sources (A9)",
  ]);
  assert.deepEqual(
    validateInformationDatasetDescriptor(
      aDescriptor({ determinism: { kind: "nondeterministic", sources: ["wire feed"] } }),
    ),
    [],
  );
});

test("record kind guards and the decimal text law (sanity)", () => {
  const records = [aResearchReport(), aNewsItem(), anEvent()];
  assert.deepEqual(
    records.map((record) => [
      isResearchReportRecord(record),
      isNewsItemRecord(record),
      isEventRecord(record),
      isAnalystNoteRecord(record),
    ]),
    [
      [true, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
    ],
  );
  assert.ok(isCanonicalDecimalText("5200.50"));
  assert.ok(!isCanonicalDecimalText("+1"));
  assert.ok(!isCanonicalDecimalText("01.5"));
  assert.ok(!isCanonicalDecimalText("1e3"));
  assert.ok(!isCanonicalDecimalText("0.1234567890123"));
});

test("sortInformationRecords is deterministic and stable on ties", () => {
  const later = aNewsItem({ publishedAt: 2 as never, sourceId: "b" });
  const earlier = aNewsItem({ publishedAt: 1 as never, sourceId: "a" });
  const tie = aNewsItem({ publishedAt: 1 as never, sourceId: "c" });
  assert.deepEqual(
    sortInformationRecords([later, tie, earlier]).map((record) => record.sourceId),
    ["c", "a", "b"],
    "ties keep input order; time ascends",
  );
});
