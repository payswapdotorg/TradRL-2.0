/**
 * Information-boundary data contracts — what the point-in-time firewall
 * stores and asserts.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — "Historical information must not be
 * observable before `availableAt`."
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md H — an artifact whose `availableAt`
 * is after current simulation time must not be observable.
 * Spec: spec/REQUIREMENTS.md R016 — runtime point-in-time information
 * firewall.
 * Spec: spec/ARCHITECTURE.md §7 "Information world" — artifacts carry id,
 * source, createdAt, availableAt, scope, provenance, version.
 *
 * Composes with W003 exactly: the canonical firewall rule is W003's
 * `isInformationAvailable` (for artifacts, see also
 * ./timeSemantics.ts `isArtifactObservableAt`, which delegates to it). This
 * module adds the stored payload-free records, the boundary-state
 * computation/transitions for `EvidencePort.getInformationBoundary`, and the
 * fail-closed observation assertions engines log on every information read.
 * The single entry-level rule `at >= availableAt` below is that same rule,
 * stated for any availability-carrying entry (artifacts and records).
 */

import type {
  InformationArtifact,
  InformationBoundaryState,
  InformationScope,
  Provenance,
} from "../../src/information.js";
import type {
  InformationArtifactId,
  WorldId,
} from "../../src/ids.js";
import type { TimestampMs } from "../../src/primitives.js";
import type {
  AvailableAtMs,
  SimulationTimeMs,
} from "./timeSemantics.js";
import { asAvailableAt } from "./timeSemantics.js";

// --- what the firewall stores ---------------------------------------------------

/**
 * Minimal availability metadata every boundary-tracked entry carries.
 * `InformationArtifact` (W003) and `InformationRecord` (below) both satisfy
 * it structurally, so one set of boundary laws covers both.
 */
export interface AvailabilityEntry {
  readonly artifactId: InformationArtifactId;
  readonly availableAt: TimestampMs;
}

/**
 * The payload-free record the firewall stores. The boundary may know that a
 * future artifact exists (and verify its content on release via `digest`)
 * without its payload ever being observable — observability is governed
 * solely by `availableAt` (A7).
 */
export interface InformationRecord {
  readonly artifactId: InformationArtifactId;
  readonly worldId: WorldId;
  readonly source: string;
  readonly scope: InformationScope;
  readonly createdAt: TimestampMs;
  readonly availableAt: AvailableAtMs;
  readonly provenance: Provenance;
  readonly version: string;
  /** Optional content digest for verifying the payload upon release. */
  readonly digest?: string;
}

/**
 * Project an artifact into its payload-free record — what the firewall keeps
 * when the payload itself must stay sealed until `availableAt`.
 */
export function informationRecordOf<TPayload>(
  artifact: InformationArtifact<TPayload>,
): InformationRecord {
  return {
    artifactId: artifact.artifactId,
    worldId: artifact.worldId,
    source: artifact.source,
    scope: artifact.scope,
    createdAt: artifact.createdAt,
    availableAt: asAvailableAt(artifact.availableAt),
    provenance: artifact.provenance,
    version: artifact.version,
  };
}

/**
 * The firewall rule for one entry at a point in simulation time — identical
 * to W003's `isInformationAvailable` (which is typed for
 * `InformationArtifact`): observable exactly from `availableAt` onward.
 */
function isEntryAvailableAt(entry: AvailabilityEntry, at: SimulationTimeMs): boolean {
  return at >= entry.availableAt;
}

// --- boundary computation (EvidencePort.getInformationBoundary) -------------------

/**
 * Partition entries into the visible/withheld boundary state at `asOf`
 * (W003's `InformationBoundaryState`). Input order is preserved in both
 * lists — the result is deterministic.
 */
export function computeInformationBoundary<T extends AvailabilityEntry>(
  entries: readonly T[],
  asOf: SimulationTimeMs,
): InformationBoundaryState {
  const visible: InformationArtifactId[] = [];
  const withheld: InformationArtifactId[] = [];
  for (const entry of entries) {
    if (isEntryAvailableAt(entry, asOf)) {
      visible.push(entry.artifactId);
    } else {
      withheld.push(entry.artifactId);
    }
  }
  return { asOf, visible, withheld };
}

/** Entries still withheld at `asOf` (`availableAt > asOf`), in input order. */
export function pendingReleases<T extends AvailabilityEntry>(
  entries: readonly T[],
  asOf: SimulationTimeMs,
): T[] {
  return entries.filter((entry) => !isEntryAvailableAt(entry, asOf));
}

/**
 * The earliest availability among pending entries — the next simulation time
 * at which the boundary changes. The clock can fast-forward to exactly this
 * point; `undefined` when nothing is pending.
 */
export function nextReleaseTime<T extends AvailabilityEntry>(
  entries: readonly T[],
  asOf: SimulationTimeMs,
): AvailableAtMs | undefined {
  const pending = pendingReleases(entries, asOf);
  if (pending.length === 0) {
    return undefined;
  }
  return asAvailableAt(Math.min(...pending.map((entry) => entry.availableAt)));
}

// --- boundary state transitions ----------------------------------------------------

/** The only boundary transition in World Alpha: withheld → visible. */
export type InformationBoundaryTransitionKind = "release";

/**
 * One boundary state transition: `artifactId` crosses from withheld to
 * visible as the clock advances from `fromAsOf` to `toAsOf`, becoming
 * observable at its `availableAt` (fromAsOf < availableAt ≤ toAsOf).
 */
export interface InformationBoundaryTransition {
  readonly kind: InformationBoundaryTransitionKind;
  readonly artifactId: InformationArtifactId;
  readonly availableAt: AvailableAtMs;
  readonly fromAsOf: SimulationTimeMs;
  readonly toAsOf: SimulationTimeMs;
}

/**
 * All transitions occurring when the clock advances `from → to`: every entry
 * with `from < availableAt ≤ to` is released (was withheld at `from`, is
 * visible at `to`). Ordered by `availableAt` (ties keep input order). An
 * empty or backwards window releases nothing.
 */
export function boundaryTransitionsBetween<T extends AvailabilityEntry>(
  entries: readonly T[],
  from: SimulationTimeMs,
  to: SimulationTimeMs,
): InformationBoundaryTransition[] {
  if (to < from) {
    return [];
  }
  return entries
    .filter((entry) => entry.availableAt > from && entry.availableAt <= to)
    .map((entry) => ({
      kind: "release" as const,
      artifactId: entry.artifactId,
      availableAt: asAvailableAt(entry.availableAt),
      fromAsOf: from,
      toAsOf: to,
    }))
    .sort((a, b) => a.availableAt - b.availableAt);
}

/**
 * Apply release transitions to a boundary state, advancing `asOf` to
 * `toAsOf`. Released ids move withheld → visible (appended in withheld
 * order); ids that are already visible, or not tracked by the state, are
 * no-ops (idempotent). Precondition (engine-enforced, see ./clock.ts rewind
 * law): `toAsOf ≥ state.asOf` — in-place backward boundary motion is a
 * rewind (A8).
 */
export function advanceInformationBoundary(
  state: InformationBoundaryState,
  toAsOf: SimulationTimeMs,
  transitions: readonly InformationBoundaryTransition[],
): InformationBoundaryState {
  const released = new Set(
    transitions.filter((t) => t.kind === "release").map((t) => t.artifactId),
  );
  const visibleAfter = [...state.visible];
  const withheldAfter: InformationArtifactId[] = [];
  for (const id of state.withheld) {
    if (released.has(id) && !visibleAfter.includes(id)) {
      visibleAfter.push(id);
    } else {
      withheldAfter.push(id);
    }
  }
  return { asOf: toAsOf, visible: visibleAfter, withheld: withheldAfter };
}

// --- observation assertions (the firewall's proof shape) ----------------------------

/** Why an observation was withheld. Closed set for World Alpha. */
export type ObservationWithheldReason = "before-availableAt";

/**
 * The fail-closed proof an engine returns/logs for one information read at
 * a point in simulation time: either the observation is granted (with the
 * threshold it satisfied), or it is withheld with a reason.
 */
export type ObservationAssertion =
  | {
      readonly kind: "granted";
      readonly artifactId: InformationArtifactId;
      readonly availableAt: AvailableAtMs;
      readonly observedAt: SimulationTimeMs;
    }
  | {
      readonly kind: "withheld";
      readonly artifactId: InformationArtifactId;
      readonly availableAt: AvailableAtMs;
      readonly observedAt: SimulationTimeMs;
      readonly reason: ObservationWithheldReason;
    };

/**
 * Assert one information observation at a point in simulation time (A7/
 * R016/acceptance H). Engines call this on every information read; the
 * assertion is the auditable evidence that the firewall held.
 */
export function assertInformationObservation<T extends AvailabilityEntry>(
  entry: T,
  at: SimulationTimeMs,
): ObservationAssertion {
  const availableAt = asAvailableAt(entry.availableAt);
  if (isEntryAvailableAt(entry, at)) {
    return { kind: "granted", artifactId: entry.artifactId, availableAt, observedAt: at };
  }
  return {
    kind: "withheld",
    artifactId: entry.artifactId,
    availableAt,
    observedAt: at,
    reason: "before-availableAt",
  };
}
