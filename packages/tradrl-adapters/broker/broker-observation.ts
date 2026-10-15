/**
 * The market observation (W065) — ONE REAL market observation as typed DATA,
 * and its fail-closed sealing gate.
 *
 * THE LIVE-MIRROR LAW (spec/ARCHITECTURE.md "Live mirror"): real
 * observations in, simulated positions/execution out. An observation is the
 * REAL half: a venue's own carried price/size at a declared point on the
 * simulation axis. It is NEVER the simulated half — nothing here is derived,
 * everything is carried. A fill composed from an observation uses the
 * observation's OWN price (A6 — no invented prices).
 *
 * The availability law (the W050 point-in-time half): an observation
 * carries BOTH `observedAt` (when the market printed it) and `availableAt`
 * (when it became knowable — never earlier than `observedAt`). A consumer
 * composing a view at a cutoff sees the observation only from
 * `availableAt` on: THE POINT-IN-TIME LAW, enforced at the shadow session's
 * gate (services/shadow), proven here at construction.
 *
 * THE REDACTION LAW (W060) rides STRUCTURALLY: the entire input is scanned
 * through packages/security's own `secretValueViolations` (errors carried
 * VERBATIM — never re-implemented, never bypassed). THE SHADOW LAW (R063)
 * rides beside it: `liveTransmissionViolations` refuses any
 * live-transmission-shaped member or URL-shaped value loudly.
 *
 * A9: the id is the canonical content digest (TENANT FIRST — R056
 * structural); A14: typed data only — no I/O, no clocks, no network.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError, SecurityScope } from "security";
import { blankSecurityScopeMembers, secretValueViolations } from "security";
import { canonicalDigestHex } from "trajectory";
import {
  BROKER_OBSERVATION_KINDS,
  BROKER_PROVENANCE_LAWS,
  MARKET_OBSERVATION_ID_PREFIX,
  isPositiveDecimal,
  liveTransmissionViolations,
  scopeTuple,
} from "./broker-identity.js";
import type { BrokerObservationKind, MarketObservationId } from "./broker-identity.js";

// ---------------------------------------------------------------------------
// The record (typed DATA)
// ---------------------------------------------------------------------------

/**
 * Where the observation was projected from — the REAL source citation: the
 * opaque id of the W050 sealed point-in-time view + the opaque record id of
 * the W004 world-journal event it projects. Cited, never parsed. The shadow
 * session's gate REQUIRES this citation (a mirror session's observations
 * come from its sealed view — the real-observations-IN law); the adapter's
 * own gate validates its laws when present.
 */
export interface ObservationSourceCitation {
  readonly viewId: string;
  readonly recordId: string;
}

/** ONE market observation: the venue's carried market data at one point. */
export interface MarketObservation {
  readonly observationId: MarketObservationId;
  readonly scope: SecurityScope;
  readonly observationKind: BrokerObservationKind;
  readonly instrumentId: string;
  /** The observation's OWN carried price (decimal string — A6's anchor). */
  readonly price: string;
  /** The carried traded/quoted size, when the observation carries one. */
  readonly size?: string;
  /** The quoted side, when the observation is a one-sided quote. */
  readonly side?: "ask" | "bid";
  /** When the market printed it (simulation axis, declared ms). */
  readonly observedAt: number;
  /** When it became knowable — never before `observedAt` (the availability law). */
  readonly availableAt: number;
  readonly source?: ObservationSourceCitation;
  readonly provenance: BrokerProvenance;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface BrokerProvenance {
  readonly deriver: string;
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ObservationErrorCode =
  | "malformed-input"
  | "invalid-scope"
  | "unknown-observation-kind"
  | "blank-instrument"
  | "invalid-price"
  | "invalid-size"
  | "invalid-side"
  | "invalid-observed-at"
  | "invalid-available-at"
  | "availability-before-observation"
  | "invalid-source-citation"
  | "secret-value-refused"
  | "live-transmission-refused"
  | "observation-id-mismatch"
  | "provenance-mismatch";

export type BrokerError = SecurityError<
  ObservationErrorCode | "live-transmission-refused" | "secret-value-refused"
>;

export interface ObservationOutcome {
  readonly ok: true;
  readonly observation: MarketObservation;
}
export type ObservationSealOutcome =
  | ObservationOutcome
  | { readonly ok: false; readonly errors: readonly BrokerError[] };

/** The sealing input (everything the observation id weighs). */
export interface MarketObservationInput {
  readonly scope: SecurityScope;
  readonly observationKind: BrokerObservationKind;
  readonly instrumentId: string;
  readonly price: string;
  readonly size?: string;
  readonly side?: "ask" | "bid";
  readonly observedAt: number;
  readonly availableAt: number;
  readonly source?: ObservationSourceCitation;
}

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant first)
// ---------------------------------------------------------------------------

/** The canonical content an observation id addresses (TENANT FIRST — R056). */
export function observationCanonicalContent(
  input: Omit<MarketObservationInput, never>,
): unknown {
  return {
    availableAt: input.availableAt,
    instrumentId: input.instrumentId,
    observationKind: input.observationKind,
    observedAt: input.observedAt,
    price: input.price,
    scope: scopeTuple(input.scope),
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.source === undefined
      ? {}
      : { source: [input.source.viewId, input.source.recordId] }),
  };
}

/** The observation id: `obs-<digest>` over the canonical content. */
export function marketObservationIdOf(input: MarketObservationInput): MarketObservationId {
  const digest = canonicalDigestHex(observationCanonicalContent(input));
  return `${MARKET_OBSERVATION_ID_PREFIX}${digest}` as MarketObservationId;
}

/** The input digest (the provenance member). */
export function observationInputDigestOf(input: MarketObservationInput): string {
  return canonicalDigestHex(observationCanonicalContent(input));
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Seal ONE market observation — fail-closed, ALL violations collected: the
 * explicit §14 scope, the closed observation-kind vocabulary, a non-blank
 * instrument, lawful positive decimal price (and size when present), the
 * declared side only on one-sided quotes, legal simulation-axis timestamps,
 * the availability law (`availableAt >= observedAt` — an observation is
 * never knowable before it printed), the source-citation laws when present,
 * THE REDACTION LAW scan (packages/security's own scanner, errors verbatim)
 * and THE SHADOW LAW scan (R063). Then the seal: `obs-<digest>` minted over
 * the canonical bytes (the TENANT weighed first — R056 structural).
 */
export function sealMarketObservation(
  input: MarketObservationInput,
): ObservationSealOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.scope)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message:
            "the sealing input is not typed data — a scope, an observation kind, an instrument, a price and two timestamps are required",
        },
      ],
    };
  }
  const errors: BrokerError[] = [];
  for (const member of blankSecurityScopeMembers(input.scope)) {
    errors.push({
      code: "invalid-scope",
      message: `the observation's scope '${String(member)}' is blank — tenant/project/world identity is explicit, never blank`,
    });
  }
  if (!BROKER_OBSERVATION_KINDS.includes(input.observationKind)) {
    errors.push({
      code: "unknown-observation-kind",
      message: `observation kind '${String(input.observationKind)}' is outside the closed vocabulary — observations answer in ${BROKER_OBSERVATION_KINDS.join(", ")} only`,
    });
  }
  if (typeof input.instrumentId !== "string" || input.instrumentId.trim().length === 0) {
    errors.push({
      code: "blank-instrument",
      message: "the observation's instrument id is blank — an observation names its instrument, never blankly",
    });
  }
  if (!isPositiveDecimal(input.price)) {
    errors.push({
      code: "invalid-price",
      message: `the observation's price '${String(input.price)}' is not a lawful positive decimal string — the price is carried data (A6), never a float`,
    });
  }
  if (input.size !== undefined && !isPositiveDecimal(input.size)) {
    errors.push({
      code: "invalid-size",
      message: `the observation's size '${String(input.size)}' is not a lawful positive decimal string — a carried size is explicit data`,
    });
  }
  if (input.side !== undefined && input.side !== "ask" && input.side !== "bid") {
    errors.push({
      code: "invalid-side",
      message: `the observation's side '${String(input.side)}' is outside the closed vocabulary — one-sided quotes answer in ask or bid only`,
    });
  }
  for (const [member, code] of [
    ["observedAt", "invalid-observed-at"],
    ["availableAt", "invalid-available-at"],
  ] as const) {
    const value = input[member];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      errors.push({
        code,
        message: `the observation's ${member} '${String(value)}' is not a non-negative safe integer on the simulation axis (declared data — A9 has no clocks)`,
      });
    }
  }
  if (
    typeof input.observedAt === "number" &&
    typeof input.availableAt === "number" &&
    input.availableAt < input.observedAt
  ) {
    errors.push({
      code: "availability-before-observation",
      message: `availableAt ${String(input.availableAt)} precedes observedAt ${String(input.observedAt)} — an observation is never knowable before the market printed it (the W050 availability law)`,
    });
  }
  if (input.source !== undefined) {
    if (
      !isRecordLike(input.source) ||
      typeof input.source.viewId !== "string" ||
      input.source.viewId.length === 0 ||
      typeof input.source.recordId !== "string" ||
      input.source.recordId.length === 0
    ) {
      errors.push({
        code: "invalid-source-citation",
        message:
          "the observation's source citation is malformed — a sealed view id and a record id are required (opaque ids, cited never parsed)",
      });
    }
  }
  errors.push(...secretValueViolations(input, "the observation input"));
  for (const violation of liveTransmissionViolations(input, "the observation input")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const observation: MarketObservation = {
    observationId: marketObservationIdOf(input),
    scope: input.scope,
    observationKind: input.observationKind,
    instrumentId: input.instrumentId,
    price: input.price,
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.side === undefined ? {} : { side: input.side }),
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    ...(input.source === undefined ? {} : { source: input.source }),
    provenance: {
      deriver: "seal-market-observation",
      inputDigest: observationInputDigestOf(input),
      laws: BROKER_PROVENANCE_LAWS,
    },
  };
  return { ok: true, observation: Object.freeze(observation) };
}
