/**
 * The PointInTimeQuery contract (W050) — ONE sealed knowledge request as
 * typed DATA.
 *
 * The chain: W004 shipped the market event/time/information contracts (the
 * TIME vocabulary — `SimulationTimeMs`, `eventObservationTime`, the A7
 * point-in-time laws); W027 shipped the research/news/event information
 * record types. THIS package types the point-in-time REQUEST: the declared
 * cutoff (W004's own time vocabulary — the simulation axis, never wall
 * time), the explicit tenant/project/world scope, the declared record
 * families the query may view, and the content-addressed query id.
 *
 * Spec: spec/REQUIREMENTS.md R016 — "Runtime point-in-time information
 * firewall." The query is the DECLARATION half; `./firewall.ts` is the
 * enforcement half (the typed gate).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the query id is the
 * canonical content digest over the scope + cutoff + families (no clocks,
 * no randomness, no env reads); the same declaration always yields the
 * same query id.
 * Spec: spec/DOMAIN-MODEL.md identity laws — ids are OPAQUE; the scope is
 * EXPLICIT (tenant/project/world, never recovered by parsing the id);
 * composite ids use CANONICAL ENCODERS.
 *
 * Fail-closed at construction (never silently repaired): blank scope
 * members, unknown record families, duplicate families (never silently
 * deduplicated), an empty family set, an illegal cutoff.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ProjectId, TenantId, WorldId } from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import { canonicalDigestHex } from "trajectory";
import type { InformationRecordKind } from "tradrl-world-contracts/information-data";

// ---------------------------------------------------------------------------
// The record families the machine may view (closed set)
// ---------------------------------------------------------------------------

/**
 * The closed record-family vocabulary: the W004 market-event family (the
 * ordered world journal's market events) plus W027's four information
 * record kinds (`InformationRecordKind`, carried through the contracts'
 * own type — one closed set, additions go through a contract change).
 */
export type TimeMachineRecordFamily = "market-event" | InformationRecordKind;

/** The family vocabulary in canonical (lexicographic) order. */
export const TIME_MACHINE_FAMILIES: readonly TimeMachineRecordFamily[] = [
  "analyst-note",
  "event",
  "market-event",
  "news",
  "research-report",
];

/** Type guard: is this value one of the closed record families? */
export function isTimeMachineRecordFamily(value: unknown): value is TimeMachineRecordFamily {
  return (
    typeof value === "string" &&
    TIME_MACHINE_FAMILIES.includes(value as TimeMachineRecordFamily)
  );
}

// ---------------------------------------------------------------------------
// The scope (explicit identity — DOMAIN-MODEL identity laws)
// ---------------------------------------------------------------------------

/** The explicit identity scope every point-in-time query carries. */
export interface TimeMachineScope {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly worldId: WorldId;
}

/** The scope members, in canonical order (validation + rendering order). */
export const TIME_MACHINE_SCOPE_MEMBERS: readonly (keyof TimeMachineScope)[] = [
  "tenantId",
  "projectId",
  "worldId",
];

/**
 * The blank scope members (the fail-closed identity gate's offender list).
 * A blank member means the scope is not explicit — the query is refused,
 * never defaulted.
 */
export function blankTimeMachineScopeMembers(
  scope: TimeMachineScope,
): readonly (keyof TimeMachineScope)[] {
  return TIME_MACHINE_SCOPE_MEMBERS.filter(
    (member) => String(scope[member]).trim().length === 0,
  );
}

// ---------------------------------------------------------------------------
// The cutoff (W004's time vocabulary — the simulation axis, role-narrowed)
// ---------------------------------------------------------------------------

declare const pointInTimeCutoffBrand: unique symbol;

/**
 * The query's declared cutoff: a role-narrowed `SimulationTimeMs` (W004's
 * time vocabulary — the simulation axis, comparable with event times and
 * availability thresholds, NEVER with wall time). The point in world time
 * at which the knowledge firewall seals the view.
 */
export type PointInTimeCutoff = SimulationTimeMs & {
  readonly [pointInTimeCutoffBrand]: true;
};

/**
 * The canonical constructor: stamp a number as a declared cutoff. The single
 * explicit choke point (mirrors W004's `asSimulationTime`/`asAvailableAt`).
 */
export function asPointInTimeCutoff(ms: number): PointInTimeCutoff {
  return ms as PointInTimeCutoff;
}

/**
 * Cutoff legality: a finite, non-negative integer of milliseconds (a
 * timestamp on the simulation axis — never NaN, never fractional, never
 * before the epoch's zero point as a declared domain time).
 */
export function isLegalCutoff(cutoff: number): boolean {
  return (
    typeof cutoff === "number" &&
    Number.isFinite(cutoff) &&
    Number.isInteger(cutoff) &&
    cutoff >= 0
  );
}

// ---------------------------------------------------------------------------
// The query id (opaque, content-addressed — A9)
// ---------------------------------------------------------------------------

declare const pointInTimeQueryIdBrand: unique symbol;

/**
 * An OPAQUE point-in-time query id (a canonical digest rendering). It is
 * produced only by {@link pointInTimeQueryIdOf} and is never parsed — the
 * scope, cutoff and families are carried explicitly on the query, never
 * recovered by splitting the id.
 */
export type PointInTimeQueryId = string & {
  readonly [pointInTimeQueryIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const POINT_IN_TIME_QUERY_ID_PREFIX = "pitq-";

/**
 * The query id: the canonical digest over the scope, the cutoff and the
 * family set (canonically ordered — input order never matters). Pure and
 * deterministic (A9): the same declaration always yields the same id, and a
 * declaration differing in any member yields a different id.
 */
export function pointInTimeQueryIdOf(
  scope: TimeMachineScope,
  cutoff: PointInTimeCutoff,
  families: readonly TimeMachineRecordFamily[],
): PointInTimeQueryId {
  const digest = canonicalDigestHex({
    cutoff,
    families: [...families].sort(),
    scope: {
      projectId: scope.projectId,
      tenantId: scope.tenantId,
      worldId: scope.worldId,
    },
  });
  return `${POINT_IN_TIME_QUERY_ID_PREFIX}${digest}` as PointInTimeQueryId;
}

// ---------------------------------------------------------------------------
// The query (typed DATA)
// ---------------------------------------------------------------------------

/**
 * ONE sealed knowledge request: the opaque content-addressed id, the
 * explicit scope, the declared cutoff (simulation axis), and the declared
 * record families this query may view (closed set — a view referencing a
 * family outside this declaration is refused by the firewall gate).
 */
export interface PointInTimeQuery {
  readonly queryId: PointInTimeQueryId;
  readonly scope: TimeMachineScope;
  readonly cutoff: PointInTimeCutoff;
  readonly families: readonly TimeMachineRecordFamily[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every construction law named)
// ---------------------------------------------------------------------------

/** Everything that can be wrong with a point-in-time query declaration. */
export type PointInTimeQueryErrorCode =
  | "blank-scope-member" // the identity scope is not explicit
  | "unknown-family" // a family outside the closed vocabulary
  | "duplicate-family" // the same family declared twice (never silently deduplicated)
  | "empty-family-set" // no families: a query over nothing is never silently built
  | "illegal-cutoff" // the cutoff is not a legal simulation-axis timestamp
  | "query-id-mismatch"; // whole-record re-proof: the id does not re-derive

/** One typed query error (fail-closed). */
export interface PointInTimeQueryError {
  readonly code: PointInTimeQueryErrorCode;
  readonly message: string;
}

/** The construction outcome: the lawful query, or every law violated. */
export type PointInTimeQueryOutcome =
  | { readonly ok: true; readonly query: PointInTimeQuery }
  | { readonly ok: false; readonly errors: readonly PointInTimeQueryError[] };

/** The construction input (the declaration, before sealing). */
export interface PointInTimeQueryInput {
  readonly scope: TimeMachineScope;
  readonly cutoff: PointInTimeCutoff;
  readonly families: readonly TimeMachineRecordFamily[];
}

/**
 * Build one point-in-time query, fail-closed. Every law is checked and
 * every violation collected (the W004 `validateEventStream` pattern — the
 * declarer sees all problems, never just the first). On success the family
 * set is carried in canonical (lexicographic) order; duplicates are NEVER
 * silently deduplicated — they are refused.
 */
export function buildPointInTimeQuery(input: PointInTimeQueryInput): PointInTimeQueryOutcome {
  const errors: PointInTimeQueryError[] = [];
  const scope = input.scope;
  if (scope === null || typeof scope !== "object") {
    return {
      ok: false,
      errors: [
        {
          code: "blank-scope-member",
          message: "scope is not an object — tenantId, projectId, worldId are required",
        },
      ],
    };
  }
  for (const member of blankTimeMachineScopeMembers(scope)) {
    errors.push({
      code: "blank-scope-member",
      message: `scope member ${String(member)} is blank — the scope must be explicit`,
    });
  }
  if (!isLegalCutoff(input.cutoff)) {
    errors.push({
      code: "illegal-cutoff",
      message: `cutoff ${String(input.cutoff)} is not a finite non-negative integer (simulation axis)`,
    });
  }
  if (!Array.isArray(input.families)) {
    return {
      ok: false,
      errors: [
        ...errors,
        {
          code: "empty-family-set",
          message: "families is not an array — the declared record families are required",
        },
      ],
    };
  }
  if (input.families.length === 0) {
    errors.push({
      code: "empty-family-set",
      message: "no declared record families — a query over nothing is never silently built",
    });
  }
  const seen = new Set<TimeMachineRecordFamily>();
  for (const family of input.families) {
    if (!isTimeMachineRecordFamily(family)) {
      errors.push({
        code: "unknown-family",
        message: `record family ${JSON.stringify(String(family))} is outside the closed vocabulary`,
      });
      continue;
    }
    if (seen.has(family)) {
      errors.push({
        code: "duplicate-family",
        message: `record family ${JSON.stringify(family)} is declared twice — never silently deduplicated`,
      });
      continue;
    }
    seen.add(family);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const families = [...seen].sort();
  const query: PointInTimeQuery = Object.freeze({
    queryId: pointInTimeQueryIdOf(scope, input.cutoff, families),
    scope: Object.freeze({ ...scope }),
    cutoff: input.cutoff,
    families: Object.freeze(families),
  });
  return { ok: true, query };
}
