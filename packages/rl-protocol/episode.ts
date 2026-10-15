/**
 * The Episode contract (W047) — ONE RL learning unit as typed DATA.
 *
 * The chain: W037 captures trajectories (the empirical record of
 * agent-world sessions); W036 ships the constraint-aware evaluation
 * contract; W038 walks experiments into evaluations; W044 binds agents to
 * worlds. THIS package types what an RL trainer consumes: an episode is a
 * RECORDED trajectory's evidence re-shaped for learning — never re-scored,
 * never re-run. The reward signal rides ON W036's `PolicyEvaluation`
 * (components + constraints carried verbatim); the observation→action→
 * outcome steps are the trajectory's own §10 evidence capsules, carried
 * verbatim (re-structuring them would invent data).
 *
 * Spec: spec/ARCHITECTURE.md §12 — "Learning can use RL, offline RL,
 * self-play, adversarial, evolutionary, imitation, preference, bandit or
 * statistical methods depending on evidence." R054 — RL is ONE method;
 * this contract is METHOD-NEUTRAL (no JAX, no gradients, no trainer).
 *
 * Spec: spec/ARCHITECTURE.md §13 — "Raw P&L is never the sole objective."
 * W036 enforces the law at reward-model construction; THIS package enforces
 * it again at episode construction — a carried evaluation whose reward
 * components are ALL from the financial-outcome family (an empty component
 * list included) is the loud typed refusal `pnl-sole-reward`, naming the
 * law. Defensive depth: the W036 gate makes the lawful case unreachable
 * through real capture, but the bridge consumes recorded data, and
 * recorded data is re-proven, never trusted (fail-closed at every seam).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the episode id is the
 * canonical content digest over the provenance triple (pure function of
 * recorded bytes — no clocks, no randomness, no env reads); identical
 * provenance ⇒ identical episode, deep-equal.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceCapsule, PolicyEvaluation } from "learning-objectives";
import { REWARD_COMPONENT_FAMILY } from "learning-objectives";
import { blankTrajectoryScopeMembers, canonicalDigestHex } from "trajectory";
import type { TrajectoryId, TrajectoryLineage, TrajectoryScope } from "trajectory";
import type { ExperimentEvaluationId } from "evaluation";
import type { ExperimentId } from "experiments";
import type { AgentBindingId } from "world-agent-runtime";

// ---------------------------------------------------------------------------
// The steps + the reward signal (carried verbatim — never re-derived)
// ---------------------------------------------------------------------------

/**
 * ONE observation→action→outcome step: the W036 §10 evidence capsule,
 * CARRIED VERBATIM from the trajectory's own evidence stream (the W035
 * pass record — observation → decision metadata → admission → action —
 * plus the settled resulting-state read). The bridge never re-structures,
 * re-orders, or re-scores these: the capsule IS the step.
 */
export type EpisodeStep = EvidenceCapsule;

// ---------------------------------------------------------------------------
// The provenance (every citation an opaque id, never parsed)
// ---------------------------------------------------------------------------

/**
 * The episode's provenance — the three records the episode descends from:
 * the W037 trajectory (the empirical source), the W044 binding (the agent
 * identity's proven route into the world), and the W038 experiment
 * evaluation (the verified outcome summary), plus the experiment the
 * trajectory ran under. Ids are OPAQUE (DOMAIN-MODEL identity law): they
 * are cited, never parsed.
 */
export interface EpisodeProvenance {
  readonly trajectoryId: TrajectoryId;
  readonly bindingId: AgentBindingId;
  readonly evaluationId: ExperimentEvaluationId;
  readonly experimentId: ExperimentId;
}

/** The provenance members, in canonical order (validation + rendering). */
export const EPISODE_PROVENANCE_MEMBERS: readonly (keyof EpisodeProvenance)[] = [
  "trajectoryId",
  "bindingId",
  "evaluationId",
  "experimentId",
];

/** The blank provenance members (the fail-closed identity gate's offenders). */
export function blankEpisodeProvenanceMembers(
  provenance: EpisodeProvenance,
): readonly (keyof EpisodeProvenance)[] {
  return EPISODE_PROVENANCE_MEMBERS.filter((member) => String(provenance[member]).trim().length === 0);
}

// ---------------------------------------------------------------------------
// The episode (typed DATA)
// ---------------------------------------------------------------------------

declare const episodeIdBrand: unique symbol;

/**
 * An OPAQUE episode id (a canonical digest rendering). It is produced only
 * by {@link episodeIdOf} and is never parsed — the provenance is carried
 * explicitly on every episode, never recovered by splitting the id.
 */
export type EpisodeId = string & { readonly [episodeIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const EPISODE_ID_PREFIX = "ep-";

/**
 * The immutable episode lineage: the episode's ancestry IS its
 * trajectory's ancestry (W037 branch lineage), carried verbatim. An
 * episode never branches on its own — a new trajectory branches, and a new
 * episode descends from it.
 */
export interface EpisodeLineage {
  readonly trajectory: TrajectoryLineage;
}

/**
 * ONE recorded session as an RL learning unit: the opaque episode id, the
 * explicit scope, the provenance citations, the carried steps, the
 * constraint-aware reward signal, and the immutable lineage. Typed DATA
 * only — assembling it from recorded trajectories + evaluations + bindings
 * is the bridge service's job (`services/learning/rl`, A14).
 */
export interface Episode {
  readonly episodeId: EpisodeId;
  readonly scope: TrajectoryScope;
  readonly provenance: EpisodeProvenance;
  readonly steps: readonly EpisodeStep[];
  readonly reward: PolicyEvaluation;
  readonly lineage: EpisodeLineage;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type EpisodeErrorCode =
  | "blank-scope-member" // the identity scope is not explicit
  | "blank-provenance-member" // a provenance citation is blank
  | "scope-experiment-mismatch" // the scope and the provenance cite different experiments
  | "empty-steps" // no steps: an episode over nothing is never silently built
  | "pnl-sole-reward" // THE §13 LAW: a bare-P&L reward signal, refused loudly
  | "invalid-lineage"; // a branch-lineage law was violated (named in the message)

/** One typed episode error (fail-closed). */
export interface EpisodeError {
  readonly code: EpisodeErrorCode;
  readonly message: string;
}

export type EpisodeOutcome =
  | { readonly ok: true; readonly episode: Episode }
  | { readonly ok: false; readonly errors: readonly EpisodeError[] };

// ---------------------------------------------------------------------------
// The construction gate
// ---------------------------------------------------------------------------

/** The episode construction input: recorded data, re-proven never trusted. */
export interface EpisodeInput {
  readonly scope: TrajectoryScope;
  readonly provenance: EpisodeProvenance;
  readonly steps: readonly EpisodeStep[];
  readonly reward: PolicyEvaluation;
  /** The trajectory's own lineage, carried verbatim. */
  readonly lineage: TrajectoryLineage;
}

/**
 * THE §13 sole-P&L probe: a reward signal is constraint-aware only if at
 * least one reward component family is NOT financial-outcome. An empty
 * component list is also refused — a reward over nothing is not
 * constraint-aware either.
 */
export function barePnlReward(reward: PolicyEvaluation): boolean {
  return reward.reward.components.every(
    (component) => REWARD_COMPONENT_FAMILY[component.kind] === "financial-outcome",
  );
}

function lineageViolations(
  lineage: TrajectoryLineage,
  trajectoryId: TrajectoryId,
): EpisodeError[] {
  if (lineage.parent === undefined) {
    if (lineage.root !== trajectoryId || lineage.ordinal !== 0) {
      return [
        {
          code: "invalid-lineage",
          message:
            "a root trajectory's lineage must be (root = own id, ordinal 0) — the episode carries its trajectory's lineage verbatim, never edited",
        },
      ];
    }
    return [];
  }
  if (
    lineage.parent === trajectoryId ||
    String(lineage.root).trim().length === 0 ||
    !Number.isInteger(lineage.ordinal) ||
    lineage.ordinal < 1
  ) {
    return [
      {
        code: "invalid-lineage",
        message:
          "the branch lineage is invalid (self-parent, blank root, or ordinal < 1) — branch lineage is immutable",
      },
    ];
  }
  return [];
}

/**
 * The episode id: the canonical content digest over the provenance triple
 * (trajectory + binding + evaluation). Pure and deterministic (A9): the
 * same provenance always yields the same id; the experiment citation rides
 * inside the evaluation's own content address, so the triple is complete.
 */
export function episodeIdOf(
  provenance: Pick<EpisodeProvenance, "trajectoryId" | "bindingId" | "evaluationId">,
): EpisodeId {
  return `${EPISODE_ID_PREFIX}${canonicalDigestHex({
    trajectoryId: provenance.trajectoryId,
    bindingId: provenance.bindingId,
    evaluationId: provenance.evaluationId,
  })}` as EpisodeId;
}

/**
 * Construct one episode from recorded data — THE CONSTRUCTION GATE. Every
 * episode law is checked here, loudly: the explicit scope, the non-blank
 * provenance citations, the scope/experiment agreement, the non-empty
 * steps, the §13 constraint-aware reward (a bare-P&L signal is the typed
 * refusal `pnl-sole-reward`, naming the law), and the immutable lineage.
 * The sealed episode's own objects (the provenance, the lineage) are
 * frozen; the carried steps and reward stay the caller's data (they
 * reference the trajectory's own capsules and evaluation — copying them
 * would invent data).
 */
export function episodeOf(input: EpisodeInput): EpisodeOutcome {
  const errors: EpisodeError[] = [];

  for (const member of blankTrajectoryScopeMembers(input.scope)) {
    errors.push({
      code: "blank-scope-member",
      message: `the episode scope member '${member}' is blank — tenant/project/world/experiment/session scope is explicit (DOMAIN-MODEL identity law), never defaulted`,
    });
  }

  for (const member of blankEpisodeProvenanceMembers(input.provenance)) {
    errors.push({
      code: "blank-provenance-member",
      message: `the episode provenance member '${member}' is blank — an episode cites its trajectory, binding, evaluation, and experiment by OPAQUE id, never blank`,
    });
  }

  if (String(input.scope.experimentId) !== String(input.provenance.experimentId)) {
    errors.push({
      code: "scope-experiment-mismatch",
      message: `the episode scope cites experiment '${String(input.scope.experimentId)}' but the provenance cites '${String(input.provenance.experimentId)}' — one episode, one experiment, fail-closed`,
    });
  }

  if (input.steps.length === 0) {
    errors.push({
      code: "empty-steps",
      message:
        "the episode carries no observation→action→outcome steps — an episode over an empty evidence stream is never silently built (fail-closed)",
    });
  }

  if (barePnlReward(input.reward)) {
    errors.push({
      code: "pnl-sole-reward",
      message:
        "the reward signal is bare P&L (every reward component is financial-outcome, or none exists) — 'Raw P&L is never the sole objective' (§13; R054: RL is one learning method, never a P&L chaser): components + constraints ride VERBATIM through the W036 PolicyEvaluation or the episode is refused",
    });
  }

  errors.push(...lineageViolations(input.lineage, input.provenance.trajectoryId));

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const provenance: EpisodeProvenance = { ...input.provenance };
  const lineage: EpisodeLineage = { trajectory: { ...input.lineage } };
  Object.freeze(provenance);
  Object.freeze(lineage.trajectory);
  Object.freeze(lineage);
  const episode: Episode = {
    episodeId: episodeIdOf(input.provenance),
    scope: input.scope,
    provenance,
    steps: [...input.steps],
    reward: input.reward,
    lineage,
  };
  Object.freeze(episode);
  return { ok: true, episode };
}
