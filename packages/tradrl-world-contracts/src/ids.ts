/**
 * Opaque identity contracts.
 *
 * Spec: spec/DOMAIN-MODEL.md — "Identity laws":
 * - IDs are opaque.
 * - Tenant/project/world scope is explicit.
 * - Composite ids use canonical encoders.
 * - Business code never parses opaque ids by delimiter.
 * - Branch lineage is immutable.
 *
 * Every id below is a branded string. Business code must treat these as
 * opaque handles: no parsing, no re-encoding, no delimiter splitting.
 * Canonical encoding/decoding belongs to dedicated engine codecs only.
 */

/**
 * Base brand for opaque identifiers. The phantom `__brand` field never exists
 * at runtime; it exists purely to prevent accidental cross-assignment of ids.
 */
export type OpaqueId<Brand extends string> = string & { readonly __brand: Brand };

/** Tenancy scope (R072 fail-closed tenancy: tenant identity is explicit). */
export type TenantId = OpaqueId<"TenantId">;

/** Project scope inside a tenant. */
export type ProjectId = OpaqueId<"ProjectId">;

/** A Market World instance. Immutable lineage (A8: branching, never destructive rewind). */
export type WorldId = OpaqueId<"WorldId">;

/** Immutable, self-describing world snapshot (WORLD-PROTOCOL.md "Snapshots"). */
export type SnapshotId = OpaqueId<"SnapshotId">;

/** A tradable instrument. Distinct from its human-readable `symbol`. */
export type InstrumentId = OpaqueId<"InstrumentId">;

/** A trading venue (exchange). */
export type VenueId = OpaqueId<"VenueId">;

/** A trader/participant order. */
export type OrderId = OpaqueId<"OrderId">;

/** Aggregate execution record for one order. */
export type ExecutionId = OpaqueId<"ExecutionId">;

/** A single (possibly partial) fill of an order. */
export type FillId = OpaqueId<"FillId">;

/** A public market trade produced by matching. */
export type TradeId = OpaqueId<"TradeId">;

/** An account holding balances/positions inside one world. */
export type AccountId = OpaqueId<"AccountId">;

/** A world participant (human trader or endogenous simulated participant). */
export type ParticipantId = OpaqueId<"ParticipantId">;

/** An information artifact in the information world (ARCHITECTURE.md §7). */
export type InformationArtifactId = OpaqueId<"InformationArtifactId">;

/** A domain event inside the ordered world journal. */
export type EventId = OpaqueId<"EventId">;

/** A command submitted through the CommandPort. */
export type CommandId = OpaqueId<"CommandId">;

/** Correlation id: groups events/commands belonging to one logical flow. */
export type CorrelationId = OpaqueId<"CorrelationId">;

/** Causation id: the command or event that directly caused an event. */
export type CausationId = OpaqueId<"CausationId">;

/** Producer identity for events and provenance records. */
export type ProducerId = OpaqueId<"ProducerId">;

/** A journal record in the authoritative world journal. */
export type JournalEntryId = OpaqueId<"JournalEntryId">;

/** A user annotation on the world timeline (CommandPort.addAnnotation). */
export type AnnotationId = OpaqueId<"AnnotationId">;

/**
 * Explicit tenant/project/world scope (DOMAIN-MODEL.md "Tenant/project/world
 * scope is explicit"). Persistence and transport must carry this scope
 * (ARCHITECTURE.md §14 Security).
 */
export interface WorldScope {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly worldId: WorldId;
}
