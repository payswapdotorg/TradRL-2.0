/**
 * The historical-import validator (W020 `tradrl-data`).
 *
 * One pure pass over (descriptor, records, symbol map) collecting EVERY
 * violation (the W004 `validateEventStream` pattern — importers see all
 * problems, never just the first, and no record is ever silently dropped):
 * - descriptor fidelity-declaration laws (`./descriptor.js`);
 * - per-record structural laws (symbol mapping, canonical decimals, bar
 *   interval/OHLC, trade aggressor side, A7 `availableAt` boundary);
 * - dataset-level laws (global event-time order, same-symbol bar interval
 *   non-overlap, declared range coverage, known-gap honesty).
 *
 * The loader (`./loader.js`) runs this first and rejects invalid imports
 * with the complete typed violation list.
 */

import type {
  InstrumentId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type {
  DatasetDescriptor,
  DatasetGap,
  DatasetRange,
  HistoricalBarRecord,
  HistoricalQuoteRecord,
  HistoricalRecord,
  HistoricalTradeRecord,
} from "tradrl-world-contracts/data";
import type { DatasetViolation } from "./errors.js";
import { validateDatasetDescriptor } from "./descriptor.js";
import type { RecordSymbolMap } from "./adapters.js";
import {
  compareCanonicalDecimalText,
  historicalRecordEventTime,
  historicalRecordExtent,
  isCanonicalDecimalText,
} from "./records.js";

/** The complete input of one historical dataset import. */
export interface HistoricalImportInput {
  /** The world the events are imported for (journal identity — never invented). */
  readonly worldId: WorldId;
  readonly descriptor: DatasetDescriptor;
  readonly records: readonly HistoricalRecord[];
  /** Source symbol → instrument mapping; unmapped symbols are rejected loudly. */
  readonly symbolMap: RecordSymbolMap;
}

/** Result of the pure import validation. */
export type DatasetValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly DatasetViolation[] };

/** Runtime shape guard: a usable record object with a known kind. */
function isRecordLike(value: unknown): value is HistoricalRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === "bar" || kind === "trade" || kind === "quote";
}

function isFiniteTime(value: unknown): value is TimestampMs {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Decimal-text field check: canonical + (optional) non-negative is implied by canonical form. */
function decimalField(
  violations: DatasetViolation[],
  index: number,
  field: string,
  value: unknown,
): void {
  if (!isCanonicalDecimalText(value)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)}: ${field} must be canonical decimal text, got '${String(value)}'`,
    });
  }
}

/** A7 boundary law: declared availability never precedes the event-time basis. */
function availabilityViolations(
  record: HistoricalRecord,
  index: number,
): DatasetViolation[] {
  const basis = historicalRecordEventTime(record);
  if (record.availableAt === undefined) {
    return [];
  }
  if (!isFiniteTime(record.availableAt)) {
    return [
      {
        kind: "malformed-record",
        index,
        detail: `record ${String(index)}: availableAt must be a finite timestamp when present`,
      },
    ];
  }
  if (record.availableAt < basis) {
    return [
      {
        kind: "available-before-occurred",
        index,
        detail:
          `record ${String(index)} (${record.kind}): availableAt ${String(record.availableAt)} ` +
          `precedes its event-time basis ${String(basis)} (A7: availability is part of the record)`,
      },
    ];
  }
  return [];
}

function barViolations(record: HistoricalBarRecord, index: number): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  if (!isFiniteTime(record.openTime) || !isFiniteTime(record.closeTime)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (bar): openTime/closeTime must be finite timestamps`,
    });
    return violations;
  }
  if (record.closeTime <= record.openTime) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (bar): closeTime ${String(record.closeTime)} must exceed openTime ${String(record.openTime)}`,
    });
  }
  for (const [field, value] of [
    ["open", record.open],
    ["high", record.high],
    ["low", record.low],
    ["close", record.close],
    ["volume", record.volume],
  ] as const) {
    decimalField(violations, index, field, value);
  }
  const prices: readonly [string, unknown][] = [
    ["open", record.open],
    ["high", record.high],
    ["low", record.low],
    ["close", record.close],
  ];
  if (prices.every(([, value]) => isCanonicalDecimalText(value))) {
    const [open, high, low, close] = [record.open, record.high, record.low, record.close];
    const inconsistent =
      compareCanonicalDecimalText(high, open) < 0 ||
      compareCanonicalDecimalText(high, close) < 0 ||
      compareCanonicalDecimalText(low, open) > 0 ||
      compareCanonicalDecimalText(low, close) > 0 ||
      compareCanonicalDecimalText(low, high) > 0;
    if (inconsistent) {
      violations.push({
        kind: "malformed-record",
        index,
        detail:
          `record ${String(index)} (bar): inconsistent OHLC ` +
          `(o=${String(open)} h=${String(high)} l=${String(low)} c=${String(close)})`,
      });
    }
  }
  return violations;
}

function tradeViolations(
  record: HistoricalTradeRecord,
  index: number,
  seenTradeIds: ReadonlyMap<string, number>,
): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  if (!isFiniteTime(record.timestamp)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (trade): timestamp must be finite`,
    });
  }
  decimalField(violations, index, "price", record.price);
  decimalField(violations, index, "quantity", record.quantity);
  if (record.aggressorSide !== "buy" && record.aggressorSide !== "sell") {
    violations.push({
      kind: "missing-aggressor-side",
      index,
      detail:
        `record ${String(index)} (trade): the W004 trade payload requires aggressorSide ` +
        `(buy|sell) — the source feed must carry it; it is never fabricated`,
    });
  }
  if (record.tradeId !== undefined) {
    if (!isNonBlank(record.tradeId)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (trade): tradeId must be a non-blank string when present`,
      });
    } else {
      const firstIndex = seenTradeIds.get(record.tradeId);
      if (firstIndex !== undefined) {
        violations.push({
          kind: "duplicate-trade-id",
          index,
          detail: `record ${String(index)} (trade): trade id '${record.tradeId}' already used by record ${String(firstIndex)}`,
        });
      }
    }
  }
  return violations;
}

function quoteViolations(record: HistoricalQuoteRecord, index: number): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  if (!isFiniteTime(record.timestamp)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (quote): timestamp must be finite`,
    });
  }
  for (const [field, value] of [
    ["bid", record.bid],
    ["bidSize", record.bidSize],
    ["ask", record.ask],
    ["askSize", record.askSize],
    ["last", record.last],
  ] as const) {
    if (value !== undefined) {
      decimalField(violations, index, field, value);
    }
  }
  return violations;
}

function recordViolations(
  record: HistoricalRecord,
  index: number,
  symbolMap: RecordSymbolMap,
  declaredKinds: ReadonlySet<string>,
  seenTradeIds: ReadonlyMap<string, number>,
): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  if (typeof record !== "object" || record === null) {
    return [
      { kind: "malformed-record", index, detail: `record ${String(index)}: must be an object` },
    ];
  }
  const kind = (record as { readonly kind?: unknown }).kind;
  if (kind !== "bar" && kind !== "trade" && kind !== "quote") {
    return [
      {
        kind: "malformed-record",
        index,
        detail: `record ${String(index)}: unknown record kind '${String(kind)}'`,
      },
    ];
  }
  if (!declaredKinds.has(record.kind)) {
    violations.push({
      kind: "record-kind-undeclared",
      index,
      detail: `record ${String(index)}: kind '${record.kind}' is not declared in descriptor.recordKinds`,
    });
  }
  if (!isNonBlank(record.symbol)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): symbol must be a non-blank string`,
    });
  } else {
    const instrument = symbolMap[record.symbol] as InstrumentId | undefined;
    if (instrument === undefined) {
      violations.push({
        kind: "unknown-symbol",
        index,
        detail: `record ${String(index)} (${record.kind}): no instrument mapping for symbol '${record.symbol}'`,
      });
    } else if (!isNonBlank(instrument)) {
      violations.push({
        kind: "unknown-symbol",
        index,
        detail: `record ${String(index)} (${record.kind}): instrument mapping for symbol '${record.symbol}' is blank`,
      });
    }
  }
  if (record.kind === "bar") {
    violations.push(...barViolations(record, index));
  } else if (record.kind === "trade") {
    violations.push(...tradeViolations(record, index, seenTradeIds));
  } else {
    violations.push(...quoteViolations(record, index));
  }
  violations.push(...availabilityViolations(record, index));
  return violations;
}

function orderingViolations(records: readonly HistoricalRecord[]): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!;
    if (!isRecordLike(record) || !isRecordLike(records[index - 1])) {
      continue; // already reported as malformed — never crash on garbage
    }
    const previous = historicalRecordEventTime(records[index - 1]!);
    const current = historicalRecordEventTime(record);
    if (current < previous) {
      violations.push({
        kind: "out-of-order-records",
        index,
        detail:
          `record ${String(index)}: event time ${String(current)} precedes record ` +
          `${String(index - 1)} at ${String(previous)} (sort explicitly, then import — never silently reordered)`,
      });
    }
  }
  return violations;
}

function barOverlapViolations(records: readonly HistoricalRecord[]): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  const lastBarBySymbol = new Map<string, HistoricalBarRecord>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!isRecordLike(record) || record.kind !== "bar") {
      continue;
    }
    const previous = lastBarBySymbol.get(record.symbol);
    if (previous !== undefined && record.openTime < previous.closeTime) {
      violations.push({
        kind: "overlapping-bars",
        index,
        detail:
          `record ${String(index)} (bar ${record.symbol}): interval [${String(record.openTime)}, ${String(record.closeTime)}) ` +
          `overlaps the previous bar's [${String(previous.openTime)}, ${String(previous.closeTime)})`,
      });
    }
    lastBarBySymbol.set(record.symbol, record);
  }
  return violations;
}

function rangeGapViolations(
  records: readonly HistoricalRecord[],
  range: DatasetRange,
  gaps: readonly DatasetGap[],
): DatasetViolation[] {
  const violations: DatasetViolation[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!isRecordLike(record)) {
      continue; // already reported as malformed — never crash on garbage
    }
    const extent = historicalRecordExtent(record);
    if (range.from !== undefined && isFiniteTime(range.from) && extent.from < range.from) {
      violations.push({
        kind: "record-outside-range",
        index,
        detail: `record ${String(index)} (${record.kind}) starts at ${String(extent.from)} before the declared range.from ${String(range.from)}`,
      });
    }
    if (range.to !== undefined && isFiniteTime(range.to) && extent.to > range.to) {
      violations.push({
        kind: "record-outside-range",
        index,
        detail: `record ${String(index)} (${record.kind}) ends at ${String(extent.to)} after the declared range.to ${String(range.to)}`,
      });
    }
    for (const gap of gaps) {
      const inGap =
        record.kind === "bar"
          ? record.openTime < gap.to && record.closeTime > gap.from
          : record.timestamp >= gap.from && record.timestamp < gap.to;
      if (inGap) {
        violations.push({
          kind: "record-in-declared-gap",
          index,
          detail:
            `record ${String(index)} (${record.kind}) falls inside the declared gap ` +
            `[${String(gap.from)}, ${String(gap.to)}) — the declaration and the data contradict`,
        });
      }
    }
  }
  return violations;
}

/**
 * Validate one historical import completely. Pure: same input ⇒ same
 * violation list, always (no IO, no clock reads, no RNG — A9).
 */
export function validateHistoricalImport(input: HistoricalImportInput): DatasetValidation {
  const violations: DatasetViolation[] = [];
  for (const problem of validateDatasetDescriptor(input.descriptor)) {
    violations.push({ kind: "invalid-descriptor", detail: problem });
  }
  const declaredKinds = new Set<string>(input.descriptor.recordKinds);
  const seenTradeIds = new Map<string, number>();
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index]!;
    violations.push(
      ...recordViolations(record, index, input.symbolMap, declaredKinds, seenTradeIds),
    );
    if (
      isRecordLike(record) &&
      record.kind === "trade" &&
      isNonBlank(record.tradeId) &&
      !seenTradeIds.has(record.tradeId)
    ) {
      seenTradeIds.set(record.tradeId, index);
    }
  }
  violations.push(...orderingViolations(input.records));
  violations.push(...barOverlapViolations(input.records));
  violations.push(
    ...rangeGapViolations(input.records, input.descriptor.range, input.descriptor.knownGaps),
  );
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
