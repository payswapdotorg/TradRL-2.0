/**
 * Information-world and information-boundary contracts.
 *
 * Spec: spec/ARCHITECTURE.md §7 "Information world" — every information
 * artifact has: id, source, createdAt, availableAt, scope, provenance,
 * version.
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — "Historical information must not be
 * observable before `availableAt`."
 * Spec: spec/REQUIREMENTS.md R016 — runtime point-in-time information
 * firewall.
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md H — an artifact whose `availableAt`
 * is after current simulation time must not be observable.
 *
 * The boundary predicate `isInformationAvailable` is the canonical,
 * engine-independent statement of the firewall: an artifact is observable
 * exactly from its `availableAt` onward.
 */

import type {
  InformationArtifactId,
  ProducerId,
  WorldId,
} from "./ids.js";
import type { TimestampMs } from "./primitives.js";

/** Opaque scope tag for information artifacts (e.g. "market", "news"). */
export type InformationScope = string;

/**
 * Provenance of an information artifact: who produced it and from which
 * inputs (ARCHITECTURE.md §7; no private model chain-of-thought is stored —
 * ARCHITECTURE.md §10 Evidence).
 */
export interface Provenance {
  readonly producer: ProducerId;
  readonly inputs?: readonly string[];
  readonly recordedAt: TimestampMs;
}

/**
 * An information artifact. `availableAt` is REQUIRED and is the earliest
 * legal observation time for this artifact (A7: point-in-time firewall).
 */
export interface InformationArtifact<TPayload = unknown> {
  readonly artifactId: InformationArtifactId;
  readonly worldId: WorldId;
  readonly source: string;
  readonly createdAt: TimestampMs;
  readonly availableAt: TimestampMs;
  readonly scope: InformationScope;
  readonly provenance: Provenance;
  readonly version: string;
  readonly payload: TPayload;
}

/**
 * Information-boundary report for a point in time: which artifacts are
 * visible and which are withheld (EvidencePort.getInformationBoundary).
 */
export interface InformationBoundaryState {
  readonly asOf: TimestampMs;
  readonly visible: readonly InformationArtifactId[];
  readonly withheld: readonly InformationArtifactId[];
}

/**
 * The information firewall (R016). True exactly when `at` is on or after the
 * artifact's `availableAt`. Engines and projections MUST use this rule; no
 * consumer may observe an artifact earlier.
 */
export function isInformationAvailable<TPayload>(
  artifact: InformationArtifact<TPayload>,
  at: TimestampMs,
): boolean {
  return at >= artifact.availableAt;
}

/** Filter a set of artifacts down to the observable subset at `at`. */
export function filterObservableArtifacts<TPayload>(
  artifacts: readonly InformationArtifact<TPayload>[],
  at: TimestampMs,
): InformationArtifact<TPayload>[] {
  return artifacts.filter((artifact) => isInformationAvailable(artifact, at));
}
