/**
 * The counterfactual branch engine (W025) — creation and hosting.
 *
 * Spec: spec/ARCHITECTURE.md §8 (counterfactual = snapshot-derived child
 * world with explicit altered scenario rules) and §9 (branching).
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — the parent is NEVER mutated: branch
 * creation reads the parent's immutable artifacts only (journal, clock,
 * snapshot payloads, lineage); no parent port is called. Parent immutability
 * is therefore structural at this layer, and re-proven behaviorally by the
 * tests (byte-identical journal/state/snapshot payloads before and after
 * any number of branches, concurrent branches included).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the branch engine is a pure function
 * of (branch definition, genesis capture, clock/command stream): the W016
 * restore path is the mechanism (restore-to-point + continue with a
 * different definition). Same parent + same branch descriptor ⇒ the same
 * content-addressed branch world ⇒ identical journals, wall clocks apart.
 *
 * THE MECHANISM: the branch engine is created through the engine's
 * `restore.snapshot` path over the branch's GENESIS CAPTURE (genesis.ts) —
 * a complete W016 WorldSnapshot whose state is the branch genesis state at
 * the branch point. The branch's own journal therefore starts at sequence
 * 1 in its own world id (the one-journal-one-world law), while the SHARED
 * parent prefix stays addressed by the typed record
 * (`snapshotDigest`/`branchPointSequence` — the comparison module aligns
 * branch journals against it). Passing `journalTail` (the branch's own
 * records) RESTORES a branch run: genesis + tail ≡ the live branch, the
 * W016 restore-equivalence law re-proven at this layer.
 *
 * ENGINE FACTORY SEAM: the default branch engine is the headless engine
 * (with the parent's lineage chain carried). Generated-market parents pass
 * `createGeneratedWorldEngine` (the W017 clock-driven wrapper) — KNOWN W017
 * SEAM, disclosed: the generated wrapper forwards only
 * (definition, restore, wallTimeSource, onPublished) to the inner engine;
 * `lineage` is accepted by its options TYPE but silently dropped, so a
 * generated branch engine reports an empty `branchLineage()` and its
 * determinism manifest records no `inputHashes.genesisSnapshot`. The W025
 * layer compensates: the typed record + the genesis capture carry the
 * content-addressed lineage evidence (record digest, genesis digest), and
 * the tests pin twin equality on journal/state/manifest as a whole.
 */

import type { WallTimeMs } from "tradrl-world-contracts/time";
import type { WorldDefinition } from "../world/definition.js";
import { EngineInvariantError } from "../world/errors.js";
import {
  createHeadlessWorldEngine,
  type EngineRestore,
  type HeadlessWorldEngine,
  type HeadlessWorldEngineOptions,
} from "../world/engine.js";
import type { BranchLineageRecord } from "../branch/lineage.js";
import type { JournalRecord } from "../journal/eventJournal.js";
import type { WorldSnapshot } from "../snapshot/capture.js";
import type { WorldTransport } from "../adapter/transport.js";
import { createInProcessWorldTransport } from "../adapter/inProcess.js";
import type { WorldId } from "tradrl-world-contracts";
import type { CounterfactualBranch } from "./definition.js";
import type { CounterfactualBranchRecord } from "./definition.js";
import {
  planCounterfactualBranch,
  type CounterfactualBranchPlan,
  type CounterfactualParentReader,
} from "./genesis.js";

/**
 * The engine factory a counterfactual branch is created through. The
 * default hosts the headless engine (lineage carried); generated-market
 * parents pass the W017 `createGeneratedWorldEngine` wrapper.
 */
export type CounterfactualEngineFactory = (options: {
  readonly definition: WorldDefinition;
  readonly restore: EngineRestore;
  readonly lineage?: readonly BranchLineageRecord[];
  readonly wallTimeSource?: () => WallTimeMs;
  readonly onPublished?: HeadlessWorldEngineOptions["onPublished"];
}) => HeadlessWorldEngine;

/** A live counterfactual branch: the engine plus its complete plan facts. */
export interface CounterfactualBranchHandle {
  readonly engine: HeadlessWorldEngine;
  readonly record: CounterfactualBranchRecord;
  readonly definition: WorldDefinition;
  /** The genesis capture the engine was restored from (re-restorable). */
  readonly genesisSnapshot: WorldSnapshot;
  readonly parentWorldId: WorldId;
}

/** Options for {@link createCounterfactualBranchEngine}. */
export interface CreateCounterfactualBranchOptions {
  /** The parent world — READ ONLY (never mutated by branch creation). */
  readonly parent: CounterfactualParentReader;
  /** The typed branch descriptor (loud-validated when no `plan` is given). */
  readonly branch: CounterfactualBranch;
  /** A pre-computed plan (skips validation; `planCounterfactualBranch`). */
  readonly plan?: CounterfactualBranchPlan;
  /** Engine factory (default: the headless engine with lineage carried). */
  readonly createEngine?: CounterfactualEngineFactory;
  readonly wallTimeSource?: () => WallTimeMs;
  readonly onPublished?: HeadlessWorldEngineOptions["onPublished"];
  /**
   * The branch's OWN journal records (restoring a branch run): genesis +
   * tail ≡ the live branch. Foreign-world records fail the journal's
   * one-world law at creation (loud `JournalLawViolationError`).
   */
  readonly journalTail?: readonly JournalRecord[];
}

/** The default branch engine: headless, with the parent's lineage carried. */
const defaultBranchEngine: CounterfactualEngineFactory = (options) =>
  createHeadlessWorldEngine({
    definition: options.definition,
    restore: options.restore,
    lineage: options.lineage,
    ...(options.wallTimeSource === undefined
      ? {}
      : { wallTimeSource: options.wallTimeSource }),
    ...(options.onPublished === undefined ? {} : { onPublished: options.onPublished }),
  });

/**
 * Create a counterfactual branch engine from a parent + descriptor: plan
 * (loud validation), restore from the genesis capture, and verify the
 * creation invariants (identity, own empty-or-replayed journal, genesis
 * payload registered, clock at the branch point).
 */
export function createCounterfactualBranchEngine(
  options: CreateCounterfactualBranchOptions,
): CounterfactualBranchHandle {
  const plan =
    options.plan ??
    planCounterfactualBranch({ parent: options.parent, branch: options.branch });
  const tail = options.journalTail ?? [];

  const engine = (options.createEngine ?? defaultBranchEngine)({
    definition: plan.definition,
    restore: { snapshot: plan.genesisSnapshot, ...(tail.length === 0 ? {} : { journalTail: tail }) },
    lineage: options.parent.branchLineage(),
    ...(options.wallTimeSource === undefined
      ? {}
      : { wallTimeSource: options.wallTimeSource }),
    ...(options.onPublished === undefined ? {} : { onPublished: options.onPublished }),
  });

  if (engine.worldId !== plan.branchWorldId) {
    throw new EngineInvariantError(
      `counterfactual branch engine is world ${String(engine.worldId)}, planned ${String(plan.branchWorldId)}`,
    );
  }
  if (engine.journal.getCursor() !== tail.length) {
    throw new EngineInvariantError(
      `counterfactual branch journal cursor ${String(engine.journal.getCursor())} ≠ tail length ${String(tail.length)} (the branch journal is its own world's, starting at sequence 1)`,
    );
  }
  if (engine.getSnapshotPayload(plan.record.genesisSnapshotId) === undefined) {
    throw new EngineInvariantError(
      `counterfactual branch genesis capture ${String(plan.record.genesisSnapshotId)} is not registered for restore`,
    );
  }
  if (
    tail.length === 0 &&
    engine.clockState().simulationTime !== plan.record.branchPointTime
  ) {
    throw new EngineInvariantError(
      `counterfactual branch clock ${String(engine.clockState().simulationTime)} is not at the branch point ${String(plan.record.branchPointTime)}`,
    );
  }

  return {
    engine,
    record: plan.record,
    definition: plan.definition,
    genesisSnapshot: plan.genesisSnapshot,
    parentWorldId: plan.parentWorldId,
  };
}

/** Options for {@link createCounterfactualBranchTransport}. */
export interface CreateCounterfactualBranchTransportOptions
  extends Omit<CreateCounterfactualBranchOptions, "onPublished" | "journalTail"> {
  /** Wall-axis source handed to the transport (default: the host clock). */
  readonly wallTimeSource?: () => WallTimeMs;
}

/**
 * Host a counterfactual branch over the REAL W018 in-process adapter: the
 * transport owns the engine's `onPublished` wiring (projections stream to
 * subscribers), so participants and panes attach through the same provider
 * surface a root world uses (A4/A15 headless parity). The engine factory
 * seam is honored: the transport's `createEngine` hook builds the branch
 * engine through this module (validation + genesis restore).
 */
export function createCounterfactualBranchTransport(
  options: CreateCounterfactualBranchTransportOptions,
): {
  readonly transport: WorldTransport;
  readonly handle: CounterfactualBranchHandle;
} {
  const plan =
    options.plan ??
    planCounterfactualBranch({ parent: options.parent, branch: options.branch });
  let handle: CounterfactualBranchHandle | undefined;
  const transport = createInProcessWorldTransport({
    definition: plan.definition,
    createEngine: (engineOptions) => {
      handle = createCounterfactualBranchEngine({
        parent: options.parent,
        branch: options.branch,
        plan,
        ...(options.createEngine === undefined
          ? {}
          : { createEngine: options.createEngine }),
        wallTimeSource: engineOptions.wallTimeSource,
        onPublished: engineOptions.onPublished,
      });
      return handle.engine;
    },
    ...(options.wallTimeSource === undefined
      ? {}
      : { wallTimeSource: options.wallTimeSource }),
  });
  if (handle === undefined) {
    throw new EngineInvariantError(
      "the in-process transport did not construct the counterfactual branch engine",
    );
  }
  return { transport, handle };
}
