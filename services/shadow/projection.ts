/**
 * The mirror projection (W065) — the SIMULATED half of the live mirror,
 * composed deterministically from a session's carried chain, as typed DATA.
 *
 * THE LIVE-MIRROR LAW: real observations with simulated positions/
 * execution; never live execution. This module is the simulation: for every
 * carried order (canonical order-id order) the projection composes ONE
 * shadow fill through the broker adapter's REAL `composeShadowFill` gate
 * (order + the first eligible observation — same instrument, observable at
 * or after the order's declaration, in canonical observedAt-then-id order —
 * BOTH carried verbatim, errors carried VERBATIM), and derives the
 * positions decimal-exact from the carried fills. A6 is structural: the
 * fill's price IS the observation's carried price; the position's net
 * quantity is the decimal-exact signed sum of the carried fill quantities;
 * the position's notional basis is the decimal-exact sum of the carried
 * price×quantity products (addition and multiplication of carried numbers
 * only — no rounding, no division, nothing invented).
 *
 * Orders with no eligible observation rest UNFILLED — carried as the
 * projection's unfilled-order-id list (canonical order), never silently
 * dropped.
 *
 * NEVER LIVE EXECUTION: the projection COMPOSES typed records — it does not
 * transmit anything; there is no network code in this service at all
 * (A13/A14). R063: the shadow path is the only path.
 *
 * A9: content-addressed `proj-<digest>` id (TENANT FIRST — R056), canonical
 * orders everywhere (the declarer's input order never leaks). License:
 * Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError, SecurityScope } from "security";
import { canonicalDigestHex } from "trajectory";
import type { ShadowFill } from "tradrl-adapters-broker";
import {
  byString,
  fillPriceOf,
  multiplyDecimals,
  scopeTuple,
  sumDecimals,
} from "tradrl-adapters-broker";
import { composeShadowFill } from "tradrl-adapters-broker";
import type { LiveMirrorSession, MirrorProvenance, MirrorSessionId } from "./session.js";
import { MIRROR_PROVENANCE_LAWS } from "./session.js";

// ---------------------------------------------------------------------------
// The record (typed DATA)
// ---------------------------------------------------------------------------

declare const mirrorProjectionIdBrand: unique symbol;
/** An OPAQUE mirror-projection id (`proj-<digest>`, TENANT FIRST — R056). */
export type MirrorProjectionId = string & { readonly [mirrorProjectionIdBrand]: true };
export const MIRROR_PROJECTION_ID_PREFIX = "proj-";

/**
 * ONE simulated position: the net decimal-exact signed quantity over the
 * carried fills of one instrument, the notional basis (the decimal-exact
 * Σ price×quantity), and the fill count — ALL derived from carried data.
 */
export interface MirrorPosition {
  readonly instrumentId: string;
  readonly netQuantity: string;
  readonly notionalBasis: string;
  readonly fillCount: number;
}

/** ONE mirror projection: the session's simulated execution state. */
export interface MirrorProjection {
  readonly projectionId: MirrorProjectionId;
  readonly sessionId: MirrorSessionId;
  readonly scope: SecurityScope;
  /** The composed fills, in canonical fill-id order (A9). */
  readonly fills: readonly ShadowFill[];
  /** The derived positions, in canonical instrument order (A9). */
  readonly positions: readonly MirrorPosition[];
  /** The orders that rested unfilled (canonical order-id order — A9). */
  readonly unfilledOrderIds: readonly string[];
  readonly provenance: MirrorProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ProjectionErrorCode =
  | "malformed-input"
  | "fill-composition-refused" // the adapter gate's errors, verbatim
  | "projection-id-mismatch"
  | "provenance-mismatch";

export type ProjectionError = SecurityError<ProjectionErrorCode>;

export type ProjectionOutcome =
  | { readonly ok: true; readonly projection: MirrorProjection }
  | { readonly ok: false; readonly errors: readonly ProjectionError[] };

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant FIRST)
// ---------------------------------------------------------------------------

export interface ProjectionCanonicalInput {
  readonly scope: SecurityScope;
  readonly sessionId: string;
  readonly fillIds: readonly string[];
  readonly positions: readonly MirrorPosition[];
  readonly unfilledOrderIds: readonly string[];
}

/** The projection id: `proj-<digest>` over the canonical content. */
export function mirrorProjectionIdOf(input: ProjectionCanonicalInput): MirrorProjectionId {
  const digest = projectionDigest(input);
  return `${MIRROR_PROJECTION_ID_PREFIX}${digest}` as MirrorProjectionId;
}

/** The input digest (the provenance member). */
export function projectionInputDigestOf(input: ProjectionCanonicalInput): string {
  return projectionDigest(input);
}

function projectionDigest(input: ProjectionCanonicalInput): string {
  return canonicalDigestHex({
    fillIds: [...input.fillIds],
    positions: [...input.positions]
      .map((position): [string, string, string, number] => [
        position.instrumentId,
        position.netQuantity,
        position.notionalBasis,
        position.fillCount,
      ])
      .sort((left, right) => byString(left[0], right[0])),
    scope: scopeTuple(input.scope),
    sessionId: input.sessionId,
    unfilledOrderIds: [...input.unfilledOrderIds],
  });
}

// ---------------------------------------------------------------------------
// THE PROJECTION COMPOSITION
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Compose ONE mirror projection — the deterministic simulation over the
 * session's carried chain. For every order (canonical order-id order) the
 * first eligible observation is selected (same instrument, `observedAt >=
 * the order's declaredAt`, canonical observedAt-then-id order) and ONE full
 * fill is composed through the broker adapter's REAL composition gate with
 * its errors carried VERBATIM (a refused composition is a LOUD refusal,
 * never a silent skip). Positions are derived decimal-exact per instrument;
 * orders with no eligible observation rest unfilled, carried canonically.
 * Pure (A9): same session ⇒ deep-equal projection, same id; A14: composes
 * typed records — NEVER live execution, no transmission, no network.
 */
export function composeMirrorProjection(
  session: LiveMirrorSession,
): ProjectionOutcome {
  if (!isRecordLike(session)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the session is not typed data — a sealed live-mirror session is required" }] };
  }
  const errors: ProjectionError[] = [];
  const fills: ShadowFill[] = [];
  const unfilledOrderIds: string[] = [];
  const orderedObservations = [...session.observations].sort((left, right) =>
    left.observedAt === right.observedAt
      ? byString(String(left.observationId), String(right.observationId))
      : left.observedAt - right.observedAt,
  );
  for (const order of [...session.orders].sort((left, right) =>
    byString(String(left.orderId), String(right.orderId)),
  )) {
    const eligible = orderedObservations.find(
      (observation) =>
        observation.instrumentId === order.instrumentId &&
        observation.observedAt >= order.declaredAt,
    );
    if (eligible === undefined) {
      unfilledOrderIds.push(String(order.orderId));
      continue;
    }
    const outcome = composeShadowFill(order, eligible, order.quantity);
    if (!outcome.ok) {
      errors.push({
        code: "fill-composition-refused",
        message: `the shadow fill for order '${String(order.orderId)}' was refused by the broker adapter's composition gate (${String(outcome.errors.length)} error(s), first: ${String(outcome.errors[0]?.code ?? "none")}) — errors carried verbatim, never bypassed`,
        entryId: String(order.orderId),
      });
      continue;
    }
    fills.push(outcome.fill);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const orderedFills = fills.sort((left, right) => byString(String(left.fillId), String(right.fillId)));
  const positions = derivePositions(orderedFills);
  const canonical: ProjectionCanonicalInput = {
    scope: session.scope,
    sessionId: String(session.sessionId),
    fillIds: orderedFills.map((fill) => String(fill.fillId)),
    positions,
    unfilledOrderIds: [...unfilledOrderIds].sort(byString),
  };
  const projection: MirrorProjection = {
    projectionId: mirrorProjectionIdOf(canonical),
    sessionId: session.sessionId,
    scope: session.scope,
    fills: orderedFills,
    positions,
    unfilledOrderIds: canonical.unfilledOrderIds,
    provenance: {
      deriver: "compose-mirror-projection",
      inputDigest: projectionInputDigestOf(canonical),
      laws: MIRROR_PROVENANCE_LAWS,
    },
  };
  return { ok: true, projection: Object.freeze(projection) };
}

/** The per-instrument positions, decimal-exact over the carried fills. */
export function derivePositions(fills: readonly ShadowFill[]): readonly MirrorPosition[] {
  const byInstrument = new Map<string, { quantities: string[]; signs: (1 | -1)[]; basis: string[] }>();
  for (const fill of fills) {
    const entry = byInstrument.get(fill.order.instrumentId) ?? { quantities: [], signs: [], basis: [] };
    entry.quantities.push(fill.fillQuantity);
    entry.signs.push(fill.order.side === "buy" ? 1 : -1);
    const product = multiplyDecimals(fillPriceOf(fill), fill.fillQuantity);
    entry.basis.push(product ?? "0");
    byInstrument.set(fill.order.instrumentId, entry);
  }
  return [...byInstrument.entries()]
    .map(([instrumentId, entry]) => ({
      instrumentId,
      netQuantity: sumDecimals(entry.quantities, entry.signs) ?? "0",
      notionalBasis: sumDecimals(entry.basis, entry.basis.map(() => 1)) ?? "0",
      fillCount: entry.quantities.length,
    }))
    .sort((left, right) => byString(left.instrumentId, right.instrumentId));
}
