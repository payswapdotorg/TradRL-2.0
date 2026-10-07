/**
 * Information-record → artifact + journal-draft event adapters (W027
 * `tradrl-information`).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" — every imported record maps
 * onto ONE information artifact and ONE journal event draft in the W004
 * envelope shape (`occurredAt` = the record's `publishedAt`, optional
 * delayed `availableAt` carried verbatim, causation/correlation/producer/
 * schema).
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the PUBLICATION-TIME MAPPING LAW:
 * an artifact's `availableAt` is the record's declared `availableAt`, or
 * the record's `publishedAt` when the source declares no delay — an
 * undelayed publication is observable exactly when it is published. Never
 * a wall-time read, never an invented delay, never a silent default.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the mapping is pure: a pure function
 * of (record, position, context); no IO, no clock reads, no RNG.
 *
 * One payload, two channels: the artifact's payload and the journal event's
 * payload are the SAME frozen object, carrying the W028 provenance identity
 * (`InformationArtifactIdentity`: artifact id, dataset id, record digest) —
 * provenance projection can cite either channel and resolve the same
 * identity.
 *
 * Credibility is resolved from the importer's DECLARED source map (validated
 * upstream); the adapter never assigns or upgrades it (no fabricated
 * authority).
 */

import type {
  CausationId,
  CorrelationId,
  InformationArtifactId,
  InstrumentId,
  ProducerId,
  WorldId,
} from "tradrl-world-contracts";
import type {
  InformationArtifact,
  NewsPayload,
  Provenance,
} from "tradrl-world-contracts";
import type {
  InformationDatasetDescriptor,
  InformationImportPayload,
  InformationSourceDeclaration,
  InformationRecord,
  ImportedInformationArtifact,
  SourceCredibility,
} from "tradrl-world-contracts/information-data";
import {
  INFORMATION_IMPORT_PRODUCER,
  INFORMATION_IMPORT_SCHEMA_VERSION,
} from "tradrl-world-contracts/information-data";
import type { PendingEventDraft } from "tradrl-world-sim/journal";
import { stableDigest } from "tradrl-world-sim/world";

/** Feed symbol → instrument mapping; the importer declares it, never the adapter. */
export type RecordSymbolMap = Readonly<Record<string, InstrumentId>>;

/**
 * The deterministic mapping context of one information import: identities
 * are derived purely from the dataset id and the declared sources (same
 * dataset ⇒ same ids — no wall time, no randomness anywhere).
 */
export interface InformationImportContext {
  readonly datasetId: InformationDatasetDescriptor["datasetId"];
  /** The causation identity of the import itself (`import:<datasetId>`). */
  readonly causationId: CausationId;
  /** Correlation id shared by every event of one import (one logical flow). */
  readonly correlationId: CorrelationId;
  readonly producer: ProducerId;
  readonly schemaVersion: string;
  /** Resolve a declared source's credibility (validated upstream). */
  readonly credibilityOf: (source: string) => SourceCredibility;
  /** Resolve a feed symbol to its instrument (undefined when unmapped). */
  readonly instrumentOf: (symbol: string) => InstrumentId | undefined;
  /** Artifact id: the record's source id, or the deterministic derived id. */
  readonly artifactIdFor: (sourceId: string | undefined, position: number) => InformationArtifactId;
  /** Deterministic content digest of one source record (A9). */
  readonly recordDigestOf: (record: InformationRecord) => string;
}

/** Build the mapping context of one import (pure in descriptor + declarations + map). */
export function buildInformationImportContext(
  descriptor: InformationDatasetDescriptor,
  sources: readonly InformationSourceDeclaration[],
  symbolMap: RecordSymbolMap,
): InformationImportContext {
  const importId = `import:${String(descriptor.datasetId)}`;
  const credibilityBySource = new Map(
    sources.map((declaration) => [declaration.source, declaration.credibility]),
  );
  return {
    datasetId: descriptor.datasetId,
    causationId: importId as CausationId,
    correlationId: importId as CorrelationId,
    producer: INFORMATION_IMPORT_PRODUCER,
    schemaVersion: INFORMATION_IMPORT_SCHEMA_VERSION,
    credibilityOf: (source) => credibilityBySource.get(source) as SourceCredibility,
    instrumentOf: (symbol) => symbolMap[symbol] as InstrumentId | undefined,
    artifactIdFor: (sourceId, position) =>
      (sourceId === undefined
        ? `${String(descriptor.datasetId)}:a:${String(position)}`
        : sourceId) as InformationArtifactId,
    recordDigestOf: (record) => stableDigest(record),
  };
}

/** Deep-freeze the plain payloads the adapter constructs (W020 discipline). */
function freezePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezePlain)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    const frozen: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      frozen[key] = entry === undefined ? undefined : freezePlain(entry);
    }
    return Object.freeze(frozen) as unknown as T;
  }
  return value;
}

/** Resolve the record's feed symbols to instruments (order preserved, verbatim). */
function instrumentsOf(
  record: InformationRecord,
  context: InformationImportContext,
): readonly InstrumentId[] | undefined {
  if (record.symbols === undefined) {
    return undefined;
  }
  return record.symbols.map((symbol) => context.instrumentOf(symbol) as InstrumentId);
}

/**
 * Map one (validated) information record at its 1-based position to its
 * artifact + journal event draft. Pure and deterministic: the same (record,
 * position, context) always yields the bit-identical pair. Callers MUST
 * validate first (`./validate.js`); the adapter never fabricates a field the
 * record lacks — credibility comes from the declared source map, instrument
 * ids from the symbol map, availability from the record.
 */
export function informationRecordToArtifactAndDraft(
  record: InformationRecord,
  position: number,
  context: InformationImportContext,
  worldId: WorldId,
): { readonly artifact: ImportedInformationArtifact; readonly draft: PendingEventDraft } {
  const artifactId = context.artifactIdFor(record.sourceId, position);
  const recordDigest = context.recordDigestOf(record);
  const credibility = context.credibilityOf(record.source);
  const instruments = instrumentsOf(record, context);
  const availableAt = record.availableAt ?? record.publishedAt;
  const provenance: Provenance = {
    producer: context.producer,
    inputs: [
      `dataset:${String(context.datasetId)}`,
      `record:${recordDigest}`,
    ],
    recordedAt: availableAt,
  };
  const identity = { artifactId, datasetId: context.datasetId, recordDigest };
  const payload: InformationImportPayload = freezePlain(
    record.kind === "news"
      ? {
          type: "information.news.published" as const,
          identity,
          source: record.source,
          credibility,
          headline: record.headline,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
          ...(instruments === undefined ? {} : { instruments }),
          ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
        }
      : record.kind === "event"
        ? {
            type: "information.event.published" as const,
            identity,
            source: record.source,
            credibility,
            headline: record.headline,
            ...(record.summary === undefined ? {} : { summary: record.summary }),
            ...(instruments === undefined ? {} : { instruments }),
            ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
            ...(record.eventType === undefined ? {} : { eventType: record.eventType }),
            ...(record.scheduledFor === undefined ? {} : { scheduledFor: record.scheduledFor }),
          }
        : record.kind === "research-report"
          ? {
              type: "information.research.published" as const,
              identity,
              source: record.source,
              credibility,
              headline: record.headline,
              ...(record.summary === undefined ? {} : { summary: record.summary }),
              ...(instruments === undefined ? {} : { instruments }),
              ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
              ...(record.rating === undefined ? {} : { rating: record.rating }),
              ...(record.targetPrice === undefined ? {} : { targetPrice: record.targetPrice }),
            }
          : {
              type: "information.analyst-note.published" as const,
              identity,
              source: record.source,
              credibility,
              headline: record.headline,
              ...(record.summary === undefined ? {} : { summary: record.summary }),
              ...(instruments === undefined ? {} : { instruments }),
              ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
              ...(record.rating === undefined ? {} : { rating: record.rating }),
              ...(record.targetPrice === undefined ? {} : { targetPrice: record.targetPrice }),
            },
  );
  // The artifact envelope: every timing field comes from the record
  // (createdAt = publishedAt, availableAt per the publication-time law).
  const artifact = Object.freeze({
    artifactId,
    worldId,
    source: record.source,
    createdAt: record.publishedAt,
    availableAt,
    scope: record.kind,
    provenance,
    version: INFORMATION_IMPORT_SCHEMA_VERSION,
    payload,
  }) as ImportedInformationArtifact;
  const draft: PendingEventDraft = {
    eventType: payload.type,
    occurredAt: record.publishedAt,
    ...(record.availableAt === undefined ? {} : { availableAt: record.availableAt }),
    causationId: context.causationId,
    correlationId: context.correlationId,
    producer: context.producer,
    schemaVersion: context.schemaVersion,
    payload,
  };
  return { artifact, draft };
}

/**
 * Project imported artifacts onto the world-definition surface
 * (`WorldDefinition.informationArtifacts`, typed
 * `InformationArtifact<NewsPayload>[]`): every W027 payload structurally
 * satisfies `NewsPayload` BY CONSTRUCTION (see `contracts/information-data`),
 * so this is an identity-preserving view — no field is dropped, rewritten
 * or invented, and the A7 firewall (`isArtifactObservableAt`) governs the
 * result exactly as it governs hand-authored news artifacts.
 */
export function toDefinitionInformationArtifacts(
  artifacts: readonly ImportedInformationArtifact[],
): readonly InformationArtifact<NewsPayload>[] {
  return artifacts as readonly InformationArtifact<NewsPayload>[];
}
