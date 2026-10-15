/**
 * The A9 twin laws of the sealed view (W050) — determinism: same query +
 * same records ⇒ the same sealed view, deep-equal, same canonical ids;
 * any data change re-addresses the view.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import { sealView, validatePointInTimeView } from "../index.js";
import {
  T0,
  aMarketEvent,
  aQuery,
  aResearchRecord,
  at,
  infoViewRecord,
  marketViewRecord,
} from "./fixtures.js";
import type { TimestampMs } from "tradrl-world-contracts";

const MINUTE = 60_000;

describe("the sealed-view twin (A9)", () => {
  it("sealing the same inputs twice yields deep-equal views with the same ids", () => {
    const query = aQuery(["market-event", "research-report"], T0 + 5 * MINUTE);
    const records = [
      marketViewRecord(aMarketEvent(T0)),
      infoViewRecord(aResearchRecord(T0 + 30_000, T0 + 90_000)),
      marketViewRecord(aMarketEvent(T0 + MINUTE)),
    ];
    const first = sealView(query, records);
    const second = sealView(query, records);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.view),
        canonicalString(second.view),
        "the twin must be deep-equal through the canonical encoding",
      );
      assert.equal(first.view.viewId, second.view.viewId);
      assert.equal(first.view.proof.firewallDigest, second.view.proof.firewallDigest);
    }
  });

  it("a different cutoff seals a different view id (content addressing)", () => {
    const records = [marketViewRecord(aMarketEvent(T0))];
    const early = sealView(aQuery(["market-event"], T0), records);
    const late = sealView(aQuery(["market-event"], T0 + MINUTE), records);
    if (early.ok && late.ok) {
      assert.notEqual(early.view.viewId, late.view.viewId);
      assert.notEqual(early.view.proof.firewallDigest, late.view.proof.firewallDigest);
    } else {
      assert.fail("both cutoffs must seal the pre-cutoff record");
    }
  });

  it("mutating a record's content re-addresses the view (tamper evidence)", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const event = aMarketEvent(T0);
    const base = sealView(query, [marketViewRecord(event)]);
    const tamperedEvent = {
      ...event,
      payload: { ...(event.payload as Record<string, unknown>), bid: "9.99" as never },
    };
    const tampered = sealView(query, [marketViewRecord(tamperedEvent)]);
    if (base.ok && tampered.ok) {
      assert.notEqual(base.view.viewId, tampered.view.viewId);
    } else {
      assert.fail("both seals must succeed");
    }
  });
});

describe("the sealed-view whole-record re-validation", () => {
  it("accepts a freshly sealed view", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const outcome = sealView(query, [marketViewRecord(aMarketEvent(T0))]);
    if (!outcome.ok) {
      assert.fail("the fixture must seal");
      return;
    }
    assert.deepEqual(validatePointInTimeView(outcome.view), { ok: true });
  });

  it("refuses a tampered view id", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const outcome = sealView(query, [marketViewRecord(aMarketEvent(T0))]);
    if (!outcome.ok) {
      assert.fail("the fixture must seal");
      return;
    }
    const tampered = { ...outcome.view, viewId: "pitv-00000000" as never };
    const validation = validatePointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.errors[0]?.code, "view-id-mismatch");
    }
  });

  it("refuses a tampered proof timestamp (the firewall digest no longer re-derives)", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const outcome = sealView(query, [marketViewRecord(aMarketEvent(T0))]);
    if (!outcome.ok) {
      assert.fail("the fixture must seal");
      return;
    }
    const entries = outcome.view.proof.entries.map((entry) => ({ ...entry }));
    entries[0]!.observableAt = at(T0 + MINUTE) as TimestampMs;
    const tampered = {
      ...outcome.view,
      proof: { ...outcome.view.proof, entries },
    };
    const validation = validatePointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "firewall-digest-mismatch"),
        "the digest tamper is named",
      );
    }
  });

  it("refuses a record reordered after sealing (the canonical order law)", () => {
    const query = aQuery(["market-event"], T0 + 5 * MINUTE);
    const outcome = sealView(query, [
      marketViewRecord(aMarketEvent(T0)),
      marketViewRecord(aMarketEvent(T0 + MINUTE)),
    ]);
    if (!outcome.ok) {
      assert.fail("the fixture must seal");
      return;
    }
    const tampered = {
      ...outcome.view,
      records: [...outcome.view.records].reverse(),
    };
    const validation = validatePointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(validation.errors.some((error) => error.code === "records-not-canonical"));
    }
  });

  it("refuses a smuggled post-cutoff record through re-validation (R016 re-proven)", () => {
    const query = aQuery(["market-event"], T0);
    const sealed = sealView(query, []);
    if (!sealed.ok) {
      assert.fail("the empty view must seal");
      return;
    }
    const leak = marketViewRecord(aMarketEvent(T0 + MINUTE));
    const tampered = {
      ...sealed.view,
      records: [leak],
      proof: {
        ...sealed.view.proof,
        entries: [
          {
            recordId: String(leak.recordId),
            family: leak.family,
            occurredAt: at(T0 + MINUTE) as TimestampMs,
            observableAt: at(T0 + MINUTE) as TimestampMs,
          },
        ],
      },
    };
    const validation = validatePointInTimeView(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "post-cutoff-record"),
        "the R016 re-proof names the leak",
      );
    }
  });
});
