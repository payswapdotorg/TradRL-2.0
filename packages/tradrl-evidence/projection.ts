/**
 * The evidence projection (W028 `tradrl-evidence`) — the EVIDENCE VIEW over
 * one world's journal and its imported sources.
 *
 * Spec: spec/WORK-ITEMS.md W028 — "given a world's journal + its imported
 * information artifacts (W027) + datasets (W020), project the EVIDENCE VIEW:
 * which facts (journal events) cite which sources (artifact/dataset/record
 * identities), the digest chain linking projections to their inputs, and
 * the query surface". Spec: spec/ACCEPTANCE-WORLD-ALPHA.md L (evidence:
 * causal events and provenance for every applied command).
 *
 * This is the AUDITABILITY SPINE and it is a PURE PROJECTION (the UI
 * projection law, WORLD-PROTOCOL.md): it NEVER mints facts and NEVER
 * invents citations — every link comes from a surface the inputs already
 * declare (see `./citations.js`), and an event with no declared source
 * carries the honest `no-declared-source` marker.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — when an observation point (`asOf`)
 * is given, the information firewall applies to the evidence view exactly
 * as it applies to the W016 EvidencePort reads ("the firewall applies to
 * evidence reads too"): events before their observation time and artifacts
 * before their `availableAt` are withheld (counted honestly in the
 * summary, never partially leaked). Without `asOf` the projection is the
 * full-audit view. Spec: A9 — deterministic and content-addressed: the
 * same inputs always yield the bit-identical projection and digest chain.
 *
 * Output is PLAIN DATA (frozen where constructed; structuredClone survives
 * — the W018 transport discipline): arrays, never Maps, so the view
 * serializes and travels; the typed lookup surface lives in `./query.js`.
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  InformationArtifact,
  InformationArtifactId,
  JournalEntryId,
  NewsPayload,
  ProducerId,
  SequenceNumber,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { DatasetDescriptor, DatasetId } from "tradrl-world-contracts/data";
import type { InformationDatasetDescriptor } from "tradrl-world-contracts/information-data";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import { isArtifactObservableAt, isEventObservableAt, validateEventStream } from "tradrl-world-contracts/time";
import type { JournalRecord } from "tradrl-world-sim/journal";
import { canonicalString } from "tradrl-world-sim/world";
import {
  citedDatasetIdOf,
  isInformationArtifactIdentity,
  resolveSourceCitation,
  type SourceCitation,
} from "./citations.js";
import {
  chainLinkOf,
  citationDigestOf,
  envelopeDigestOf,
  inventoryDigestOf,
  type EvidenceDigestChain,
} from "./chain.js";
import { EvidenceProjectionError, type EvidenceViolation } from "./errors.js";

/** A dataset descriptor the projection was given — W020 or W027 flavored. */
export type EvidenceDatasetDescriptor = DatasetDescriptor | InformationDatasetDescriptor;

/** The input of one evidence projection (all pure data, no IO). */
export interface EvidenceProjectionInput {
  /** The world whose evidence this projects; every record/artifact must belong to it. */
  readonly worldId: WorldId;
  /**
   * The world's journal records, in journal sequence order (the order the
   * W016 journal/snapshot surfaces freeze; `journal.records()`,
   * `loader.records` or a snapshot prefix all fit).
   */
  readonly records: readonly JournalRecord[];
  /**
   * The world's imported information artifacts (the W027 definition channel,
   * `definition.informationArtifacts`). Optional — the projection cites from
   * journal events independently; provided artifacts enrich the view with
   * the uncited-artifact state and verbatim records.
   */
  readonly artifacts?: readonly InformationArtifact<NewsPayload>[];
  /**
   * The imported dataset descriptors (W020 `DatasetDescriptor` and/or W027
   * `InformationDatasetDescriptor`) — the fidelity declarations the evidence
   * view echoes for each cited dataset.
   */
  readonly datasets?: readonly EvidenceDatasetDescriptor[];
  /**
   * The A7 observation point. When given, events before their observation
   * time and artifacts before their `availableAt` are withheld (honestly
   * counted); when omitted, the projection is the full-audit view.
   */
  readonly asOf?: SimulationTimeMs;
}

/** The per-event evidence record — the audit view of ONE journal event. */
export interface EventEvidence {
  readonly eventId: EventId;
  readonly entryId: JournalEntryId;
  readonly sequence: SequenceNumber;
  readonly eventType: string;
  readonly occurredAt: TimestampMs;
  readonly availableAt?: TimestampMs;
  readonly producer: ProducerId;
  /** The envelope's own causation, verbatim (command id or import id — never interpreted here). */
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  /** Domain time at which the journal sealed this record. */
  readonly recordedAt: TimestampMs;
  /** The sealed envelope, verbatim — the audited fact itself. */
  readonly envelope: WorldEventEnvelope;
  /** The resolved source citation (see `./citations.js`) — never fabricated. */
  readonly citation: SourceCitation;
  /** Content digest of the envelope (A9, the W016 hashing family). */
  readonly eventDigest: string;
  /** Content digest of the citation (A9). */
  readonly citationDigest: string;
  /** This event's link in the projection digest chain. */
  readonly chainLink: string;
}

/** The evidence view of ONE imported artifact identity. */
export interface ArtifactEvidence {
  readonly artifactId: InformationArtifactId;
  readonly datasetId: DatasetId;
  readonly recordDigest: string;
  /**
   * The verbatim artifact record when the projection input provided it
   * (definition channel); absent when the identity is known only by
   * citation — never fabricated.
   */
  readonly artifact?: InformationArtifact<NewsPayload>;
  /** Journal events citing this identity, in sequence order (empty = honestly uncited). */
  readonly citingEventIds: readonly EventId[];
}

/** The evidence view of ONE dataset (direct citations + its artifacts). */
export interface DatasetEvidence {
  readonly datasetId: DatasetId;
  /** The provided descriptor, when the projection input carried one. */
  readonly descriptor?: EvidenceDatasetDescriptor;
  /** This dataset's identity-carrying artifacts, deterministic (datasetId, artifactId) order. */
  readonly artifactIds: readonly InformationArtifactId[];
  /**
   * Events citing this dataset — directly (W020 causation) or through an
   * artifact identity — in sequence order.
   */
  readonly citingEventIds: readonly EventId[];
}

/** Deterministic counts over the evidence view — the honest summary. */
export interface EvidenceSummary {
  /** Records the projection was given. */
  readonly journalSize: number;
  /** Events in the evidence view (after the A7 firewall, when applied). */
  readonly projectedEventCount: number;
  /** Events withheld by the A7 firewall (asOf) — counted, never leaked. */
  readonly withheldEventCount: number;
  /** Events citing an imported information artifact (W027 payload identity). */
  readonly artifactCitationCount: number;
  /** Events citing a dataset directly (W020 import causation). */
  readonly datasetCitationCount: number;
  /** Events with no declared source — the honest marker, never fabricated. */
  readonly noSourceCount: number;
  /** Distinct artifact identities in the view (provided ∪ cited). */
  readonly artifactCount: number;
  /** Distinct datasets in the view (provided ∪ cited). */
  readonly datasetCount: number;
}

/** The evidence view — pure plain data (see module doc). */
export interface EvidenceProjection {
  readonly worldId: WorldId;
  /** Present when the A7 firewall was applied at this observation point. */
  readonly asOf?: SimulationTimeMs;
  /** Per-event evidence, journal sequence order (firewalled when asOf is set). */
  readonly events: readonly EventEvidence[];
  /** Artifact identities in the view, deterministic (datasetId, artifactId) order. */
  readonly artifacts: readonly ArtifactEvidence[];
  /** Datasets in the view, deterministic datasetId order. */
  readonly datasets: readonly DatasetEvidence[];
  /** The projection digest chain (see `./chain.js`). */
  readonly chain: EvidenceDigestChain;
  readonly summary: EvidenceSummary;
}

/** Code-unit comparison — the hashing.ts canonicalize discipline. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The identity fields of an information-artifact citation or artifact payload identity. */
interface IdentityShape {
  readonly artifactId: string;
  readonly datasetId: string;
  readonly recordDigest: string;
}

function identityKey(identity: IdentityShape): string {
  return canonicalString(identity);
}

/**
 * Project the evidence view — pure and deterministic (A9): the same input
 * always yields the bit-identical projection and digest chain. Collects the
 * COMPLETE violation list first (world mismatches, W004 stream-law
 * violations, malformed/missing provenance identities, unresolvable import
 * causations, ambiguous artifact ids, duplicate dataset ids) and throws ONE
 * `EvidenceProjectionError` when anything is wrong — never a partial
 * projection, never a silently dropped citation.
 */
export function projectEvidence(input: EvidenceProjectionInput): EvidenceProjection {
  const violations: EvidenceViolation[] = [];
  const records = input.records;
  const providedArtifacts = input.artifacts ?? [];
  const providedDatasets = input.datasets ?? [];
  const asOf = input.asOf;

  // --- input laws (collected, never first-only) -------------------------------
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.envelope.worldId !== input.worldId) {
      violations.push({
        kind: "world-mismatch",
        index,
        detail: `record ${String(index)} (${String(record.envelope.eventId)}) belongs to world ${String(
          record.envelope.worldId,
        )}, not ${String(input.worldId)}`,
      });
    }
  }
  const streamCheck = validateEventStream(records.map((record) => record.envelope));
  if (!streamCheck.ok) {
    for (const streamViolation of streamCheck.violations) {
      violations.push({
        kind: "invalid-journal-stream",
        index: streamViolation.index,
        detail: `W004 stream law: ${streamViolation.detail}`,
      });
    }
  }
  for (let index = 0; index < providedArtifacts.length; index += 1) {
    const artifact = providedArtifacts[index]!;
    if (artifact.worldId !== input.worldId) {
      violations.push({
        kind: "world-mismatch",
        index,
        detail: `artifact ${String(index)} (${String(artifact.artifactId)}) belongs to world ${String(
          artifact.worldId,
        )}, not ${String(input.worldId)}`,
      });
    }
  }

  // --- the artifact identity registry (provided, A7-filtered) -----------------
  // ONE canonical identity per artifact id in the view: a second, different
  // identity under the same artifact id (provided-provided, provided-cited
  // or cited-cited) is an ambiguous-artifact-id violation — loud, never a
  // silent merge.
  const identityByArtifactId = new Map<string, IdentityShape>();
  const providedArtifactById = new Map<string, InformationArtifact<NewsPayload>>();
  const observableProvidedArtifacts: InformationArtifact<NewsPayload>[] = [];
  for (const artifact of providedArtifacts) {
    const payload: unknown = artifact.payload;
    const identity: unknown =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).identity
        : undefined;
    if (identity === undefined) {
      // A hand-authored W004 news artifact carries no provenance identity —
      // it is world-authored content, not an imported source; it is not
      // citable and simply does not enter the registry (honest, documented).
      continue;
    }
    if (!isInformationArtifactIdentity(identity)) {
      violations.push({
        kind: "malformed-identity",
        detail: `artifact ${String(artifact.artifactId)}: payload identity is present but malformed`,
      });
      continue;
    }
    if (asOf !== undefined && !isArtifactObservableAt(artifact, asOf)) {
      continue; // the A7 firewall: not observable at asOf ⇒ not in the view
    }
    observableProvidedArtifacts.push(artifact);
    const existing = identityByArtifactId.get(identity.artifactId);
    if (existing !== undefined && identityKey(existing) !== identityKey(identity)) {
      violations.push({
        kind: "ambiguous-artifact-id",
        detail: `artifact id ${identity.artifactId} is declared by two different identities (datasets ${existing.datasetId} and ${identity.datasetId})`,
      });
      continue;
    }
    identityByArtifactId.set(identity.artifactId, identity);
    if (!providedArtifactById.has(identity.artifactId)) {
      providedArtifactById.set(identity.artifactId, artifact);
    }
  }

  // --- dataset descriptors ------------------------------------------------------
  const descriptorsById = new Map<string, EvidenceDatasetDescriptor>();
  for (const descriptor of providedDatasets) {
    const existing = descriptorsById.get(descriptor.datasetId);
    if (existing !== undefined && canonicalString(existing) !== canonicalString(descriptor)) {
      violations.push({
        kind: "duplicate-dataset-id",
        detail: `dataset id ${String(descriptor.datasetId)} is declared twice with different descriptors`,
      });
      continue;
    }
    descriptorsById.set(descriptor.datasetId, descriptor);
  }

  // --- per-event pass 1: citations (violations collected) -----------------------
  interface RawEvent {
    readonly record: JournalRecord;
    readonly citation: SourceCitation;
    readonly eventDigest: string;
    readonly citationDigest: string;
  }
  const rawEvents: RawEvent[] = [];
  const citingEventIdsByArtifactId = new Map<string, EventId[]>();
  const citingEventIdsByDatasetId = new Map<string, EventId[]>();
  let artifactCitationCount = 0;
  let datasetCitationCount = 0;
  let noSourceCount = 0;

  for (const record of records) {
    const envelope = record.envelope;
    if (asOf !== undefined && !isEventObservableAt(envelope, asOf)) {
      continue; // the A7 firewall applies to evidence reads too
    }
    const resolution = resolveSourceCitation(envelope);
    if (!resolution.ok) {
      violations.push(resolution.violation);
      continue;
    }
    const citation = resolution.citation;
    if (citation.kind === "information-artifact") {
      artifactCitationCount += 1;
      const identity: IdentityShape = {
        artifactId: citation.artifactId,
        datasetId: citation.datasetId,
        recordDigest: citation.recordDigest,
      };
      const existing = identityByArtifactId.get(identity.artifactId);
      if (existing !== undefined && identityKey(existing) !== identityKey(identity)) {
        violations.push({
          kind: "ambiguous-artifact-id",
          detail: `artifact id ${identity.artifactId} is cited by two different identities (datasets ${existing.datasetId} and ${identity.datasetId})`,
        });
        continue;
      }
      identityByArtifactId.set(identity.artifactId, identity);
      const list = citingEventIdsByArtifactId.get(identity.artifactId);
      if (list === undefined) {
        citingEventIdsByArtifactId.set(identity.artifactId, [envelope.eventId]);
      } else {
        list.push(envelope.eventId);
      }
    } else if (citation.kind === "dataset") {
      datasetCitationCount += 1;
    } else {
      noSourceCount += 1;
    }
    const citedDataset = citedDatasetIdOf(citation);
    if (citedDataset !== undefined) {
      const list = citingEventIdsByDatasetId.get(citedDataset);
      if (list === undefined) {
        citingEventIdsByDatasetId.set(citedDataset, [envelope.eventId]);
      } else {
        list.push(envelope.eventId);
      }
    }
    rawEvents.push({
      record,
      citation,
      eventDigest: envelopeDigestOf(envelope),
      citationDigest: citationDigestOf(citation),
    });
  }

  if (violations.length > 0) {
    throw new EvidenceProjectionError(violations);
  }

  // --- the digest chain (inventory anchor + rolling links) ----------------------
  const inventoryDigest = inventoryDigestOf({
    worldId: input.worldId,
    ...(asOf === undefined ? {} : { asOf }),
    datasets: [...descriptorsById.values()],
    artifacts: observableProvidedArtifacts,
  });
  const links: string[] = [];
  let previous = inventoryDigest;
  const events: EventEvidence[] = [];
  for (const raw of rawEvents) {
    const envelope = raw.record.envelope;
    previous = chainLinkOf(previous, envelope, raw.citation);
    links.push(previous);
    events.push(
      Object.freeze({
        eventId: envelope.eventId,
        entryId: raw.record.entryId,
        sequence: envelope.sequence,
        eventType: envelope.eventType,
        occurredAt: envelope.occurredAt,
        ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
        producer: envelope.producer,
        causationId: envelope.causationId,
        correlationId: envelope.correlationId,
        recordedAt: raw.record.recordedAt,
        envelope,
        citation: Object.freeze(raw.citation),
        eventDigest: raw.eventDigest,
        citationDigest: raw.citationDigest,
        chainLink: previous,
      }) as EventEvidence,
    );
  }

  // --- the artifact evidence view (provided ∪ cited) ----------------------------
  const artifacts: ArtifactEvidence[] = [];
  for (const [artifactId, identity] of identityByArtifactId) {
    const provided = providedArtifactById.get(artifactId);
    const citingEventIds = citingEventIdsByArtifactId.get(artifactId);
    artifacts.push({
      artifactId: artifactId as InformationArtifactId,
      datasetId: identity.datasetId as DatasetId,
      recordDigest: identity.recordDigest,
      ...(provided === undefined ? {} : { artifact: provided }),
      citingEventIds: citingEventIds ?? [],
    });
  }
  artifacts.sort((left, right) =>
    compareText(`${left.datasetId}:${left.artifactId}`, `${right.datasetId}:${right.artifactId}`),
  );

  // --- the dataset evidence view -------------------------------------------------
  const datasetIds = new Set<string>([
    ...descriptorsById.keys(),
    ...citingEventIdsByDatasetId.keys(),
    ...artifacts.map((artifact) => artifact.datasetId),
  ]);
  const datasets: DatasetEvidence[] = [...datasetIds].sort(compareText).map((datasetId) => {
    const descriptor = descriptorsById.get(datasetId);
    return {
      datasetId: datasetId as DatasetId,
      ...(descriptor === undefined ? {} : { descriptor }),
      artifactIds: artifacts
        .filter((artifact) => artifact.datasetId === datasetId)
        .map((artifact) => artifact.artifactId),
      citingEventIds: citingEventIdsByDatasetId.get(datasetId) ?? [],
    };
  });

  const frozenArtifacts = Object.freeze(artifacts.map((artifact) => Object.freeze(artifact)));
  const frozenDatasets = Object.freeze(datasets.map((dataset) => Object.freeze(dataset)));

  return Object.freeze({
    worldId: input.worldId,
    ...(asOf === undefined ? {} : { asOf }),
    events: Object.freeze(events),
    artifacts: frozenArtifacts,
    datasets: frozenDatasets,
    chain: Object.freeze({
      inventoryDigest,
      links: Object.freeze(links),
      head: previous,
    }),
    summary: Object.freeze({
      journalSize: records.length,
      projectedEventCount: events.length,
      withheldEventCount: records.length - events.length,
      artifactCitationCount,
      datasetCitationCount,
      noSourceCount,
      artifactCount: frozenArtifacts.length,
      datasetCount: frozenDatasets.length,
    }),
  });
}
