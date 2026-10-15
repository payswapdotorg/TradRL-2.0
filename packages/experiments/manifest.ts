/**
 * The experiment manifest (W037) — which trajectory records belong to the
 * experiment, the holdout split assignments, and the integrity requirements
 * carried forward.
 *
 * Spec: spec/ARCHITECTURE.md §13 — holdouts are "unseen periods,
 * walk-forward, regime/asset/venue holdouts": each declared policy holdout
 * axis gets its split AS DATA (declarative split descriptors — periods,
 * regimes, assets, venues — never computed statistics; the split atoms are
 * declared, not measured). The integrity requirements declared on the
 * policy's axes are carried forward onto the manifest verbatim.
 *
 * FAIL-CLOSED: an unknown holdout kind, a split for an axis the policy never
 * declared, a split whose kind disagrees with its axis, atoms of the wrong
 * family, empty/duplicate/overlapping split sides, a trajectory whose scope
 * is not the experiment's own (tenant/project/world/experiment), or a
 * duplicate trajectory — every one is a loud typed error naming the law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { HOLDOUT_KINDS } from "learning-objectives";
import type { HoldoutKind, IntegrityRequirementKind } from "learning-objectives";
import { blankTrajectoryScopeMembers, canonicalString } from "trajectory";
import type { TrajectoryId, TrajectoryScope } from "trajectory";
import type { InstrumentId, TimestampMs } from "tradrl-world-contracts";
import type { Experiment, ExperimentId, WorldDefinitionRef } from "./descriptor.js";

// ---------------------------------------------------------------------------
// The holdout split vocabulary (declarative data)
// ---------------------------------------------------------------------------

/**
 * One split atom — the declared unit of a holdout side. The atom's family
 * must match the split's holdout kind (periods for time-based kinds,
 * regime/asset/venue ids for the id-based kinds).
 */
export type SplitAtom =
  | { readonly kind: "period"; readonly from: TimestampMs; readonly to: TimestampMs }
  | { readonly kind: "regime"; readonly regimeId: string }
  | { readonly kind: "asset"; readonly instrumentId: InstrumentId }
  | { readonly kind: "venue"; readonly venueId: string };

/** Which atom family each holdout kind splits over (the closed table). */
export const HOLDOUT_SPLIT_ATOM_KIND: Readonly<Record<HoldoutKind, SplitAtom["kind"]>> = {
  "unseen-period": "period",
  "walk-forward": "period",
  regime: "regime",
  asset: "asset",
  venue: "venue",
};

/**
 * One declared holdout split: the policy axis it implements, its kind (the
 * axis's own kind), and the two DISJOINT sides — what trains and what is
 * held out for evaluation. Declarative: the atoms are declared data, never
 * computed statistics.
 */
export interface HoldoutSplitDescriptor {
  readonly axisId: string;
  readonly kind: HoldoutKind;
  readonly train: readonly SplitAtom[];
  readonly evaluation: readonly SplitAtom[];
}

// ---------------------------------------------------------------------------
// The trajectory references + the manifest
// ---------------------------------------------------------------------------

/** One trajectory record's membership (identity + explicit scope, as data). */
export interface TrajectoryRef {
  readonly trajectoryId: TrajectoryId;
  readonly scope: TrajectoryScope;
}

/**
 * The experiment manifest: the deterministic experiment identity, the world
 * reference, the member trajectories (canonical id order), the declared
 * holdout splits (canonical kind-then-axis order), and the integrity
 * requirements carried forward from the policy's axes.
 */
export interface ExperimentManifest {
  readonly experimentId: ExperimentId;
  readonly experimentName: string;
  readonly world: WorldDefinitionRef;
  readonly trajectories: readonly TrajectoryRef[];
  readonly holdoutSplits: readonly HoldoutSplitDescriptor[];
  readonly integrity: readonly IntegrityRequirementKind[];
}

export type ExperimentManifestErrorCode =
  | "empty-manifest" // an experiment records at least one trajectory
  | "invalid-trajectory-ref" // a ref's scope is blank (member named)
  | "trajectory-scope-mismatch" // the ref's scope is not this experiment's
  | "duplicate-trajectory" // one trajectory id joins once
  | "blank-split-axis"
  | "unknown-split-kind" // a runtime holdout kind outside the closed set
  | "unknown-split-axis" // the policy declared no such holdout axis
  | "duplicate-split-axis" // one axis, one split
  | "split-kind-mismatch" // the split's kind ≠ the axis's declared kind
  | "split-atom-kind-mismatch" // an atom outside the split kind's family
  | "invalid-period-atom" // non-finite instants or from > to
  | "empty-split-side" // a side with no atoms is not a split
  | "duplicate-split-atom" // one atom, one side, once
  | "overlapping-split-sides"; // a held-out atom never trains

/** One typed manifest error (fail-closed; the law named in the message). */
export interface ExperimentManifestError {
  readonly code: ExperimentManifestErrorCode;
  readonly message: string;
  /** The offending axis/traj id, when the error belongs to one entry. */
  readonly entryId?: string;
}

export type ExperimentManifestOutcome =
  | { readonly ok: true; readonly manifest: ExperimentManifest }
  | { readonly ok: false; readonly errors: readonly ExperimentManifestError[] };

/** The manifest input: the member trajectories + the declared splits. */
export interface ExperimentManifestInput {
  readonly trajectories: readonly TrajectoryRef[];
  readonly holdoutSplits: readonly HoldoutSplitDescriptor[];
}

// ---------------------------------------------------------------------------
// The manifest gate
// ---------------------------------------------------------------------------

/** Validate one split descriptor against the experiment's declared axes. */
function splitErrors(
  split: HoldoutSplitDescriptor,
  declaredAxes: ReadonlyMap<string, HoldoutKind>,
  seenAxisIds: Set<string>,
): ExperimentManifestError[] {
  const errors: ExperimentManifestError[] = [];
  if (String(split.axisId).trim().length === 0) {
    return [
      {
        code: "blank-split-axis",
        message: "a holdout split declares a blank axis id — every split names its policy axis",
      },
    ];
  }
  if (HOLDOUT_KINDS.indexOf(split.kind) < 0) {
    errors.push({
      code: "unknown-split-kind",
      message: `the split for axis '${split.axisId}' declares unknown holdout kind '${String(split.kind)}' (the closed set: ${HOLDOUT_KINDS.join(", ")})`,
      entryId: split.axisId,
    });
    return errors;
  }
  if (seenAxisIds.has(split.axisId)) {
    errors.push({
      code: "duplicate-split-axis",
      message: `the holdout axis '${split.axisId}' is split twice — one axis, one split`,
      entryId: split.axisId,
    });
  }
  seenAxisIds.add(split.axisId);
  const declaredKind = declaredAxes.get(split.axisId);
  if (declaredKind === undefined) {
    errors.push({
      code: "unknown-split-axis",
      message: `the split names axis '${split.axisId}' but the experiment's evaluation policy declares no such holdout axis — splits never invent axes`,
      entryId: split.axisId,
    });
    return errors;
  }
  if (declaredKind !== split.kind) {
    errors.push({
      code: "split-kind-mismatch",
      message: `the split for axis '${split.axisId}' declares kind '${String(split.kind)}' but the policy declared that axis as '${declaredKind}' — a split never re-kinds its axis`,
      entryId: split.axisId,
    });
  }
  const atomKind = HOLDOUT_SPLIT_ATOM_KIND[split.kind];
  const sides: readonly (readonly [string, readonly SplitAtom[]])[] = [
    ["train", split.train],
    ["evaluation", split.evaluation],
  ];
  for (const [sideName, atoms] of sides) {
    if (atoms.length === 0) {
      errors.push({
        code: "empty-split-side",
        message: `the '${sideName}' side of the split for axis '${split.axisId}' is empty — a side with no atoms is not a split`,
        entryId: split.axisId,
      });
    }
    const seen = new Set<string>();
    for (const atom of atoms) {
      const rendering = canonicalString(atom);
      if (seen.has(rendering)) {
        errors.push({
          code: "duplicate-split-atom",
          message: `the '${sideName}' side of the split for axis '${split.axisId}' declares the same atom twice (${rendering})`,
          entryId: split.axisId,
        });
      }
      seen.add(rendering);
      if (atom.kind !== atomKind) {
        errors.push({
          code: "split-atom-kind-mismatch",
          message: `the split for axis '${split.axisId}' (kind '${String(split.kind)}') carries a '${String(atom.kind)}' atom — only '${atomKind}' atoms belong to this kind`,
          entryId: split.axisId,
        });
      }
      if (atom.kind === "period" && (!Number.isFinite(Number(atom.from)) || !Number.isFinite(Number(atom.to)) || Number(atom.from) > Number(atom.to))) {
        errors.push({
          code: "invalid-period-atom",
          message: `the period atom of axis '${split.axisId}' is invalid (${String(atom.from)} → ${String(atom.to)}) — instants are finite and ordered`,
          entryId: split.axisId,
        });
      }
    }
  }
  const trainSet = new Set(split.train.map((atom) => canonicalString(atom)));
  for (const atom of split.evaluation) {
    if (trainSet.has(canonicalString(atom))) {
      errors.push({
        code: "overlapping-split-sides",
        message: `the atom ${canonicalString(atom)} is declared on BOTH sides of the split for axis '${split.axisId}' — a held-out atom never trains`,
        entryId: split.axisId,
      });
    }
  }
  return errors;
}

/**
 * Build the experiment manifest — THE MANIFEST GATE. Every trajectory ref
 * must carry THIS experiment's scope (tenant/project/world/experiment — the
 * derived experiment id) and join once; every holdout split must implement a
 * DECLARED policy axis with that axis's own kind, atoms of the right family,
 * non-empty, duplicate-free, disjoint sides. The assembled manifest carries
 * the trajectories in canonical id order, the splits in canonical
 * kind-then-axis order, and the policy's integrity requirements verbatim.
 */
export function experimentManifestOf(
  experiment: Experiment,
  input: ExperimentManifestInput,
): ExperimentManifestOutcome {
  const errors: ExperimentManifestError[] = [];
  const descriptor = experiment.descriptor;

  if (input.trajectories.length === 0) {
    errors.push({
      code: "empty-manifest",
      message: "the manifest declares no trajectories — an experiment records at least one trajectory (fail-closed)",
    });
  }

  const seenTrajectories = new Set<string>();
  for (const ref of input.trajectories) {
    for (const member of blankTrajectoryScopeMembers(ref.scope)) {
      errors.push({
        code: "invalid-trajectory-ref",
        message: `the trajectory ref '${String(ref.trajectoryId)}' carries a blank scope member '${member}' — scope is explicit (DOMAIN-MODEL identity law)`,
        entryId: String(ref.trajectoryId),
      });
    }
    const mismatches: readonly [keyof TrajectoryScope, string][] = [
      ["tenantId", descriptor.tenantId],
      ["projectId", descriptor.projectId],
      ["worldId", descriptor.world.worldId],
      ["experimentId", experiment.experimentId],
    ];
    for (const [member, expected] of mismatches) {
      if (ref.scope[member] !== expected) {
        errors.push({
          code: "trajectory-scope-mismatch",
          message: `the trajectory ref '${String(ref.trajectoryId)}' declares scope.${member} '${String(ref.scope[member])}' but this experiment is '${expected}' — trajectory/experiment scope mismatch`,
          entryId: String(ref.trajectoryId),
        });
      }
    }
    if (seenTrajectories.has(String(ref.trajectoryId))) {
      errors.push({
        code: "duplicate-trajectory",
        message: `the trajectory '${String(ref.trajectoryId)}' joins the experiment twice — one trajectory, one membership`,
        entryId: String(ref.trajectoryId),
      });
    }
    seenTrajectories.add(String(ref.trajectoryId));
  }

  const declaredAxes = new Map<string, HoldoutKind>();
  for (const axis of descriptor.policy.axes.holdouts) {
    declaredAxes.set(axis.axisId, axis.kind);
  }
  const seenAxisIds = new Set<string>();
  for (const split of input.holdoutSplits) {
    errors.push(...splitErrors(split, declaredAxes, seenAxisIds));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const trajectories = [...input.trajectories].sort((left, right) =>
    String(left.trajectoryId).localeCompare(String(right.trajectoryId)),
  );
  const holdoutSplits = [...input.holdoutSplits].sort((left, right) => {
    const kindDelta =
      HOLDOUT_KINDS.indexOf(left.kind) - HOLDOUT_KINDS.indexOf(right.kind);
    return kindDelta !== 0 ? kindDelta : left.axisId.localeCompare(right.axisId);
  });
  const manifest: ExperimentManifest = {
    experimentId: experiment.experimentId,
    experimentName: descriptor.name,
    world: descriptor.world,
    trajectories,
    holdoutSplits,
    integrity: experiment.policy.descriptor.axes.integrity,
  };
  Object.freeze(manifest);
  return { ok: true, manifest };
}
