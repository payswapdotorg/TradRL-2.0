/**
 * Counterfactual branch planning (W025) — the PURE derivation that turns a
 * typed {@link CounterfactualBranch} descriptor plus a live parent engine
 * into a complete, restorable branch plan: the branch world definition, the
 * typed lineage record, and the branch's GENESIS SNAPSHOT.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A8/A9 and spec/WORLD-PROTOCOL.md
 * "Snapshots"/"Branches". The genesis snapshot is the restore-to-point
 * capture the branch engine is created from (engine.ts): a complete W016
 * `WorldSnapshot` whose state is the W016 branch genesis state
 * (branch/genesis.ts — rescoped entities, reset registries, scenario
 * override applied) and whose records are EMPTY, because a branch journal
 * is its OWN world's (the one-journal-one-world law, journal/eventJournal.ts)
 * — the shared parent prefix lives on the parent, addressed by the record.
 *
 * LOUD VALIDATION (the whole descriptor, against the live parent): every
 * problem below is a typed `CounterfactualProblem` on the thrown
 * `CounterfactualBranchValidationError`:
 * - `blank-branch-seed` — the seed is empty/whitespace;
 * - `unknown-snapshot` — the parent holds no such snapshot payload;
 * - `snapshot-world-mismatch` — the snapshot belongs to another world;
 * - `snapshot-tampered` — W016 `verifyWorldSnapshot` fails (digest/cursor/
 *   journal-digest disagree with the content);
 * - `prefix-mismatch` — the snapshot's prefix is not the parent's journal
 *   prefix (a foreign or stale snapshot; the parent's own snapshots always
 *   share their records with the journal by construction);
 * - `branch-point-mismatch` — the declared branch point time ≠ the
 *   snapshot's `createdAt`;
 * - `branch-point-beyond-lived-time` — the branch point is after the
 *   parent's current simulation time (cannot fork the future);
 * - `branch-point-before-origin` — the branch point precedes the world's
 *   clock origin;
 * - `branch-is-parent` — the derived branch world id equals the parent's
 *   (a branch is NOT its parent);
 * - `overlay-regime-invalid` — malformed regime entries in the overlay;
 * - `overlay-artifact-invalid` — blank/duplicate/colliding injected
 *   artifact ids;
 * - `branch-definition-invalid` — the composed branch definition fails the
 *   engine's own `validateWorldDefinition` (full detail list attached).
 *
 * Parent immutability is STRUCTURAL here: the planner only READS the parent
 * (journal records, clock, snapshot payloads, lineage) — no port, no
 * command, no mutation path is ever taken.
 */

import type { BranchConfiguration, SnapshotId, WorldId } from "tradrl-world-contracts";
import { validateWorldDefinition, type WorldDefinition } from "../world/definition.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
import type { JournalRecord } from "../journal/eventJournal.js";
import type { WorldSnapshot } from "../snapshot/capture.js";
import { buildWorldSnapshot, verifyWorldSnapshot } from "../snapshot/capture.js";
import { snapshotIdFor } from "../snapshot/capture.js";
import { branchGenesisState } from "../branch/genesis.js";
import {
  CounterfactualBranchValidationError,
  counterfactualBranchDefinition,
  counterfactualEngineIdentity,
  counterfactualWorldIdFor,
  regimeEntryProblems,
  type AppliedCounterfactualOverlay,
  type CounterfactualBranch,
  type CounterfactualBranchRecord,
  type CounterfactualProblem,
} from "./definition.js";

/** The complete, pure plan for one counterfactual branch. */
export interface CounterfactualBranchPlan {
  readonly branchWorldId: WorldId;
  readonly parentWorldId: WorldId;
  readonly sourceSnapshotId: SnapshotId;
  readonly definition: WorldDefinition;
  readonly record: CounterfactualBranchRecord;
  /** The branch's genesis capture (the restore-to-point snapshot). */
  readonly genesisSnapshot: WorldSnapshot;
  /** The W016 branch configuration (scenarioOverride when a regime overlay). */
  readonly configuration: BranchConfiguration | undefined;
  /** The applied overlay (undefined for a control branch). */
  readonly appliedOverlay: AppliedCounterfactualOverlay | undefined;
}

/**
 * The READ-ONLY parent surface the counterfactual framework consumes — a
 * structural subset of {@link HeadlessWorldEngine} (the real engine
 * satisfies it as-is). Making the surface explicit is the parent-
 * immutability law in the type: there is NO mutating member on it.
 */
export interface CounterfactualParentReader {
  readonly worldId: WorldId;
  getSnapshotPayload(snapshotId: SnapshotId): WorldSnapshot | undefined;
  readonly journal: { readonly worldId: WorldId; records(): readonly JournalRecord[] };
  clockState(): { readonly simulationTime: number };
  branchLineage(): readonly BranchLineageRecord[];
}

/** True when the string is blank. */
function isBlank(value: unknown): value is string {
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Plan a counterfactual branch: validate the descriptor loudly against the
 * live parent, derive the content-addressed branch world id, compose the
 * branch definition and capture the genesis snapshot. Pure — no engine is
 * created and the parent is only read.
 */
export function planCounterfactualBranch(input: {
  readonly parent: CounterfactualParentReader;
  readonly branch: CounterfactualBranch;
}): CounterfactualBranchPlan {
  const { parent, branch } = input;
  const problems: CounterfactualProblem[] = [];
  const details: string[] = [];
  const problem = (kind: CounterfactualProblem, detail: string): void => {
    problems.push(kind);
    details.push(detail);
  };

  if (isBlank(branch.seed)) {
    problem("blank-branch-seed", "the branch seed must be a non-blank string");
  }

  const snapshot = parent.getSnapshotPayload(branch.sourceSnapshotId);
  if (snapshot === undefined) {
    problem(
      "unknown-snapshot",
      `snapshot ${String(branch.sourceSnapshotId)} has no restorable payload in world ${String(parent.worldId)}`,
    );
  }

  let prefixOk = false;
  if (snapshot !== undefined) {
    if (snapshot.descriptor.worldId !== parent.worldId) {
      problem(
        "snapshot-world-mismatch",
        `snapshot ${String(branch.sourceSnapshotId)} belongs to world ${String(snapshot.descriptor.worldId)}, not ${String(parent.worldId)}`,
      );
    }
    const verification = verifyWorldSnapshot(snapshot);
    if (!verification.ok) {
      problem(
        "snapshot-tampered",
        `snapshot ${String(branch.sourceSnapshotId)} fails verification: ${verification.problems.join(", ")}`,
      );
    }
    // The shared prefix law: the snapshot's records ARE the parent's first
    // `journalCursor` records (append-only frozen history — true for every
    // snapshot the parent itself took; a foreign payload fails loudly).
    const parentRecords = parent.journal.records();
    const cursor = snapshot.descriptor.journalCursor;
    prefixOk =
      parentRecords.length >= cursor &&
      snapshot.records.every(
        (record, index) => parentRecords[index]?.envelope.eventId === record.envelope.eventId,
      );
    if (!prefixOk) {
      problem(
        "prefix-mismatch",
        `snapshot ${String(branch.sourceSnapshotId)} prefix is not the journal prefix of ${String(parent.worldId)} at cursor ${String(cursor)}`,
      );
    }

    if (branch.branchPointTime !== snapshot.descriptor.createdAt) {
      problem(
        "branch-point-mismatch",
        `declared branch point ${String(branch.branchPointTime)} ≠ snapshot createdAt ${String(snapshot.descriptor.createdAt)}`,
      );
    }
    const livedTo = parent.clockState().simulationTime;
    if (branch.branchPointTime > livedTo) {
      problem(
        "branch-point-beyond-lived-time",
        `branch point ${String(branch.branchPointTime)} is beyond the parent's lived time ${String(livedTo)}`,
      );
    }
    const origin = snapshot.definition.clock.start;
    if (branch.branchPointTime < origin) {
      problem(
        "branch-point-before-origin",
        `branch point ${String(branch.branchPointTime)} precedes the world origin ${String(origin)}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new CounterfactualBranchValidationError(problems, details);
  }
  const parentSnapshot = snapshot!;

  const branchWorldId = counterfactualWorldIdFor({
    parentWorldId: parent.worldId,
    branch,
  });
  if (branchWorldId === parent.worldId) {
    // DEFENSE-IN-DEPTH: structurally unreachable under the current encoder
    // (`cf:<parent>:<digest>` is a strict extension — the prefix never
    // collapses), kept so that any future encoder change that collapses
    // prefixes fails loudly here instead of silently allowing a branch to
    // BE its parent. The law is property-proven in the tests.
    throw new CounterfactualBranchValidationError(
      ["branch-is-parent"],
      [`derived branch world id ${String(branchWorldId)} equals the parent world id (a branch is NOT its parent)`],
    );
  }

  const overlay = branch.overlay;
  if (overlay?.regimeSchedule !== undefined) {
    const regimeProblems = regimeEntryProblems(overlay.regimeSchedule);
    if (regimeProblems.length > 0) {
      throw new CounterfactualBranchValidationError(["overlay-regime-invalid"], regimeProblems);
    }
  }
  if (overlay?.informationArtifacts !== undefined) {
    const inheritedIds = new Set(
      (parentSnapshot.definition.informationArtifacts ?? []).map((artifact) =>
        String(artifact.artifactId),
      ),
    );
    const seen = new Set<string>();
    const artifactProblems: string[] = [];
    for (const [index, artifact] of overlay.informationArtifacts.entries()) {
      const id = String(artifact.artifactId);
      if (isBlank(id)) {
        artifactProblems.push(`informationArtifacts[${String(index)}]: artifactId must be non-blank`);
        continue;
      }
      if (seen.has(id)) {
        artifactProblems.push(`informationArtifacts[${String(index)}]: duplicate injected artifactId ${id}`);
      }
      seen.add(id);
      if (inheritedIds.has(id)) {
        artifactProblems.push(`informationArtifacts[${String(index)}]: artifactId ${id} collides with an inherited artifact`);
      }
      if (!Number.isFinite(artifact.availableAt)) {
        artifactProblems.push(`informationArtifacts[${String(index)}]: availableAt must be finite (A7)`);
      }
    }
    if (artifactProblems.length > 0) {
      throw new CounterfactualBranchValidationError(["overlay-artifact-invalid"], artifactProblems);
    }
  }

  const composed = counterfactualBranchDefinition({
    parentSnapshotDefinition: parentSnapshot.definition,
    branchWorldId,
    branch,
  });
  const definitionErrors = validateWorldDefinition(composed.definition);
  if (definitionErrors.length > 0) {
    throw new CounterfactualBranchValidationError(
      ["branch-definition-invalid"],
      definitionErrors,
    );
  }

  // The genesis capture: the W016 branch genesis state at the branch point,
  // content-addressed with an EMPTY record set (the branch journal is its
  // own world's; the shared prefix stays addressed by the record).
  const genesisSnapshotId = snapshotIdFor(branchWorldId, 0);
  const genesisSnapshot = buildWorldSnapshot({
    definition: composed.definition,
    state: branchGenesisState({
      snapshot: parentSnapshot,
      branchWorldId,
      ...(composed.configuration === undefined
        ? {}
        : { configuration: composed.configuration }),
    }),
    records: [],
    snapshotId: genesisSnapshotId,
    createdAt: parentSnapshot.descriptor.createdAt,
  });

  const identity = counterfactualEngineIdentity();
  const record: CounterfactualBranchRecord = Object.freeze({
    branchWorldId,
    parentWorldId: parent.worldId,
    sourceSnapshotId: branch.sourceSnapshotId,
    snapshotDigest: parentSnapshot.descriptor.digest!,
    genesisSnapshotId,
    genesisSnapshotDigest: genesisSnapshot.descriptor.digest!,
    branchPointSequence: parentSnapshot.descriptor.journalCursor,
    branchPointTime: parentSnapshot.descriptor.createdAt,
    seed: branch.seed,
    overlay: composed.appliedOverlay,
    engine: identity.engine,
    engineVersion: identity.engineVersion,
    mode: "counterfactual",
  });

  return {
    branchWorldId,
    parentWorldId: parent.worldId,
    sourceSnapshotId: branch.sourceSnapshotId,
    definition: composed.definition,
    record,
    genesisSnapshot,
    configuration: composed.configuration,
    appliedOverlay: composed.appliedOverlay,
  };
}
