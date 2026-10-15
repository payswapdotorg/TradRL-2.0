/**
 * assembleEpisodes (W047) — THE BRIDGE GATE.
 *
 * Assembles typed episodes FROM recorded trajectories + experiment
 * evaluations + world-agent bindings — carry, never re-score, never
 * re-run. Every law is proven here, loudly, through the upstream
 * packages' OWN gates: each trajectory re-proven by W037's validator
 * (errors carried verbatim), each binding re-proven by W044's (errors
 * carried verbatim), scope/world/session agreement proven pairwise, the
 * experiment evaluation proven a faithful carry of the record's own W036
 * evaluation, and the reward signal proven constraint-aware (a bare-P&L
 * reward is the loud typed refusal naming the §13 law). Then — and only
 * then — the episode is sealed through the protocol's own construction
 * gate and emitted in CANONICAL episode-id order (input order never
 * leaks, A9).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — the bridge ASSEMBLES typed data;
 * it never executes a trainer, never steps a world, never trains.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { episodeOf } from "rl-protocol";
import type { Episode } from "rl-protocol";
import type { ExperimentEvaluation } from "evaluation";
import type { TrajectoryRecord } from "trajectory";
import type { WorldAgentBinding } from "world-agent-runtime";
import { agreementErrors, provenanceErrorsFor, type RlBridgeError } from "./validate.js";

// ---------------------------------------------------------------------------
// The assembly input + outcome
// ---------------------------------------------------------------------------

/** The bridge input: recorded data only — trajectories, evaluations, bindings. */
export interface EpisodeAssemblyInput {
  readonly trajectories: readonly TrajectoryRecord[];
  readonly evaluations: readonly ExperimentEvaluation[];
  readonly bindings: readonly WorldAgentBinding[];
}

export type EpisodeAssemblyOutcome =
  | { readonly ok: true; readonly episodes: readonly Episode[] }
  | { readonly ok: false; readonly errors: readonly RlBridgeError[] };

// ---------------------------------------------------------------------------
// The pairing laws (which binding + which evaluation prove one trajectory)
// ---------------------------------------------------------------------------

interface PairedSources {
  readonly binding: WorldAgentBinding | undefined;
  readonly evaluation: ExperimentEvaluation | undefined;
  readonly errors: readonly RlBridgeError[];
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Pair one trajectory with THE binding that proves its agent identity and
 * THE evaluation that verified its experiment. Pairing is deterministic:
 * among agreeing candidates the CANONICALLY-FIRST (smallest opaque id)
 * wins — input order never leaks (A9). When nothing agrees, the pairwise
 * disagreement laws surface against the canonically-first candidate
 * available, loudly.
 */
function pairSources(
  record: TrajectoryRecord,
  evaluations: readonly ExperimentEvaluation[],
  bindings: readonly WorldAgentBinding[],
): PairedSources {
  const errors: RlBridgeError[] = [];

  let binding: WorldAgentBinding | undefined;
  if (bindings.length === 0) {
    errors.push({
      code: "missing-binding",
      message: `no binding was provided to prove the agent identity of trajectory '${String(record.trajectoryId)}' — an episode's agent identity routes through a PROVEN W044 binding (fail-closed, never defaulted)`,
    });
  } else {
    const candidates = bindings.filter((entry) => agreementErrors(record, entry).length === 0);
    if (candidates.length === 0) {
      const probe = [...bindings].sort((left, right) => compareIds(String(left.bindingId), String(right.bindingId)))[0]!;
      errors.push(...agreementErrors(record, probe));
    } else {
      binding = [...candidates].sort((left, right) =>
        compareIds(String(left.bindingId), String(right.bindingId)),
      )[0]!;
    }
  }

  let evaluation: ExperimentEvaluation | undefined;
  const evaluationCandidates = evaluations.filter(
    (entry) => String(entry.experimentId) === String(record.scope.experimentId),
  );
  if (evaluationCandidates.length === 0) {
    errors.push({
      code: "missing-experiment-evaluation",
      message: `no W038 experiment evaluation covers the experiment '${String(record.scope.experimentId)}' of trajectory '${String(record.trajectoryId)}' — an episode's reward provenance cites the evaluation that VERIFIED its trajectory (fail-closed)`,
    });
  } else {
    evaluation = [...evaluationCandidates].sort((left, right) =>
      compareIds(String(left.evaluationId), String(right.evaluationId)),
    )[0]!;
  }

  return { binding, evaluation, errors };
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/**
 * Assemble episodes from recorded data — THE BRIDGE GATE. Laws (all
 * errors at once, fail-closed): at least one trajectory; one trajectory,
 * one episode; per trajectory — W037 re-validation (carried verbatim),
 * pairing with an agreeing binding + a covering experiment evaluation,
 * the full provenance law set (W044 re-validation, pairwise agreements,
 * the faithful-carry proof, the §13 constraint-aware reward), then the
 * protocol's own sealing gate. The emitted episodes are in CANONICAL
 * episode-id order. Pure and deterministic (A9): identical inputs ⇒
 * deep-equal episodes with identical ids.
 */
export function assembleEpisodes(input: EpisodeAssemblyInput): EpisodeAssemblyOutcome {
  const errors: RlBridgeError[] = [];

  if (input.trajectories.length === 0) {
    errors.push({
      code: "empty-assembly",
      message:
        "the bridge received no trajectories — an assembly bridges at least one recorded session (fail-closed, the W038 empty-records precedent)",
    });
  }

  const seenTrajectories = new Set<string>();
  for (const record of input.trajectories) {
    const id = String(record.trajectoryId);
    if (seenTrajectories.has(id)) {
      errors.push({
        code: "duplicate-episode",
        message: `the trajectory '${id}' assembles twice — one trajectory, one episode (deterministic assembly, A9)`,
      });
    }
    seenTrajectories.add(id);
  }

  const episodes: Episode[] = [];
  for (const record of input.trajectories) {
    const paired = pairSources(record, input.evaluations, input.bindings);
    errors.push(...paired.errors);
    if (paired.binding === undefined || paired.evaluation === undefined) {
      continue;
    }
    if (paired.errors.length > 0) {
      // the pairing itself failed loudly (disagreement laws) — the deeper
      // triple proofs would only repeat them against an arbitrary probe.
      continue;
    }

    const provenanceErrors = provenanceErrorsFor(record, paired.evaluation, paired.binding);
    errors.push(...provenanceErrors);
    if (provenanceErrors.length > 0) {
      continue;
    }

    const sealed = episodeOf({
      scope: record.scope,
      provenance: {
        trajectoryId: record.trajectoryId,
        bindingId: paired.binding.bindingId,
        evaluationId: paired.evaluation.evaluationId,
        experimentId: paired.evaluation.experimentId,
      },
      steps: [...record.stream.capsules],
      reward: record.evaluation,
      lineage: record.lineage,
    });
    if (!sealed.ok) {
      errors.push({
        code: "malformed-episode",
        message: `[learning-rl] the episode for trajectory '${String(record.trajectoryId)}' failed the protocol's own construction gate (${String(sealed.errors.length)} error(s)) — the protocol's errors carried verbatim`,
        episodeErrors: sealed.errors,
      });
      continue;
    }
    episodes.push(sealed.episode);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const canonical = [...episodes].sort((left, right) =>
    compareIds(String(left.episodeId), String(right.episodeId)),
  );
  return { ok: true, episodes: canonical };
}
