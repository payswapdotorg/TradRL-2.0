/**
 * Query-surface tests (W028 `tradrl-evidence`) — the typed lookups the W016
 * EvidencePort extends for provenance: by event, by artifact, by dataset;
 * unknown ids are typed errors (never silent); known-but-uncited is the
 * honest empty state; and the `ProvenanceRecord` bridge projects the
 * evidence view into the port's contract shape.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingEventDraft } from "tradrl-world-sim/journal";
import { createEventJournal } from "tradrl-world-sim/journal";
import type { InformationArtifact, NewsPayload } from "tradrl-world-contracts";
import { projectEvidence, type EvidenceProjectionInput } from "../projection.js";
import { createEvidenceQuery } from "../query.js";
import { UnknownEvidenceEntityError } from "../errors.js";
import {
  combinedJournal,
  dataDescriptor,
  dataImport,
  infoDescriptor,
  infoImport,
  T0,
  MINUTE,
  WORLD,
} from "./fixtures.js";

/** Append drafts through a real journal (lawful sealed records). */
function journalOf(drafts: readonly PendingEventDraft[]) {
  const journal = createEventJournal(WORLD);
  if (drafts.length > 0) {
    journal.append([...drafts]);
  }
  return journal;
}

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

test("lookup by event: known ids resolve, unknown ids throw the typed error", () => {
  const query = createEvidenceQuery(projectEvidence(combinedInput()));
  const event = query.getEventEvidence("evt:world-w028-tests:5" as never);
  assert.equal(event.eventType, "information.news.published");
  assert.equal(event.citation.kind, "information-artifact");
  assert.throws(
    () => query.getEventEvidence("evt:world-w028-tests:999" as never),
    (error: unknown) => {
      assert.ok(error instanceof UnknownEvidenceEntityError);
      assert.equal(error.entity, "event");
      assert.equal(error.id, "evt:world-w028-tests:999");
      return true;
    },
  );
});

test("lookup by artifact: cited, uncited and unknown are three distinct honest states", () => {
  // CITED: the combined journal cites wire-A.
  const cited = createEvidenceQuery(projectEvidence(combinedInput()));
  const wire = cited.getArtifactEvidence("wire-A" as never);
  assert.equal(wire.datasetId, "info-w028-research");
  assert.deepEqual(wire.citingEventIds, ["evt:world-w028-tests:5"]);
  assert.ok(wire.artifact);

  // UNCITED: the data-only journal cites no artifact, yet the provided
  // artifacts are KNOWN — the honest empty answer, not an error.
  const data = dataImport();
  const info = infoImport();
  const uncited = createEvidenceQuery(
    projectEvidence({
      worldId: WORLD,
      records: journalOf(data.drafts).records(),
      artifacts: info.artifacts as unknown as InformationArtifact<NewsPayload>[],
      datasets: [dataDescriptor(), infoDescriptor()],
    }),
  );
  const research = uncited.getArtifactEvidence("note-alpha" as never);
  assert.deepEqual(research.citingEventIds, []);
  assert.ok(research.artifact, "the provided record rides along");

  // UNKNOWN: an id that appears nowhere in the view — the typed error.
  assert.throws(
    () => cited.getArtifactEvidence("no-such-artifact" as never),
    (error: unknown) => {
      assert.ok(error instanceof UnknownEvidenceEntityError);
      assert.equal(error.entity, "artifact");
      return true;
    },
  );
});

test("lookup by artifact known only by citation carries no fabricated record", () => {
  const info = infoImport();
  const view = createEvidenceQuery(
    projectEvidence({ worldId: WORLD, records: journalOf(info.drafts).records() }),
  );
  const wire = view.getArtifactEvidence("wire-A" as never);
  assert.equal(wire.artifact, undefined);
  assert.deepEqual(wire.citingEventIds, ["evt:world-w028-tests:1"]);
  assert.equal(wire.recordDigest.length > 0, true);
});

test("lookup by dataset: descriptor echo, artifacts, citing events, typed unknown", () => {
  const query = createEvidenceQuery(projectEvidence(combinedInput()));
  const market = query.getDatasetEvidence("ds-w028-market" as never);
  assert.deepEqual(market.descriptor, dataDescriptor());
  assert.deepEqual(market.artifactIds, []);
  assert.equal(market.citingEventIds.length, 4);
  const research = query.getDatasetEvidence("info-w028-research" as never);
  assert.deepEqual(research.descriptor, infoDescriptor());
  assert.deepEqual(research.artifactIds, ["evt-B", "note-alpha", "wire-A"]);
  assert.equal(research.citingEventIds.length, 3);
  assert.throws(
    () => query.getDatasetEvidence("ds-unknown" as never),
    (error: unknown) => {
      assert.ok(error instanceof UnknownEvidenceEntityError);
      assert.equal(error.entity, "dataset");
      return true;
    },
  );
});

test("a dataset known only by citation echoes no descriptor it was not given", () => {
  const { journal } = combinedJournal();
  const query = createEvidenceQuery(
    projectEvidence({ worldId: WORLD, records: journal.records() }),
  );
  const market = query.getDatasetEvidence("ds-w028-market" as never);
  assert.equal(market.descriptor, undefined);
  assert.equal(market.citingEventIds.length, 4);
});

test("getUncitedEvents lists exactly the no-declared-source events", () => {
  const info = infoImport();
  // A journal of imported events only — nothing is uncited.
  const imported = createEvidenceQuery(
    projectEvidence({ worldId: WORLD, records: journalOf(info.drafts).records() }),
  );
  assert.deepEqual(imported.getUncitedEvents(), []);
});

test("listEvents filters by citation kind, producer and event type", () => {
  const query = createEvidenceQuery(projectEvidence(combinedInput()));
  assert.equal(query.listEvents({ citationKind: "dataset" }).length, 4);
  assert.equal(query.listEvents({ citationKind: "information-artifact" }).length, 3);
  assert.equal(query.listEvents({ citationKind: "none" }).length, 0);
  assert.equal(query.listEvents({ producer: "historical-data-import" as never }).length, 4);
  assert.equal(query.listEvents({ producer: "information-data-import" as never }).length, 3);
  assert.equal(query.listEvents({ types: ["market.bar.closed"] }).length, 1);
  assert.equal(query.listEvents({ types: ["information.research.published"] }).length, 1);
  assert.equal(query.listEvents().length, 7);
});

test("toProvenanceRecord: the W016 EvidencePort shape, extended with the artifact input", () => {
  const query = createEvidenceQuery(projectEvidence(combinedInput()));
  // An imported information event cites its artifact AND its import causation.
  const news = query.toProvenanceRecord("evt:world-w028-tests:5" as never);
  assert.deepEqual(news, {
    subjectEventId: "evt:world-w028-tests:5",
    producer: "information-data-import",
    inputs: [
      { kind: "artifact", ref: "wire-A" },
      { kind: "command", ref: "import:info-w028-research" },
    ],
    // The journal sealed this import batch at its last event's domain time.
    recordedAt: T0 + 4 * MINUTE + 30_000,
  });
  // A dataset-cited historical event carries its import causation.
  const quote = query.toProvenanceRecord("evt:world-w028-tests:1" as never);
  assert.deepEqual(quote.inputs, [{ kind: "command", ref: "import:ds-w028-market" }]);
  assert.equal(quote.producer, "historical-data-import");
  // Unknown event id ⇒ typed error.
  assert.throws(
    () => query.toProvenanceRecord("evt:world-w028-tests:999" as never),
    (error: unknown) => error instanceof UnknownEvidenceEntityError,
  );
});

test("the query surface exposes the chain and verifies it clean", () => {
  const query = createEvidenceQuery(projectEvidence(combinedInput()));
  const chain = query.getChain();
  assert.equal(chain.links.length, 7);
  assert.equal(chain.head, chain.links[6]);
  assert.deepEqual(query.verifyChain(), { ok: true });
  assert.deepEqual(query.getSummary().journalSize, 7);
});
