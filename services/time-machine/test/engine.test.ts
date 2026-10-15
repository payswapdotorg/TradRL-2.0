/**
 * The assembly gate laws (W050) — every seam fail-closed, W004/W027's own
 * validators re-proven with errors carried VERBATIM, the point-in-time
 * selection through the observation laws, the seal through the R016
 * knowledge firewall.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assembleView } from "../index.js";
import { viewRecordObservableAt } from "tradrl-time-machine";
import {
  ALL_FAMILIES,
  MINUTE,
  T0,
  aMarketEvent,
  aMarketStream,
  aQuery,
  anInformationStream,
  extendedStreams,
  happyStreams,
} from "./fixtures.js";

describe("assembleView — the happy path (the point-in-time selection)", () => {
  it("seals only the knowable-at-cutoff records, carrying the summaries as data", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), happyStreams());
    assert.equal(outcome.ok, true);
    if (!outcome.ok) {
      return;
    }
    const { view, summaries } = outcome.assembled;
    // 4 of 6 information records + 2 of 3 market events are knowable at T0+2m.
    assert.equal(view.records.length, 6);
    assert.equal(summaries.length, 2);
    const info = summaries.find((summary) => summary.kind === "information");
    const market = summaries.find((summary) => summary.kind === "market-events");
    assert.equal(info?.totalRecords, 6);
    assert.equal(info?.includedRecords, 4);
    assert.equal(info?.excludedPostCutoff, 2);
    assert.equal(market?.totalRecords, 3);
    assert.equal(market?.includedRecords, 2);
    assert.equal(market?.excludedPostCutoff, 1);
    assert.equal(market?.digest?.eventCount, 3);
    assert.equal(info?.importSummary?.newsCount, 2);
  });

  it("withholds the post-cutoff records — their ids never appear in the sealed view", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), happyStreams());
    if (!outcome.ok) {
      assert.fail("the happy fixture must assemble");
      return;
    }
    const ids = outcome.assembled.view.records.map((record) => String(record.recordId));
    assert.equal(ids.includes("wire-2"), false);
    assert.equal(ids.includes("evt-2"), false);
    assert.equal(ids.includes("wire-1"), true);
  });

  it("withholds a market event whose delayed availability is after the cutoff (W004's own law)", () => {
    const streams = [
      aMarketStream([aMarketEvent(T0), aMarketEvent(T0, T0 + 5 * MINUTE)]),
    ];
    const outcome = assembleView(aQuery(["market-event"], T0 + MINUTE), streams);
    if (!outcome.ok) {
      assert.fail("the delayed-availability fixture must assemble");
      return;
    }
    assert.equal(outcome.assembled.view.records.length, 1);
    assert.equal(outcome.assembled.summaries[0]?.excludedPostCutoff, 1);
  });

  it("includes the delayed records once the cutoff passes their availability (the boundary flips)", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 5 * MINUTE), extendedStreams());
    if (!outcome.ok) {
      assert.fail("the extended fixture must assemble at T0+5m");
      return;
    }
    assert.equal(outcome.assembled.view.records.length, 9);
    const ids = outcome.assembled.view.records.map((record) => String(record.recordId));
    assert.equal(ids.includes("wire-2"), true);
    assert.equal(ids.includes("evt-2"), true);
  });

  it("places the sealed records in canonical order (observation time never decreases)", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), happyStreams());
    if (!outcome.ok) {
      assert.fail("the happy fixture must assemble");
      return;
    }
    const observationTimes = outcome.assembled.view.records.map(viewRecordObservableAt);
    for (let index = 1; index < observationTimes.length; index += 1) {
      assert.ok(
        observationTimes[index]! >= observationTimes[index - 1]!,
        "the canonical order law holds",
      );
    }
  });

  it("assembles an empty view from an empty stream set (honest data, empty proof)", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0), []);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.assembled.view.records.length, 0);
      assert.deepEqual(outcome.assembled.summaries, []);
    }
  });
});

describe("assembleView — the fail-closed seams", () => {
  it("refuses a malformed W004 stream, carrying W004's violations VERBATIM", () => {
    const later = aMarketEvent(T0 + MINUTE);
    const earlier = aMarketEvent(T0);
    const outcome = assembleView(aQuery(["market-event"], T0 + 5 * MINUTE), [
      aMarketStream([later, earlier]),
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      const error = outcome.errors.find((candidate) => candidate.code === "invalid-event-stream");
      assert.ok(error, "the W004 stream law is named");
      assert.deepEqual(
        error?.eventStreamViolations?.map((violation) => violation.kind),
        ["time-not-monotonic"],
        "W004's own violations carried verbatim",
      );
    }
  });

  it("refuses a malformed W027 import, carrying W027's violations VERBATIM", () => {
    const stream = anInformationStream();
    const badRecords = [
      { ...stream.input.records[0]!, source: "mystery-source" },
      ...stream.input.records.slice(1),
    ];
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), [
      { kind: "information", input: { ...stream.input, records: badRecords } },
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      const error = outcome.errors.find(
        (candidate) => candidate.code === "invalid-information-import",
      );
      assert.ok(error, "the W027 import law is named");
      assert.equal(error?.informationViolations?.[0]?.kind, "unknown-source");
    }
  });

  it("refuses a stream recorded for another world than the query's scope", () => {
    const stream = aMarketStream([aMarketEvent(T0)]);
    const outcome = assembleView(aQuery(["market-event"], T0 + MINUTE), [
      { ...stream, worldId: "world-other" as never },
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "world-mismatch");
    }
  });

  it("refuses a stream carrying families the query does not declare (R016 scope law)", () => {
    const outcome = assembleView(aQuery(["news"], T0 + 2 * MINUTE), [anInformationStream()]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      const error = outcome.errors.find((candidate) => candidate.code === "family-not-declared");
      assert.ok(error, "the family law is named");
      assert.match(error?.message ?? "", /R016/);
    }
  });

  it("refuses a cutoff before the declared range and one at/after its end", () => {
    const before = assembleView(aQuery(ALL_FAMILIES, T0 - MINUTE), happyStreams());
    const after = assembleView(aQuery(ALL_FAMILIES, T0 + 5 * MINUTE), happyStreams());
    for (const outcome of [before, after]) {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.ok(
          outcome.errors.some((error) => error.code === "cutoff-outside-declared-range"),
          "the declared-range law is named",
        );
      }
    }
  });

  it("refuses the same opaque record id appearing in two streams", () => {
    const event = aMarketEvent(T0);
    const outcome = assembleView(aQuery(["market-event"], T0 + MINUTE), [
      aMarketStream([event]),
      aMarketStream([{ ...event, sequence: (event.sequence + 100) as typeof event.sequence }]),
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "duplicate-record-id");
    }
  });

  it("refuses an unlawful query, carrying the query re-proof errors verbatim", () => {
    const query = aQuery(ALL_FAMILIES, T0 + 2 * MINUTE);
    const tampered = { ...query, queryId: "pitq-deadbeef" as never };
    const outcome = assembleView(tampered, happyStreams());
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "invalid-query");
      assert.equal(outcome.errors[0]?.queryErrors?.[0]?.code, "query-id-mismatch");
    }
  });

  it("refuses an unknown stream kind", () => {
    const outcome = assembleView(aQuery(ALL_FAMILIES, T0 + 2 * MINUTE), [
      { kind: "not-a-stream" } as never,
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "unknown-stream-kind");
    }
  });

  it("collects every seam violation at once, not just the first", () => {
    const outcome = assembleView(aQuery(["news"], T0 - MINUTE), [
      aMarketStream([aMarketEvent(T0)]),
      anInformationStream(),
    ]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.ok(outcome.errors.length >= 3, "family + range + family violations all collected");
    }
  });
});
