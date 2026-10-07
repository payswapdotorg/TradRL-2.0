/**
 * The documented NautilusTrader Bar dtype mapper (W021).
 *
 * Record shape transcribed from the published NautilusTrader data-types
 * reference (see `nautilusTraderCatalog().docs` for the snapshot label): a
 * bar row is `{ bar_type, open, high, low, close, volume, ts_event,
 * ts_init }` — bar_type a string, OHLCV float64 columns, ts_event/ts_init
 * int64 NANOSECONDS. NO parquet IO: mappers consume recorded/documented JSON
 * rows; the real catalog reader is a TL action item.
 *
 * Declared conventions (all tested, all disclosed in the catalog's fidelity
 * declaration):
 * - `bar_type` is "<instrument_id>-<step>-<aggregation>-<price_type>-<specification>";
 *   it is parsed from the RIGHT because the instrument_id itself contains a
 *   dash ("<SYMBOL>-<VENUE>");
 * - `ts_event` is the bar's interval START (the exchange-kline wrangler
 *   convention); the interval END is DERIVED from the bar_type's
 *   step+aggregation (SECOND/MINUTE/HOUR/DAY) or, for the irregular
 *   aggregations (TICK/VOLUME/NOTIONAL/DOLLAR/OPEN_INTEREST), REQUIRED from
 *   the mapping context (`granularityMs`) — never invented;
 * - `ts_init` (object initialization) maps to `availableAt`, validated to
 *   never precede the derived close (the A7 boundary, loudly);
 * - float64 OHLCV columns convert to canonical decimal text via the
 *   shortest round-trip decimal representation (deterministic).
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type { HistoricalBarRecord, HistoricalRecord } from "tradrl-world-contracts/data";
import type { NautilusMappingViolation } from "./errors.js";
import { resolveNautilusInstrument } from "./instruments.js";
import type { NautilusRecordContext, NautilusRecordMapping } from "./mapping.js";
import {
  asPrice,
  asQuantity,
  availabilityViolation,
  decimalOrPush,
  isJsonObject,
  missingField,
  nsFieldOrPush,
  ohlcvViolation,
} from "./shape.js";

/** Documented Bar row (field names per the dtype reference; float64 columns). */
export interface NautilusBarRow {
  readonly bar_type: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly ts_event: number | string;
  readonly ts_init: number | string;
}

/** The time-fixed bar aggregations (interval length derivable from the step). */
export const TIME_AGGREGATIONS: Readonly<Record<string, number>> = {
  SECOND: 1_000,
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
};

/** The irregular bar aggregations (no derivable interval length). */
export const IRREGULAR_AGGREGATIONS: readonly string[] = [
  "TICK",
  "VOLUME",
  "NOTIONAL",
  "DOLLAR",
  "OPEN_INTEREST",
];

/** The documented BarSpecification price types. */
export const BAR_PRICE_TYPES: readonly string[] = ["LAST", "MID", "BID", "ASK"];

/** The documented BarSpecification aggregation sources. */
export const BAR_SPECIFICATIONS: readonly string[] = ["EXTERNAL", "INTERNAL", "COMPUTED"];

/** The parsed parts of one documented bar_type string. */
export interface NautilusBarTypeParts {
  readonly instrumentId: string;
  readonly step: number;
  readonly aggregation: string;
  readonly priceType: string;
  readonly specification: string;
}

/** The granularity label derived from a parsed bar_type (e.g. "1-MINUTE" -> "1m"). */
export function barGranularityLabel(parts: NautilusBarTypeParts): string {
  const unit =
    parts.aggregation === "SECOND"
      ? "s"
      : parts.aggregation === "MINUTE"
        ? "m"
        : parts.aggregation === "HOUR"
          ? "h"
          : parts.aggregation === "DAY"
            ? "d"
            : "irregular";
  return `${String(parts.step)}${unit}`;
}

/**
 * Parse one documented bar_type string. Deterministic: the LAST four
 * dash-separated tokens are specification, price_type, aggregation, step;
 * everything before them is the instrument_id (which itself contains a
 * dash). Every part is validated against the documented closed sets —
 * nothing is guessed, every failure is a typed violation.
 */
export function parseNautilusBarType(
  barType: unknown,
): { readonly ok: true; readonly parts: NautilusBarTypeParts } | { readonly ok: false; readonly violations: readonly NautilusMappingViolation[] } {
  if (typeof barType !== "string" || barType.trim().length === 0) {
    return {
      ok: false,
      violations: [
        missingField("bar_type", "the documented Bar dtype requires the bar_type string"),
      ],
    };
  }
  const tokens = barType.split("-");
  if (tokens.length < 5) {
    return {
      ok: false,
      violations: [
        {
          kind: "malformed-record",
          detail:
            `bar_type '${barType}' must be '<instrument_id>-<step>-<aggregation>-<price_type>-<specification>' ` +
            `with at least 5 dash-separated tokens (the instrument_id itself contains a dash)`,
        },
      ],
    };
  }
  const specification = tokens[tokens.length - 1]!;
  const priceType = tokens[tokens.length - 2]!;
  const aggregation = tokens[tokens.length - 3]!;
  const stepText = tokens[tokens.length - 4]!;
  const instrumentId = tokens.slice(0, tokens.length - 4).join("-");
  const violations: NautilusMappingViolation[] = [];
  const step = Number(stepText);
  if (!/^[1-9][0-9]*$/.test(stepText) || !Number.isSafeInteger(step) || step < 1) {
    violations.push({
      kind: "malformed-record",
      detail: `bar_type step '${stepText}' must be a positive integer`,
    });
  }
  if (!(aggregation in TIME_AGGREGATIONS) && !IRREGULAR_AGGREGATIONS.includes(aggregation)) {
    violations.push({
      kind: "malformed-record",
      detail:
        `bar_type aggregation '${aggregation}' is not a documented aggregation ` +
        `(${[...Object.keys(TIME_AGGREGATIONS), ...IRREGULAR_AGGREGATIONS].join("/")})`,
    });
  }
  if (!BAR_PRICE_TYPES.includes(priceType)) {
    violations.push({
      kind: "malformed-record",
      detail: `bar_type price_type '${priceType}' is not a documented price type (${BAR_PRICE_TYPES.join("/")})`,
    });
  }
  if (!BAR_SPECIFICATIONS.includes(specification)) {
    violations.push({
      kind: "malformed-record",
      detail: `bar_type specification '${specification}' is not a documented specification (${BAR_SPECIFICATIONS.join("/")})`,
    });
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return {
    ok: true,
    parts: {
      instrumentId,
      step,
      aggregation,
      priceType,
      specification,
    },
  };
}

/** Derive the bar interval length (ms) from parsed parts + declared context. */
function durationMsOf(
  parts: NautilusBarTypeParts,
  context: NautilusRecordContext,
  violations: NautilusMappingViolation[],
): number | undefined {
  const unitMs = TIME_AGGREGATIONS[parts.aggregation];
  if (unitMs !== undefined) {
    const duration = parts.step * unitMs;
    if (
      context.granularityMs !== undefined &&
      (typeof context.granularityMs !== "number" || context.granularityMs !== duration)
    ) {
      violations.push({
        kind: "interval-length-mismatch",
        detail:
          `bar_type ${String(parts.step)}-${parts.aggregation} derives a ${String(duration)}ms interval ` +
          `but the mapping context declares ${String(context.granularityMs)}ms`,
      });
    }
    return duration;
  }
  if (
    context.granularityMs === undefined ||
    typeof context.granularityMs !== "number" ||
    !Number.isSafeInteger(context.granularityMs) ||
    context.granularityMs < 1
  ) {
    violations.push(
      missingField(
        "mapping context granularityMs",
        `the bar_type aggregation '${parts.aggregation}' is irregular — its interval length is not derivable; ` +
          `declare the granularity in milliseconds (never invented)`,
      ),
    );
    return undefined;
  }
  return context.granularityMs;
}

/**
 * Map one documented Bar row onto a W020 bar record. Pure; collects every
 * violation. The interval end is the DECLARED derivation
 * `ts_event + duration` (half-open, the exchange-kline interval convention);
 * `ts_init` becomes `availableAt` and is boundary-checked against the close.
 */
export function mapNautilusBar(raw: unknown, context: NautilusRecordContext): NautilusRecordMapping {
  const violations: NautilusMappingViolation[] = [];
  if (!isJsonObject(raw)) {
    return {
      ok: false,
      violations: [{ kind: "malformed-record", detail: `Bar row must be a JSON object, got '${typeof raw}'` }],
    };
  }
  const parsed = parseNautilusBarType(raw.bar_type);
  let parts: NautilusBarTypeParts | undefined;
  if (parsed.ok) {
    parts = parsed.parts;
    const instrument = resolveNautilusInstrument(context.instruments, parsed.parts.instrumentId);
    if (!instrument.ok) {
      violations.push(instrument.violation);
    }
  } else {
    violations.push(...parsed.violations);
  }
  const openTime = nsFieldOrPush("Bar ts_event", raw.ts_event, violations);
  const availableAt = nsFieldOrPush("Bar ts_init", raw.ts_init, violations);
  const open = decimalOrPush("Bar open", raw.open, violations);
  const high = decimalOrPush("Bar high", raw.high, violations);
  const low = decimalOrPush("Bar low", raw.low, violations);
  const close = decimalOrPush("Bar close", raw.close, violations);
  const volume = decimalOrPush("Bar volume", raw.volume, violations);
  if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
    const problem = ohlcvViolation("Bar", open, high, low, close);
    if (problem !== undefined) violations.push(problem);
  }
  let durationMs: number | undefined;
  if (parts !== undefined) {
    durationMs = durationMsOf(parts, context, violations);
  }
  if (
    violations.length > 0 ||
    parts === undefined ||
    openTime === undefined ||
    availableAt === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volume === undefined ||
    durationMs === undefined
  ) {
    return { ok: false, violations };
  }
  const closeTime = (openTime + durationMs) as TimestampMs;
  const boundary = availabilityViolation("Bar ts_init", availableAt, closeTime);
  if (boundary !== undefined) {
    return { ok: false, violations: [...violations, boundary] };
  }
  const record: HistoricalBarRecord = {
    kind: "bar",
    symbol: parts.instrumentId,
    openTime,
    closeTime,
    open: asPrice(open),
    high: asPrice(high),
    low: asPrice(low),
    close: asPrice(close),
    volume: asQuantity(volume),
    availableAt,
  };
  return { ok: true, record: record as HistoricalRecord };
}
