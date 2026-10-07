/**
 * Timestamp unit laws (W026 `tradrl-adapters-crypto`).
 *
 * Spec: spec/WORK-ITEMS.md W026 — "timestamps come from the record fields
 * (ms vs s units handled explicitly per the exchange's documented convention
 * — a unit mistake is the classic silent corruption; validate ranges
 * loudly)".
 *
 * Every exchange feed DECLARES its documented timestamp convention
 * (`TimestampUnit`); these converters implement the three conventions the
 * baseline providers use. Each conversion is pure and returns a typed
 * result — `malformed` for unparseable input, `out-of-range` for values
 * outside the loud sanity window. The window exists precisely because the
 * s↔ms swap produces plausible-looking garbage: a seconds value read as
 * milliseconds lands in 1970, a milliseconds value read as seconds lands in
 * the 56th millennium. Both are rejected here, loudly, with the raw value in
 * the detail text.
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type { CryptoMappingViolation } from "./errors.js";

/** The timestamp conventions the baseline providers declare per feed. */
export type TimestampUnit = "epoch-ms" | "epoch-s" | "iso-8601";

/**
 * Sanity-window floor: the Bitcoin genesis block (2009-01-03T18:15:05Z).
 * Crypto exchange market data cannot predate it; a value below it in an
 * epoch-ms field is almost certainly a seconds value (the classic unit swap).
 */
export const CRYPTO_EPOCH_FLOOR_MS = 1_231_006_505_000;

/**
 * Sanity-window ceiling: 2100-01-01T00:00:00Z. A value above it is almost
 * certainly a seconds-convention value read as milliseconds (or garbage).
 */
export const CRYPTO_EPOCH_CEILING_MS = 4_102_444_800_000;

/** The same window in whole seconds (for `epoch-s` conventions). */
export const CRYPTO_EPOCH_FLOOR_SECONDS = 1_231_006_505;

/** The same window in whole seconds (for `epoch-s` conventions). */
export const CRYPTO_EPOCH_CEILING_SECONDS = 4_102_444_800;

/** Typed outcome of one timestamp conversion. */
export type TimestampConversion =
  | { readonly ok: true; readonly ms: TimestampMs }
  | { readonly ok: false; readonly violation: CryptoMappingViolation };

/** Is the value a finite number at all? */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function malformed(field: string, value: unknown): CryptoMappingViolation {
  return {
    kind: "malformed-record",
    detail: `${field}: expected a number, got '${String(value)}'`,
  };
}

function outOfRange(
  field: string,
  value: number,
  unit: string,
  floor: number,
  ceiling: number,
  hint: string,
): CryptoMappingViolation {
  return {
    kind: "timestamp-out-of-range",
    detail:
      `${field}: value ${String(value)} is outside the ${unit} sanity window ` +
      `[${String(floor)}, ${String(ceiling)}] — ${hint}`,
  };
}

/**
 * Convert an epoch-milliseconds timestamp (the Binance Spot convention:
 * kline open/close time, aggTrade `T` are documented as Unix epoch in
 * milliseconds). Verbatim passthrough after the range check — never
 * rescaled, never reinterpreted.
 */
export function epochMsFromMs(value: unknown, field: string): TimestampConversion {
  if (!isFiniteNumber(value)) {
    return { ok: false, violation: malformed(field, value) };
  }
  if (value < CRYPTO_EPOCH_FLOOR_MS || value > CRYPTO_EPOCH_CEILING_MS) {
    return {
      ok: false,
      violation: outOfRange(
        field,
        value,
        "epoch-milliseconds",
        CRYPTO_EPOCH_FLOOR_MS,
        CRYPTO_EPOCH_CEILING_MS,
        "a value this small in an ms field is likely a seconds value (the classic unit swap); a value this large is likely garbage",
      ),
    };
  }
  return { ok: true, ms: value as TimestampMs };
}

/**
 * Convert an epoch-seconds timestamp (the Coinbase Exchange candle
 * convention: the candle `time` is documented as the bucket start in Unix
 * epoch SECONDS). The ×1000 rescale is explicit and preceded by a
 * seconds-window check, so a milliseconds value mistakenly present in a
 * seconds field is rejected before it can become a silently wrong time.
 */
export function epochMsFromSeconds(value: unknown, field: string): TimestampConversion {
  if (!isFiniteNumber(value)) {
    return { ok: false, violation: malformed(field, value) };
  }
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      violation: {
        kind: "malformed-record",
        detail: `${field}: epoch-seconds must be a whole number, got '${String(value)}'`,
      },
    };
  }
  if (value < CRYPTO_EPOCH_FLOOR_SECONDS || value > CRYPTO_EPOCH_CEILING_SECONDS) {
    return {
      ok: false,
      violation: outOfRange(
        field,
        value,
        "epoch-seconds",
        CRYPTO_EPOCH_FLOOR_SECONDS,
        CRYPTO_EPOCH_CEILING_SECONDS,
        "a value this large in a seconds field is likely a milliseconds value (the classic unit swap)",
      ),
    };
  }
  return { ok: true, ms: (value * 1000) as TimestampMs };
}

/** The strict documented Coinbase Exchange time text: UTC, `Z`-suffixed. */
const ISO_8601_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

/**
 * Convert an ISO-8601 UTC timestamp string (the Coinbase Exchange trades/
 * ticker convention: `time` is an ISO 8601 string with up to microsecond
 * precision and a `Z` suffix). Parsing is a strict hand-rolled scan — never
 * `Date.parse` (whose behavior beyond the ECMAScript subset is
 * implementation-defined). Sub-millisecond digits are TRUNCATED to the
 * `TimestampMs` contract (a declared, deterministic conversion); a
 * round-trip check (`toISOString`) rejects rolled-over components such as
 * `2023-02-31` or a leap-second `:60`.
 */
export function epochMsFromIso8601Utc(value: unknown, field: string): TimestampConversion {
  if (typeof value !== "string") {
    return { ok: false, violation: malformed(field, value) };
  }
  const match = ISO_8601_UTC.exec(value);
  if (match === null) {
    return {
      ok: false,
      violation: {
        kind: "malformed-record",
        detail:
          `${field}: '${value}' is not the documented ISO-8601 UTC form ` +
          `YYYY-MM-DDTHH:MM:SS[.ffffff]Z (offsets other than Z are not the documented shape and are never guessed)`,
      },
    };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const parsed = new Date(utc);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== roundTrip(value)) {
    return {
      ok: false,
      violation: {
        kind: "malformed-record",
        detail: `${field}: '${value}' is not a real UTC instant (component round-trip failed)`,
      },
    };
  }
  const ms = parsed.getTime() as TimestampMs;
  if (ms < CRYPTO_EPOCH_FLOOR_MS || ms > CRYPTO_EPOCH_CEILING_MS) {
    return {
      ok: false,
      violation: outOfRange(
        field,
        ms,
        "epoch-milliseconds (from ISO-8601)",
        CRYPTO_EPOCH_FLOOR_MS,
        CRYPTO_EPOCH_CEILING_MS,
        "the instant is outside the crypto data sanity window",
      ),
    };
  }
  return { ok: true, ms };
}

/** The canonical text of the parsed instant, for the round-trip check. */
function roundTrip(original: string): string {
  // Normalize the fraction to exactly 3 digits (millisecond precision).
  const match = ISO_8601_UTC.exec(original);
  if (match === null) {
    return original;
  }
  const fraction = match[7] ?? "";
  const millis = fraction.padEnd(3, "0").slice(0, 3);
  return `${match[1]!}-${match[2]!}-${match[3]!}T${match[4]!}:${match[5]!}:${match[6]!}.${millis}Z`;
}
