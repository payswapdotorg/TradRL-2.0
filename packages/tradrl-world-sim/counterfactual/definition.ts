/**
 * The counterfactual branch definition (W025) — the TYPED descriptor of a
 * "what if" world branched from a parent world's point in time, and its
 * composition into a branch world definition.
 *
 * Spec: spec/ARCHITECTURE.md §8 "Counterfactual — snapshot-derived child
 * world with explicit altered scenario rules" and §9 "Branching".
 * Spec: spec/ARCHITECTURE-LOCK.md A8 (branching, never destructive rewind —
 * a counterfactual branch is derived from the parent's IMMUTABLE snapshot
 * artifacts; the parent is never written) and A9 (determinism — the branch
 * descriptor is a pure value; the same parent + the same descriptor yield
 * the same branch world identity).
 *
 * DELIBERATE CONTRAST with the W016 branch command (branch/seam.ts): a W016
 * branch is JOURNALED on the parent (one `world.branch.created` record) and
 * the child inherits the parent's definition verbatim (rescoped). A W025
 * counterfactual branch is a HOST-SIDE derivation — the parent journal is
 * NOT touched at all — whose definition carries the branch's OWN seed, the
 * `counterfactual` world mode, and an optional scenario overlay (a regime
 * schedule override and/or injected information artifacts behind the A7
 * firewall). The two families compose: a counterfactual can branch from a
 * W016 branch child (the parent reference is any engine + its snapshot).
 *
 * IDENTITY LAW: the branch world id is CONTENT-ADDRESSED over the whole
 * descriptor (parent, source snapshot, branch point, seed, overlay) — the
 * W016 hashing family (`stableDigest`). Same inputs ⇒ same world id ⇒ the
 * same journal event ids (the A9 twin runs are literally the same world);
 * any counterfactual input difference (seed, overlay, branch point) yields
 * a different world. Injected artifacts are declared WITHOUT a world id —
 * the framework stamps the derived branch id (the participant-runtime
 * stampCommand precedent: identity is minted at the typed boundary, never
 * by the caller), which keeps the id derivation non-circular.
 */

import type {
  BranchConfiguration,
  InformationArtifact,
  NewsPayload,
  RegimeScheduleEntry,
  ScenarioDefinition,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";
import { ENGINE_ID, ENGINE_VERSION } from "../world/definition.js";
import { stableDigest } from "../world/hashing.js";
import { withBranchWorldId } from "../branch/definition.js";

/**
 * An information artifact injected into a counterfactual branch, declared
 * WITHOUT a world id: the framework stamps the derived branch world id
 * (`InformationArtifact.worldId` in the applied overlay). Everything else
 * is the W003 artifact shape verbatim — `availableAt` is honored by the A7
 * firewall exactly as for declared artifacts (an injected artifact is
 * observable only from its `availableAt` on; the counterfactual may inject
 * future-dated information and the firewall still holds).
 */
export type InjectedInformationArtifact = Omit<InformationArtifact<NewsPayload>, "worldId">;

/**
 * The counterfactual scenario overlay — the "what if" axis. Every field is
 * optional; a branch without an overlay is the honest CONTROL arm (same
 * origin, own seed, no scenario change) against which overlay arms compare.
 */
export interface CounterfactualScenarioOverlay {
  /**
   * Replaces the regime schedule in force from the branch point on (the
   * W016 `BranchConfiguration.scenarioOverride` mechanism — "explicit
   * altered scenario rules for counterfactual branches"). The generator
   * acts on the overridden schedule immediately; windows that START after
   * the branch point are announced in the branch journal when their `from`
   * time enters a driven interval (a window whose `from` is at or before
   * the branch point acts without re-announcing — the schedule semantics
   * W017 documents, disclosed here for the counterfactual).
   */
  readonly regimeSchedule?: readonly RegimeScheduleEntry[];
  /** Information artifacts injected into the branch world (A7-firewalled). */
  readonly informationArtifacts?: readonly InjectedInformationArtifact[];
}

/**
 * The typed counterfactual branch descriptor: the parent reference (the
 * source snapshot of the parent world), the branch point (the parent's
 * simulation time the snapshot pins), the branch's OWN seed, and the
 * optional scenario overlay. A pure value — loud-validated as a whole by
 * `planCounterfactualBranch` (genesis.ts) against the live parent.
 */
export interface CounterfactualBranch {
  /** The parent's snapshot to fork from (`snap:<parentWorldId>:<n>`). */
  readonly sourceSnapshotId: SnapshotId;
  /**
   * The branch point on the parent's simulation axis — MUST equal the
   * source snapshot's `createdAt` and lie within the parent's lived time
   * (not before the world origin, not beyond the parent's current clock).
   */
  readonly branchPointTime: TimestampMs;
  /** The branch's OWN seed (drives the branch's generator draws). */
  readonly seed: string;
  /** The optional scenario overlay (regime override / injected artifacts). */
  readonly overlay?: CounterfactualScenarioOverlay;
}

/** The overlay in its APPLIED form: artifacts stamped with the branch id. */
export interface AppliedCounterfactualOverlay {
  readonly regimeSchedule?: readonly RegimeScheduleEntry[];
  readonly informationArtifacts?: readonly InformationArtifact<NewsPayload>[];
}

/** The typed, immutable record of one counterfactual branch (W025 lineage). */
export interface CounterfactualBranchRecord {
  readonly branchWorldId: WorldId;
  readonly parentWorldId: WorldId;
  readonly sourceSnapshotId: SnapshotId;
  /** Content digest of the PARENT snapshot forked from (W016 family). */
  readonly snapshotDigest: string;
  /** The branch's genesis capture id (`snap:<branchWorldId>:0`). */
  readonly genesisSnapshotId: SnapshotId;
  /** Content digest of the branch's genesis capture (W016 family). */
  readonly genesisSnapshotDigest: string;
  /** Parent journal cursor at the branch point. */
  readonly branchPointSequence: number;
  /** Parent simulation time at the branch point. */
  readonly branchPointTime: TimestampMs;
  readonly seed: string;
  /** The applied overlay (undefined for a control branch). */
  readonly overlay: AppliedCounterfactualOverlay | undefined;
  readonly engine: string;
  readonly engineVersion: string;
  readonly mode: "counterfactual";
}

/** Closed set of counterfactual validation problems (loud, typed). */
export type CounterfactualProblem =
  | "blank-branch-seed"
  | "unknown-snapshot"
  | "snapshot-world-mismatch"
  | "snapshot-tampered"
  | "prefix-mismatch"
  | "branch-point-mismatch"
  | "branch-point-beyond-lived-time"
  | "branch-point-before-origin"
  | "branch-is-parent"
  | "overlay-regime-invalid"
  | "overlay-artifact-invalid"
  | "branch-definition-invalid";

/** Thrown when a counterfactual branch descriptor fails validation. */
export class CounterfactualBranchValidationError extends Error {
  constructor(
    readonly problems: readonly CounterfactualProblem[],
    readonly details: readonly string[],
  ) {
    super(
      `[counterfactual] branch rejected: ${problems.join(", ")}${details.length === 0 ? "" : ` — ${details.join("; ")}`}`,
    );
    this.name = "CounterfactualBranchValidationError";
  }
}

/** The six lawful regime kinds (mirrors the W003 `RegimeKind` union). */
const REGIME_KINDS: readonly string[] = [
  "trend",
  "mean-reversion",
  "high-volatility",
  "low-liquidity",
  "shock",
  "halt-reopen",
];

/** Structural validation of overlay regime entries (the W003 entry laws). */
export function regimeEntryProblems(entries: readonly RegimeScheduleEntry[]): readonly string[] {
  const problems: string[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!REGIME_KINDS.includes(String(entry.regime))) {
      problems.push(`regimeSchedule[${String(index)}]: '${String(entry.regime)}' is not a RegimeKind`);
    }
    if (!Number.isFinite(entry.from)) {
      problems.push(`regimeSchedule[${String(index)}]: from must be finite`);
    }
    if (entry.to !== undefined && (!Number.isFinite(entry.to) || entry.to < entry.from)) {
      problems.push(`regimeSchedule[${String(index)}]: to must be finite and not precede from`);
    }
  }
  return problems;
}

/** Strip any caller-supplied world id from an injected artifact (idempotent). */
function artifactContent(artifact: InjectedInformationArtifact): InjectedInformationArtifact {
  const { worldId: _callerSupplied, ...content } = artifact as InformationArtifact<NewsPayload>;
  return content;
}

/**
 * The content-addressed counterfactual branch world id:
 * `cf:<parentWorldId>:<digest>` over the whole descriptor (the W016
 * `prefix:world:discriminator` encoder shape). Pure — the same inputs
 * always derive the same id, so twin runs of the same branch are the SAME
 * world (identical event ids), and any input difference is a different
 * world. Injected artifacts enter by CONTENT (their world id is stamped
 * from this id afterwards — non-circular by construction).
 */
export function counterfactualWorldIdFor(input: {
  readonly parentWorldId: WorldId;
  readonly branch: CounterfactualBranch;
}): WorldId {
  const { branch } = input;
  const overlay = branch.overlay;
  const identity = {
    parentWorldId: String(input.parentWorldId),
    sourceSnapshotId: String(branch.sourceSnapshotId),
    branchPointTime: branch.branchPointTime,
    seed: branch.seed,
    ...(overlay === undefined
      ? {}
      : {
          ...(overlay.regimeSchedule === undefined
            ? {}
            : { regimeSchedule: overlay.regimeSchedule }),
          ...(overlay.informationArtifacts === undefined
            ? {}
            : { informationArtifacts: overlay.informationArtifacts.map(artifactContent) }),
        }),
  };
  return `cf:${String(input.parentWorldId)}:${stableDigest(identity).slice(0, 8)}` as WorldId;
}

/** Compose the branch world definition from the parent snapshot + descriptor. */
export function counterfactualBranchDefinition(input: {
  readonly parentSnapshotDefinition: WorldDefinition;
  readonly branchWorldId: WorldId;
  readonly branch: CounterfactualBranch;
}): {
  readonly definition: WorldDefinition;
  readonly appliedOverlay: AppliedCounterfactualOverlay | undefined;
  /** The W016 branch configuration (scenarioOverride when a regime overlay). */
  readonly configuration: BranchConfiguration | undefined;
} {
  const { branchWorldId, branch } = input;
  const overlay = branch.overlay;
  const rescoped = withBranchWorldId(input.parentSnapshotDefinition, branchWorldId);

  let appliedOverlay: AppliedCounterfactualOverlay | undefined;
  if (overlay !== undefined) {
    appliedOverlay = {
      ...(overlay.regimeSchedule === undefined
        ? {}
        : { regimeSchedule: [...overlay.regimeSchedule] }),
      ...(overlay.informationArtifacts === undefined
        ? {}
        : {
            informationArtifacts: overlay.informationArtifacts.map((artifact) => ({
              ...artifactContent(artifact),
              worldId: branchWorldId,
            })),
          }),
    };
  }

  const injected = appliedOverlay?.informationArtifacts;
  const definition: WorldDefinition = {
    ...rescoped,
    mode: "counterfactual",
    seed: branch.seed,
    ...(injected === undefined
      ? {}
      : {
          informationArtifacts: [...(rescoped.informationArtifacts ?? []), ...injected],
        }),
  };

  const scenarioOverride: ScenarioDefinition | undefined =
    overlay?.regimeSchedule === undefined
      ? undefined
      : { label: "counterfactual-overlay", entries: [...overlay.regimeSchedule] };
  const configuration: BranchConfiguration | undefined =
    scenarioOverride === undefined ? undefined : { scenarioOverride };

  return { definition, appliedOverlay, configuration };
}

/** The engine identity constants the record stamps (W016 lineage shape). */
export function counterfactualEngineIdentity(): {
  readonly engine: string;
  readonly engineVersion: string;
} {
  return { engine: ENGINE_ID, engineVersion: ENGINE_VERSION };
}
