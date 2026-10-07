/**
 * Source-citation resolution (W028 `tradrl-evidence`) — the PURE law that
 * turns one journal event envelope into its declared source citation.
 *
 * Spec: spec/WORK-ITEMS.md W028 — "given a world's journal + its imported
 * information artifacts (W027) + datasets (W020), project the EVIDENCE VIEW:
 * which facts (journal events) cite which sources (artifact/dataset/record
 * identities)". The citation link is ONLY what the existing surfaces
 * honestly declare — this module never fabricates one:
 *
 * - W027 information events (`information.*.published`) carry the stable
 *   typed `InformationArtifactIdentity` (artifact id, dataset id, record
 *   digest) ON THE PAYLOAD, identical across the definition-artifact
 *   channel and the journal-event channel (the W028 seam W027 declared) —
 *   that payload identity IS the citation, basis `payload-identity`.
 * - W020 historical-import events (`market.quote.updated`,
 *   `market.trade.printed`, `market.bar.closed`, producer
 *   `historical-data-import`) carry NO per-record identity on the payload
 *   (the W004 canonical payloads) — the dataset identity is declared by the
 *   import CAUSATION (`import:<datasetId>`, the logical command the W020
 *   adapter stamps on every imported event) — basis `import-causation`.
 *   This is an HONEST dataset-level citation: the current W020 surface
 *   exposes no per-event record digest, so none is invented.
 * - Every other event (engine core, matching, generator, clock …) declares
 *   no imported source — the honest `no-declared-source` marker, never a
 *   fabricated citation. The envelope's own causation (command or import)
 *   is carried verbatim by the projection (see `EventEvidence`), not
 *   invented here.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — pure and deterministic: the same
 * envelope always resolves to the same citation (or the same violation); no
 * IO, no clock reads, no RNG.
 */

import type {
  InformationArtifactId,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { DatasetId } from "tradrl-world-contracts/data";
import {
  INFORMATION_IMPORT_EVENT_TYPES,
  INFORMATION_IMPORT_PRODUCER,
  SOURCE_CREDIBILITIES,
  type InformationArtifactIdentity,
  type SourceCredibility,
} from "tradrl-world-contracts/information-data";
import { HISTORICAL_IMPORT_PRODUCER } from "tradrl-world-contracts/data";
import type { EvidenceViolation } from "./errors.js";

/**
 * The citation of one journal event to its declared imported source.
 *
 * `basis` discloses WHERE the link comes from — the honest derivation
 * channel, so an auditor can tell a payload-declared artifact identity from
 * a causation-declared dataset identity at a glance.
 */
export type SourceCitation =
  | {
      /** The event's payload declares a W027 imported-artifact identity. */
      readonly kind: "information-artifact";
      readonly basis: "payload-identity";
      readonly artifactId: InformationArtifactId;
      readonly datasetId: DatasetId;
      readonly recordDigest: string;
      /** The payload's declared source name, carried verbatim when a string. */
      readonly source?: string;
      /** The payload's declared credibility, carried verbatim when valid. */
      readonly credibility?: SourceCredibility;
    }
  | {
      /**
       * The event's import causation declares its dataset (W020 law:
       * `import:<datasetId>`). Dataset-level only — the W020 event surface
       * carries no per-record digest, and none is invented.
       */
      readonly kind: "dataset";
      readonly basis: "import-causation";
      readonly datasetId: DatasetId;
    }
  | {
      /** No imported source is declared — the honest marker, never fabricated. */
      readonly kind: "none";
      readonly reason: "no-declared-source";
    };

/** One resolution step: a citation, or the typed violation that blocks one. */
export type CitationResolution =
  | { readonly ok: true; readonly citation: SourceCitation }
  | { readonly ok: false; readonly violation: EvidenceViolation };

/**
 * Structural guard for the W028 provenance seam
 * (`InformationArtifactIdentity`): an object whose artifactId, datasetId and
 * recordDigest are all non-empty strings. Anything else that is PRESENT on a
 * payload is malformed — a violation, never a partial citation.
 */
export function isInformationArtifactIdentity(
  value: unknown,
): value is InformationArtifactIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.artifactId === "string" &&
    candidate.artifactId.length > 0 &&
    typeof candidate.datasetId === "string" &&
    candidate.datasetId.length > 0 &&
    typeof candidate.recordDigest === "string" &&
    candidate.recordDigest.length > 0
  );
}

/** Parse the W020/W027 import causation id (`import:<datasetId>`). */
function datasetIdOfImportCausation(
  causationId: string,
): DatasetId | undefined {
  const match = /^import:(.+)$/.exec(causationId);
  return match === null ? undefined : (match[1] as DatasetId);
}

function isInformationImportEventType(eventType: string): boolean {
  return (INFORMATION_IMPORT_EVENT_TYPES as readonly string[]).includes(eventType);
}

function violation(
  kind: EvidenceViolation["kind"],
  detail: string,
): CitationResolution {
  return { ok: false, violation: { kind, detail } };
}

/**
 * Resolve the source citation of ONE journal event envelope — pure and
 * total: the same envelope always yields the same citation or the same
 * typed violation (A9). Violations are returned, not thrown, so a
 * projection can collect the COMPLETE list across a whole journal (the W004
 * `validateEventStream` discipline); `projectEvidence` throws them as one
 * `EvidenceProjectionError`.
 */
export function resolveSourceCitation(envelope: WorldEventEnvelope): CitationResolution {
  const payload: unknown = envelope.payload;

  if (isInformationImportEventType(envelope.eventType)) {
    const identity: unknown =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).identity
        : undefined;
    if (identity !== undefined) {
      if (!isInformationArtifactIdentity(identity)) {
        return violation(
          "malformed-identity",
          `event ${String(envelope.eventId)} (${envelope.eventType}): payload identity is present but malformed`,
        );
      }
      const riders =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      const source = typeof riders.source === "string" ? riders.source : undefined;
      const credibility =
        typeof riders.credibility === "string" &&
        (SOURCE_CREDIBILITIES as readonly string[]).includes(riders.credibility)
          ? (riders.credibility as SourceCredibility)
          : undefined;
      return {
        ok: true,
        citation: {
          kind: "information-artifact",
          basis: "payload-identity",
          artifactId: identity.artifactId,
          datasetId: identity.datasetId,
          recordDigest: identity.recordDigest,
          ...(source === undefined ? {} : { source }),
          ...(credibility === undefined ? {} : { credibility }),
        },
      };
    }
    if (envelope.producer === INFORMATION_IMPORT_PRODUCER) {
      // The W027 law: every imported information payload carries the
      // identity — an import-produced event without one is a law violation.
      return violation(
        "information-event-without-identity",
        `event ${String(envelope.eventId)} (${envelope.eventType}): producer ${String(
          envelope.producer,
        )} declares an information import but the payload carries no provenance identity`,
      );
    }
    // A foreign producer publishing an information-typed event with no
    // identity declares no imported source — the honest none, never guessed.
    return { ok: true, citation: { kind: "none", reason: "no-declared-source" } };
  }

  if (envelope.producer === HISTORICAL_IMPORT_PRODUCER) {
    const datasetId = datasetIdOfImportCausation(String(envelope.causationId));
    if (datasetId === undefined) {
      // The W020 law: every imported historical event is caused by
      // `import:<datasetId>` — anything else cannot be cited honestly.
      return violation(
        "unresolvable-import-causation",
        `event ${String(envelope.eventId)} (${envelope.eventType}): producer ${String(
          envelope.producer,
        )} with causation ${String(envelope.causationId)} does not declare a dataset`,
      );
    }
    return {
      ok: true,
      citation: { kind: "dataset", basis: "import-causation", datasetId },
    };
  }

  if (envelope.producer === INFORMATION_IMPORT_PRODUCER) {
    // The W027 adapter emits exactly the taxonomy types; an import-produced
    // event of any other type contradicts the import law.
    return violation(
      "information-event-outside-taxonomy",
      `event ${String(envelope.eventId)} (${envelope.eventType}): producer ${String(
        envelope.producer,
      )} outside the information-import event taxonomy`,
    );
  }

  // Engine core, matching, generator, clock … events: no imported source is
  // declared — the honest marker. The causation (command or import) rides
  // verbatim on the envelope and is projected by `projectEvidence`.
  return { ok: true, citation: { kind: "none", reason: "no-declared-source" } };
}

/** Type guard: does this citation point at an imported artifact? */
export function isArtifactCitation(
  citation: SourceCitation,
): citation is Extract<SourceCitation, { kind: "information-artifact" }> {
  return citation.kind === "information-artifact";
}

/** Type guard: does this citation point at a dataset directly? */
export function isDatasetCitation(
  citation: SourceCitation,
): citation is Extract<SourceCitation, { kind: "dataset" }> {
  return citation.kind === "dataset";
}

/** The dataset a citation contributes to (artifact citations cite THROUGH their dataset). */
export function citedDatasetIdOf(citation: SourceCitation): DatasetId | undefined {
  if (citation.kind === "information-artifact" || citation.kind === "dataset") {
    return citation.datasetId;
  }
  return undefined;
}
