/**
 * The W064 reference-journey FACTS — ONE fixed, fully deterministic §14
 * scope for the WHOLE journey (the populations fixture family's own scope:
 * the W041→W042→W043→W044→W045→W046 chain's own identity, the proven
 * W055 fixture-chain scope) plus the journey's declaring principal (the
 * W058 grantee vocabulary: {tenantId, principalId}), and every declared
 * constant the later stages cite. No clocks, no randomness, no env reads
 * (A9); every number below is either a DECLARED input (the gates accept it
 * as declared data) or is carried by a composed record (A6).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { SCOPE as POPULATION_SCOPE } from "../../services/populations/test/fixtures.js";

/** The journey's ONE §14 scope — the fixture family's own (tenant explicit,
 * R056: the tenant is part of every record's canonical identity). */
export const SCOPE = {
  tenantId: POPULATION_SCOPE.tenantId,
  projectId: POPULATION_SCOPE.projectId,
  worldId: POPULATION_SCOPE.worldId,
} as const;

/** The journey's declaring principal (§14's {tenantId, principalId} tuple —
 * the W058 entitlement grantee / W060 security declarer vocabulary). */
export const PRINCIPAL = {
  tenantId: POPULATION_SCOPE.tenantId,
  principalId: "principal-reference-journey",
} as const;

// --- The commerce facts (W058 — declared data, never re-scored) -----------

/** The licensing terms the journey's marketplace offer is listed under. */
export const LISTING_TERMS = {
  model: "per-use",
  billingPeriod: "monthly",
  price: { amount: 42, currency: "USD" },
} as const;

/** The entitlement period (declared ticks — explicit, never a clock read). */
export const ENTITLEMENT_PERIOD = {
  kind: "fixed-window",
  startAt: 1_700_000_000_000,
  endAt: 1_700_003_600_000,
} as const;

/** The declared tick of the journey's one entitlement use. */
export const ENTITLEMENT_USE_AT = 1_700_001_800_000;

// --- The security facts (W060 — declared data) ----------------------------

/** The secret-custody requirement the journey's policy declares. */
export const CUSTODY = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant"],
  redaction: "everywhere",
} as const;

/** The required §14 scope kind (W059's closed hierarchy — the world kind:
 * the journey's records all live at tenant/project/world explicitness). */
export const REQUIRED_SCOPE_KIND = "tenant-project-world";

// --- The observability facts (W061 — declared data) -----------------------

/** The ops actor of every journey event/audit record. */
export const OPS_ACTOR = { kind: "platform", actorId: "platform-core" } as const;

/** The declared timestamp base of the journey's operational events. */
export const EVENT_DECLARED_AT = 10_000;

/** The declared timestamp base of the journey's audit records. */
export const AUDIT_DECLARED_AT = 20_000;

/** The W028 provenance citation the journey's even-sequence audit records
 * carry (the dataset import that caused the world's records). */
export const DATASET_CITATION = {
  kind: "dataset",
  basis: "import-causation",
  datasetId: "ds-reference-journey-1",
};

/** The honest W028 none-marker the journey's odd-sequence audit records
 * carry (a composed trail entry with no declared source). */
export const NO_SOURCE = { kind: "none", reason: "no-declared-source" } as const;

// --- The time-machine facts (W050 — declared data) -------------------------

/** The journey's market-event stream: three W004 quote updates at declared
 * simulation instants (T0 from the W055 fixture family's own constants). */
export const MARKET_EVENT_INSTANTS = [0, 30_000, 150_000] as const;

/** The declared range of the journey's market-event stream. */
export const MARKET_RANGE = { from: 0, to: 300_000 } as const;

/** The cutoff the journey's point-in-time view is sealed at. */
export const VIEW_CUTOFF = 150_000;

// --- The journey identity --------------------------------------------------

/** The journey id prefix (a rendering convention, never a parse target). */
export const JOURNEY_ID_PREFIX = "journey-";
