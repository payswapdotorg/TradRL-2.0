/**
 * Loader tests (W027 `tradrl-information`) — the deterministic import laws:
 * artifact construction (publication-time availability law, A7), payload
 * mapping per kind, the W028 identity seam (one shared payload across both
 * channels), sealed journal-ready records, determinism (A9) and the honest
 * summary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InformationArtifact, NewsPayload } from "tradrl-world-contracts";
import {
  INFORMATION_IMPORT_PRODUCER,
  INFORMATION_IMPORT_SCHEMA_VERSION,
  type ImportedEventArtifact,
  type ImportedInformationArtifact,
  type ImportedNewsArtifact,
  type ImportedResearchArtifact,
} from "tradrl-world-contracts/information-data";
import { isInformationAvailable } from "tradrl-world-contracts";
import { eventIdFor } from "tradrl-world-sim/journal";
import { stableDigest } from "tradrl-world-sim/world";
import { loadInformationDataset } from "../loader.js";
import { toDefinitionInformationArtifacts } from "../adapters.js";
import { InformationImportError } from "../errors.js";
import { validateInformationImport, type InformationImportInput } from "../validate.js";
import {
  BTC_INSTRUMENT,
  BTC_SYMBOL,
  DATASET_ID,
  ETH_INSTRUMENT,
  ETH_SYMBOL,
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

test("the happy-path import maps every record to one artifact + draft + record in order", () => {
  const outcome = loadInformationDataset(anInput());
  assert.equal(outcome.worldId, WORLD);
  assert.equal(outcome.artifacts.length, 6);
  assert.equal(outcome.drafts.length, 6);
  assert.equal(outcome.records.length, 6);
  assert.deepEqual(
    outcome.records.map((record) => record.envelope.sequence),
    [1, 2, 3, 4, 5, 6],
  );
});

test("artifact envelope law: createdAt = publishedAt, availableAt by the publication-time law (A7)", () => {
  const outcome = loadInformationDataset(anInput());
  const [wireNews, research, exchangeEvent, note, blogNews, macroEvent] =
    outcome.artifacts as [
      ImportedInformationArtifact,
      ImportedInformationArtifact,
      ImportedInformationArtifact,
      ImportedInformationArtifact,
      ImportedInformationArtifact,
      ImportedInformationArtifact,
    ];
  // Undelayed publication: availableAt === publishedAt (never invented).
  assert.equal(wireNews.createdAt, T0);
  assert.equal(wireNews.availableAt, T0);
  // Declared delay: carried verbatim.
  assert.equal(research.availableAt, T0 + 90_000);
  assert.equal(research.createdAt, T0 + 30_000);
  // availableAt declared EXACTLY at publication is carried verbatim.
  assert.equal(blogNews.availableAt, T0 + 3 * MINUTE);
  assert.equal(exchangeEvent.availableAt, T0 + MINUTE);
  assert.equal(note.availableAt, T0 + 90_000);
  assert.equal(macroEvent.availableAt, T0 + 5 * MINUTE);
  for (const artifact of outcome.artifacts) {
    assert.equal(artifact.worldId, WORLD);
    assert.equal(artifact.version, INFORMATION_IMPORT_SCHEMA_VERSION);
    assert.equal(artifact.scope, artifact.payload.type === "information.news.published" ? "news" : artifact.payload.type === "information.research.published" ? "research-report" : artifact.payload.type === "information.event.published" ? "event" : "analyst-note");
    assert.equal(artifact.provenance.producer, INFORMATION_IMPORT_PRODUCER);
    assert.equal(artifact.provenance.recordedAt, artifact.availableAt);
  }
});

test("the W003 firewall predicate governs the imported artifacts unchanged", () => {
  const outcome = loadInformationDataset(anInput());
  const research = outcome.artifacts[1] as ImportedResearchArtifact;
  assert.equal(isInformationAvailable(research, at(T0 + 89_999)), false);
  assert.equal(isInformationAvailable(research, at(T0 + 90_000)), true);
  const immediate = outcome.artifacts[0] as ImportedNewsArtifact;
  assert.equal(isInformationAvailable(immediate, at(T0)), true);
  assert.equal(isInformationAvailable(immediate, at(T0 - 1)), false);
});

test("envelope law: occurredAt = publishedAt verbatim; availableAt carried or omitted, never defaulted", () => {
  const outcome = loadInformationDataset(anInput());
  const [wireNews, research] = outcome.records;
  assert.equal(wireNews!.envelope.occurredAt, T0);
  assert.equal(wireNews!.envelope.availableAt, undefined, "undelayed events omit availableAt");
  assert.equal(research!.envelope.occurredAt, T0 + 30_000);
  assert.equal(research!.envelope.availableAt, T0 + 90_000, "declared delay is verbatim");
  assert.equal(wireNews!.envelope.producer, INFORMATION_IMPORT_PRODUCER);
  assert.equal(wireNews!.envelope.schemaVersion, INFORMATION_IMPORT_SCHEMA_VERSION);
  assert.equal(String(wireNews!.envelope.causationId), `import:${String(DATASET_ID)}`);
  assert.equal(String(wireNews!.envelope.correlationId), `import:${String(DATASET_ID)}`);
});

test("payload mapping per kind: headline/summary/instruments/rating/target/schedule/credibility/confidence", () => {
  const outcome = loadInformationDataset(anInput());
  const [wireNews, research, exchangeEvent, note, blogNews, macroEvent] = outcome.artifacts as [
    ImportedNewsArtifact,
    ImportedResearchArtifact,
    ImportedEventArtifact,
    ImportedInformationArtifact,
    ImportedNewsArtifact,
    ImportedEventArtifact,
  ];
  assert.deepEqual(wireNews!.payload, {
    type: "information.news.published",
    identity: wireNews!.payload.identity,
    source: "global-wire",
    credibility: "primary-media",
    headline: "Spot venue reports record session volume",
    summary: "Tuesday session printed the highest volume since launch.",
    instruments: [BTC_INSTRUMENT],
    confidence: "high",
  });
  assert.deepEqual(research!.payload, {
    type: "information.research.published",
    identity: research!.payload.identity,
    source: "acme-research",
    credibility: "analyst",
    headline: "Structural bid for digital gold",
    summary: "Flow analysis argues for sustained institutional accumulation.",
    instruments: [BTC_INSTRUMENT, ETH_INSTRUMENT],
    rating: "overweight",
    targetPrice: "5200.50",
    confidence: "medium",
  });
  assert.deepEqual(exchangeEvent!.payload, {
    type: "information.event.published",
    identity: exchangeEvent!.payload.identity,
    source: "exchange-notices",
    credibility: "official",
    headline: "Quarterly earnings release scheduled",
    summary: "The issuer will report earnings this session.",
    instruments: [ETH_INSTRUMENT],
    eventType: "earnings-release",
    scheduledFor: T0 + 5 * MINUTE,
  });
  assert.deepEqual(note!.payload, {
    type: "information.analyst-note.published",
    identity: note!.payload.identity,
    source: "acme-research",
    credibility: "analyst",
    headline: "Desk trims near-term view",
    rating: "hold",
  }, "absent symbols/confidence are omitted exactly when absent");
  assert.equal(blogNews!.payload.instruments, undefined);
  assert.equal(macroEvent!.payload.scheduledFor, T0 + 4 * MINUTE, "past schedule is carried verbatim");
});

test("the W028 provenance seam: stable typed identity on every artifact, unique, digest-stable", () => {
  const outcome = loadInformationDataset(anInput());
  const identities = outcome.artifacts.map((artifact) => artifact.payload.identity);
  // Source-stable ids are carried verbatim; absent ids derive deterministically.
  assert.equal(
    identities[0]!.artifactId,
    "wire-1" as never,
    "source-stable id is the artifact id",
  );
  assert.equal(
    identities[1]!.artifactId,
    `${String(DATASET_ID)}:a:2` as never,
    "derived id is dataset + position",
  );
  assert.equal(new Set(identities.map((identity) => identity.artifactId)).size, 6);
  for (const identity of identities) {
    assert.equal(identity.datasetId, DATASET_ID);
    assert.match(identity.recordDigest, /^[0-9a-f]{8}$/);
  }
  // The digest pins the record content: same record ⇒ same digest (A9).
  assert.equal(identities[1]!.recordDigest, stableDigest(happyInformationRecords()[1]));
  // A re-import resolves the identical identities.
  const again = loadInformationDataset(anInput());
  assert.deepEqual(again.artifacts.map((artifact) => artifact.payload.identity), identities);
});

test("one payload, two channels: artifact.payload === draft payload (=== the sealed envelope's)", () => {
  const outcome = loadInformationDataset(anInput());
  for (let i = 0; i < outcome.artifacts.length; i += 1) {
    assert.equal(outcome.drafts[i]!.payload, outcome.artifacts[i]!.payload);
    assert.equal(outcome.records[i]!.envelope.payload, outcome.artifacts[i]!.payload);
  }
});

test("records are sealed journal-ready: dense sequences, deterministic ids, own recordedAt", () => {
  const outcome = loadInformationDataset(anInput());
  outcome.records.forEach((record, index) => {
    assert.equal(record.envelope.eventId, eventIdFor(WORLD, (index + 1) as never));
    assert.equal(record.entryId, `jrn:${String(WORLD)}:${String(index + 1)}` as never);
    assert.equal(record.recordedAt, record.envelope.occurredAt, "domain time, never wall time");
    assert.ok(Object.isFrozen(record));
    assert.ok(Object.isFrozen(record.envelope));
  });
  assert.ok(Object.isFrozen(outcome.records));
  assert.ok(Object.isFrozen(outcome.artifacts));
  for (const artifact of outcome.artifacts) {
    assert.ok(Object.isFrozen(artifact));
    assert.ok(Object.isFrozen(artifact.payload));
  }
});

test("determinism: same input ⇒ bit-identical outcome and digest (A9)", () => {
  const first = loadInformationDataset(anInput());
  const second = loadInformationDataset(anInput());
  assert.deepEqual(first, second);
  assert.equal(first.digest.eventChecksum, second.digest.eventChecksum);
  assert.equal(first.digest.eventCount, 6);
  assert.equal(first.digest.lastSequence, 6);
  assert.equal(first.digest.finalEventTime, T0 + 4 * MINUTE + 30_000);
});

test("determinism: structured-clone of the INPUT yields the identical outcome (plain data in)", () => {
  const input = anInput();
  const fromClone = loadInformationDataset(structuredClone(input));
  assert.deepEqual(fromClone, loadInformationDataset(input));
});

test("an empty import is a legal deterministic no-op", () => {
  const outcome = loadInformationDataset(anInput({ records: [] }));
  assert.deepEqual(outcome.artifacts, []);
  assert.deepEqual(outcome.records, []);
  assert.equal(outcome.digest.eventCount, 0);
  assert.deepEqual(outcome.summary, {
    researchReportCount: 0,
    newsCount: 0,
    eventCount: 0,
    analystNoteCount: 0,
    delayedCount: 0,
    sources: [],
    symbols: [],
  });
});

test("summary counts, sorted sources/symbols and the publication span", () => {
  const outcome = loadInformationDataset(anInput());
  assert.deepEqual(outcome.summary, {
    researchReportCount: 1,
    newsCount: 2,
    eventCount: 2,
    analystNoteCount: 1,
    delayedCount: 2,
    sources: ["acme-research", "exchange-notices", "global-wire", "market-chatter"],
    symbols: [BTC_SYMBOL, ETH_SYMBOL],
    firstPublishedAt: T0,
    lastPublishedAt: T0 + 4 * MINUTE + 30_000,
  });
});

test("the loader rejects invalid imports with the COMPLETE typed violation list", () => {
  const badInput = anInput({
    records: [aNewsItem({ source: "ghost-wire" }), aNewsItem({ headline: "  ", sourceId: "wire-blank" })],
  });
  assert.throws(
    () => loadInformationDataset(badInput),
    (error: unknown) => {
      assert.ok(error instanceof InformationImportError);
      assert.equal(error.kind, "unknown-source");
      assert.equal(error.violations.length, 2);
      assert.match(error.message, /2 violation\(s\)/);
      return true;
    },
  );
  // The validator agrees with the loader (same pure pass).
  const validation = validateInformationImport(badInput);
  assert.equal(validation.ok, false);
});

test("toDefinitionInformationArtifacts is an identity-preserving view onto the definition surface", () => {
  const outcome = loadInformationDataset(anInput());
  const view = toDefinitionInformationArtifacts(outcome.artifacts);
  assert.equal(view.length, 6);
  for (let i = 0; i < view.length; i += 1) {
    assert.equal(view[i], outcome.artifacts[i], "no copy — the same frozen artifacts");
    // The NewsPayload view sees the family fields.
    const newsView: InformationArtifact<NewsPayload> = view[i]!;
    assert.equal(typeof newsView.payload.headline, "string");
    assert.ok(newsView.payload.summary === undefined || typeof newsView.payload.summary === "string");
  }
});

test("single-record imports map each kind faithfully", () => {
  for (const record of [
    aResearchReport(),
    aNewsItem({ sourceId: undefined }),
    anEvent(),
    anAnalystNote(),
  ]) {
    const outcome = loadInformationDataset(anInput({ records: [record] }));
    assert.equal(outcome.artifacts.length, 1);
    assert.equal(outcome.artifacts[0]!.scope, record.kind);
  }
});
