/**
 * The typed evidence query surface (W028 `tradrl-evidence`) — lookups over
 * a projected evidence view: by event, by artifact, by dataset.
 *
 * Spec: spec/WORK-ITEMS.md W028 — "a typed query surface (lookups by event,
 * by artifact, by dataset; unknown ids are typed errors, never silent)".
 * Unknown ≠ uncited: a KNOWN artifact with zero citing events is the honest
 * empty answer; an id that appears nowhere in the view throws
 * `UnknownEvidenceEntityError` — a typed error, never an undefined, never
 * an empty list that silently looks like "cited by nothing".
 *
 * This is the surface the W016 EvidencePort extends for provenance
 * (WORLD-PROTOCOL.md "Ports"): `getProvenance(eventId)` on the port
 * currently projects the command causation of every event; the evidence
 * view carries the richer citation, and `toProvenanceRecord` projects it
 * into the port's `ProvenanceRecord` contract shape — the artifact input
 * (`kind: "artifact"`) for imported information events, plus the envelope's
 * own causation as the command input (an import causation IS the logical
 * command that produced those events — the W020 adapter law). Wiring it
 * INTO the engine's port is a contracts/sim change and stays TL-owned; this
 * package delivers the projection and the bridge, pure and side-effect
 * free.
 */

import type {
  EventId,
  ProducerId,
  ProvenanceRecord,
} from "tradrl-world-contracts";
import type { DatasetId } from "tradrl-world-contracts/data";
import type { InformationArtifactId } from "tradrl-world-contracts";
import { UnknownEvidenceEntityError } from "./errors.js";
import type { SourceCitation } from "./citations.js";
import { verifyEvidenceChain, type ChainVerification, type EvidenceDigestChain } from "./chain.js";
import type {
  ArtifactEvidence,
  DatasetEvidence,
  EventEvidence,
  EvidenceProjection,
  EvidenceSummary,
} from "./projection.js";

/** Filter for listing events out of the evidence view. */
export interface EvidenceEventFilter {
  readonly citationKind?: SourceCitation["kind"];
  readonly producer?: ProducerId;
  readonly types?: readonly string[];
}

/** The typed query surface over one evidence projection. */
export interface EvidenceQuery {
  /** Deterministic counts over the view — the honest summary. */
  getSummary(): EvidenceSummary;
  /** The projection digest chain (content address of the view). */
  getChain(): EvidenceDigestChain;
  /** Recompute + verify the chain over the view's own events — tamper evidence. */
  verifyChain(): ChainVerification;
  /** The full evidence of one journaled event. Unknown event id ⇒ typed error. */
  getEventEvidence(eventId: EventId): EventEvidence;
  /** List events (sequence order), optionally filtered by citation kind / producer / type. */
  listEvents(filter?: EvidenceEventFilter): readonly EventEvidence[];
  /**
   * The evidence of one artifact identity. Known-but-uncited ⇒ empty
   * citingEventIds (the honest state); unknown id ⇒ typed error.
   */
  getArtifactEvidence(artifactId: InformationArtifactId): ArtifactEvidence;
  /**
   * The evidence of one dataset (descriptor echo + artifacts + citing
   * events). Unknown dataset id ⇒ typed error.
   */
  getDatasetEvidence(datasetId: DatasetId): DatasetEvidence;
  /** Events with no declared source — the honest audit channel, never fabricated. */
  getUncitedEvents(): readonly EventEvidence[];
  /**
   * The W003 `ProvenanceRecord` projection of one event — the shape the
   * W016 EvidencePort's `getProvenance` returns, extended with the artifact
   * input imported information events declare. Unknown event id ⇒ typed error.
   */
  toProvenanceRecord(eventId: EventId): ProvenanceRecord;
}

/** Build the typed query surface over one projected evidence view. */
export function createEvidenceQuery(projection: EvidenceProjection): EvidenceQuery {
  const eventsByEventId = new Map<string, EventEvidence>();
  for (const event of projection.events) {
    eventsByEventId.set(event.eventId, event);
  }
  const artifactsByArtifactId = new Map<string, ArtifactEvidence>();
  for (const artifact of projection.artifacts) {
    artifactsByArtifactId.set(artifact.artifactId, artifact);
  }
  const datasetsByDatasetId = new Map<string, DatasetEvidence>();
  for (const dataset of projection.datasets) {
    datasetsByDatasetId.set(dataset.datasetId, dataset);
  }

  const requireEvent = (eventId: EventId): EventEvidence => {
    const event = eventsByEventId.get(eventId);
    if (event === undefined) {
      throw new UnknownEvidenceEntityError("event", String(eventId));
    }
    return event;
  };

  return {
    getSummary() {
      return projection.summary;
    },
    getChain() {
      return projection.chain;
    },
    verifyChain() {
      return verifyEvidenceChain(projection);
    },
    getEventEvidence(eventId) {
      return requireEvent(eventId);
    },
    listEvents(filter = {}) {
      return projection.events.filter(
        (event) =>
          (filter.citationKind === undefined ||
            event.citation.kind === filter.citationKind) &&
          (filter.producer === undefined || event.producer === filter.producer) &&
          (filter.types === undefined || filter.types.includes(event.eventType)),
      );
    },
    getArtifactEvidence(artifactId) {
      const artifact = artifactsByArtifactId.get(artifactId);
      if (artifact === undefined) {
        throw new UnknownEvidenceEntityError("artifact", String(artifactId));
      }
      return artifact;
    },
    getDatasetEvidence(datasetId) {
      const dataset = datasetsByDatasetId.get(datasetId);
      if (dataset === undefined) {
        throw new UnknownEvidenceEntityError("dataset", String(datasetId));
      }
      return dataset;
    },
    getUncitedEvents() {
      return projection.events.filter((event) => event.citation.kind === "none");
    },
    toProvenanceRecord(eventId) {
      const event = requireEvent(eventId);
      const inputs =
        event.citation.kind === "information-artifact"
          ? [
              // The imported source the payload declares (W028 seam).
              { kind: "artifact" as const, ref: String(event.citation.artifactId) },
              // The import causation — the logical command (W020/W027 law).
              { kind: "command" as const, ref: String(event.causationId) },
            ]
          : [
              // Engine events are command-caused; dataset-cited events are
              // caused by their import — the envelope's own causation either
              // way, carried verbatim (the W016 getProvenance discipline).
              { kind: "command" as const, ref: String(event.causationId) },
            ];
      return {
        subjectEventId: event.eventId,
        producer: event.producer,
        inputs,
        recordedAt: event.recordedAt,
      };
    },
  };
}
