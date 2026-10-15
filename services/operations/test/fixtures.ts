/**
 * Shared fixtures (W061 `services/operations` tests) — REAL imports: every
 * record is built through the genuine `observability` contracts.
 */

import {
  mintAuditRecord,
  mintOperationalEvent,
  type AuditRecord,
  type AuditTrail,
  type OperationalEvent,
  type OpsScope,
  type SourceCitation,
} from "observability";
import { assembleTrail } from "../trail.js";

export const TENANT = "tenant-alpha";
export const PROJECT = "project-one";
export const WORLD = "world-w";

export const WORLD_SCOPE: OpsScope = {
  kind: "tenant-project-world",
  tenantId: TENANT,
  projectId: PROJECT,
  worldId: WORLD,
};

const ACTOR = { kind: "platform" as const, actorId: "platform-core" };

export const DATASET_CITATION = {
  kind: "dataset",
  basis: "import-causation",
  datasetId: "ds-hist-1",
} as unknown as SourceCitation;

export const NO_SOURCE = { kind: "none", reason: "no-declared-source" } as const;
export const NO_SOURCE_CITATION: SourceCitation = NO_SOURCE;

/** Mint one lawful audit record with the given overrides. */
export function mintAudit(
  overrides: Partial<Omit<AuditRecord, "recordId">> = {},
): AuditRecord {
  const sequence = overrides.sequence ?? 1;
  const outcome = mintAuditRecord({
    sequence,
    action: "world-accessed",
    scope: WORLD_SCOPE,
    actor: ACTOR,
    subject: `subject-${sequence}`,
    detail: { route: "evidence-view", code: 200 },
    provenance: sequence % 2 === 0 ? DATASET_CITATION : NO_SOURCE,
    declaredAt: 20_000 + sequence,
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`fixture audit record is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.record;
}

/** One lawful audit record at the given sequence. */
export function auditAt(sequence: number): AuditRecord {
  return mintAudit({ sequence });
}

/** Mint one lawful operational event. */
export function mintEvent(
  overrides: Partial<Omit<OperationalEvent, "eventId">> = {},
): OperationalEvent {
  const sequence = overrides.sequence ?? 1;
  const kind = overrides.kind ?? "dataset-imported";
  const outcome = mintOperationalEvent({
    sequence,
    kind,
    scope: WORLD_SCOPE,
    actor: ACTOR,
    payload:
      kind === "dataset-imported"
        ? { kind, datasetId: "ds-hist-1", recordCount: 10 + sequence }
        : kind === "world-created"
          ? { kind, worldId: WORLD, definitionDigest: "def-digest-1", seed: 7 }
          : { kind: "audit-appended", auditRecordId: `aud-${sequence}`, auditAction: "world-accessed" },
    declaredAt: 10_000 + sequence,
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`fixture event is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.event;
}

/** One lawful operational event at the given sequence + declared time. */
export function eventAt(
  sequence: number,
  declaredAt: number,
  kind: OperationalEvent["kind"] = "dataset-imported",
): OperationalEvent {
  return mintEvent({ sequence, declaredAt, kind });
}

/** A lawful three-record trail (provenance mixed: dataset + honest none). */
export function sampleTrail(): AuditTrail {
  const outcome = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  if (!outcome.ok) {
    throw new Error(`fixture trail is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.trail;
}

/** A lawful four-event stream (three kinds, canonical timestamps). */
export function sampleEvents(): readonly OperationalEvent[] {
  return [
    eventAt(1, 10_001, "world-created"),
    eventAt(2, 10_002, "dataset-imported"),
    eventAt(3, 10_003, "dataset-imported"),
    eventAt(4, 10_004, "audit-appended"),
  ];
}
