/**
 * Projection tests (W028 `tradrl-evidence`) — the EVIDENCE VIEW laws over
 * the real import surfaces: the plain-data projection, the A7 firewall at a
 * declared observation point, the honest uncited/citation-known states, the
 * artifact/dataset registries, and the loud complete-violation collection
 * (never a partial projection, never a silently dropped citation).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { JournalRecord, PendingEventDraft } from "tradrl-world-sim/journal";
import { createEventJournal } from "tradrl-world-sim/journal";
import { stableDigest } from "tradrl-world-sim/world";
import type {
  CausationId,
  CorrelationId,
  InformationArtifact,
  JournalEntryId,
  NewsPayload,
  ProducerId,
  SequenceNumber,
  TimestampMs,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { InformationArtifactIdentity } from "tradrl-world-contracts/information-data";
import { projectEvidence, type EvidenceProjectionInput } from "../projection.js";
import { verifyEvidenceChain } from "../chain.js";
import { EvidenceProjectionError } from "../errors.js";
import {
  at,
  combinedJournal,
  dataDescriptor,
  dataImport,
  infoDescriptor,
  infoImport,
  sim,
  T0,
  MINUTE,
  w028WorldDefinition,
  WORLD,
} from "./fixtures.js";

/** The full-audit projection of the combined two-import journal. */
function combinedInput(
  overrides: Partial<EvidenceProjectionInput> = {},
): EvidenceProjectionInput {
  const { journal, info } = combinedJournal();
  return {
    worldId: WORLD,
    records: journal.records(),
    artifacts: info.artifacts as unknown as InformationArtifact<NewsPayload>[],
    datasets: [dataDescriptor(), infoDescriptor()],
    ...overrides,
  };
}

test("the full-audit view projects every event with its declared citation", () => {
  const { journal, info } = combinedJournal();
  const projection = projectEvidence({
    worldId: WORLD,
    records: journal.records(),
    artifacts: info.artifacts as unknown as InformationArtifact<NewsPayload>[],
    datasets: [dataDescriptor(), infoDescriptor()],
  });
  assert.equal(projection.worldId, WORLD);
  assert.equal(projection.asOf, undefined);
  assert.equal(projection.events.length, 7);
  // Market-data events (seq 1-4): dataset citations.
  for (const event of projection.events.slice(0, 4)) {
    assert.equal(event.citation.kind, "dataset");
  }
  // Information events (seq 5-7): artifact citations with the loader's identity.
  for (const event of projection.events.slice(4)) {
    assert.equal(event.citation.kind, "information-artifact");
  }
  // The envelope is carried verbatim (reference identity with the journal).
  for (let index = 0; index < 7; index += 1) {
    assert.equal(projection.events[index]!.envelope, journal.records()[index]!.envelope);
    assert.equal(projection.events[index]!.sequence, index + 1);
  }
  // Event digests are the engine's own content digests of the envelopes.
  for (const event of projection.events) {
    assert.equal(event.eventDigest, stableDigest(event.envelope));
  }
});

test("the honest summary counts the view exactly", () => {
  const projection = projectEvidence(combinedInput());
  assert.deepEqual(projection.summary, {
    journalSize: 7,
    projectedEventCount: 7,
    withheldEventCount: 0,
    artifactCitationCount: 3,
    datasetCitationCount: 4,
    noSourceCount: 0,
    artifactCount: 3,
    datasetCount: 2,
  });
});

test("the artifact registry carries provided+cited artifacts, deterministically ordered", () => {
  const projection = projectEvidence(combinedInput());
  assert.deepEqual(
    projection.artifacts.map((artifact) => artifact.artifactId),
    ["evt-B", "note-alpha", "wire-A"],
  );
  const wire = projection.artifacts.find((artifact) => artifact.artifactId === "wire-A")!;
  assert.equal(wire.datasetId, "info-w028-research");
  assert.equal(wire.citingEventIds.length, 1);
  assert.equal(wire.citingEventIds[0], "evt:world-w028-tests:5");
  assert.ok(wire.artifact, "the provided artifact record rides along verbatim");
  assert.equal(wire.recordDigest.length > 0, true);
});

test("the dataset registry echoes descriptors, artifacts and citing events", () => {
  const projection = projectEvidence(combinedInput());
  assert.deepEqual(
    projection.datasets.map((dataset) => dataset.datasetId),
    ["ds-w028-market", "info-w028-research"],
  );
  const market = projection.datasets[0]!;
  assert.deepEqual(market.descriptor, dataDescriptor());
  assert.deepEqual(market.artifactIds, []);
  assert.equal(market.citingEventIds.length, 4);
  const research = projection.datasets[1]!;
  assert.deepEqual(research.descriptor, infoDescriptor());
  assert.deepEqual(research.artifactIds, ["evt-B", "note-alpha", "wire-A"]);
  assert.equal(research.citingEventIds.length, 3);
});

test("the projection is plain data: structuredClone survives, the chain verifies", () => {
  const projection = projectEvidence(combinedInput());
  const cloned = structuredClone(projection);
  assert.deepEqual(cloned.chain, projection.chain);
  assert.deepEqual(cloned.summary, projection.summary);
  assert.deepEqual(verifyEvidenceChain(projection), { ok: true });
  assert.deepEqual(verifyEvidenceChain(cloned), { ok: true });
});

test("the projection is deterministic: identical inputs ⇒ identical views (A9)", () => {
  const first = projectEvidence(combinedInput());
  const second = projectEvidence(combinedInput());
  assert.deepEqual(first, second);
  // Cloned inputs (a fresh object graph) yield the same chain head.
  const fromClones = projectEvidence({
    ...combinedInput(),
    records: structuredClone(combinedInput().records),
  });
  assert.equal(fromClones.chain.head, first.chain.head);
});

test("A7: at an observation point, unobservable events and artifacts are withheld, counted, never leaked", () => {
  const projection = projectEvidence(
    combinedInput({ asOf: sim(T0 + 3 * MINUTE + 30_000) }),
  );
  assert.equal(projection.asOf, sim(T0 + 3 * MINUTE + 30_000));
  // 4 market events + the undelayed wire news are observable; the delayed
  // research (availableAt T0+4m) and the late event (T0+4m30s) are not.
  assert.equal(projection.summary.projectedEventCount, 5);
  assert.equal(projection.summary.withheldEventCount, 2);
  assert.deepEqual(
    projection.events.map((event) => event.sequence),
    [1, 2, 3, 4, 5],
  );
  // The artifact registry is firewalled identically: only the observable
  // wire-A artifact is in the view (its availableAt is its publication time).
  assert.deepEqual(
    projection.artifacts.map((artifact) => artifact.artifactId),
    ["wire-A"],
  );
  assert.deepEqual(projection.datasets.map((dataset) => dataset.datasetId), [
    "ds-w028-market",
    "info-w028-research",
  ]);
  const research = projection.datasets[1]!;
  assert.deepEqual(research.artifactIds, ["wire-A"]);
  assert.deepEqual(research.citingEventIds, ["evt:world-w028-tests:5"]);
});

test("A7 at the origin: only the occurred-and-observable market events survive", () => {
  const projection = projectEvidence(combinedInput({ asOf: sim(T0) }));
  // The T0 quote is observable exactly from T0; everything later is withheld.
  assert.equal(projection.summary.projectedEventCount, 1);
  assert.equal(projection.summary.withheldEventCount, 6);
  assert.equal(projection.events[0]!.eventType, "market.quote.updated");
  assert.deepEqual(projection.artifacts, []);
});

test("the honest uncited state: a provided artifact no journal event cites", () => {
  const data = dataImport();
  const info = infoImport();
  const projection = projectEvidence({
    worldId: WORLD,
    records: createJournalFrom(data.drafts).records(),
    artifacts: info.artifacts as unknown as InformationArtifact<NewsPayload>[],
    datasets: [dataDescriptor(), infoDescriptor()],
  });
  assert.equal(projection.summary.artifactCitationCount, 0);
  assert.equal(projection.summary.datasetCitationCount, 4);
  // All three artifacts are KNOWN (provided) and honestly uncited.
  for (const artifact of projection.artifacts) {
    assert.deepEqual(artifact.citingEventIds, []);
  }
  // The information dataset is known through its artifacts + descriptor,
  // with zero citing events — a different state from unknown.
  const research = projection.datasets.find((d) => d.datasetId === "info-w028-research")!;
  assert.deepEqual(research.citingEventIds, []);
  assert.equal(research.artifactIds.length, 3);
});

test("the citation-known state: an identity cited by events with no provided artifact record", () => {
  const info = infoImport();
  const projection = projectEvidence({
    worldId: WORLD,
    records: createJournalFrom(info.drafts).records(),
  });
  assert.equal(projection.summary.artifactCitationCount, 3);
  assert.equal(projection.artifacts.length, 3);
  for (const artifact of projection.artifacts) {
    assert.equal(artifact.artifact, undefined, "no artifact record was provided — never fabricated");
    assert.equal(artifact.citingEventIds.length, 1);
  }
  // Datasets are known by citation alone (no descriptors provided).
  assert.deepEqual(projection.datasets.map((dataset) => dataset.datasetId), [
    "info-w028-research",
  ]);
  assert.equal(projection.datasets[0]!.descriptor, undefined);
});

test("a hand-authored artifact (no payload identity) is not an imported source — skipped, no violation", () => {
  const handAuthored: InformationArtifact<NewsPayload> = {
    artifactId: "hand-authored-1" as never,
    worldId: WORLD,
    source: "world-author",
    createdAt: at(T0),
    availableAt: at(T0),
    scope: "news",
    provenance: { producer: "world-author" as ProducerId, recordedAt: at(T0) },
    version: "1",
    payload: {
      headline: "Hand-authored world content",
      summary: "Not an imported source.",
    },
  };
  const info = infoImport();
  const projection = projectEvidence({
    worldId: WORLD,
    records: createJournalFrom(info.drafts).records(),
    artifacts: [
      ...(info.artifacts as unknown as InformationArtifact<NewsPayload>[]),
      handAuthored,
    ],
  });
  assert.equal(projection.artifacts.length, 3);
  assert.equal(
    projection.artifacts.some((artifact) => artifact.artifactId === "hand-authored-1"),
    false,
  );
});

test("an empty input projects the honest empty view", () => {
  const projection = projectEvidence({ worldId: WORLD, records: [] });
  assert.deepEqual(projection.events, []);
  assert.deepEqual(projection.artifacts, []);
  assert.deepEqual(projection.datasets, []);
  assert.deepEqual(projection.chain.links, []);
  assert.equal(projection.chain.head, projection.chain.inventoryDigest);
  assert.deepEqual(projection.summary, {
    journalSize: 0,
    projectedEventCount: 0,
    withheldEventCount: 0,
    artifactCitationCount: 0,
    datasetCitationCount: 0,
    noSourceCount: 0,
    artifactCount: 0,
    datasetCount: 0,
  });
});

test("a record from another world is rejected loudly (world mismatch)", () => {
  const { journal } = combinedJournal();
  assert.throws(
    () =>
      projectEvidence({
        worldId: "world-somewhere-else" as never,
        records: journal.records(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.equal(error.violations.length, 7);
      assert.ok(error.violations.every((violation) => violation.kind === "world-mismatch"));
      return true;
    },
  );
});

test("an artifact with a malformed payload identity is rejected loudly", () => {
  const malformed = {
    artifactId: "broken-1" as never,
    worldId: WORLD,
    source: "x",
    createdAt: T0,
    availableAt: T0,
    scope: "news",
    provenance: { producer: "x" as ProducerId, recordedAt: T0 },
    version: "1",
    payload: { identity: { artifactId: "a", datasetId: 1, recordDigest: "r" } },
  } as unknown as InformationArtifact<NewsPayload>;
  assert.throws(
    () => projectEvidence({ worldId: WORLD, records: [], artifacts: [malformed] }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.equal(error.violations[0]!.kind, "malformed-identity");
      return true;
    },
  );
});

test("two different descriptors sharing a dataset id are rejected (duplicate dataset id)", () => {
  assert.throws(
    () =>
      projectEvidence({
        worldId: WORLD,
        records: [],
        datasets: [
          dataDescriptor(),
          dataDescriptor({ granularity: "5m" }),
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.equal(error.violations[0]!.kind, "duplicate-dataset-id");
      return true;
    },
  );
});

test("two different artifact identities sharing an artifact id are rejected (ambiguous artifact id)", () => {
  const info = infoImport();
  const first = info.artifacts[0]!;
  const colliding: InformationArtifact<NewsPayload> = {
    ...first,
    artifactId: first.artifactId,
    payload: {
      ...(first.payload as unknown as Record<string, unknown>),
      identity: {
        artifactId: first.payload.identity.artifactId,
        datasetId: "another-dataset" as never,
        recordDigest: first.payload.identity.recordDigest,
      } as InformationArtifactIdentity,
    } as unknown as NewsPayload,
  };
  assert.throws(
    () =>
      projectEvidence({
        worldId: WORLD,
        records: [],
        artifacts: [first as unknown as InformationArtifact<NewsPayload>, colliding],
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.equal(error.violations[0]!.kind, "ambiguous-artifact-id");
      return true;
    },
  );
});

test("an event citing an identity that collides with a provided artifact id is rejected", () => {
  const info = infoImport();
  const collidingDraft: PendingEventDraft = {
    ...info.drafts[0]!,
    occurredAt: at(T0 + 2 * MINUTE),
    payload: {
      ...(info.drafts[0]!.payload as Record<string, unknown>),
      identity: {
        artifactId: "wire-A",
        datasetId: "a-different-dataset",
        recordDigest: "deadbeef",
      },
    },
  };
  const journal = createEventJournal(WORLD);
  journal.append([collidingDraft]);
  assert.throws(
    () =>
      projectEvidence({
        worldId: WORLD,
        records: journal.records(),
        artifacts: info.artifacts as unknown as InformationArtifact<NewsPayload>[],
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.equal(error.violations[0]!.kind, "ambiguous-artifact-id");
      return true;
    },
  );
});

test("ALL violations are collected in one pass — never first-only", () => {
  const info = infoImport();
  const badIdentityDraft: PendingEventDraft = {
    ...info.drafts[0]!,
    payload: {
      ...(info.drafts[0]!.payload as Record<string, unknown>),
      identity: { artifactId: "x", datasetId: 9 },
    },
  };
  const badImportDraft: PendingEventDraft = {
    eventType: "market.trade.printed",
    occurredAt: at(T0 + 2 * MINUTE + 5_000),
    causationId: "not-an-import" as CausationId,
    correlationId: "not-an-import" as CorrelationId,
    producer: "historical-data-import" as ProducerId,
    schemaVersion: "tradrl-data.import@1",
    payload: { type: "market.trade.printed", tradeId: "t", instrumentId: "i", price: "1", quantity: "1", aggressorSide: "buy" },
  };
  const journal = createJournalFrom([badIdentityDraft, badImportDraft]);
  assert.throws(
    () => projectEvidence({ worldId: WORLD, records: journal.records() }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      const kinds = error.violations.map((violation) => violation.kind).sort();
      assert.deepEqual(kinds, [
        "malformed-identity",
        "unresolvable-import-causation",
      ]);
      return true;
    },
  );
});

test("a journal stream that violates the W004 laws is rejected (invalid journal stream)", () => {
  const records: JournalRecord[] = [
    handRecord(1, at(T0 + MINUTE)),
    handRecord(2, at(T0), "occurredAt went backwards"),
  ];
  assert.throws(
    () => projectEvidence({ worldId: WORLD, records }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceProjectionError);
      assert.ok(
        error.violations.some((violation) => violation.kind === "invalid-journal-stream"),
      );
      return true;
    },
  );
});

// --- helpers -----------------------------------------------------------------------

/** Append drafts through a real journal (lawful sealed records). */
function createJournalFrom(drafts: readonly PendingEventDraft[]) {
  const journal = createEventJournal(WORLD);
  if (drafts.length > 0) {
    journal.append([...drafts]);
  }
  return journal;
}

/** A hand-built journal record (for stream-law violation inputs only). */
function handRecord(sequence: number, occurredAt: TimestampMs, note = ""): JournalRecord {
  const envelope: WorldEventEnvelope = {
    worldId: WORLD,
    sequence: sequence as SequenceNumber,
    eventId: `evt:${String(WORLD)}:${String(sequence)}` as never,
    eventType: "world.annotation.added",
    occurredAt,
    causationId: "cmd-x" as CausationId,
    correlationId: "cmd-x" as CorrelationId,
    producer: "world-core" as ProducerId,
    schemaVersion: "engine.test@1",
    payload: { type: "world.annotation.added", note },
  };
  return {
    entryId: `jrn:${String(WORLD)}:${String(sequence)}` as JournalEntryId,
    envelope,
    recordedAt: occurredAt,
  };
}
