/**
 * Citation-resolution tests (W028 `tradrl-evidence`) — the pure law that
 * maps one journal event envelope to its declared source citation, and the
 * honest limits: every citation comes from a surface the envelope already
 * declares; nothing is ever invented.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingEventDraft } from "tradrl-world-sim/journal";
import { createEventJournal } from "tradrl-world-sim/journal";
import type {
  CausationId,
  CorrelationId,
  ProducerId,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import {
  citedDatasetIdOf,
  isArtifactCitation,
  isDatasetCitation,
  isInformationArtifactIdentity,
  resolveSourceCitation,
} from "../citations.js";
import { combinedJournal, WORLD } from "./fixtures.js";

/** A lawful draft shell for hand-crafted edge-case envelopes. */
function aDraft(overrides: Partial<PendingEventDraft> = {}): PendingEventDraft {
  return {
    eventType: "world.annotation.added",
    occurredAt: 1_700_044_800_000 as TimestampMs,
    causationId: "cmd-1" as CausationId,
    correlationId: "cmd-1" as CorrelationId,
    producer: "world-core" as ProducerId,
    schemaVersion: "engine.test@1",
    payload: {},
    ...overrides,
  };
}

/** Append one draft through a real journal to get a lawful sealed envelope. */
function envelopeOf(draft: PendingEventDraft, worldId: WorldId = WORLD): WorldEventEnvelope {
  const journal = createEventJournal(worldId);
  return journal.append([draft])[0]!;
}

test("W027 information events cite their payload identity (basis payload-identity)", () => {
  const { info } = combinedJournal();
  const news = info.records[0]!.envelope;
  const resolution = resolveSourceCitation(news);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) {
    return;
  }
  assert.deepEqual(resolution.citation, {
    kind: "information-artifact",
    basis: "payload-identity",
    artifactId: "wire-A",
    datasetId: "info-w028-research",
    recordDigest: info.artifacts[0]!.payload.identity.recordDigest,
    source: "global-wire",
    credibility: "primary-media",
  });
  assert.equal(resolution.citation.recordDigest.length > 0, true);
});

test("every information event kind resolves its identity citation (research/event)", () => {
  const { info } = combinedJournal();
  const research = resolveSourceCitation(info.records[1]!.envelope);
  const event = resolveSourceCitation(info.records[2]!.envelope);
  assert.equal(research.ok && research.citation.kind, "information-artifact");
  assert.equal(event.ok && event.citation.kind, "information-artifact");
  if (research.ok && research.citation.kind === "information-artifact") {
    assert.equal(research.citation.artifactId, "note-alpha");
    assert.equal(research.citation.credibility, "analyst");
  }
  if (event.ok && event.citation.kind === "information-artifact") {
    assert.equal(event.citation.artifactId, "evt-B");
    assert.equal(event.citation.credibility, "official");
  }
});

test("W020 historical events cite their dataset via the import causation (basis import-causation)", () => {
  const { data } = combinedJournal();
  for (const record of data.records) {
    const resolution = resolveSourceCitation(record.envelope);
    assert.equal(resolution.ok, true, record.envelope.eventType);
    if (!resolution.ok) {
      continue;
    }
    assert.deepEqual(resolution.citation, {
      kind: "dataset",
      basis: "import-causation",
      datasetId: "ds-w028-market",
    });
    // The honest limitation: the W020 event surface carries NO per-record
    // digest — the dataset citation must not invent one.
    assert.equal("recordDigest" in resolution.citation, false);
  }
});

test("engine events carry the honest no-declared-source marker, never a fabricated citation", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        payload: {
          type: "world.annotation.added",
          annotationId: "ann-1",
          issuedBy: "p",
          at: 1,
          text: "x",
        },
      }),
    ),
  );
  assert.deepEqual(resolution, {
    ok: true,
    citation: { kind: "none", reason: "no-declared-source" },
  });
});

test("a malformed payload identity is a violation, never a partial citation", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "information.news.published",
        causationId: "import:x" as CausationId,
        correlationId: "import:x" as CorrelationId,
        producer: "someone" as ProducerId,
        payload: {
          type: "information.news.published",
          identity: { artifactId: "a", datasetId: 42 },
        },
      }),
    ),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.violation.kind, "malformed-identity");
});

test("an information-import-produced event WITHOUT identity violates the W027 law", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "information.news.published",
        causationId: "import:info-w028-research" as CausationId,
        correlationId: "import:info-w028-research" as CorrelationId,
        producer: "information-data-import" as ProducerId,
        schemaVersion: "tradrl-information.import@1",
        payload: { type: "information.news.published", headline: "x" },
      }),
    ),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.violation.kind, "information-event-without-identity");
});

test("a foreign information-typed event without identity declares no source (honest none)", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "information.news.published",
        producer: "some-other-producer" as ProducerId,
        payload: { type: "information.news.published", headline: "x" },
      }),
    ),
  );
  assert.deepEqual(resolution, {
    ok: true,
    citation: { kind: "none", reason: "no-declared-source" },
  });
});

test("a historical-import event whose causation is not import:<datasetId> cannot be cited", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "market.quote.updated",
        producer: "historical-data-import" as ProducerId,
        schemaVersion: "tradrl-data.import@1",
        payload: { type: "market.quote.updated", instrumentId: "i" },
      }),
    ),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.violation.kind, "unresolvable-import-causation");
});

test("an information-import producer outside the event taxonomy violates the W027 law", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "market.quote.updated",
        causationId: "import:x" as CausationId,
        correlationId: "import:x" as CorrelationId,
        producer: "information-data-import" as ProducerId,
        payload: { type: "market.quote.updated", instrumentId: "i" },
      }),
    ),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.violation.kind, "information-event-outside-taxonomy");
});

test("an empty import causation id (import:) is unresolvable — never an empty dataset id", () => {
  const resolution = resolveSourceCitation(
    envelopeOf(
      aDraft({
        eventType: "market.trade.printed",
        causationId: "import:" as CausationId,
        correlationId: "import:" as CorrelationId,
        producer: "historical-data-import" as ProducerId,
        payload: { type: "market.trade.printed", instrumentId: "i" },
      }),
    ),
  );
  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    return;
  }
  assert.equal(resolution.violation.kind, "unresolvable-import-causation");
});

test("resolution is deterministic: the same envelope always resolves identically (A9)", () => {
  const { journal } = combinedJournal();
  for (const record of journal.records()) {
    const first = resolveSourceCitation(record.envelope);
    const second = resolveSourceCitation(record.envelope);
    assert.deepEqual(first, second, record.envelope.eventType);
  }
});

test("the identity structural guard accepts the loader's identities and rejects garbage", () => {
  const { info } = combinedJournal();
  const identity = info.artifacts[0]!.payload.identity;
  assert.equal(isInformationArtifactIdentity(identity), true);
  assert.equal(isInformationArtifactIdentity(undefined), false);
  assert.equal(isInformationArtifactIdentity(null), false);
  assert.equal(
    isInformationArtifactIdentity({ artifactId: "", datasetId: "d", recordDigest: "r" }),
    false,
  );
  assert.equal(
    isInformationArtifactIdentity({ artifactId: "a", datasetId: "d", recordDigest: 7 }),
    false,
  );
  assert.equal(isInformationArtifactIdentity("nope"), false);
});

test("citation helpers classify and extract the cited dataset", () => {
  const { journal } = combinedJournal();
  const infoEvent = journal.records()[4]!.envelope;
  const dataEvent = journal.records()[0]!.envelope;
  const infoResolution = resolveSourceCitation(infoEvent);
  const dataResolution = resolveSourceCitation(dataEvent);
  assert.ok(infoResolution.ok && dataResolution.ok);
  if (infoResolution.ok) {
    assert.equal(isArtifactCitation(infoResolution.citation), true);
    assert.equal(citedDatasetIdOf(infoResolution.citation), "info-w028-research");
  }
  if (dataResolution.ok) {
    assert.equal(isDatasetCitation(dataResolution.citation), true);
    assert.equal(citedDatasetIdOf(dataResolution.citation), "ds-w028-market");
    assert.equal(isArtifactCitation(dataResolution.citation), false);
  }
});
