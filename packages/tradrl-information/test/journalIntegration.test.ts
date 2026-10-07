/**
 * Journal + world-engine integration tests (W027 `tradrl-information`) —
 * the proof that an information import is WORLD-ready against the real
 * W013/W016/W004 surfaces:
 *
 * - the sealed records restore into a real journal through
 *   `createEventJournalFromRecords` (the W016 restore path) with the exact
 *   import digest; the engine-appendable drafts, appended through a REAL
 *   journal, seal to envelopes bit-identical to the sealed records; the
 *   journal's own stream laws keep governing imported information (a later
 *   out-of-time append is rejected);
 * - the records are PLAIN DATA (structuredClone survives; the W018
 *   transport discipline) and a real content-addressed WorldSnapshot
 *   carries them as its journal prefix (W016);
 * - the DEFINITION channel: imported artifacts placed on a real world
 *   definition's `informationArtifacts` surface pass the W013 definition
 *   laws and a REAL headless engine projects them through `QueryPort.getNews`
 *   behind the A7 firewall — delayed artifacts appear exactly when the
 *   simulation clock reaches their `availableAt`;
 * - the A7 firewall (W004 time contracts) governs the imported journal
 *   envelopes exactly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JournalLawViolationError,
  createEventJournal,
  createEventJournalFromRecords,
} from "tradrl-world-sim/journal";
import { buildWorldSnapshot, verifyWorldSnapshot } from "tradrl-world-sim/snapshot";
import {
  assertValidWorldDefinition,
  createHeadlessWorldEngine,
  initialWorldState,
} from "tradrl-world-sim/world";
import {
  asSimulationTime,
  eventObservationTime,
  isEventObservableAt,
  validateEventStream,
} from "tradrl-world-contracts/time";
import { loadInformationDataset } from "../loader.js";
import { toDefinitionInformationArtifacts } from "../adapters.js";
import type { InformationImportInput } from "../validate.js";
import {
  BTC_INSTRUMENT,
  ETH_INSTRUMENT,
  MINUTE,
  SOURCE_DECLARATIONS,
  SYMBOL_MAP,
  T0,
  WORLD,
  aDescriptor,
  aNewsItem,
  anEvent,
  at,
  fixedWallTimeSource,
  happyInformationRecords,
  informationWorldDefinition,
  snapshotIdOf,
} from "./fixtures.js";

function happyInput(
  overrides: Partial<InformationImportInput> = {},
): InformationImportInput {
  return {
    worldId: WORLD,
    descriptor: aDescriptor(),
    records: happyInformationRecords(),
    sources: SOURCE_DECLARATIONS,
    symbolMap: SYMBOL_MAP,
    ...overrides,
  };
}

test("the sealed records restore into a REAL journal (the W016 restore path)", () => {
  const outcome = loadInformationDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  assert.equal(journal.size(), 6);
  assert.equal(journal.getCursor(), 6);
  assert.deepEqual(journal.digest(), outcome.digest);
  assert.deepEqual(journal.records(), outcome.records);
});

test("appending the DRAFTS through a real journal reproduces the sealed envelopes exactly", () => {
  const outcome = loadInformationDataset(happyInput());
  const journal = createEventJournal(WORLD);
  const sealed = journal.append([...outcome.drafts]);
  assert.equal(sealed.length, outcome.records.length);
  for (let i = 0; i < sealed.length; i += 1) {
    assert.deepEqual(sealed[i], outcome.records[i]!.envelope);
  }
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("the W004 ordered-stream laws hold over the imported envelopes", () => {
  const outcome = loadInformationDataset(happyInput());
  const envelopes = outcome.records.map((record) => record.envelope);
  assert.deepEqual(validateEventStream(envelopes), { ok: true });
});

test("journal queries filter imported information events (EventQuery semantics)", () => {
  const outcome = loadInformationDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  const news = journal.read({ types: ["information.news.published"] });
  assert.equal(news.length, 2);
  assert.ok(news.every((envelope) => envelope.eventType === "information.news.published"));
  const research = journal.read({ types: ["information.research.published"] });
  assert.equal(research.length, 1);
  const lateWindow = journal.read({ from: at(T0 + 3 * MINUTE) });
  assert.equal(lateWindow.length, 2);
});

test("the journal's own laws keep governing imported data (later out-of-time append rejected)", () => {
  const outcome = loadInformationDataset(happyInput());
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: outcome.records });
  const laterImport = loadInformationDataset(
    happyInput({
      descriptor: aDescriptor({
        datasetId: "info-fixture-later" as never,
        range: { from: at(T0 + 5 * MINUTE), to: at(T0 + 10 * MINUTE) },
        knownGaps: [],
      }),
      records: [aNewsItem({ publishedAt: at(T0 + 5 * MINUTE + 1_000), sourceId: "later-1" })],
    }),
  );
  const sealed = journal.append([...laterImport.drafts]);
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0]!.sequence, 7);

  const outOfTime = loadInformationDataset(
    happyInput({
      descriptor: aDescriptor({
        datasetId: "info-fixture-early" as never,
        range: { from: at(T0 + 4 * MINUTE), to: at(T0 + 5 * MINUTE) },
        knownGaps: [],
      }),
      records: [anEvent({ publishedAt: at(T0 + 4 * MINUTE + 5_000), sourceId: "early-1" })],
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
  const outcome = loadInformationDataset(happyInput());
  const cloned = structuredClone(outcome.records);
  const journal = createEventJournalFromRecords({ worldId: WORLD, records: cloned });
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("a REAL content-addressed snapshot carries the import as its journal prefix (W016)", () => {
  const outcome = loadInformationDataset(happyInput());
  const definition = informationWorldDefinition(WORLD);
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
  assert.equal(snapshot.descriptor.journalCursor, 6);
  const journal = createEventJournalFromRecords({
    worldId: WORLD,
    records: snapshot.records,
  });
  assert.deepEqual(journal.digest(), outcome.digest);
});

test("A7 firewall: delayed imported events are observable exactly from availableAt", () => {
  const outcome = loadInformationDataset(happyInput());
  const delayed = outcome.records[1]!; // research at T0+30s, availableAt T0+90s
  const envelope = delayed.envelope;
  assert.equal(eventObservationTime(envelope), T0 + 90_000);
  assert.equal(isEventObservableAt(envelope, asSimulationTime(T0 + 89_999)), false);
  assert.equal(isEventObservableAt(envelope, asSimulationTime(T0 + 90_000)), true);
  // The un-delayed wire news at T0 is observable on occurrence.
  const immediate = outcome.records[0]!.envelope;
  assert.equal(eventObservationTime(immediate), T0);
  assert.equal(isEventObservableAt(immediate, asSimulationTime(T0)), true);
  assert.equal(isEventObservableAt(immediate, asSimulationTime(T0 - 1)), false);
});

test("the DEFINITION channel: a real world definition carries the imported artifacts (W013 laws)", () => {
  const outcome = loadInformationDataset(happyInput());
  const definition = {
    ...informationWorldDefinition(WORLD),
    informationArtifacts: toDefinitionInformationArtifacts(outcome.artifacts),
  };
  assertValidWorldDefinition(definition);
  assert.equal(definition.informationArtifacts?.length, 6);
});

test("a REAL headless engine projects the imported artifacts through getNews behind the A7 firewall", async () => {
  const outcome = loadInformationDataset(happyInput());
  const definition = {
    ...informationWorldDefinition(WORLD),
    informationArtifacts: toDefinitionInformationArtifacts(outcome.artifacts),
  };
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
  });
  const visibleIds = async () =>
    (await engine.query.getNews()).map((item) => String(item.artifactId));

  // At the clock origin only the undelayed T0 wire news is observable.
  assert.deepEqual(await visibleIds(), ["wire-1"]);
  // Advancing to the earnings publication time releases the exchange event
  // (availableAt = its publication time — the publication-time law).
  await engine.clock.seek(asSimulationTime(T0 + MINUTE));
  assert.deepEqual(await visibleIds(), ["wire-1", "evt-1"]);
  // The delayed research report + the analyst note land exactly at T0+90s
  // (definition order is preserved — the W003 projection law).
  await engine.clock.seek(asSimulationTime(T0 + 90_000));
  assert.deepEqual(await visibleIds(), ["wire-1", "info-fixture-1:a:2", "evt-1", "note-1"]);
  // At T0+5m every artifact — including the delayed macro event — is visible.
  await engine.clock.seek(asSimulationTime(T0 + 5 * MINUTE));
  assert.deepEqual(await visibleIds(), [
    "wire-1",
    "info-fixture-1:a:2",
    "evt-1",
    "note-1",
    "wire-2",
    "evt-2",
  ]);
  // The instrument filter composes with the firewall (NewsQuery semantics).
  const btcNews = await engine.query.getNews({ instrumentId: BTC_INSTRUMENT });
  assert.equal(btcNews.length, 5, "BTC-linked or instrument-agnostic artifacts");
  const ethNews = await engine.query.getNews({ instrumentId: ETH_INSTRUMENT });
  assert.equal(ethNews.length, 4);
  const lateWindow = await engine.query.getNews({ from: at(T0 + 3 * MINUTE) });
  assert.equal(lateWindow.length, 2);
  // The payload riding the definition channel is the SAME typed payload the
  // import built (identity seam intact — W028 can cite either channel).
  const research = (await engine.query.getNews()).find(
    (item) => String(item.artifactId) === "info-fixture-1:a:2",
  );
  assert.equal(research!.payload, outcome.artifacts[1]!.payload);
  assert.equal(research!.payload.identity, outcome.artifacts[1]!.payload.identity);
});
