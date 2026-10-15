/**
 * The A9 twin laws of the ASSEMBLED view (W050) — the pure-function law:
 * the same (query, streams) always assemble the deep-equal view; the
 * sealed records are stream-order independent; a different cutoff seals a
 * different view.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import { assembleView } from "../index.js";
import { ALL_FAMILIES, MINUTE, T0, aQuery, happyStreams } from "./fixtures.js";

describe("the assembled-view twin (A9)", () => {
  it("assembling the same inputs twice yields the deep-equal assembled view", () => {
    const query = aQuery(ALL_FAMILIES, T0 + 2 * MINUTE);
    const streams = happyStreams();
    const first = assembleView(query, streams);
    const second = assembleView(query, streams);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.assembled),
        canonicalString(second.assembled),
        "the twin is deep-equal through the canonical encoding",
      );
    }
  });

  it("is identity-independent: distinct but structurally equal inputs assemble the equal view", () => {
    const query = aQuery(ALL_FAMILIES, T0 + 2 * MINUTE);
    const streams = happyStreams();
    const first = assembleView(query, streams);
    const second = assembleView(query, structuredClone(streams));
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.assembled),
        canonicalString(second.assembled),
        "object identity never leaks into the assembled view",
      );
    } else {
      assert.fail("both assemblies must succeed");
    }
  });

  it("the sealed records are stream-order independent (canonical order; summaries follow input)", () => {
    const query = aQuery(ALL_FAMILIES, T0 + 2 * MINUTE);
    const [market, information] = happyStreams();
    const forward = assembleView(query, [market, information]);
    const backward = assembleView(query, [information, market]);
    if (forward.ok && backward.ok) {
      assert.equal(
        canonicalString(forward.assembled.view),
        canonicalString(backward.assembled.view),
        "the sealed view (records + proof) is invariant under stream permutation",
      );
      assert.equal(forward.assembled.view.viewId, backward.assembled.view.viewId);
      assert.deepEqual(
        forward.assembled.summaries.map((summary) => summary.kind),
        ["market-events", "information"],
      );
      assert.deepEqual(
        backward.assembled.summaries.map((summary) => summary.kind),
        ["information", "market-events"],
      );
    } else {
      assert.fail("both permutations must assemble");
    }
  });

  it("a later cutoff seals a superset view with a different id (the machine moves only forward)", () => {
    const streams = happyStreams();
    const early = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), streams);
    const late = assembleView(aQuery(ALL_FAMILIES, T0 + 4 * MINUTE), streams);
    if (early.ok && late.ok) {
      assert.notEqual(early.assembled.view.viewId, late.assembled.view.viewId);
      const earlyIds = early.assembled.view.records.map((record) => String(record.recordId));
      const lateIds = late.assembled.view.records.map((record) => String(record.recordId));
      for (const id of earlyIds) {
        assert.equal(lateIds.includes(id), true, `record ${id} persists into the later view`);
      }
      assert.ok(lateIds.length > earlyIds.length, "the later view knows strictly more");
    } else {
      assert.fail("both cutoffs must assemble");
    }
  });
});
