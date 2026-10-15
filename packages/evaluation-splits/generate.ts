/**
 * THE GENERATORS (W052) — pure, deterministic split-family generation.
 *
 * `generateWalkForward(range, windowPolicy)` rolls the train/evaluation
 * window sequence over the input range: fold i trains on
 * `[from + i·evaluationWindow, … + trainWindow)` and evaluates on the next
 * `evaluationWindow` slice, every boundary an explicit W004 timestamp, the
 * fold's sealed knowledge boundary a W050 `PointInTimeCutoff` equal to the
 * train side's end (the R016 no-leakage seam), the evaluation windows tiling
 * the range's evaluation span with no gap and no overlap (disjoint +
 * covering), and the final window clipped to the range's end so the tiling
 * covers the whole span. `generateRegimePartitions`,
 * `generateAssetPartitions`, `generateVenuePartitions` partition the
 * declared atom universe (canonical code-unit order — declaration order
 * never leaks) under the closed partition-rule set (tail-holdout /
 * round-robin / explicit) into DISJOINT, NON-EMPTY sides, emitted in W037's
 * own `HoldoutSplitDescriptor` shapes.
 *
 * A9: same input range + same family policy → deep-equal output, the same
 * canonical ids; no clocks, no randomness, no env reads. A14: the output is
 * typed DATA — never evaluated, never scored.
 *
 * Fail-closed at every seam (the W004 collected-errors pattern): malformed
 * ranges (W004/W037 errors carried), non-positive window policies, ranges
 * too short to roll one evaluation window, blank/empty/duplicate universes,
 * rules outside their own laws, empty sides, non-disjoint partitions,
 * uncovered atoms, atoms outside the universe.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { asPointInTimeCutoff, isLegalCutoff } from "tradrl-time-machine";
import type { HoldoutSplitDescriptor, SplitAtom } from "experiments";
import type {
  PartitionRule,
  SplitAtomUniverse,
  SplitFamilyError,
  SplitFamilyPolicy,
  SplitFamilyRange,
  SplitInstrumentId,
  SplitPeriodAtom,
  SplitTimestampMs,
  WalkForwardFold,
  WalkForwardWindowPolicy,
} from "./families.js";

// ---------------------------------------------------------------------------
// The canonicalization + legality primitives (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * The canonical id order: plain code-unit comparison — deterministic across
 * locales and ICU builds (never `localeCompare`, never the environment).
 */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Is this a positive integer (a window length, a holdout count, a modulus)? */
export function isPositiveInteger(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

/**
 * Is this a lawful range — finite, ordered instants (the W004/W037 period
 * law carried: non-finite instants or `from > to` are refused)?
 */
export function isFiniteRange(range: SplitFamilyRange): boolean {
  return (
    range !== null &&
    typeof range === "object" &&
    typeof range.from === "number" &&
    Number.isFinite(Number(range.from)) &&
    typeof range.to === "number" &&
    Number.isFinite(Number(range.to)) &&
    Number(range.from) <= Number(range.to)
  );
}

/**
 * The canonical atom universe: the declared id lists in canonical code-unit
 * order (declaration order never leaks — A9); the period universe carried
 * as declared.
 */
export function canonicalUniverse(universe: SplitAtomUniverse): SplitAtomUniverse {
  switch (universe.kind) {
    case "period":
      return { kind: "period", from: universe.from, to: universe.to };
    case "regime":
      return { kind: "regime", regimeIds: [...universe.regimeIds].sort(compareCodeUnits) };
    case "asset":
      return {
        kind: "asset",
        instrumentIds: [...universe.instrumentIds].sort(compareCodeUnits),
      };
    case "venue":
      return { kind: "venue", venueIds: [...universe.venueIds].sort(compareCodeUnits) };
  }
}

/** The id list of an id-based universe (the period universe has none). */
export function splitAtomUniverseIds(universe: SplitAtomUniverse): readonly string[] {
  switch (universe.kind) {
    case "period":
      return [];
    case "regime":
      return universe.regimeIds;
    case "asset":
      return universe.instrumentIds;
    case "venue":
      return universe.venueIds;
  }
}

/** The canonical family policy (explicit-side id lists in canonical order). */
export function canonicalPolicy(policy: SplitFamilyPolicy): SplitFamilyPolicy {
  if (policy.kind === "walk-forward") {
    return { ...policy };
  }
  if (policy.rule.kind === "explicit") {
    return {
      ...policy,
      rule: {
        ...policy.rule,
        train: [...policy.rule.train].sort(compareCodeUnits),
        evaluation: [...policy.rule.evaluation].sort(compareCodeUnits),
      },
    };
  }
  return { ...policy };
}

function periodAtom(from: number, to: number): SplitPeriodAtom {
  return { kind: "period", from: from as SplitTimestampMs, to: to as SplitTimestampMs };
}

// ---------------------------------------------------------------------------
// generateWalkForward — the rolling window sequence
// ---------------------------------------------------------------------------

/** The generated window sequence: the folds + their split descriptors. */
export interface WalkForwardGeneration {
  readonly folds: readonly WalkForwardFold[];
  readonly splits: readonly HoldoutSplitDescriptor[];
}

/** The generation outcome: the lawful sequence, or every law violated. */
export type WalkForwardOutcome =
  | { readonly ok: true; readonly generation: WalkForwardGeneration }
  | { readonly ok: false; readonly errors: readonly SplitFamilyError[] };

/**
 * Roll the walk-forward window sequence over the input range. Fold `i`
 * trains on `[from + i·evaluationWindowMs, … + trainWindowMs)` and
 * evaluates on the following `evaluationWindowMs` slice (the final slice
 * clipped to `range.to`); the fold's cutoff is its train side's end — a
 * sealed W050 cutoff, so the evaluation side's instants are ALL post-cutoff
 * (R016). The evaluation windows tile `[from + trainWindowMs, range.to]`
 * exactly: disjoint, covering, no gap, no overlap. Deterministic (A9).
 */
export function generateWalkForward(
  range: SplitFamilyRange,
  policy: WalkForwardWindowPolicy,
): WalkForwardOutcome {
  const errors: SplitFamilyError[] = [];
  if (policy === null || typeof policy !== "object") {
    return { ok: false, errors: [{ code: "invalid-window-policy", message: "the walk-forward window policy is not an object — an axis id and two positive integer window lengths are required" }] };
  }
  if (typeof policy.axisId !== "string" || policy.axisId.trim().length === 0) {
    errors.push({ code: "blank-family-axis", message: "the walk-forward policy declares a blank axis id — every split family names its axis" });
  }
  if (!isPositiveInteger(policy.trainWindowMs) || !isPositiveInteger(policy.evaluationWindowMs)) {
    errors.push({ code: "invalid-window-policy", message: `the walk-forward window policy declares train/evaluation windows that are not positive integer milliseconds (train ${String(policy.trainWindowMs)}, evaluation ${String(policy.evaluationWindowMs)}) — every window is an explicit W004 time span` });
  }
  if (!isFiniteRange(range)) {
    errors.push({ code: "invalid-range", message: `the input range ${String(range?.from)} → ${String(range?.to)} is invalid — instants are finite and ordered (the W004/W037 period law)` });
  } else if (!isLegalCutoff(Number(range.from)) || !isLegalCutoff(Number(range.to))) {
    errors.push({ code: "invalid-range", message: "the walk-forward range instants must be finite non-negative integers — every fold boundary becomes a sealed W050 cutoff (R016)" });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const trainWindowMs = policy.trainWindowMs;
  const evaluationWindowMs = policy.evaluationWindowMs;
  const from = Number(range.from);
  const to = Number(range.to);
  const span = to - from + 1;
  if (span <= trainWindowMs) {
    return { ok: false, errors: [{ code: "range-too-short", message: `the range ${from} → ${to} leaves no evaluation instant after a ${trainWindowMs}ms train window — a walk-forward family rolls at least one evaluation window` }] };
  }

  const foldCount = Math.ceil((span - trainWindowMs) / evaluationWindowMs);
  const folds: WalkForwardFold[] = [];
  const splits: HoldoutSplitDescriptor[] = [];
  for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
    const trainFrom = from + foldIndex * evaluationWindowMs;
    const trainTo = trainFrom + trainWindowMs - 1;
    const evaluationFrom = trainTo + 1;
    const evaluationTo = Math.min(evaluationFrom + evaluationWindowMs - 1, to);
    const fold: WalkForwardFold = {
      foldIndex,
      axisId: `${policy.axisId}-fold-${foldIndex}`,
      train: periodAtom(trainFrom, trainTo),
      evaluation: periodAtom(evaluationFrom, evaluationTo),
      // THE R016 SEAM: the sealed knowledge boundary — everything the train
      // side may know is at or below it; every evaluation-side instant is
      // after it (the evaluation side can never see its train side's future).
      cutoff: asPointInTimeCutoff(trainTo),
    };
    folds.push(fold);
    splits.push({
      axisId: fold.axisId,
      kind: "walk-forward",
      train: [fold.train],
      evaluation: [fold.evaluation],
    });
  }
  return { ok: true, generation: { folds, splits } };
}

// ---------------------------------------------------------------------------
// The id-based partition generators (regime / asset / venue)
// ---------------------------------------------------------------------------

/** The partition outcome: the lawful split descriptor, or every law violated. */
export type PartitionOutcome =
  | { readonly ok: true; readonly split: HoldoutSplitDescriptor }
  | { readonly ok: false; readonly errors: readonly SplitFamilyError[] };

interface IdPartition {
  readonly train: readonly string[];
  readonly evaluation: readonly string[];
}

/** Canonicalize the declared universe: sorted, blank-free, duplicate-free. */
function canonicalUniverseIds(
  ids: readonly string[],
): { readonly ok: true; readonly ids: readonly string[] } | { readonly ok: false; readonly errors: readonly SplitFamilyError[] } {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, errors: [{ code: "empty-universe", message: "the declared atom universe is empty — a partition family splits at least two atoms (W037's atom vocabulary)" }] };
  }
  const errors: SplitFamilyError[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0) {
      errors.push({ code: "blank-atom", message: `the atom universe declares a blank atom id (${typeof id}) — every atom id is explicit`, entryId: String(id) });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ code: "duplicate-atom", message: `the atom '${id}' is declared twice in the universe — one atom, once (never silently deduplicated)`, entryId: id });
    }
    seen.add(id);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, ids: [...ids].sort(compareCodeUnits) };
}

/** Apply one partition rule to the canonical universe (deterministic). */
function partitionUniverse(
  ids: readonly string[],
  rule: PartitionRule,
): { readonly ok: true; readonly partition: IdPartition } | { readonly ok: false; readonly errors: readonly SplitFamilyError[] } {
  const errors: SplitFamilyError[] = [];
  if (rule === null || typeof rule !== "object") {
    return { ok: false, errors: [{ code: "invalid-partition-rule", message: "the partition rule is not an object — one of the closed set (tail-holdout, round-robin, explicit) is required" }] };
  }
  if (rule.kind === "tail-holdout") {
    if (!isPositiveInteger(rule.evaluationCount)) {
      errors.push({ code: "invalid-partition-rule", message: `the tail-holdout rule declares evaluationCount ${String(rule.evaluationCount)} — a positive integer number of atoms` });
    } else if (rule.evaluationCount >= ids.length) {
      errors.push({ code: "empty-split-side", message: `the tail-holdout rule holds out all ${ids.length} atoms of the universe — the train side is empty, and a side with no atoms is not a split (W037 carried)` });
    } else {
      return {
        ok: true,
        partition: {
          train: ids.slice(0, ids.length - rule.evaluationCount),
          evaluation: ids.slice(ids.length - rule.evaluationCount),
        },
      };
    }
  } else if (rule.kind === "round-robin") {
    const modulus = rule.modulus;
    const offset = rule.offset;
    if (
      typeof modulus !== "number" ||
      !Number.isInteger(modulus) ||
      modulus < 2 ||
      typeof offset !== "number" ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= modulus
    ) {
      errors.push({ code: "invalid-partition-rule", message: `the round-robin rule declares modulus ${String(modulus)} / offset ${String(offset)} — the modulus is an integer ≥ 2 and the offset an integer in [0, modulus)` });
    } else {
      const evaluation = ids.filter((_, index) => index % modulus === offset);
      const train = ids.filter((_, index) => index % modulus !== offset);
      if (evaluation.length === 0 || train.length === 0) {
        errors.push({ code: "empty-split-side", message: `the round-robin rule (modulus ${String(modulus)}, offset ${String(offset)}) empties a side over the ${ids.length}-atom universe — a side with no atoms is not a split (W037 carried)` });
      } else {
        return { ok: true, partition: { train, evaluation } };
      }
    }
  } else if (rule.kind === "explicit") {
    const trainList = Array.isArray(rule.train) ? rule.train : [];
    const evaluationList = Array.isArray(rule.evaluation) ? rule.evaluation : [];
    const sides: readonly (readonly [string, readonly string[]])[] = [
      ["train", trainList],
      ["evaluation", evaluationList],
    ];
    for (const [sideName, list] of sides) {
      const reportedDuplicates = new Set<string>();
      for (const id of list) {
        if (typeof id !== "string" || id.trim().length === 0) {
          errors.push({ code: "blank-atom", message: `the '${sideName}' side of the explicit partition declares a blank atom id (${typeof id}) — every atom id is explicit`, entryId: String(id) });
        } else if (
          list.indexOf(id) !== list.lastIndexOf(id) &&
          !reportedDuplicates.has(id)
        ) {
          reportedDuplicates.add(id);
          errors.push({ code: "duplicate-split-atom", message: `the '${sideName}' side of the explicit partition declares the atom '${id}' twice — one atom, one side, once (W037 carried)`, entryId: id });
        }
      }
    }
    const trainSet = new Set(trainList);
    const evaluationSet = new Set(evaluationList);
    for (const id of trainSet) {
      if (evaluationSet.has(id)) {
        errors.push({ code: "overlapping-split-sides", message: `the atom '${id}' is declared on BOTH sides of the explicit partition — a held-out atom never trains (W037 carried)`, entryId: id });
      }
    }
    const universe = new Set(ids);
    for (const [sideName, set] of [
      ["train", trainSet],
      ["evaluation", evaluationSet],
    ] as const) {
      for (const id of set) {
        if (!universe.has(id)) {
          errors.push({ code: "atom-outside-universe", message: `the '${sideName}' side of the explicit partition declares the atom '${id}' outside the declared universe — splits never invent atoms`, entryId: id });
        }
      }
    }
    for (const id of ids) {
      if (!trainSet.has(id) && !evaluationSet.has(id)) {
        errors.push({ code: "uncovered-atom", message: `the atom '${id}' of the declared universe is on neither side of the explicit partition — the partition covers its whole universe`, entryId: id });
      }
    }
    if (trainList.length === 0) {
      errors.push({ code: "empty-split-side", message: "the 'train' side of the explicit partition is empty — a side with no atoms is not a split (W037 carried)" });
    }
    if (evaluationList.length === 0) {
      errors.push({ code: "empty-split-side", message: "the 'evaluation' side of the explicit partition is empty — a side with no atoms is not a split (W037 carried)" });
    }
    if (errors.length === 0) {
      return {
        ok: true,
        partition: {
          train: [...trainSet].sort(compareCodeUnits),
          evaluation: [...evaluationSet].sort(compareCodeUnits),
        },
      };
    }
  } else {
    errors.push({ code: "invalid-partition-rule", message: `unknown partition rule '${String((rule as { readonly kind?: unknown }).kind)}' (the closed set: tail-holdout, round-robin, explicit) — partitions are declared, never invented` });
  }
  return { ok: false, errors };
}

/** Build the split atoms of one id family, in canonical id order. */
function atomsFor(
  kind: "regime" | "asset" | "venue",
  ids: readonly string[],
): readonly SplitAtom[] {
  if (kind === "regime") {
    return ids.map((regimeId) => ({ kind: "regime", regimeId }));
  }
  if (kind === "asset") {
    return ids.map((instrumentId) => ({
      kind: "asset",
      instrumentId: instrumentId as SplitInstrumentId,
    }));
  }
  return ids.map((venueId) => ({ kind: "venue", venueId }));
}

/** The shared id-partition engine (deterministic, fail-closed). */
function generateIdPartitions(
  kind: "regime" | "asset" | "venue",
  ids: readonly string[],
  rule: PartitionRule,
  axisId: string,
): PartitionOutcome {
  const errors: SplitFamilyError[] = [];
  if (typeof axisId !== "string" || axisId.trim().length === 0) {
    errors.push({ code: "blank-family-axis", message: `the '${kind}' partition declares a blank axis id — every split family names its axis` });
  }
  const universe = canonicalUniverseIds(ids);
  if (!universe.ok) {
    return { ok: false, errors: [...errors, ...universe.errors] };
  }
  const partition = partitionUniverse(universe.ids, rule);
  if (!partition.ok) {
    return { ok: false, errors: [...errors, ...partition.errors] };
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const split: HoldoutSplitDescriptor = {
    axisId,
    kind,
    train: atomsFor(kind, partition.partition.train),
    evaluation: atomsFor(kind, partition.partition.evaluation),
  };
  return { ok: true, split };
}

/**
 * Partition the declared regime universe into disjoint, non-empty sides
 * under the partition rule, as W037's own descriptor shape (regime atoms).
 */
export function generateRegimePartitions(
  regimeIds: readonly string[],
  rule: PartitionRule,
  axisId: string,
): PartitionOutcome {
  return generateIdPartitions("regime", regimeIds, rule, axisId);
}

/**
 * Partition the declared asset universe into disjoint, non-empty sides
 * under the partition rule, as W037's own descriptor shape (asset atoms).
 */
export function generateAssetPartitions(
  instrumentIds: readonly SplitInstrumentId[],
  rule: PartitionRule,
  axisId: string,
): PartitionOutcome {
  return generateIdPartitions("asset", instrumentIds, rule, axisId);
}

/**
 * Partition the declared venue universe into disjoint, non-empty sides
 * under the partition rule, as W037's own descriptor shape (venue atoms).
 */
export function generateVenuePartitions(
  venueIds: readonly string[],
  rule: PartitionRule,
  axisId: string,
): PartitionOutcome {
  return generateIdPartitions("venue", venueIds, rule, axisId);
}
