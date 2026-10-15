/**
 * The whole-record re-validation laws of the ASSEMBLED view (W050) — the
 * tamper tests: every mutation of the recorded data is refused with the
 * law named (the contract's view re-proof errors carried VERBATIM; the
 * summaries' counts/worlds/families proven against the view's own data).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assembleView, validateAssembledPointInTimeView } from "../index.js";
import { ALL_FAMILIES, MINUTE, T0, aQuery, happyStreams } from "./fixtures.js";

function aHappyAssembled() {
  const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), happyStreams());
  if (!outcome.ok) {
    throw new Error(`fixture must assemble: ${String(outcome.errors[0]?.message ?? "unknown")}`);
  }
  return outcome.assembled;
}

describe("validateAssembledPointInTimeView (the whole-record re-proof)", () => {
  it("accepts a freshly assembled view", () => {
    assert.deepEqual(validateAssembledPointInTimeView(aHappyAssembled()), { ok: true });
  });

  it("refuses a tampered sealed view id, carrying the contract's errors verbatim", () => {
    const assembled = aHappyAssembled();
    const tampered = {
      ...assembled,
      view: { ...assembled.view, viewId: "pitv-00000000" as never },
    };
    const validation = validateAssembledPointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      const error = validation.errors.find((candidate) => candidate.code === "invalid-view");
      assert.equal(error?.viewErrors?.[0]?.code, "view-id-mismatch");
    }
  });

  it("refuses a tampered record payload (the view id no longer re-derives)", () => {
    const assembled = aHappyAssembled();
    const records = assembled.view.records.map((record) =>
      record.family === "market-event"
        ? { ...record, event: { ...record.event, sequence: 9999 as never } }
        : record,
    );
    const tampered = { ...assembled, view: { ...assembled.view, records } };
    const validation = validateAssembledPointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) =>
          error.viewErrors?.some((viewError) => viewError.code === "view-id-mismatch"),
        ),
        "the payload tamper is named through the view id re-derivation",
      );
    }
  });

  it("refuses a summary whose counts no longer add up AND no longer match the view", () => {
    const assembled = aHappyAssembled();
    const summaries = assembled.summaries.map((summary, index) =>
      index === 0 ? { ...summary, includedRecords: summary.includedRecords + 1 } : summary,
    );
    const tampered = { ...assembled, summaries };
    const validation = validateAssembledPointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "summary-count-mismatch"),
        "the count law is named",
      );
      assert.ok(
        validation.errors.some((error) => error.code === "summary-view-count-mismatch"),
        "the view/summary cross-check is named",
      );
    }
  });

  it("refuses a summary citing another world", () => {
    const assembled = aHappyAssembled();
    const summaries = assembled.summaries.map((summary, index) =>
      index === 0 ? { ...summary, worldId: "world-other" as never } : summary,
    );
    const validation = validateAssembledPointInTimeView({ ...assembled, summaries });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(validation.errors.some((error) => error.code === "summary-world-mismatch"));
    }
  });

  it("refuses a summary citing an undeclared record family", () => {
    const assembled = aHappyAssembled();
    const summaries = assembled.summaries.map((summary, index) =>
      index === 0 ? { ...summary, families: [...summary.families, "not-real" as never] } : summary,
    );
    const validation = validateAssembledPointInTimeView({ ...assembled, summaries });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "summary-family-not-declared"),
      );
    }
  });

  it("refuses a market summary whose W004 digest count no longer matches", () => {
    const assembled = aHappyAssembled();
    const summaries = assembled.summaries.map((summary) =>
      summary.kind === "market-events"
        ? { ...summary, digest: { ...summary.digest!, eventCount: 99 as never } }
        : summary,
    );
    const validation = validateAssembledPointInTimeView({ ...assembled, summaries });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some(
          (error) => error.code === "summary-count-mismatch" && error.streamIndex !== undefined,
        ),
      );
    }
  });

  it("refuses an information summary whose W027 import counts no longer match", () => {
    const assembled = aHappyAssembled();
    const summaries = assembled.summaries.map((summary) =>
      summary.kind === "information"
        ? {
            ...summary,
            importSummary: { ...summary.importSummary!, newsCount: 99 as never },
          }
        : summary,
    );
    const validation = validateAssembledPointInTimeView({ ...assembled, summaries });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "summary-count-mismatch"),
        "the W027 summary coherence law is named",
      );
    }
  });

  it("refuses structurally malformed assembled data without throwing", () => {
    assert.equal(validateAssembledPointInTimeView(null as never).ok, false);
    assert.equal(
      validateAssembledPointInTimeView({ view: null } as never).ok,
      false,
    );
  });
});
