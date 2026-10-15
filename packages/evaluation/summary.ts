/**
 * The trajectory outcome summary + the holdout-split membership derivation
 * (W038) — what the experiment walker aggregates per trajectory.
 *
 * The summary is CARRIED from the record's own outcome summary (the W036
 * `PolicyEvaluation` the W037 capture gate already produced) — the walker
 * never re-scores a record (A13: it measures and aggregates what exists).
 *
 * The holdout membership derivation is a DATA COMPARISON, never a computed
 * statistic: a split's declared atoms (periods / instruments, W037 manifest
 * data) are compared, member by member, against the record's own data (its
 * capsules' observation instants; its decisions' instrument ids). No means,
 * no variances, no fitted quantities — set membership of declared atoms over
 * recorded data, and nothing else. Kinds whose atoms have no counterpart in
 * the record surface (regime, venue) are typed `not-derivable` — the walker
 * never fabricates a membership it cannot derive (fail-closed honesty).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { HoldoutKind } from "learning-objectives";
import type { ConstraintCompliance } from "learning-objectives";
import type { TrajectoryRecord } from "trajectory";
import type { TrajectoryId } from "trajectory";
import type { HoldoutSplitDescriptor, SplitAtom } from "experiments";

// ---------------------------------------------------------------------------
// The trajectory outcome summary (carried, never re-scored)
// ---------------------------------------------------------------------------

/**
 * One trajectory's outcome, carried from its own record's outcome summary
 * (the W036 `PolicyEvaluation`). The compliance dimension is ALWAYS present —
 * "raw P&L is never the sole objective" (§13): no summary here is a bare
 * score, ever.
 */
export interface TrajectoryOutcomeSummary {
  readonly trajectoryId: TrajectoryId;
  readonly policyId: string;
  readonly combinedScore: number;
  readonly appliedSoftPenaltyTotal: number;
  readonly hardViolationCount: number;
  readonly compliance: ConstraintCompliance;
}

/** Carry one record's own outcome summary (never re-scored, A13). */
export function trajectoryOutcomeSummaryOf(record: TrajectoryRecord): TrajectoryOutcomeSummary {
  return {
    trajectoryId: record.trajectoryId,
    policyId: record.evaluation.policyId,
    combinedScore: record.evaluation.combinedScore,
    appliedSoftPenaltyTotal: record.evaluation.appliedSoftPenaltyTotal,
    hardViolationCount: record.evaluation.constraints.hardViolationCount,
    compliance: record.evaluation.compliance,
  };
}

// ---------------------------------------------------------------------------
// The holdout membership derivation (data comparison, not statistics)
// ---------------------------------------------------------------------------

/** How one split's side membership was derived for the walked records. */
export type HoldoutMembershipDerivation =
  | "period-instants" // capsule observation instants vs period atoms, as data
  | "asset-instruments" // decision instrument ids vs asset atoms, as data
  | "not-derivable"; // regime/venue atoms have no counterpart in the record surface

/** Which side of a split one trajectory belongs to (by data comparison). */
export type HoldoutSideAssignment = "train" | "evaluation" | "unassigned";

/** One record's derived membership of one split (derivation + assignment). */
export interface HoldoutMembership {
  readonly derivation: HoldoutMembershipDerivation;
  readonly assignment: HoldoutSideAssignment;
}

const PERIOD_KINDS: readonly string[] = ["unseen-period", "walk-forward"];

/** Is one instant inside one period atom (inclusive bounds, as declared)? */
function instantInAtom(instant: number, atom: SplitAtom): boolean {
  return atom.kind === "period" && Number(atom.from) <= instant && instant <= Number(atom.to);
}

/** One instant's side of a period split: train, evaluation, or neither/both. */
function periodSideOf(
  instant: number,
  split: HoldoutSplitDescriptor,
): "train" | "evaluation" | "outside" | "both" {
  const inTrain = split.train.some((atom) => instantInAtom(instant, atom));
  const inEvaluation = split.evaluation.some((atom) => instantInAtom(instant, atom));
  if (inTrain && inEvaluation) {
    return "both";
  }
  if (inTrain) {
    return "train";
  }
  if (inEvaluation) {
    return "evaluation";
  }
  return "outside";
}

/**
 * The instrument ids one record's decisions actually touched (recorded data —
 * the submit-order commands' instrument ids, nothing else).
 */
function touchedInstruments(record: TrajectoryRecord): readonly string[] {
  const touched = new Set<string>();
  for (const capsule of record.stream.capsules) {
    for (const decision of capsule.pass.stream.decisions) {
      if (decision.command.kind === "submit-order") {
        touched.add(String(decision.command.instrumentId));
      }
    }
  }
  return [...touched].sort();
}

/** One instrument id's side of an asset split (data comparison). */
function assetSideOf(
  instrumentId: string,
  split: HoldoutSplitDescriptor,
): "train" | "evaluation" | "outside" | "both" {
  const inTrain = split.train.some(
    (atom) => atom.kind === "asset" && String(atom.instrumentId) === instrumentId,
  );
  const inEvaluation = split.evaluation.some(
    (atom) => atom.kind === "asset" && String(atom.instrumentId) === instrumentId,
  );
  if (inTrain && inEvaluation) {
    return "both";
  }
  if (inTrain) {
    return "train";
  }
  if (inEvaluation) {
    return "evaluation";
  }
  return "outside";
}

/**
 * Derive one record's membership of one holdout split — a DATA COMPARISON of
 * the split's declared atoms against the record's own recorded data:
 * - period kinds: every capsule's observation instant is compared against the
 *   declared period atoms; a record whose instants all sit in train atoms is
 *   train-side, all in evaluation atoms is evaluation-side, anything else
 *   (mixed, outside, or on both sides) is `unassigned` — the contamination
 *   is surfaced as data, never silently resolved;
 * - asset kind: the instrument ids the record's decisions touched, compared
 *   against the declared asset atoms (same discipline);
 * - regime/venue kinds: `not-derivable` — the record surface carries no
 *   regime or venue counterpart, so no membership is fabricated.
 */
export function holdoutMembershipOf(
  record: TrajectoryRecord,
  split: HoldoutSplitDescriptor,
): HoldoutMembership {
  if (PERIOD_KINDS.includes(String(split.kind))) {
    let sawTrain = false;
    let sawEvaluation = false;
    for (const capsule of record.stream.capsules) {
      const side = periodSideOf(Number(capsule.pass.observedAt), split);
      if (side === "train") {
        sawTrain = true;
      } else if (side === "evaluation") {
        sawEvaluation = true;
      } else {
        // "outside" or "both": not cleanly on one side.
        return { derivation: "period-instants", assignment: "unassigned" };
      }
    }
    const assignment: HoldoutSideAssignment =
      sawTrain && sawEvaluation ? "unassigned" : sawTrain ? "train" : "evaluation";
    return { derivation: "period-instants", assignment };
  }
  if (String(split.kind) === "asset") {
    const touched = touchedInstruments(record);
    if (touched.length === 0) {
      return { derivation: "asset-instruments", assignment: "unassigned" };
    }
    let sawTrain = false;
    let sawEvaluation = false;
    for (const instrumentId of touched) {
      const side = assetSideOf(instrumentId, split);
      if (side === "train") {
        sawTrain = true;
      } else if (side === "evaluation") {
        sawEvaluation = true;
      } else {
        return { derivation: "asset-instruments", assignment: "unassigned" };
      }
    }
    const assignment: HoldoutSideAssignment =
      sawTrain && sawEvaluation ? "unassigned" : sawTrain ? "train" : "evaluation";
    return { derivation: "asset-instruments", assignment };
  }
  return { derivation: "not-derivable", assignment: "unassigned" };
}

// ---------------------------------------------------------------------------
// The per-split aggregation (declarative data + carried summaries)
// ---------------------------------------------------------------------------

/**
 * One holdout split's aggregation: the split carried VERBATIM (the atoms are
 * data, never statistics), the derivation that was possible, and the member
 * trajectories' carried outcome summaries per side — each side in canonical
 * trajectory-id order.
 */
export interface HoldoutSplitAggregation {
  readonly axisId: string;
  readonly kind: HoldoutKind;
  readonly derivation: HoldoutMembershipDerivation;
  /** The declared split, verbatim (periods/regimes/assets/venues as data). */
  readonly split: HoldoutSplitDescriptor;
  readonly train: readonly TrajectoryOutcomeSummary[];
  readonly evaluation: readonly TrajectoryOutcomeSummary[];
  /** Records not cleanly on one side (mixed/outside/both — surfaced, not resolved). */
  readonly unassigned: readonly TrajectoryOutcomeSummary[];
}

/** Sort summaries into canonical trajectory-id order. */
export function canonicalSummaryOrder(
  summaries: readonly TrajectoryOutcomeSummary[],
): TrajectoryOutcomeSummary[] {
  return [...summaries].sort((left, right) =>
    String(left.trajectoryId).localeCompare(String(right.trajectoryId)),
  );
}

/**
 * Aggregate one split over the walked records: per-record membership by data
 * comparison, the carried summaries grouped per side (canonical id order),
 * and the split itself carried verbatim.
 */
export function holdoutSplitAggregationOf(
  split: HoldoutSplitDescriptor,
  records: readonly TrajectoryRecord[],
): HoldoutSplitAggregation {
  const train: TrajectoryOutcomeSummary[] = [];
  const evaluation: TrajectoryOutcomeSummary[] = [];
  const unassigned: TrajectoryOutcomeSummary[] = [];
  let derivation: HoldoutMembershipDerivation = "not-derivable";
  for (const record of records) {
    const membership = holdoutMembershipOf(record, split);
    derivation = membership.derivation;
    const summary = trajectoryOutcomeSummaryOf(record);
    if (membership.assignment === "train") {
      train.push(summary);
    } else if (membership.assignment === "evaluation") {
      evaluation.push(summary);
    } else {
      unassigned.push(summary);
    }
  }
  return {
    axisId: split.axisId,
    kind: split.kind,
    derivation,
    split,
    train: canonicalSummaryOrder(train),
    evaluation: canonicalSummaryOrder(evaluation),
    unassigned: canonicalSummaryOrder(unassigned),
  };
}
