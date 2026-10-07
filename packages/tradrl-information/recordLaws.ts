/**
 * Record-law collectors for the information-import validator (W027
 * `tradrl-information`) — one pure function per law family, each returning
 * its violations (the W004 collect-everything pattern). Split from
 * `./validate.ts` to honor the repo's per-file line budget; the validator
 * orchestrates these in one pass.
 */

import type { InstrumentId, TimestampMs } from "tradrl-world-contracts";
import {
  SOURCE_CREDIBILITIES,
  INFORMATION_CONFIDENCES,
  type InformationConfidence,
  type InformationRecord,
  type InformationSourceDeclaration,
} from "tradrl-world-contracts/information-data";
import type { InformationViolation } from "./errors.js";
import type { RecordSymbolMap } from "./adapters.js";
import { isCanonicalDecimalText } from "./records.js";

const CREDIBILITIES = new Set<string>(SOURCE_CREDIBILITIES);
const CONFIDENCES = new Set<string>(INFORMATION_CONFIDENCES);

export function isFiniteTime(value: unknown): value is TimestampMs {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Runtime shape guard: a usable record object with a known kind. */
export function isRecordLike(value: unknown): value is InformationRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  return (
    kind === "research-report" || kind === "news" || kind === "event" || kind === "analyst-note"
  );
}

/** Source-declaration laws: credibility is DECLARED, never fabricated. */
export function sourceDeclarationViolations(
  sources: readonly InformationSourceDeclaration[],
): InformationViolation[] {
  const violations: InformationViolation[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < sources.length; index += 1) {
    const declaration = sources[index];
    if (typeof declaration !== "object" || declaration === null) {
      violations.push({
        kind: "invalid-source-declaration",
        detail: `sources[${String(index)}] must be an object`,
      });
      continue;
    }
    if (!isNonBlank(declaration.source)) {
      violations.push({
        kind: "invalid-source-declaration",
        detail: `sources[${String(index)}]: source must be a non-blank string`,
      });
      continue;
    }
    if (seen.has(declaration.source)) {
      violations.push({
        kind: "invalid-source-declaration",
        detail: `sources[${String(index)}]: duplicate declaration for source '${declaration.source}'`,
      });
      continue;
    }
    seen.add(declaration.source);
    if (!CREDIBILITIES.has(String(declaration.credibility))) {
      violations.push({
        kind: "invalid-source-declaration",
        detail:
          `sources[${String(index)}] ('${declaration.source}'): credibility ` +
          `'${String(declaration.credibility)}' is not a declared class ` +
          `(one of ${SOURCE_CREDIBILITIES.join("|")})`,
      });
    }
    if (declaration.note !== undefined && !isNonBlank(declaration.note)) {
      violations.push({
        kind: "invalid-source-declaration",
        detail: `sources[${String(index)}] ('${declaration.source}'): note must be a non-blank string when present`,
      });
    }
  }
  return violations;
}

/** A7 boundary law: declared availability never precedes the publication basis. */
export function availabilityViolations(
  record: InformationRecord,
  index: number,
): InformationViolation[] {
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
  if (record.availableAt < record.publishedAt) {
    return [
      {
        kind: "available-before-published",
        index,
        detail:
          `record ${String(index)} (${record.kind}): availableAt ${String(record.availableAt)} ` +
          `precedes its publication time ${String(record.publishedAt)} ` +
          `(A7: availability is part of the record)`,
      },
    ];
  }
  return [];
}

/** Symbol laws: every feed symbol resolvable, no duplicates (never deduped silently). */
export function symbolsViolations(
  record: InformationRecord,
  index: number,
  symbolMap: RecordSymbolMap,
): InformationViolation[] {
  const violations: InformationViolation[] = [];
  const seen = new Set<string>();
  for (const symbol of record.symbols ?? []) {
    if (!isNonBlank(symbol)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (${record.kind}): every symbol must be a non-blank string`,
      });
      continue;
    }
    if (seen.has(symbol)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (${record.kind}): duplicate symbol '${symbol}'`,
      });
      continue;
    }
    seen.add(symbol);
    const instrument = symbolMap[symbol] as InstrumentId | undefined;
    if (instrument === undefined || !isNonBlank(instrument)) {
      violations.push({
        kind: "unknown-symbol",
        index,
        detail: `record ${String(index)} (${record.kind}): no instrument mapping for symbol '${symbol}'`,
      });
    }
  }
  return violations;
}

/** Kind-specific structural laws (confidence, ids, rating, decimals, schedule). */
export function kindViolations(record: InformationRecord, index: number): InformationViolation[] {
  const violations: InformationViolation[] = [];
  const confidence: InformationConfidence | undefined = record.confidence;
  if (confidence !== undefined && !CONFIDENCES.has(String(confidence))) {
    violations.push({
      kind: "malformed-record",
      index,
      detail:
        `record ${String(index)} (${record.kind}): confidence '${String(confidence)}' ` +
        `is not a declared level (one of ${INFORMATION_CONFIDENCES.join("|")})`,
    });
  }
  if (record.sourceId !== undefined && !isNonBlank(record.sourceId)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): sourceId must be a non-blank string when present`,
    });
  }
  if (record.kind === "research-report" || record.kind === "analyst-note") {
    if (record.rating !== undefined && !isNonBlank(record.rating)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (${record.kind}): rating must be a non-blank string when present`,
      });
    }
    if (record.targetPrice !== undefined && !isCanonicalDecimalText(record.targetPrice)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail:
          `record ${String(index)} (${record.kind}): targetPrice must be canonical decimal text, ` +
          `got '${String(record.targetPrice)}'`,
      });
    }
  }
  if (record.kind === "event") {
    if (record.eventType !== undefined && !isNonBlank(record.eventType)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (event): eventType must be a non-blank string when present`,
      });
    }
    if (record.scheduledFor !== undefined && !isFiniteTime(record.scheduledFor)) {
      violations.push({
        kind: "malformed-record",
        index,
        detail: `record ${String(index)} (event): scheduledFor must be a finite timestamp when present`,
      });
    }
  }
  return violations;
}

/** Per-record laws: kind, declared source, structural fields, symbols, A7. */
export function recordViolations(
  record: InformationRecord,
  index: number,
  declaredKinds: ReadonlySet<string>,
  declaredSources: ReadonlySet<string>,
  symbolMap: RecordSymbolMap,
  seenSourceIds: ReadonlyMap<string, number>,
): InformationViolation[] {
  const violations: InformationViolation[] = [];
  if (typeof record !== "object" || record === null) {
    return [
      { kind: "malformed-record", index, detail: `record ${String(index)}: must be an object` },
    ];
  }
  const kind = (record as { readonly kind?: unknown }).kind;
  if (
    kind !== "research-report" &&
    kind !== "news" &&
    kind !== "event" &&
    kind !== "analyst-note"
  ) {
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
  if (!isNonBlank(record.source)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): source must be a non-blank string`,
    });
  } else if (!declaredSources.has(record.source)) {
    violations.push({
      kind: "unknown-source",
      index,
      detail:
        `record ${String(index)} (${record.kind}): source '${record.source}' is not declared ` +
        `in the import's source declarations (credibility is declared, never fabricated)`,
    });
  }
  if (!isNonBlank(record.headline)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): headline must be a non-blank string`,
    });
  }
  if (record.summary !== undefined && !isNonBlank(record.summary)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): summary must be a non-blank string when present`,
    });
  }
  if (!isFiniteTime(record.publishedAt)) {
    violations.push({
      kind: "malformed-record",
      index,
      detail: `record ${String(index)} (${record.kind}): publishedAt must be a finite timestamp`,
    });
  }
  if (isNonBlank(record.sourceId)) {
    const firstIndex = seenSourceIds.get(record.sourceId);
    if (firstIndex !== undefined) {
      violations.push({
        kind: "duplicate-record-id",
        index,
        detail: `record ${String(index)} (${record.kind}): source id '${record.sourceId}' already used by record ${String(firstIndex)}`,
      });
    }
  }
  violations.push(...kindViolations(record, index));
  violations.push(...symbolsViolations(record, index, symbolMap));
  violations.push(...availabilityViolations(record, index));
  return violations;
}

/** Dataset law: publication times never decrease (journal law: time-not-monotonic). */
export function orderingViolations(records: readonly InformationRecord[]): InformationViolation[] {
  const violations: InformationViolation[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!;
    if (!isRecordLike(record) || !isRecordLike(records[index - 1])) {
      continue; // already reported as malformed — never crash on garbage
    }
    if (record.publishedAt < records[index - 1]!.publishedAt) {
      violations.push({
        kind: "out-of-order-records",
        index,
        detail:
          `record ${String(index)}: publication time ${String(record.publishedAt)} precedes record ` +
          `${String(index - 1)} at ${String(records[index - 1]!.publishedAt)} ` +
          `(sort explicitly, then import — never silently reordered)`,
      });
    }
  }
  return violations;
}

/** Dataset law: declared range coverage and known-gap honesty (the W020 law). */
export function rangeGapViolations(
  records: readonly InformationRecord[],
  range: { readonly from?: TimestampMs; readonly to?: TimestampMs },
  gaps: readonly { readonly from: number; readonly to: number }[],
): InformationViolation[] {
  const violations: InformationViolation[] = [];
  const { from, to } = range;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (!isRecordLike(record)) {
      continue; // already reported as malformed — never crash on garbage
    }
    if (from !== undefined && isFiniteTime(from) && record.publishedAt < from) {
      violations.push({
        kind: "record-outside-range",
        index,
        detail:
          `record ${String(index)} (${record.kind}) published at ${String(record.publishedAt)} ` +
          `before the declared range.from ${String(from)}`,
      });
    }
    if (to !== undefined && isFiniteTime(to) && record.publishedAt > to) {
      violations.push({
        kind: "record-outside-range",
        index,
        detail:
          `record ${String(index)} (${record.kind}) published at ${String(record.publishedAt)} ` +
          `after the declared range.to ${String(to)}`,
      });
    }
    for (const gap of gaps) {
      if (
        isFiniteTime(gap.from) &&
        isFiniteTime(gap.to) &&
        record.publishedAt >= gap.from &&
        record.publishedAt < gap.to
      ) {
        violations.push({
          kind: "record-in-declared-gap",
          index,
          detail:
            `record ${String(index)} (${record.kind}) published inside the declared gap ` +
            `[${String(gap.from)}, ${String(gap.to)}) — the declaration and the data contradict`,
        });
      }
    }
  }
  return violations;
}
