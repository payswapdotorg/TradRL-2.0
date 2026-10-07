/**
 * Validator tests (W027 `tradrl-information`) — every typed violation kind,
 * collected loudly in ONE pass: never just the first problem, never a
 * silently dropped record.
 *
 * Spec: spec/WORK-ITEMS.md W027 error behavior — typed dataset errors
 * (unknown source, malformed record, unavailable boundary violation).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InformationSourceDeclaration } from "tradrl-world-contracts/information-data";
import { validateInformationImport, type InformationImportInput } from "../validate.js";
import type { InformationViolation } from "../errors.js";
import {
  MINUTE,
  SOURCE_DECLARATIONS,
  SYMBOL_MAP,
  T0,
  WORLD,
  aDescriptor,
  aNewsItem,
  aResearchReport,
  anAnalystNote,
  anEvent,
  at,
  happyInformationRecords,
} from "./fixtures.js";

function anInput(overrides: Partial<InformationImportInput> = {}): InformationImportInput {
  return {
    worldId: WORLD,
    descriptor: aDescriptor(),
    records: happyInformationRecords(),
    sources: SOURCE_DECLARATIONS,
    symbolMap: SYMBOL_MAP,
    ...overrides,
  };
}

function kindsOf(violations: readonly InformationViolation[]): string[] {
  return [...new Set(violations.map((violation) => violation.kind))];
}

function expectNotOk(input: InformationImportInput): readonly InformationViolation[] {
  const result = validateInformationImport(input);
  assert.equal(result.ok, false, "the import must be rejected");
  return (result as { violations: readonly InformationViolation[] }).violations;
}

test("the happy-path import is valid", () => {
  assert.deepEqual(validateInformationImport(anInput()), { ok: true });
});

test("descriptor problems surface as invalid-descriptor violations", () => {
  const violations = expectNotOk(anInput({ descriptor: aDescriptor({ datasetId: "" as never }) }));
  assert.deepEqual(kindsOf(violations), ["invalid-descriptor"]);
});

test("a record citing an undeclared source is an unknown-source violation (credibility is declared, never fabricated)", () => {
  const violations = expectNotOk(
    anInput({ records: [aNewsItem({ source: "mystery-wire" })] }),
  );
  assert.deepEqual(kindsOf(violations), ["unknown-source"]);
  assert.match(violations[0]!.detail, /mystery-wire/);
});

test("invalid source declarations are loud (unknown credibility, duplicates)", () => {
  const badCredibility = expectNotOk(
    anInput({
      sources: [{ source: "global-wire", credibility: "gold-standard" } as never],
      records: [],
    }),
  );
  assert.ok(
    badCredibility.some(
      (violation) =>
        violation.kind === "invalid-source-declaration" && /gold-standard/.test(violation.detail),
    ),
  );
  const duplicate = expectNotOk(
    anInput({
      sources: [
        ...SOURCE_DECLARATIONS,
        { source: "global-wire", credibility: "official" } satisfies InformationSourceDeclaration,
      ],
      records: [],
    }),
  );
  assert.ok(
    duplicate.some(
      (violation) =>
        violation.kind === "invalid-source-declaration" && /duplicate declaration/.test(violation.detail),
    ),
  );
});

test("an unmapped record symbol is an unknown-symbol violation", () => {
  const violations = expectNotOk(
    anInput({ records: [aNewsItem({ symbols: ["SOL-USD"] })] }),
  );
  assert.deepEqual(kindsOf(violations), ["unknown-symbol"]);
  assert.match(violations[0]!.detail, /SOL-USD/);
});

test("malformed records are loud: blank fields, bad confidence, bad decimal, unknown kind", () => {
  const violations = expectNotOk(
    anInput({
      records: [
        aNewsItem({ headline: "  " }),
        aResearchReport({ targetPrice: "5,200.50" as never }),
        anEvent({ scheduledFor: Number.NaN as never }),
        anAnalystNote({ rating: "" }),
        { kind: "opinion" } as never,
      ],
    }),
  );
  const kinds = kindsOf(violations);
  assert.ok(kinds.includes("malformed-record"));
  assert.ok(violations.some((violation) => /headline/.test(violation.detail)));
  assert.ok(violations.some((violation) => /targetPrice/.test(violation.detail)));
  assert.ok(violations.some((violation) => /scheduledFor/.test(violation.detail)));
  assert.ok(violations.some((violation) => /rating/.test(violation.detail)));
  assert.ok(violations.some((violation) => /unknown record kind 'opinion'/.test(violation.detail)));
  const confidence = expectNotOk(
    anInput({ records: [aNewsItem({ confidence: "certain" as never })] }),
  );
  assert.ok(confidence.some((violation) => /confidence 'certain'/.test(violation.detail)));
});

test("duplicate symbols inside one record are malformed (no silent dedup)", () => {
  const violations = expectNotOk(
    anInput({ records: [aNewsItem({ symbols: ["BTC-USD", "BTC-USD"] })] }),
  );
  assert.ok(violations.some((violation) => /duplicate symbol 'BTC-USD'/.test(violation.detail)));
});

test("A7 boundary violation: availableAt before publishedAt is rejected", () => {
  const violations = expectNotOk(
    anInput({ records: [aNewsItem({ availableAt: at(T0 - 1) })] }),
  );
  assert.deepEqual(kindsOf(violations), ["available-before-published"]);
  assert.match(violations[0]!.detail, /precedes its publication time/);
});

test("availableAt exactly at publishedAt is legal (delay of zero)", () => {
  assert.deepEqual(
    validateInformationImport(anInput({ records: [aNewsItem({ availableAt: at(T0) })] })),
    { ok: true },
  );
});

test("records published outside the declared range are rejected", () => {
  const before = expectNotOk(
    anInput({
      descriptor: aDescriptor({ range: { from: at(T0 + MINUTE) } }),
    }),
  );
  assert.ok(before.some((violation) => violation.kind === "record-outside-range"));
  const after = expectNotOk(
    anInput({
      descriptor: aDescriptor({ range: { to: at(T0 + 2 * MINUTE) } }),
    }),
  );
  assert.ok(
    after.some(
      (violation) =>
        violation.kind === "record-outside-range" && /after the declared range.to/.test(violation.detail),
    ),
  );
});

test("records inside a declared gap contradict the declaration", () => {
  const violations = expectNotOk(
    anInput({
      records: [
        aNewsItem({ publishedAt: at(T0 + 2 * MINUTE), sourceId: "in-gap-1" }),
        aNewsItem({ publishedAt: at(T0 + 2 * MINUTE + 1), sourceId: "in-gap-2" }),
      ],
    }),
  );
  assert.equal(
    violations.filter((violation) => violation.kind === "record-in-declared-gap").length,
    2,
  );
  // The gap is half-open: a record published exactly at gap end is legal.
  assert.deepEqual(
    validateInformationImport(
      anInput({ records: [aNewsItem({ publishedAt: at(T0 + 3 * MINUTE) })] }),
    ),
    { ok: true },
  );
});

test("an undeclared record kind is a record-kind-undeclared violation", () => {
  const violations = expectNotOk(
    anInput({
      descriptor: aDescriptor({ recordKinds: ["news"] }),
      records: [aNewsItem(), anEvent()],
    }),
  );
  assert.deepEqual(kindsOf(violations), ["record-kind-undeclared"]);
  assert.match(violations[0]!.detail, /kind 'event' is not declared/);
});

test("out-of-order publication times are rejected loudly (never silently reordered)", () => {
  const violations = expectNotOk(
    anInput({
      records: [
        aNewsItem({ publishedAt: at(T0 + MINUTE), sourceId: "late-1" }),
        aNewsItem({ publishedAt: at(T0), sourceId: "early-1" }),
      ],
    }),
  );
  assert.deepEqual(kindsOf(violations), ["out-of-order-records"]);
  assert.match(violations[0]!.detail, /sort explicitly, then import/);
});

test("duplicate source record ids collide (duplicate-record-id)", () => {
  const violations = expectNotOk(
    anInput({
      records: [
        aNewsItem({ sourceId: "wire-x" }),
        aNewsItem({ publishedAt: at(T0 + 1_000), sourceId: "wire-x" }),
      ],
    }),
  );
  assert.deepEqual(kindsOf(violations), ["duplicate-record-id"]);
  assert.match(violations[0]!.detail, /already used by record 0/);
});

test("ALL violations are collected in one pass (never just the first)", () => {
  const violations = expectNotOk(
    anInput({
      records: [
        aNewsItem({ source: "ghost-wire", symbols: ["SOL-USD"], headline: "" }),
        aNewsItem({ publishedAt: at(T0 - 5_000), sourceId: "before-range" }),
      ],
    }),
  );
  const kinds = kindsOf(violations);
  for (const expected of ["unknown-source", "unknown-symbol", "malformed-record", "record-outside-range"]) {
    assert.ok(kinds.includes(expected), `expected ${expected} in ${kinds.join(",")}`);
  }
});

test("an empty records array with valid declarations is a legal (empty) import", () => {
  assert.deepEqual(validateInformationImport(anInput({ records: [] })), { ok: true });
});
