/**
 * Tests for the deterministic loader (W020 `tradrl-data`).
 *
 * Laws under test (spec/WORK-ITEMS.md W020, spec/ARCHITECTURE-LOCK.md A7/A9):
 * - occurredAt/availableAt come FROM the record (bar basis = closeTime;
 *   availableAt carried verbatim or omitted entirely — never defaulted);
 * - the same input always yields the bit-identical outcome (digest law);
 * - records are sealed journal-ready (deterministic sequence/event/entry
 *   ids, recordedAt = each event's own domain time, frozen per the W016 A8
 *   discipline);
 * - payloads map verbatim (source trade ids, derived ids only when the
 *   source has none, optional quote sides omitted, bar interval + OHLCV);
 * - invalid imports throw the typed DatasetImportError with every violation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingEventDraft } from "tradrl-world-sim/journal";
import { entryIdFor, eventIdFor } from "tradrl-world-sim/journal";
import { canonicalEventString, eventStreamDigest } from "tradrl-world-contracts/time";
import {
  HISTORICAL_IMPORT_EVENT_TYPES,
  HISTORICAL_IMPORT_PRODUCER,
  HISTORICAL_IMPORT_SCHEMA_VERSION,
} from "tradrl-world-contracts/data";
import { DatasetImportError } from "../errors.js";
import { loadHistoricalDataset } from "../loader.js";
import type { HistoricalImportInput } from "../validate.js";
import {
  BTC_INSTRUMENT,
  BTC_SYMBOL,
  DATASET_ID,
  ETH_SYMBOL,
  MINUTE,
  SYMBOL_MAP,
  T0,
  WORLD,
  aDescriptor,
  aTrade,
  at,
  happyImportRecords,
} from "./fixtures.js";

function happyInput(
  overrides: Partial<HistoricalImportInput> = {},
): HistoricalImportInput {
  return {
    worldId: WORLD,
    descriptor: aDescriptor(),
    records: happyImportRecords(),
    symbolMap: SYMBOL_MAP,
    ...overrides,
  };
}

test("the happy-path import maps every record to one draft in order", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.equal(outcome.drafts.length, 9);
  assert.deepEqual(
    outcome.drafts.map((draft) => draft.eventType),
    [
      "market.quote.updated",
      "market.trade.printed",
      "market.bar.closed",
      "market.trade.printed",
      "market.quote.updated",
      "market.bar.closed",
      "market.bar.closed",
      "market.quote.updated",
      "market.trade.printed",
    ],
  );
  assert.ok(
    outcome.drafts.every((draft) =>
      (HISTORICAL_IMPORT_EVENT_TYPES as readonly string[]).includes(draft.eventType),
    ),
  );
});

test("envelope law: occurredAt/availableAt come from the record, never defaulted", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const drafts = outcome.drafts;
  // quote at T0 — no availableAt declared → the field is ABSENT (observable
  // on occurrence), never fabricated.
  assert.equal("availableAt" in drafts[0]!, false);
  assert.equal(drafts[0]!.occurredAt, T0);
  // trade at T0+500 with declared delayed availability → carried verbatim.
  assert.equal(drafts[1]!.occurredAt, T0 + 500);
  assert.equal(drafts[1]!.availableAt, T0 + 1_500);
  // bar: the event-time basis is the CLOSE time (an interval fact completes
  // when it closes), with delayed availability carried verbatim.
  assert.equal(drafts[5]!.occurredAt, T0 + 2 * MINUTE);
  assert.equal(drafts[5]!.availableAt, T0 + 2 * MINUTE + 1_000);
  // trade with availableAt == timestamp is legal and carried.
  const last = drafts[8]!;
  assert.equal(last.occurredAt, T0 + 4 * MINUTE + 10_000);
  assert.equal(last.availableAt, T0 + 4 * MINUTE + 10_000);
});

test("producer/schema/causation/correlation are the deterministic import identity", () => {
  const outcome = loadHistoricalDataset(happyInput());
  for (const draft of outcome.drafts) {
    assert.equal(draft.producer, HISTORICAL_IMPORT_PRODUCER);
    assert.equal(draft.schemaVersion, HISTORICAL_IMPORT_SCHEMA_VERSION);
    assert.equal(draft.causationId, `import:${String(DATASET_ID)}` as never);
    assert.equal(draft.correlationId, `import:${String(DATASET_ID)}` as never);
  }
});

test("payload mapping: bar interval + OHLCV + mapped instrument, verbatim fields", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.deepEqual(outcome.drafts[2]!.payload, {
    type: "market.bar.closed",
    instrumentId: BTC_INSTRUMENT,
    interval: { start: T0, end: T0 + MINUTE },
    open: "4800.10",
    high: "4800.60",
    low: "4800.00",
    close: "4800.40",
    volume: "12.5",
  });
});

test("payload mapping: trades carry source ids verbatim, derived ids only when absent", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.deepEqual(outcome.drafts[1]!.payload, {
    type: "market.trade.printed",
    tradeId: "fx-1",
    instrumentId: BTC_INSTRUMENT,
    price: "4800.25",
    quantity: "0.5",
    aggressorSide: "sell",
  });
  // record 4 (position 4): no source trade id → the deterministic derived id.
  assert.deepEqual(outcome.drafts[3]!.payload, {
    type: "market.trade.printed",
    tradeId: `${String(DATASET_ID)}:t:4`,
    instrumentId: BTC_INSTRUMENT,
    price: "4800.35",
    quantity: "0.25",
    aggressorSide: "buy",
  });
});

test("payload mapping: quote sides are optional and omitted exactly when absent", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.deepEqual(outcome.drafts[0]!.payload, {
    type: "market.quote.updated",
    instrumentId: BTC_INSTRUMENT,
    bid: "4800.25",
    bidSize: "3",
    ask: "4800.50",
    askSize: "5",
  });
  const ethQuote = outcome.drafts[4]!.payload as Record<string, unknown>;
  assert.equal(ethQuote.last, "180.15");
  assert.equal("last" in outcome.drafts[0]!.payload, false);
});

test("records are sealed journal-ready: dense sequences, deterministic ids, own recordedAt", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.equal(outcome.records.length, 9);
  outcome.records.forEach((record, index) => {
    const sequence = (index + 1) as never;
    assert.equal(record.envelope.sequence, sequence);
    assert.equal(record.envelope.eventId, eventIdFor(WORLD, sequence));
    assert.equal(record.entryId, entryIdFor(WORLD, sequence));
    assert.equal(record.envelope.worldId, WORLD);
    assert.equal(record.recordedAt, record.envelope.occurredAt, "journaled at its own domain time");
  });
});

test("records and envelopes and payloads are frozen (the W016 A8 discipline)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.ok(Object.isFrozen(outcome.records));
  const record = outcome.records[0]!;
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.envelope));
  assert.ok(Object.isFrozen(record.envelope.payload));
  const barRecord = outcome.records[2]!;
  assert.ok(Object.isFrozen((barRecord.envelope.payload as { interval: object }).interval));
  assert.throws(() => {
    (record.envelope as { sequence: number }).sequence = 99;
  }, TypeError);
});

test("determinism: same input ⇒ bit-identical outcome and digest (A9)", () => {
  const first = loadHistoricalDataset(happyInput());
  const second = loadHistoricalDataset(happyInput());
  assert.equal(first.digest.eventChecksum, second.digest.eventChecksum);
  assert.equal(first.digest.eventCount, 9);
  assert.deepEqual(first.summary, second.summary);
  for (let i = 0; i < first.records.length; i += 1) {
    assert.equal(
      canonicalEventString(first.records[i]!.envelope),
      canonicalEventString(second.records[i]!.envelope),
    );
  }
  // The digest is exactly W004's eventStreamDigest over the sealed envelopes.
  assert.deepEqual(
    first.digest,
    eventStreamDigest(first.records.map((record) => record.envelope)),
  );
});

test("determinism: structured-clone of the INPUT yields the identical outcome (plain data in)", () => {
  const input = happyInput();
  const cloned = structuredClone(input);
  const direct = loadHistoricalDataset(input);
  const fromClone = loadHistoricalDataset(cloned);
  assert.equal(direct.digest.eventChecksum, fromClone.digest.eventChecksum);
  assert.deepEqual(direct.summary, fromClone.summary);
});

test("summary counts, sorted symbols and the covered event-time span", () => {
  const outcome = loadHistoricalDataset(happyInput());
  assert.deepEqual(outcome.summary, {
    barCount: 3,
    tradeCount: 3,
    quoteCount: 3,
    symbols: [BTC_SYMBOL, ETH_SYMBOL],
    firstEventTime: T0,
    lastEventTime: T0 + 4 * MINUTE + 10_000,
  });
  assert.equal(outcome.descriptor.datasetId, DATASET_ID);
  assert.equal(outcome.worldId, WORLD);
});

test("an empty import is a legal deterministic no-op", () => {
  const outcome = loadHistoricalDataset(happyInput({ records: [] }));
  assert.deepEqual(outcome.drafts, []);
  assert.deepEqual(outcome.records, []);
  assert.deepEqual(outcome.summary, {
    barCount: 0,
    tradeCount: 0,
    quoteCount: 0,
    symbols: [],
  });
  assert.equal("firstEventTime" in outcome.summary, false);
  assert.deepEqual(outcome.digest, eventStreamDigest([]));
});

test("invalid imports throw the typed error with EVERY violation, never partially load", () => {
  assert.throws(
    () =>
      loadHistoricalDataset(
        happyInput({
          records: [
            aTrade({ symbol: "DOGE-USD", tradeId: undefined }),
            aTrade({ timestamp: at(T0 + 5_000), price: "bad" as never }),
          ],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DatasetImportError);
      assert.equal(error.kind, "unknown-symbol");
      assert.equal(error.violations.length, 2);
      assert.equal(error.violations[1]?.kind, "malformed-record");
      assert.ok(error.message.includes("2 violation"));
      return true;
    },
  );
});

test("drafts are reusable across worlds (the engine-appendable surface)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const draft: PendingEventDraft = outcome.drafts[0]!;
  assert.equal(draft.eventType, "market.quote.updated");
  assert.equal(typeof draft.occurredAt, "number");
});
