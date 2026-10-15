/**
 * The knowledge firewall gate laws (W050) — R016 enforced structurally:
 * every record proven ≤ cutoff through its own timestamps; any post-cutoff
 * record is a LOUD typed refusal naming R016.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_FIREWALL_LAW,
  POINT_IN_TIME_VIEW_ID_PREFIX,
  compareViewRecords,
  firewallDigestOf,
  pointInViewIdOf,
  sealView,
  viewRecordOccurredAt,
  viewRecordObservableAt,
} from "../index.js";
import {
  T0,
  aMarketEvent,
  aQuery,
  aResearchRecord,
  at,
  cutoff,
  infoViewRecord,
  marketViewRecord,
} from "./fixtures.js";
import type { TimestampMs } from "tradrl-world-contracts";

const MINUTE = 60_000;

describe("the observation-time laws (W004/W027 through their own types)", () => {
  it("an undelayed market event is observable exactly from its occurredAt", () => {
    const event = aMarketEvent(T0);
    assert.equal(viewRecordObservableAt(marketViewRecord(event)), T0);
  });

  it("a delayed market event is observable exactly from its availableAt (W004's eventObservationTime)", () => {
    const event = aMarketEvent(T0, T0 + MINUTE);
    assert.equal(viewRecordObservableAt(marketViewRecord(event)), T0 + MINUTE);
    assert.equal(viewRecordOccurredAt(marketViewRecord(event)), T0);
  });

  it("an undelayed information record is observable exactly from its publishedAt (the W027 publication-time mapping law)", () => {
    const record = aResearchRecord(T0 + 30_000);
    assert.equal(viewRecordObservableAt(infoViewRecord(record)), T0 + 30_000);
  });

  it("a delayed information record is observable exactly from its declared availableAt", () => {
    const record = aResearchRecord(T0 + 30_000, T0 + 90_000);
    assert.equal(viewRecordObservableAt(infoViewRecord(record)), T0 + 90_000);
  });
});

describe("sealView (THE GATE)", () => {
  it("seals a lawful view carrying its proof and digest", () => {
    const query = aQuery(["market-event", "research-report"], T0 + 5 * MINUTE);
    const records = [
      marketViewRecord(aMarketEvent(T0)),
      infoViewRecord(aResearchRecord(T0 + 30_000, T0 + 90_000)),
    ];
    const outcome = sealView(query, records);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      const { view } = outcome;
      assert.ok(view.viewId.startsWith(POINT_IN_TIME_VIEW_ID_PREFIX));
      assert.equal(view.proof.law, KNOWLEDGE_FIREWALL_LAW);
      assert.equal(view.proof.cutoff, query.cutoff);
      assert.equal(view.proof.entries.length, 2);
      assert.deepEqual(
        view.proof.entries.map((entry) => entry.recordId),
        view.records.map((record) => String(record.recordId)),
      );
      assert.match(view.proof.firewallDigest, /^[0-9a-f]{8}$/);
    }
  });

  it("REFUSES a post-cutoff record loudly, naming R016", () => {
    const query = aQuery(["market-event"], T0);
    const leak = marketViewRecord(aMarketEvent(T0 + MINUTE));
    const outcome = sealView(query, [leak]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.refusal.law, "R016");
      assert.equal(outcome.refusal.code, "post-cutoff-record");
      assert.match(outcome.refusal.message, /R016/);
      assert.match(outcome.refusal.message, new RegExp(String(leak.recordId).replace(/[-\\]/g, "\\$&")));
    }
  });

  it("refuses a delayed record whose availability is after the cutoff, even when published before it", () => {
    const query = aQuery(["research-report"], T0 + MINUTE);
    const delayed = infoViewRecord(aResearchRecord(T0, T0 + 5 * MINUTE));
    const outcome = sealView(query, [delayed]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.refusal.code, "post-cutoff-record");
    }
  });

  it("seals a record exactly AT its observation threshold (the boundary is inclusive)", () => {
    const query = aQuery(["market-event"], T0 + MINUTE);
    const boundary = marketViewRecord(aMarketEvent(T0, T0 + MINUTE));
    const outcome = sealView(query, [boundary]);
    assert.equal(outcome.ok, true);
  });

  it("refuses a record of a family the query does not declare (the R016 scope law)", () => {
    const query = aQuery(["news"], T0 + 5 * MINUTE);
    const foreign = marketViewRecord(aMarketEvent(T0));
    const outcome = sealView(query, [foreign]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.refusal.code, "family-not-declared");
      assert.match(outcome.refusal.message, /R016/);
    }
  });

  it("refuses duplicate record ids in one view", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const event = marketViewRecord(aMarketEvent(T0));
    const outcome = sealView(query, [event, event]);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.refusal.code, "duplicate-record-id");
    }
  });

  it("refuses a query that fails whole-record re-proof, carrying the errors verbatim", () => {
    const query = aQuery(["news"], T0 + 5 * MINUTE);
    const tampered = { ...query, queryId: "pitq-deadbeef" as never };
    const outcome = sealView(tampered, []);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.refusal.code, "invalid-query");
      assert.equal(outcome.refusal.queryErrors?.[0]?.code, "query-id-mismatch");
    }
  });

  it("seals an empty view (nothing recorded ≤ cutoff is honest data, with an empty proof)", () => {
    const query = aQuery(["news"], T0);
    const outcome = sealView(query, []);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.view.records.length, 0);
      assert.deepEqual(outcome.view.proof.entries, []);
    }
  });

  it("places records in canonical order — input order never leaks into the sealed view", () => {
    const query = aQuery(["market-event", "research-report"], T0 + 5 * MINUTE);
    const early = marketViewRecord(aMarketEvent(T0));
    const middle = infoViewRecord(aResearchRecord(T0 + 30_000));
    const late = marketViewRecord(aMarketEvent(T0 + MINUTE));
    const forward = sealView(query, [early, middle, late]);
    const backward = sealView(query, [late, middle, early]);
    assert.equal(forward.ok, true);
    assert.equal(backward.ok, true);
    if (forward.ok && backward.ok) {
      assert.deepEqual(forward.view.records, backward.view.records);
      assert.equal(forward.view.viewId, backward.view.viewId);
      assert.deepEqual(
        forward.view.records.map((record) => viewRecordObservableAt(record)),
        [T0, T0 + 30_000, T0 + MINUTE],
      );
    }
  });

  it("orders same-threshold records by record id (the total-order tiebreak)", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const first = { ...marketViewRecord(aMarketEvent(T0)), recordId: "evt-a" as never };
    const second = { ...marketViewRecord(aMarketEvent(T0)), recordId: "evt-b" as never };
    assert.equal(compareViewRecords(second, first) > 0, true);
    const outcome = sealView(query, [second, first]);
    if (outcome.ok) {
      assert.deepEqual(
        outcome.view.records.map((record) => String(record.recordId)),
        ["evt-a", "evt-b"],
      );
    } else {
      assert.fail("same-threshold records must be sealable");
    }
  });
});

describe("the digest derivations", () => {
  it("re-derives the firewall digest and the view id from the sealed view's own data", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const outcome = sealView(query, [
      marketViewRecord(aMarketEvent(T0)),
      marketViewRecord(aMarketEvent(T0 + MINUTE, T0 + 2 * MINUTE)),
    ]);
    if (!outcome.ok) {
      assert.fail("the fixture must seal");
      return;
    }
    const { view } = outcome;
    assert.equal(firewallDigestOf(view.proof.cutoff, view.proof.entries), view.proof.firewallDigest);
    assert.equal(pointInViewIdOf(view.query, view.records, view.proof), view.viewId);
  });

  it("yields a different firewall digest for a different cutoff (the proof is cutoff-addressed)", () => {
    const entries = [
      {
        recordId: "evt-1",
        family: "market-event" as const,
        occurredAt: at(T0) as TimestampMs,
        observableAt: at(T0) as TimestampMs,
      },
    ];
    assert.notEqual(firewallDigestOf(cutoff(T0), entries), firewallDigestOf(cutoff(T0 + 1), entries));
  });
});
