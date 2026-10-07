/**
 * Dataset descriptor validation (W020 `tradrl-data`).
 *
 * Spec: spec/SIMULATION.md "Fidelity declarations" — every dataset declares
 * its source, range, granularity, known gaps, limitations and determinism
 * declaration; declarations are HONEST and never claim beyond the data.
 * This module enforces the mechanically checkable descriptor laws and
 * returns every problem found (the `validateWorldDefinition` pattern):
 * the loader turns a non-empty problem list into typed
 * `invalid-descriptor` violations.
 */

import type {
  DatasetDescriptor,
  DatasetGap,
  HistoricalRecordKind,
} from "tradrl-world-contracts/data";

/** The closed set of historical record kinds. */
export const HISTORICAL_RECORD_KINDS: readonly HistoricalRecordKind[] = [
  "bar",
  "trade",
  "quote",
];

/** Type guard for a valid record kind. */
export function isHistoricalRecordKind(value: unknown): value is HistoricalRecordKind {
  return (
    value === "bar" || value === "trade" || value === "quote"
  );
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Structural validation of one known-gap declaration. */
function gapProblems(gap: unknown, index: number): string[] {
  const problems: string[] = [];
  if (typeof gap !== "object" || gap === null) {
    return [`knownGaps[${String(index)}] must be an object`];
  }
  const candidate = gap as Partial<DatasetGap>;
  if (!isFiniteTime(candidate.from) || !isFiniteTime(candidate.to)) {
    problems.push(`knownGaps[${String(index)}]: from/to must be finite timestamps`);
  } else if (candidate.from >= candidate.to) {
    problems.push(
      `knownGaps[${String(index)}]: from ${String(candidate.from)} must precede to ${String(candidate.to)}`,
    );
  }
  if (candidate.reason !== undefined && !isNonBlank(candidate.reason)) {
    problems.push(`knownGaps[${String(index)}]: reason must be a non-blank string when present`);
  }
  return problems;
}

/**
 * Validate a dataset descriptor structurally. Returns every problem (empty
 * list = valid). Pure; deterministic; never throws on bad input — the
 * problem list IS the failure mode.
 */
export function validateDatasetDescriptor(
  descriptor: DatasetDescriptor,
): readonly string[] {
  const problems: string[] = [];
  if (typeof descriptor !== "object" || descriptor === null) {
    return ["descriptor must be an object"];
  }
  if (!isNonBlank(descriptor.datasetId)) {
    problems.push("datasetId must be a non-blank string");
  }
  const source = descriptor.source;
  if (typeof source !== "object" || source === null) {
    problems.push("source must be an object");
  } else {
    if (!isNonBlank(source.provider)) problems.push("source.provider must be a non-blank string");
    if (!isNonBlank(source.name)) problems.push("source.name must be a non-blank string");
    if (!isNonBlank(source.format)) problems.push("source.format must be a non-blank string");
    if (source.obtained !== undefined && !isNonBlank(source.obtained)) {
      problems.push("source.obtained must be a non-blank string when present");
    }
  }
  if (!isNonBlank(descriptor.granularity)) {
    problems.push("granularity must be a non-blank string (the honest scale declaration)");
  }
  if (!Array.isArray(descriptor.recordKinds) || descriptor.recordKinds.length === 0) {
    problems.push("recordKinds must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const kind of descriptor.recordKinds) {
      if (!isHistoricalRecordKind(kind)) {
        problems.push(`recordKinds: '${String(kind)}' is not a historical record kind`);
      } else if (seen.has(kind)) {
        problems.push(`recordKinds: duplicate kind '${kind}'`);
      }
      seen.add(String(kind));
    }
  }
  const range = descriptor.range;
  if (typeof range !== "object" || range === null) {
    problems.push("range must be an object");
  } else {
    if (range.from !== undefined && !isFiniteTime(range.from)) {
      problems.push("range.from must be a finite timestamp when present");
    }
    if (range.to !== undefined && !isFiniteTime(range.to)) {
      problems.push("range.to must be a finite timestamp when present");
    }
    if (isFiniteTime(range.from) && isFiniteTime(range.to) && range.from > range.to) {
      problems.push(`range: from ${String(range.from)} must not exceed to ${String(range.to)}`);
    }
  }
  if (!Array.isArray(descriptor.knownGaps)) {
    problems.push("knownGaps must be an array");
  } else {
    for (let i = 0; i < descriptor.knownGaps.length; i += 1) {
      problems.push(...gapProblems(descriptor.knownGaps[i], i));
    }
    // Gaps must not overlap each other and must sit inside the declared range.
    const gaps = descriptor.knownGaps.filter(
      (gap): gap is DatasetGap =>
        typeof gap === "object" &&
        gap !== null &&
        isFiniteTime((gap as Partial<DatasetGap>).from) &&
        isFiniteTime((gap as Partial<DatasetGap>).to) &&
        (gap as Partial<DatasetGap>).from < (gap as Partial<DatasetGap>).to,
    );
    const ordered = [...gaps].sort((left, right) => left.from - right.from);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]!;
      const current = ordered[i]!;
      if (current.from < previous.to) {
        problems.push(
          `knownGaps: [${String(previous.from)}, ${String(previous.to)}) overlaps [${String(current.from)}, ${String(current.to)})`,
        );
      }
    }
    for (const gap of ordered) {
      if (range?.from !== undefined && isFiniteTime(range.from) && gap.from < range.from) {
        problems.push(
          `knownGaps: [${String(gap.from)}, ${String(gap.to)}) starts before range.from ${String(range.from)}`,
        );
      }
      if (range?.to !== undefined && isFiniteTime(range.to) && gap.to > range.to) {
        problems.push(
          `knownGaps: [${String(gap.from)}, ${String(gap.to)}) ends after range.to ${String(range.to)}`,
        );
      }
    }
  }
  if (!Array.isArray(descriptor.limitations)) {
    problems.push("limitations must be an array (the honest disclosure channel)");
  } else {
    for (const limitation of descriptor.limitations) {
      if (!isNonBlank(limitation)) {
        problems.push("limitations: every entry must be a non-blank string");
      }
    }
  }
  const determinism = descriptor.determinism;
  if (
    determinism?.kind !== "deterministic" &&
    determinism?.kind !== "nondeterministic"
  ) {
    problems.push("determinism must declare kind 'deterministic' or 'nondeterministic'");
  } else if (
    determinism.kind === "nondeterministic" &&
    (!Array.isArray(determinism.sources) ||
      determinism.sources.length === 0 ||
      !determinism.sources.every(isNonBlank))
  ) {
    problems.push(
      "determinism: a nondeterministic dataset must declare its non-empty sources (A9)",
    );
  }
  return problems;
}
