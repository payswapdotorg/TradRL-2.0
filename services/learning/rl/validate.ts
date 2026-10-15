/**
 * The bridge provenance laws (W047) — the typed error family + the
 * pairwise proofs every sealed episode's provenance rests on.
 *
 * The chain: W037 captures trajectories; W036 types the constraint-aware
 * evaluation; W038 walks experiments into evaluations; W044 binds agents
 * to worlds. THIS module proves an episode's provenance THROUGH THOSE
 * PACKAGES' OWN GATES (their validators run here, their errors carried
 * verbatim — carry never re-score, the W038 precedent), plus the bridge's
 * own pairwise laws: scope/world/session agreement between the trajectory
 * and the binding, and the experiment-evaluation's summary as a faithful
 * carry of the record's own W036 evaluation.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — carried data is re-proven, never
 * trusted. Spec: §13 — a bare-P&L reward signal is the loud typed refusal
 * `bare-pnl-reward`, naming the law. Spec: A9 — every proof is a pure
 * function of the recorded bytes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ExperimentEvaluation } from "evaluation";
import { barePnlReward } from "rl-protocol";
import type { Episode, EpisodeError, EpisodeValidationError } from "rl-protocol";
import type { EpisodeBatchError } from "rl-protocol";
import { validateTrajectoryRecord } from "trajectory";
import type { TrajectoryError, TrajectoryRecord } from "trajectory";
import {
  validateAgentBinding,
  validateOrganizationBinding,
} from "world-agent-runtime";
import type {
  AgentBinding,
  OrganizationBinding,
  WorldAgentBinding,
  WorldAgentBindingValidationError,
} from "world-agent-runtime";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type RlBridgeErrorCode =
  | "empty-assembly" // no trajectories: nothing to bridge (fail-closed)
  | "duplicate-episode" // one trajectory, one episode
  | "malformed-trajectory" // W037's own re-validation failed (errors carried)
  | "malformed-binding" // W044's own re-validation failed (errors carried)
  | "missing-binding" // no binding proves this trajectory's agent identity
  | "scope-disagreement" // the trajectory and the binding are different scopes
  | "world-disagreement" // the trajectory and the binding are different worlds
  | "session-disagreement" // the session's mind is not the binding's substrate
  | "missing-experiment-evaluation" // no W038 evaluation covers the experiment
  | "evaluation-mismatch" // the evaluation disagrees with the record's own carry
  | "bare-pnl-reward" // THE §13 LAW: a bare-P&L reward signal, refused loudly
  | "malformed-episode" // the protocol's own construction gate refused (carried)
  | "citation-mismatch" // a sealed episode cites other records than its sources
  | "empty-batch" // a batch of zero episodes is refused
  | "invalid-selection-policy"; // the batch policy laws failed (carried)

/** One typed bridge error (fail-closed; carries the upstream errors verbatim). */
export interface RlBridgeError {
  readonly code: RlBridgeErrorCode;
  readonly message: string;
  /** Present on `malformed-trajectory`: W037's own errors, verbatim. */
  readonly trajectoryErrors?: readonly TrajectoryError[];
  /** Present on `malformed-binding`: W044's own errors, verbatim. */
  readonly bindingErrors?: readonly WorldAgentBindingValidationError[];
  /** Present on `malformed-episode`: the protocol gates' own errors, verbatim. */
  readonly episodeErrors?: readonly (EpisodeError | EpisodeValidationError)[];
  /** Present on `invalid-selection-policy`: the batch gate's own errors, verbatim. */
  readonly batchErrors?: readonly EpisodeBatchError[];
}

// ---------------------------------------------------------------------------
// The pairwise agreement laws (trajectory ↔ binding)
// ---------------------------------------------------------------------------

/** The substrate surfaces one binding proves (an agent mind, or an org's seats). */
function bindingSubstrates(binding: WorldAgentBinding): readonly string[] {
  if (binding.kind === "agent") {
    return [String(binding.substrateId)];
  }
  return binding.seats.map((seat) => String(seat.substrateId));
}

/**
 * The pairwise agreement laws: the trajectory's scope (tenant/project) and
 * world must BE the binding's (an episode's agent identity routes through
 * a binding of its own scope and world), and the session's mind — the
 * trajectory session's substrate — must be a substrate that binding
 * proves in that world.
 */
export function agreementErrors(record: TrajectoryRecord, binding: WorldAgentBinding): RlBridgeError[] {
  const errors: RlBridgeError[] = [];
  if (
    String(record.scope.tenantId) !== String(binding.scope.tenantId) ||
    String(record.scope.projectId) !== String(binding.scope.projectId)
  ) {
    errors.push({
      code: "scope-disagreement",
      message: `the trajectory's scope (${String(record.scope.tenantId)}, ${String(record.scope.projectId)}) disagrees with the binding's (${String(binding.scope.tenantId)}, ${String(binding.scope.projectId)}) — an episode's agent identity routes through a binding of its own scope (fail-closed)`,
    });
  }
  if (
    String(record.scope.worldId) !== String(binding.scope.worldId) ||
    String(record.scope.worldId) !== String(binding.world.scope.worldId)
  ) {
    errors.push({
      code: "world-disagreement",
      message: `the trajectory ran in world '${String(record.scope.worldId)}' but the binding proves world '${String(binding.world.scope.worldId)}' — mixed worlds are refused`,
    });
  }
  if (!bindingSubstrates(binding).includes(String(record.session.substrateId))) {
    errors.push({
      code: "session-disagreement",
      message: `the trajectory session's mind (substrate '${String(record.session.substrateId)}') is not proven by the binding '${String(binding.bindingId)}' (substrates: ${bindingSubstrates(binding).join(", ") || "none"}) — the session's agent identity must route through the binding's own substrate surface`,
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The full provenance law set (the paired triple)
// ---------------------------------------------------------------------------

/** The records one sealed episode's provenance cites. */
export interface EpisodeProvenanceSources {
  readonly trajectory: TrajectoryRecord;
  readonly evaluation: ExperimentEvaluation;
  readonly binding: WorldAgentBinding;
}

/**
 * THE PROVENANCE LAWS for one paired (trajectory, evaluation, binding)
 * triple: W037's own re-validation (errors carried verbatim), W044's own
 * re-validation (agent or organization shape; errors carried verbatim),
 * the pairwise scope/world/session agreements, the evaluation's
 * experiment agreement + its summary as a FAITHFUL CARRY of the record's
 * own W036 evaluation (carry never re-scores — but a carry mismatch is
 * fail-closed), and the §13 constraint-aware reward (a bare-P&L signal is
 * the loud refusal naming the law). Pure, deterministic, all errors at
 * once (A9/A13).
 */
export function provenanceErrorsFor(
  record: TrajectoryRecord,
  evaluation: ExperimentEvaluation,
  binding: WorldAgentBinding,
): RlBridgeError[] {
  const errors: RlBridgeError[] = [];

  const reproof = validateTrajectoryRecord(record);
  if (!reproof.ok) {
    errors.push({
      code: "malformed-trajectory",
      message: `[learning-rl] the trajectory '${String(record.trajectoryId)}' failed W037 re-validation (${String(reproof.errors.length)} error(s)) — W037's own errors carried verbatim; malformed evidence never bridges`,
      trajectoryErrors: reproof.errors,
    });
  }

  const bindingProof =
    binding.kind === "agent"
      ? validateAgentBinding(binding as AgentBinding)
      : validateOrganizationBinding(binding as OrganizationBinding);
  if (!bindingProof.ok) {
    errors.push({
      code: "malformed-binding",
      message: `[learning-rl] the binding '${String(binding.bindingId)}' failed W044 re-validation (${String(bindingProof.errors.length)} error(s)) — W044's own errors carried verbatim; an unproven route never carries an episode`,
      bindingErrors: bindingProof.errors,
    });
  }

  errors.push(...agreementErrors(record, binding));

  if (String(evaluation.experimentId) !== String(record.scope.experimentId)) {
    errors.push({
      code: "evaluation-mismatch",
      message: `the cited evaluation belongs to experiment '${String(evaluation.experimentId)}' but the trajectory ran under '${String(record.scope.experimentId)}' — an episode's reward provenance cites the evaluation of ITS OWN experiment`,
    });
  } else {
    const summary = evaluation.trajectories.find(
      (entry) => String(entry.trajectoryId) === String(record.trajectoryId),
    );
    if (summary === undefined) {
      errors.push({
        code: "evaluation-mismatch",
        message: `the experiment evaluation '${String(evaluation.evaluationId)}' does not summarize the trajectory '${String(record.trajectoryId)}' — an episode's reward provenance cites the evaluation that VERIFIED its trajectory`,
      });
    } else if (
      summary.policyId !== record.evaluation.policyId ||
      summary.combinedScore !== record.evaluation.combinedScore ||
      summary.appliedSoftPenaltyTotal !== record.evaluation.appliedSoftPenaltyTotal ||
      summary.hardViolationCount !== record.evaluation.constraints.hardViolationCount ||
      summary.compliance !== record.evaluation.compliance
    ) {
      errors.push({
        code: "evaluation-mismatch",
        message: `the evaluation's carried summary for trajectory '${String(record.trajectoryId)}' (score ${String(summary.combinedScore)}, compliance '${String(summary.compliance)}') disagrees with the record's own W036 evaluation (score ${String(record.evaluation.combinedScore)}, compliance '${String(record.evaluation.compliance)}') — carry never re-scores, but a carry MISMATCH is fail-closed`,
      });
    }
  }

  if (barePnlReward(record.evaluation)) {
    errors.push({
      code: "bare-pnl-reward",
      message: `the reward signal of trajectory '${String(record.trajectoryId)}' is bare P&L (every reward component financial-outcome: ${record.evaluation.reward.components.map((component) => String(component.kind)).join(", ") || "none"}) — 'Raw P&L is never the sole objective' (§13; R054: RL is one learning method, never a P&L chaser): the reward rides VERBATIM through W036's constraint-aware PolicyEvaluation or nothing bridges`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// The sealed-episode re-validation (the consumer's proof, W048-facing)
// ---------------------------------------------------------------------------

export type EpisodeProvenanceValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly RlBridgeError[] };

/**
 * Re-validate one SEALED episode against the records its provenance
 * cites: the full provenance law set over the sources, plus the citation
 * agreement (the episode must cite exactly these trajectory/binding/
 * evaluation ids and carry exactly the trajectory's scope). The episode's
 * own shape laws are the protocol package's re-validation
 * (`validateEpisode`); this gate proves the BRIDGE's laws. Pure,
 * deterministic (A9); carried data re-proven, never trusted (A13).
 */
export function validateEpisodeProvenance(
  episode: Episode,
  sources: EpisodeProvenanceSources,
): EpisodeProvenanceValidationOutcome {
  const errors: RlBridgeError[] = provenanceErrorsFor(
    sources.trajectory,
    sources.evaluation,
    sources.binding,
  );

  if (String(episode.provenance.trajectoryId) !== String(sources.trajectory.trajectoryId)) {
    errors.push({
      code: "citation-mismatch",
      message: `the episode cites trajectory '${String(episode.provenance.trajectoryId)}' but the sources provide '${String(sources.trajectory.trajectoryId)}' — provenance citations are exact`,
    });
  }
  if (String(episode.provenance.bindingId) !== String(sources.binding.bindingId)) {
    errors.push({
      code: "citation-mismatch",
      message: `the episode cites binding '${String(episode.provenance.bindingId)}' but the sources provide '${String(sources.binding.bindingId)}' — provenance citations are exact`,
    });
  }
  if (String(episode.provenance.evaluationId) !== String(sources.evaluation.evaluationId)) {
    errors.push({
      code: "citation-mismatch",
      message: `the episode cites evaluation '${String(episode.provenance.evaluationId)}' but the sources provide '${String(sources.evaluation.evaluationId)}' — provenance citations are exact`,
    });
  }
  if (
    String(episode.scope.tenantId) !== String(sources.trajectory.scope.tenantId) ||
    String(episode.scope.projectId) !== String(sources.trajectory.scope.projectId) ||
    String(episode.scope.worldId) !== String(sources.trajectory.scope.worldId) ||
    String(episode.scope.experimentId) !== String(sources.trajectory.scope.experimentId) ||
    String(episode.scope.sessionId) !== String(sources.trajectory.scope.sessionId)
  ) {
    errors.push({
      code: "citation-mismatch",
      message: "the episode's scope is not the trajectory's own scope — the episode carries its trajectory's scope verbatim, never edited",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
