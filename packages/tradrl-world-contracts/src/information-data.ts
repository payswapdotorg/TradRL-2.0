/**
 * Research/news/event information-import contracts — the W027
 * `contracts/information-data` surface (consumed by the `tradrl-information`
 * package; the export path `tradrl-world-contracts/information-data`).
 *
 * Spec: spec/WORK-ITEMS.md W027 — "Research/news/event information world":
 * research-report and news/event artifacts as FIRST-CLASS importable
 * datasets (the W020 pattern applied to information) — typed records,
 * dataset descriptors, deterministic import to the world's information
 * artifacts behind the A7 firewall.
 * Spec: spec/ARCHITECTURE.md §7 "Information world" — every artifact has
 * id, source, createdAt, availableAt, scope, provenance, version.
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — "Historical information must not be
 * observable before `availableAt`." Availability is PART OF THE RECORD:
 * carried verbatim, never invented, never defaulted, never derived from
 * wall time. An UNDELAYED publication is observable exactly from its
 * `publishedAt` (the publication-time mapping law — see the loader).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism; the import transform is
 * a pure function of (descriptor, records, source declarations, symbol map,
 * world id).
 * Spec: spec/SIMULATION.md "Fidelity declarations" — dataset descriptors
 * declare source, covered range, granularity, known gaps, known limitations
 * and a determinism declaration; declarations are honest.
 *
 * Boundary laws:
 * - Every W027 payload EXTENDS the W003 `NewsPayload` (headline, summary,
 *   instruments), so every imported artifact rides the existing
 *   `WorldDefinition.informationArtifacts` surface (typed
 *   `InformationArtifact<NewsPayload>[]`) unchanged — kind-specific fields
 *   (rating, target price, schedule, credibility) ride along inside the
 *   payload, and the W004 `isArtifactObservableAt` firewall governs the
 *   whole family exactly as it governs hand-authored news.
 * - The PRODUCER of every imported information event is the
 *   information-import producer (honest provenance: this artifact came from
 *   a dataset import, not from a live wire).
 * - Credibility is DECLARED by the importer per source (never assigned by
 *   the adapter — no fabricated authority); a record citing an undeclared
 *   source is a loud typed violation, never a silent default.
 *
 * W028 seam (evidence/provenance projection — packages/tradrl-evidence/):
 * every imported artifact carries a stable typed identity
 * (`InformationArtifactIdentity`: artifact id, dataset id, record digest) on
 * its payload, identical across the definition-artifact channel and the
 * journal-event channel, so provenance projection can cite it. The
 * projection itself is W028's surface and is NOT implemented here.
 */

import type { InformationArtifactId, ProducerId } from "./ids.js";
import type { Price, TimestampMs } from "./primitives.js";
import type { InformationArtifact } from "./information.js";
import type { NewsPayload } from "./market.js";
import type {
  DatasetGap,
  DatasetId,
  DatasetRange,
  DatasetSource,
} from "./data.js";
import type { DeterminismDeclaration } from "./world.js";

// --- dataset identity and fidelity declarations (the W020 family) ----------------

/**
 * The record kinds an information dataset contains. `DatasetId`,
 * `DatasetSource`, `DatasetRange`, `DatasetGap` and
 * `DeterminismDeclaration` are reused from the W020 `contracts/data`
 * surface — one dataset identity/declaration family across the program.
 */
export type InformationRecordKind =
  | "research-report"
  | "news"
  | "event"
  | "analyst-note";

/**
 * The dataset descriptor — the fidelity declaration of one information
 * dataset (SIMULATION.md "Fidelity declarations"). Same declaration shape
 * as the W020 `DatasetDescriptor`, with information record kinds.
 */
export interface InformationDatasetDescriptor {
  readonly datasetId: DatasetId;
  readonly source: DatasetSource;
  readonly range: DatasetRange;
  /** Kinds the dataset claims to contain (records of other kinds are rejected). */
  readonly recordKinds: readonly InformationRecordKind[];
  /**
   * Declared publication cadence/scale, e.g. "event-driven", "daily" — the
   * honest scale statement (the W020 `granularity` law).
   */
  readonly granularity: string;
  /** Known absences inside `range` (half-open intervals). */
  readonly knownGaps: readonly DatasetGap[];
  /** Known limitations — the honest disclosure channel. */
  readonly limitations: readonly string[];
  /** Determinism declaration (A9: nondeterministic sources are declared). */
  readonly determinism: DeterminismDeclaration;
}

// --- source credibility and record confidence (declared, never fabricated) --------

/**
 * The closed set of credibility classes a source can be DECLARED with.
 * The importer declares each source's class honestly; the adapter never
 * assigns, upgrades or defaults credibility (no fabricated authority).
 */
export const SOURCE_CREDIBILITIES = [
  "official",
  "primary-media",
  "analyst",
  "vendor-model",
  "unattributed",
] as const;

export type SourceCredibility = (typeof SOURCE_CREDIBILITIES)[number];

/**
 * The importer's declaration for one record source: which credibility class
 * the source is honestly claimed to hold, plus an optional attribution note
 * (e.g. licensing). Records citing an undeclared source are rejected.
 */
export interface InformationSourceDeclaration {
  /** The source name exactly as records cite it (e.g. "acme-research"). */
  readonly source: string;
  readonly credibility: SourceCredibility;
  readonly note?: string;
}

/**
 * The closed set of confidence levels a record can carry. This is the
 * SOURCE'S own stated confidence in its content, carried verbatim from the
 * record — optional, and never derived or interpolated.
 */
export const INFORMATION_CONFIDENCES = ["high", "medium", "low"] as const;

export type InformationConfidence = (typeof INFORMATION_CONFIDENCES)[number];

// --- typed information records (availability is part of the record) ---------------

/** Fields shared by every information record (the W020 record law, adapted). */
interface InformationRecordBase {
  /** The record's source, exactly as the feed cites it (must be declared). */
  readonly source: string;
  /**
   * Source-stable record id (e.g. a wire id). When present it becomes the
   * artifact id verbatim and must be unique in the import; when absent the
   * adapter derives `<datasetId>:a:<position>` deterministically.
   */
  readonly sourceId?: string;
  /** Publication timestamp — the event-time basis (occurredAt), never invented. */
  readonly publishedAt: TimestampMs;
  readonly headline: string;
  /** Body summary, when the feed carries one. */
  readonly summary?: string;
  /** Feed symbols the record is about (mapped to InstrumentIds at import). */
  readonly symbols?: readonly string[];
  /** The source's own stated confidence, verbatim (optional). */
  readonly confidence?: InformationConfidence;
  /** Earliest legal observation time, when the source declares a delay (A7). */
  readonly availableAt?: TimestampMs;
}

/** A research report: long-form analysis, optionally rated with a target. */
export interface ResearchReportRecord extends InformationRecordBase {
  readonly kind: "research-report";
  /** Rating, verbatim from the source (e.g. "overweight") — never normalized. */
  readonly rating?: string;
  /** Price target, canonical decimal text, verbatim from the source. */
  readonly targetPrice?: Price;
}

/** A news item: wire-report timing of a development. */
export interface NewsItemRecord extends InformationRecordBase {
  readonly kind: "news";
}

/** A calendar/macro event: scheduled or reported event timing. */
export interface EventRecord extends InformationRecordBase {
  readonly kind: "event";
  /** Event classification, verbatim from the source (e.g. "earnings-release"). */
  readonly eventType?: string;
  /** The scheduled time, when the source declares one (part of the record). */
  readonly scheduledFor?: TimestampMs;
}

/** An analyst note: short-form analyst commentary, optionally with a target. */
export interface AnalystNoteRecord extends InformationRecordBase {
  readonly kind: "analyst-note";
  readonly rating?: string;
  readonly targetPrice?: Price;
}

/** Discriminated union of importable information records. */
export type InformationRecord =
  | ResearchReportRecord
  | NewsItemRecord
  | EventRecord
  | AnalystNoteRecord;

// --- the W028 provenance seam: stable typed identity -------------------------------

/**
 * The stable typed identity of one imported information artifact — the W028
 * evidence/provenance citation seam. `recordDigest` is the deterministic
 * content digest of the source record (same input ⇒ same digest, A9), so a
 * citation survives re-import and pins the exact record content. Carried on
 * every W027 payload, identical across the definition-artifact and
 * journal-event channels. The provenance projection that CITES it is W028's
 * surface (packages/tradrl-evidence/) and is deliberately not built here.
 */
export interface InformationArtifactIdentity {
  readonly artifactId: InformationArtifactId;
  readonly datasetId: DatasetId;
  readonly recordDigest: string;
}

// --- the imported-artifact payload taxonomy (W027 extension of the news family) ----

/**
 * Closed set of journal event types the information-import producer emits
 * (one per record kind; the payload `type` discriminant matches). Additions
 * go through a contract change.
 */
export const INFORMATION_IMPORT_EVENT_TYPES = [
  "information.news.published",
  "information.research.published",
  "information.event.published",
  "information.analyst-note.published",
] as const;

export type InformationImportEventType =
  (typeof INFORMATION_IMPORT_EVENT_TYPES)[number];

/** The producer identity for imported information artifacts/events. */
export const INFORMATION_IMPORT_PRODUCER = "information-data-import" as ProducerId;

/** Schema version stamped on every imported information artifact/event. */
export const INFORMATION_IMPORT_SCHEMA_VERSION = "tradrl-information.import@1";

/**
 * Payload of an imported news artifact. Extends the W003 `NewsPayload` so
 * the artifact rides `definition.informationArtifacts` / `QueryPort.getNews`
 * unchanged; timing lives on the artifact/envelope, never the payload.
 */
export interface InformationNewsPayload extends NewsPayload {
  readonly type: "information.news.published";
  readonly identity: InformationArtifactIdentity;
  readonly source: string;
  readonly credibility: SourceCredibility;
  readonly confidence?: InformationConfidence;
}

/** Payload of an imported research-report artifact. */
export interface InformationResearchPayload extends NewsPayload {
  readonly type: "information.research.published";
  readonly identity: InformationArtifactIdentity;
  readonly source: string;
  readonly credibility: SourceCredibility;
  readonly confidence?: InformationConfidence;
  readonly rating?: string;
  readonly targetPrice?: Price;
}

/** Payload of an imported event artifact (calendar/macro timing). */
export interface InformationEventPayload extends NewsPayload {
  readonly type: "information.event.published";
  readonly identity: InformationArtifactIdentity;
  readonly source: string;
  readonly credibility: SourceCredibility;
  readonly confidence?: InformationConfidence;
  readonly eventType?: string;
  readonly scheduledFor?: TimestampMs;
}

/** Payload of an imported analyst-note artifact. */
export interface InformationAnalystNotePayload extends NewsPayload {
  readonly type: "information.analyst-note.published";
  readonly identity: InformationArtifactIdentity;
  readonly source: string;
  readonly credibility: SourceCredibility;
  readonly confidence?: InformationConfidence;
  readonly rating?: string;
  readonly targetPrice?: Price;
}

/** Discriminated union of information-import payloads. */
export type InformationImportPayload =
  | InformationNewsPayload
  | InformationResearchPayload
  | InformationEventPayload
  | InformationAnalystNotePayload;

// --- the imported information artifacts (both channels, one payload) ---------------

/** An imported news artifact. */
export type ImportedNewsArtifact = InformationArtifact<InformationNewsPayload>;
/** An imported research-report artifact. */
export type ImportedResearchArtifact =
  InformationArtifact<InformationResearchPayload>;
/** An imported event artifact. */
export type ImportedEventArtifact = InformationArtifact<InformationEventPayload>;
/** An imported analyst-note artifact. */
export type ImportedAnalystNoteArtifact =
  InformationArtifact<InformationAnalystNotePayload>;

/** Discriminated union of imported information artifacts. */
export type ImportedInformationArtifact =
  | ImportedNewsArtifact
  | ImportedResearchArtifact
  | ImportedEventArtifact
  | ImportedAnalystNoteArtifact;

/**
 * Every W027 payload structurally satisfies `NewsPayload` by construction,
 * so the full imported artifact set is assignable to the world definition's
 * `informationArtifacts` surface without transformation — this type is the
 * honest declaration of that law (no data is dropped or rewritten).
 */
export type DefinitionInformationArtifacts = readonly InformationArtifact<NewsPayload>[];
