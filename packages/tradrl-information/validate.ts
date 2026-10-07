/**
 * The information-import validator (W027 `tradrl-information`).
 *
 * One pure pass over (descriptor, records, source declarations, symbol map)
 * collecting EVERY violation (the W004 `validateEventStream` pattern —
 * importers see all problems, never just the first, and no record is ever
 * silently dropped):
 * - descriptor fidelity-declaration laws (`./descriptor.js`);
 * - source-declaration laws (credibility is DECLARED, never fabricated —
 *   unknown credibility classes and duplicate declarations are loud);
 * - per-record structural laws (declared source, resolvable symbols,
 *   canonical target prices, finite times, A7 `availableAt` boundary);
 * - dataset-level laws (global publication-time order, declared range
 *   coverage, known-gap honesty, unique record ids).
 *
 * The loader (`./loader.js`) runs this first and rejects invalid imports
 * with the complete typed violation list.
 */

import type {
  InstrumentId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import {
  SOURCE_CREDIBILITIES,
  INFORMATION_CONFIDENCES,
  type InformationConfidence,
  type InformationDatasetDescriptor,
  type InformationRecord,
  type InformationSourceDeclaration,
} from "tradrl-world-contracts/information-data";
import type { InformationViolation } from "./errors.js";
import { validateInformationDatasetDescriptor } from "./descriptor.js";
import type { RecordSymbolMap } from "./adapters.js";
import { isCanonicalDecimalText } from "./records.js";

/** The complete input of one information dataset import. */
export interface InformationImportInput {
  /** The world the artifacts are imported for (identity — never invented). */
  readonly worldId: WorldId;
  readonly descriptor: InformationDatasetDescriptor;
  readonly records: readonly InformationRecord[];
  /**
   * The importer's source declarations — the honesty surface: every record
   * source must be declared here with its credibility class, and the
   * adapter never assigns credibility itself (no fabricated authority).
   */
  readonly sources: readonly InformationSourceDeclaration[];
  /** Feed symbol → instrument mapping; unmapped symbols are rejected loudly. */
  readonly symbolMap: RecordSymbolMap;
}

/** Result of the pure import validation. */
export type InformationValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly InformationViolation[] };

const CREDIBILITIES = new Set<string>(SOURCE_CREDIBILITIES);
const CONFIDENCES = new Set<string>(INFORMATION_CONFIDENCES);

function isFiniteTime(value: unknown): value is TimestampMs {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Runtime shape guard: a usable record object with a known kind. */
function isRecordLike(value: unknown): value is InformationRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  return (
    kind === "research-report" || kind === "news" || kind === "event" || kind === "analyst-note"
  );
}

function sourceDeclarationViolations(
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
function availabilityViolations(
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

function symbolsViolations(
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

function kindViolations(record: InformationRecord, index: number): InformationViolation[] {
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

function recordViolations(
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

function orderingViolations(records: readonly InformationRecord[]): InformationViolation[] {
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

function rangeGapViolations(
  records: readonly InformationRecord[],
  descriptor: InformationDatasetDescriptor,
): InformationViolation[] {
  const violations: InformationViolation[] = [];
  const { from, to } = descriptor.range;
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
    for (const gap of descriptor.knownGaps) {
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

/**
 * Validate one information import completely. Pure: same input ⇒ same
 * violation list, always (no IO, no clock reads, no RNG — A9).
 */
export function validateInformationImport(
  input: InformationImportInput,
): InformationValidation {
  const violations: InformationViolation[] = [];
  for (const problem of validateInformationDatasetDescriptor(input.descriptor)) {
    violations.push({ kind: "invalid-descriptor", detail: problem });
  }
  violations.push(...sourceDeclarationViolations(input.sources));
  const declaredKinds = new Set<string>(input.descriptor.recordKinds);
  const declaredSources = new Set<string>(
    input.sources
      .filter((declaration) => isNonBlank(declaration?.source))
      .map((declaration) => declaration.source),
  );
  const seenSourceIds = new Map<string, number>();
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index]!;
    violations.push(
      ...recordViolations(
        record,
        index,
        declaredKinds,
        declaredSources,
        input.symbolMap,
        seenSourceIds,
      ),
    );
    if (
      isRecordLike(record) &&
      isNonBlank(record.sourceId) &&
      !seenSourceIds.has(record.sourceId)
    ) {
      seenSourceIds.set(record.sourceId, index);
    }
  }
  violations.push(...orderingViolations(input.records));
  violations.push(...rangeGapViolations(input.records, input.descriptor));
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
