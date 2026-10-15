/**
 * Shared fixtures (W061 `observability` tests) — REAL contract builders:
 * every record is built through the genuine types; no shims, no stubs.
 */

import type { SourceCitation } from "tradrl-evidence";
import type {
  AuditRecord,
  OpsActor,
  OpsScope,
  OperationalEvent,
} from "../index.js";

export const TENANT = "tenant-alpha";
export const PROJECT = "project-one";
export const WORLD = "world-w";

/** A full §14 world scope (the strictest scope kind). */
export function worldScope(): OpsScope {
  return {
    kind: "tenant-project-world",
    tenantId: TENANT,
    projectId: PROJECT,
    worldId: WORLD,
  };
}

/** A tenant-only scope (the narrowest scope kind). */
export function tenantScope(): OpsScope {
  return { kind: "tenant", tenantId: TENANT };
}

/** The platform actor (closed vocabulary member). */
export function platformActor(): OpsActor {
  return { kind: "platform", actorId: "platform-core" };
}

/** A W028 dataset citation (import-causation basis; branded ids cast). */
export const DATASET_CITATION = {
  kind: "dataset",
  basis: "import-causation",
  datasetId: "ds-hist-1",
} as unknown as SourceCitation;

/** A W028 information-artifact citation (payload-identity basis; branded ids cast). */
export const ARTIFACT_CITATION = {
  kind: "information-artifact",
  basis: "payload-identity",
  artifactId: "ia-1",
  datasetId: "ds-info-1",
  recordDigest: "record-digest-1",
} as unknown as SourceCitation;

/** The honest W028 no-declared-source marker. */
export const NO_SOURCE: SourceCitation = {
  kind: "none",
  reason: "no-declared-source",
};

let eventCounter = 0;

/** A lawful world-created event declaration (sequence advances per call). */
export function eventDeclaration(
  overrides: Partial<Omit<OperationalEvent, "eventId">> = {},
): Omit<OperationalEvent, "eventId"> {
  eventCounter += 1;
  return {
    sequence: eventCounter,
    kind: "world-created",
    scope: worldScope(),
    actor: platformActor(),
    payload: {
      kind: "world-created",
      worldId: WORLD,
      definitionDigest: "def-digest-1",
      seed: 7,
    },
    declaredAt: 10_000 + eventCounter,
    ...overrides,
  };
}

/** A dataset-imported event declaration (a second payload shape). */
export function datasetEventDeclaration(
  overrides: Partial<Omit<OperationalEvent, "eventId">> = {},
): Omit<OperationalEvent, "eventId"> {
  return eventDeclaration({
    kind: "dataset-imported",
    payload: {
      kind: "dataset-imported",
      datasetId: "ds-hist-1",
      recordCount: 12,
    },
    ...overrides,
  });
}

let auditCounter = 0;

/** A lawful world-accessed audit-record declaration (provenance cited). */
export function auditDeclaration(
  overrides: Partial<Omit<AuditRecord, "recordId">> = {},
): Omit<AuditRecord, "recordId"> {
  auditCounter += 1;
  return {
    sequence: auditCounter,
    action: "world-accessed",
    scope: worldScope(),
    actor: platformActor(),
    subject: `subject-${auditCounter}`,
    detail: { route: "evidence-view", code: 200 },
    provenance: DATASET_CITATION,
    declaredAt: 20_000 + auditCounter,
    ...overrides,
  };
}

/** Reset the fixture counters (deterministic twin reuse). */
export function resetFixtureCounters(): void {
  eventCounter = 0;
  auditCounter = 0;
}
