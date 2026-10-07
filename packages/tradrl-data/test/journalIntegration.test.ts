/**
 * Journal/snapshot integration tests (W020 `tradrl-data`) — the proof that
 * a dataset import is JOURNAL-READY against the real W013/W016 surfaces:
 *
 * - the sealed records restore into a real journal through
 *   `createEventJournalFromRecords` (the W016 restore path) with the exact
 *   import digest;
 * - the engine-appendable drafts, appended through a REAL journal, seal to
 *   envelopes bit-identical to the sealed records (draft path ≡ records
 *   path) and the journal's own stream laws keep applying to imported data
 *   (a later out-of-time append is rejected);
 * - the records are PLAIN DATA (structured-clone survives; the W018
 *   transport discipline) and snapshot-compatible: a real content-addressed
 *   WorldSnapshot carries them as its journal prefix and restores;
 * - the A7 information firewall (W004 time contracts) governs the imported
 *   envelopes exactly: delayed availability is observable only from
 *   `availableAt`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JournalLawViolationError,
  createEventJournal,
  createEventJournalFromRecords,
} from "tradrl-world-sim/journal";
import { buildWorldSnapshot, verifyWorldSnapshot } from "tradrl-world-sim/snapshot";
import { assertValidWorldDefinition, initialWorldState } from "tradrl-world-sim/world";
import {
  asSimulationTime,
  eventObservationTime,
  isEventObservableAt,
  validateEventStream,
} from "tradrl-world-contracts/time";
import { loadHistoricalDataset } from "../loader.js";
import type { HistoricalImportInput } from "../validate.js";
import {
  MINUTE,
  SYMBOL_MAP,
  T0,
  WORLD,
  aDescriptor,
  aTrade,
  at,
  happyImportRecords,
  snapshotIdOf,
  snapshotTestDefinition,
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

test("the sealed records restore into a REAL journal (the W016 restore path)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  assert.equal(journal.size(), 9);
  assert.equal(journal.getCursor(), 9);
  assert.deepEqual(journal.digest(), outcome.digest);
  assert.deepEqual(journal.records(), outcome.records);
});

test("appending the DRAFTS through a real journal reproduces the sealed envelopes exactly", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const journal = createEventJournal(WORLD);
  const sealed = journal.append([...outcome.drafts]);
  assert.equal(sealed.length, outcome.records.length);
  for (let i = 0; i < sealed.length; i += 1) {
    assert.deepEqual(sealed[i], outcome.records[i]!.envelope);
  }
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("the W004 ordered-stream laws hold over the imported envelopes", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const envelopes = outcome.records.map((record) => record.envelope);
  assert.deepEqual(validateEventStream(envelopes), { ok: true });
});

test("journal queries filter imported events (EventQuery semantics)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  const bars = journal.read({ types: ["market.bar.closed"] });
  assert.equal(bars.length, 3);
  assert.ok(bars.every((envelope) => envelope.eventType === "market.bar.closed"));
  const lateWindow = journal.read({ from: at(T0 + 4 * MINUTE) });
  assert.equal(lateWindow.length, 3);
});

test("the journal's own laws keep governing imported data (later out-of-time append rejected)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  const laterImport = loadHistoricalDataset(
    happyInput({
      descriptor: aDescriptor({
        datasetId: "ds-fixture-later" as never,
        range: { from: at(T0 + 5 * MINUTE), to: at(T0 + 10 * MINUTE) },
        knownGaps: [],
      }),
      records: [aTrade({ timestamp: at(T0 + 5 * MINUTE + 1_000), tradeId: "later-1" })],
    }),
  );
  const sealed = journal.append([...laterImport.drafts]);
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0]!.sequence, 10);

  const outOfTime = loadHistoricalDataset(
    happyInput({
      descriptor: aDescriptor({
        datasetId: "ds-fixture-early" as never,
        range: { from: at(T0 + 4 * MINUTE), to: at(T0 + 5 * MINUTE) },
        knownGaps: [],
      }),
      records: [aTrade({ timestamp: at(T0 + 4 * MINUTE + 5_000), tradeId: "early-1" })],
    }),
  );
  assert.throws(
    () => journal.append([...outOfTime.drafts]),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "time-not-monotonic");
      return true;
    },
  );
});

test("records are plain data: structuredClone survives the import (W018 transport discipline)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const cloned = structuredClone(outcome.records);
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: cloned });
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("a REAL content-addressed snapshot carries the import as its journal prefix (W016)", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const definition = snapshotTestDefinition(WORLD);
  assertValidWorldDefinition(definition);
  const state = initialWorldState(definition);
  const snapshot = buildWorldSnapshot({
    definition,
    state,
    records: outcome.records,
    snapshotId: snapshotIdOf(1),
    createdAt: outcome.records[outcome.records.length - 1]!.envelope.occurredAt,
  });
  assert.deepEqual(verifyWorldSnapshot(snapshot), { ok: true });
  assert.equal(snapshot.records.length, outcome.records.length);
  assert.equal(snapshot.records[0], outcome.records[0], "prefix shares the frozen records");
  assert.equal(snapshot.descriptor.journalCursor, 9);
  // The snapshot prefix restores into a journal with the exact import digest.
  const journal = createEventJournalFromRecords({
    worldId: WORLD,
    records: snapshot.records,
  });
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("A7 firewall: delayed imported events are observable exactly from availableAt", () => {
  const outcome = loadHistoricalDataset(happyInput());
  const delayed = outcome.records[1]!; // trade at T0+500, availableAt T0+1500
  const envelope = delayed.envelope;
  assert.equal(eventObservationTime(envelope), T0 + 1_500);
  assert.equal(isEventObservableAt(envelope, asSimulationTime(T0 + 1_499)), false);
  assert.equal(isEventObservableAt(envelope, asSimulationTime(T0 + 1_500)), true);
  // The un-delayed quote at T0 is observable on occurrence.
  const immediate = outcome.records[0]!.envelope;
  assert.equal(eventObservationTime(immediate), T0);
  assert.equal(isEventObservableAt(immediate, asSimulationTime(T0)), true);
  assert.equal(isEventObservableAt(immediate, asSimulationTime(T0 - 1)), false);
});
