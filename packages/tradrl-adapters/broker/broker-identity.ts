/**
 * The broker identity family (W065) — the closed broker vocabularies, THE
 * SHADOW LAW scanner (R063), the decimal-exact helpers, and the deterministic
 * canonical identity derivations for the provider-neutral shadow broker
 * adapter (the W057 arena-identity precedent).
 *
 * Spec: spec/REQUIREMENTS.md R063 — "Shadow/live separation is mandatory":
 * the broker vocabulary (venue kinds, order kinds, time-in-force,
 * execution-report kinds, observation kinds) is declared HERE and ONLY HERE
 * — closed sets, fail-closed at every seam — never in a concrete venue
 * adapter (R070 provider-neutrality).
 *
 * THE SHADOW LAW, STRUCTURAL: the typed record vocabulary has NO
 * live-transmission field at all. `liveTransmissionViolations` scans its
 * ENTIRE input (every member, recursively) and REFUSES LOUDLY naming R063
 * when a live-transmission-shaped member appears (endpoint/url/webhook/
 * socket/host/port/connection/transport/...) or when any string is
 * URL-shaped (http(s)://, ws(s)://, tcp://) — an adapter declaration that
 * smuggles a live-transmission capability anywhere is refused, never
 * silently stripped.
 *
 * Spec: spec/DOMAIN-MODEL.md identity laws — ids are opaque (never parsed),
 * composite ids use canonical encoders, identity is a function of content
 * (A9), and every digest weighs the TENANT FIRST (R056 structural — the
 * same declaration under two tenants is two records). The hashing family is
 * the repo's discipline carried through the W037 `trajectory` seam
 * (`canonicalDigestHex`) — never re-implemented.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

// ---------------------------------------------------------------------------
// The broker closed vocabularies (declared HERE and ONLY here — R063/R070)
// ---------------------------------------------------------------------------

/** How the venue matches orders (closed set — the venue vocabulary). */
export const BROKER_VENUE_KINDS = [
  "batch-auction",
  "central-limit-order-book",
  "quote-driven",
] as const;
export type BrokerVenueKind = (typeof BROKER_VENUE_KINDS)[number];

/** The kinds of order a shadow declaration can carry (closed set). */
export const BROKER_ORDER_KINDS = ["limit", "market"] as const;
export type BrokerOrderKind = (typeof BROKER_ORDER_KINDS)[number];

/** The order's declared lifetime (closed set — the TIF vocabulary). */
export const BROKER_TIME_IN_FORCE = [
  "day",
  "fill-or-kill",
  "good-till-cancelled",
  "immediate-or-cancel",
] as const;
export type BrokerTimeInForce = (typeof BROKER_TIME_IN_FORCE)[number];

/**
 * The execution-report kinds (closed set): the shadow lifecycle states
 * DERIVABLE from a carried order + its carried fills — the order was
 * acknowledged into the shadow book with no fill yet, partially filled, or
 * fully filled. DISCLOSED: rejection/cancellation semantics are DECLARED
 * outcomes that would need an explicit typed cancellation vocabulary —
 * deliberately NOT invented in this lane (A6: the derivable states only).
 */
export const BROKER_EXECUTION_REPORT_KINDS = [
  "new-acknowledged",
  "order-filled",
  "order-partially-filled",
] as const;
export type BrokerExecutionReportKind = (typeof BROKER_EXECUTION_REPORT_KINDS)[number];

/**
 * The market-observation kinds (closed set): what KIND of real market data
 * one observation carries. The price is always the observation's OWN
 * carried price — a fill composed from it never invents one (A6).
 */
export const BROKER_OBSERVATION_KINDS = [
  "book-snapshot",
  "mark-price",
  "top-of-book-quote",
  "trade-print",
] as const;
export type BrokerObservationKind = (typeof BROKER_OBSERVATION_KINDS)[number];

// ---------------------------------------------------------------------------
// THE SHADOW LAW (R063) — the live-transmission scanner (pure, closed list)
// ---------------------------------------------------------------------------

/** R063 — THE shadow/live separation law (named in every refusal). */
export const SHADOW_SEPARATION_LAW = "spec/REQUIREMENTS.md R063" as const;
/** The live-mirror architecture law (real observations in, simulated
 * positions/execution out — never live execution). */
export const LIVE_MIRROR_LAW =
  "spec/ARCHITECTURE.md 'Live mirror' — real observations with simulated positions/execution; never live execution" as const;
/** A9 — determinism. A14 — composes typed data, never executes. */
export const DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;
export const COMPOSITION_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;
/** R056 — tenant isolation is STRUCTURAL (tenant-first digests). */
export const TENANT_ISOLATION_LAW = "spec/REQUIREMENTS.md R056" as const;

/** The canonical law list carried on every broker record's provenance. */
export const BROKER_PROVENANCE_LAWS: readonly string[] = [
  SHADOW_SEPARATION_LAW,
  LIVE_MIRROR_LAW,
  TENANT_ISOLATION_LAW,
  DETERMINISM_LAW,
  COMPOSITION_LAW,
];

/**
 * The live-transmission-shaped MEMBER names: a shadow declaration never
 * carries a transmission capability, only the data a shadow projection
 * needs. THE SHADOW LAW is structural over these names.
 */
export const LIVE_TRANSMISSION_MEMBERS: readonly string[] = [
  "endpoint",
  "url",
  "uri",
  "webhook",
  "webSocket",
  "socket",
  "host",
  "port",
  "connection",
  "transmit",
  "transmission",
  "transport",
  "network",
];

/** URL-shaped string prefixes — a live-transmission ADDRESS as a value. */
const URL_SHAPED_PREFIXES: readonly string[] = [
  "http://",
  "https://",
  "ws://",
  "wss://",
  "tcp://",
];

/** Is this string URL-shaped (a live-transmission address as a value)? */
export function isUrlShaped(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return URL_SHAPED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One typed shadow-law violation (fail-closed; the law named). */
export interface ShadowLawViolation {
  readonly code: "live-transmission-refused";
  readonly message: string;
}

/**
 * THE SHADOW LAW scan: walk an entire value (objects, arrays, nested) and
 * collect a LOUD typed `live-transmission-refused` violation naming R063 for
 * every live-transmission-shaped member and every URL-shaped string found.
 * Pure; the same input always yields the same violations (A9).
 */
export function liveTransmissionViolations(
  value: unknown,
  path: string,
): readonly ShadowLawViolation[] {
  const violations: ShadowLawViolation[] = [];
  const refuse = (where: string): void => {
    violations.push({
      code: "live-transmission-refused",
      message: `${where} — THE SHADOW LAW refuses it: shadow/live separation is mandatory (${SHADOW_SEPARATION_LAW}); the broker vocabulary has NO live-transmission field, and no declaration may smuggle one in`,
    });
  };
  const walk = (node: unknown, memberPath: string): void => {
    if (typeof node === "string") {
      if (isUrlShaped(node)) {
        refuse(`the string ${memberPath} is URL-shaped (a live-transmission address)`);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) {
        walk(entry, `${memberPath}[${String(index)}]`);
      }
      return;
    }
    if (isRecordLike(node)) {
      for (const member of Object.keys(node)) {
        if (LIVE_TRANSMISSION_MEMBERS.includes(member)) {
          refuse(`the member '${memberPath}.${member}' is live-transmission-shaped`);
        }
        walk(node[member], `${memberPath}.${member}`);
      }
    }
  };
  walk(value, path);
  return violations;
}

// ---------------------------------------------------------------------------
// The decimal-exact helpers (carried decimal strings, never floats)
// ---------------------------------------------------------------------------

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/** The canonical parse of one decimal string (digits + scale). */
interface Decimal {
  readonly digits: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): Decimal | undefined {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    return undefined;
  }
  const [whole, fraction = ""] = value.split(".");
  return { digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

/** Is this a lawful decimal string (the W004 Price/Quantity convention)? */
export function isLawfulDecimal(value: unknown): boolean {
  return parseDecimal(String(value)) !== undefined;
}

/** Is this a lawful POSITIVE decimal string (prices and quantities are)? */
export function isPositiveDecimal(value: unknown): boolean {
  const decimal = parseDecimal(String(value));
  return decimal !== undefined && decimal.digits > 0n;
}

/** Decimal-exact comparison: negative iff left < right. */
export function compareDecimals(left: string, right: string): number | undefined {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  if (leftDecimal === undefined || rightDecimal === undefined) {
    return undefined;
  }
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftScaled = leftDecimal.digits * 10n ** BigInt(scale - leftDecimal.scale);
  const rightScaled = rightDecimal.digits * 10n ** BigInt(scale - rightDecimal.scale);
  if (leftScaled === rightScaled) {
    return 0;
  }
  return leftScaled < rightScaled ? -1 : 1;
}

/** Decimal-exact sum over carried decimal strings (signed by `signs`). */
export function sumDecimals(
  values: readonly string[],
  signs: readonly (1 | -1)[],
): string | undefined {
  if (values.length !== signs.length || values.length === 0) {
    return undefined;
  }
  let digits = 0n;
  let scale = 0;
  const parsed: { decimal: Decimal; sign: 1 | -1 }[] = [];
  for (const [index, value] of values.entries()) {
    const decimal = parseDecimal(value);
    if (decimal === undefined) {
      return undefined;
    }
    scale = Math.max(scale, decimal.scale);
    parsed.push({ decimal, sign: signs[index] ?? 1 });
  }
  for (const { decimal, sign } of parsed) {
    digits += (sign === -1 ? -decimal.digits : decimal.digits) * 10n ** BigInt(scale - decimal.scale);
  }
  return renderDecimal(digits, scale);
}

/** Decimal-exact product of carried decimal strings (basis derivation). */
export function multiplyDecimals(left: string, right: string): string | undefined {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  if (leftDecimal === undefined || rightDecimal === undefined) {
    return undefined;
  }
  return renderDecimal(
    leftDecimal.digits * rightDecimal.digits,
    leftDecimal.scale + rightDecimal.scale,
  );
}

function renderDecimal(digits: bigint, scale: number): string {
  const negative = digits < 0n;
  let absolute = negative ? -digits : digits;
  let currentScale = scale;
  // canonical trailing-zero normalization ("3685.400" → "3685.4")
  while (currentScale > 0 && absolute % 10n === 0n) {
    absolute /= 10n;
    currentScale -= 1;
  }
  const text = absolute.toString().padStart(currentScale + 1, "0");
  const rendered =
    currentScale === 0 ? text : `${text.slice(0, -currentScale)}.${text.slice(-currentScale)}`;
  return negative ? `-${rendered}` : rendered;
}

// ---------------------------------------------------------------------------
// The opaque id family (digest-derived — the TENANT FIRST, R056 structural)
// ---------------------------------------------------------------------------

declare const marketObservationIdBrand: unique symbol;
export type MarketObservationId = string & {
  readonly [marketObservationIdBrand]: true;
};
export const MARKET_OBSERVATION_ID_PREFIX = "obs-";

declare const shadowOrderIdBrand: unique symbol;
export type ShadowOrderId = string & { readonly [shadowOrderIdBrand]: true };
export const SHADOW_ORDER_ID_PREFIX = "sord-";

declare const shadowFillIdBrand: unique symbol;
export type ShadowFillId = string & { readonly [shadowFillIdBrand]: true };
export const SHADOW_FILL_ID_PREFIX = "sfil-";

declare const executionReportIdBrand: unique symbol;
export type ExecutionReportId = string & {
  readonly [executionReportIdBrand]: true;
};
export const EXECUTION_REPORT_ID_PREFIX = "xrep-";

/** The canonical scope tuple — the TENANT FIRST (R056 structural). */
export function scopeTuple(scope: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}): [string, string, string] {
  return [scope.tenantId, scope.projectId, scope.worldId];
}

/** byString: the canonical lexicographic comparison helper (A9 orders). */
export function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
