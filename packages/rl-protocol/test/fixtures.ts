/**
 * REAL episode inputs for the W047 protocol tests (the no-shim law): the
 * trajectory record is built through the REAL W037 capture gate over the
 * trajectory package's own test fixtures (the W041 fixture lineage — REAL
 * W035 telemetry, REAL W036 policy, zero fixture drift); the binding and
 * evaluation citations are opaque-id leaf casts (the fixture law's
 * allowance). Only the tampered-reward fixtures construct literal typed
 * records, and each discloses itself in-header.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ExperimentEvaluationId } from "evaluation";
import type { ExperimentId } from "experiments";
import type { PolicyEvaluation } from "learning-objectives";
import { trajectoryRecordOf } from "trajectory";
import type { TrajectoryRecord } from "trajectory";
import {
  canonicalResultingStates,
  canonicalTelemetry,
  DETERMINISM,
  fixturePolicy,
  SCOPE,
} from "../../trajectory/test/fixtures.js";
import type { EpisodeInput, EpisodeProvenance } from "../episode.js";
import type { AgentBindingId } from "world-agent-runtime";

export const BINDING_ID = "agent-binding-fixture" as AgentBindingId;
export const EVALUATION_ID = "expeval-fixture" as ExperimentEvaluationId;
export const EXPERIMENT_ID = SCOPE.experimentId as ExperimentId;

/** The REAL fixture trajectory (through the W037 capture gate). */
export function canonicalTrajectoryRecord(): TrajectoryRecord {
  const outcome = trajectoryRecordOf({
    scope: SCOPE,
    telemetry: canonicalTelemetry(),
    resultingStates: canonicalResultingStates(),
    policy: fixturePolicy(),
    determinism: DETERMINISM,
  });
  if (!outcome.ok) {
    throw new Error(`fixture trajectory capture failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.record;
}

/** The canonical episode input over the REAL fixture trajectory. */
export function canonicalEpisodeInput(record: TrajectoryRecord = canonicalTrajectoryRecord()): EpisodeInput {
  return {
    scope: record.scope,
    provenance: canonicalProvenance(record),
    steps: [...record.stream.capsules],
    reward: record.evaluation,
    lineage: record.lineage,
  };
}

/** The provenance fixture (opaque-id citations over the REAL record). */
export function canonicalProvenance(record: TrajectoryRecord): EpisodeProvenance {
  return {
    trajectoryId: record.trajectoryId,
    bindingId: BINDING_ID,
    evaluationId: EVALUATION_ID,
    experimentId: EXPERIMENT_ID,
  };
}

/**
 * A literal BARE-P&L PolicyEvaluation (defensive-depth fixture): every
 * component financial-outcome — a record W036's own construction gate
 * refuses to produce, re-shaped here as carried data so the episode gate's
 * §13 refusal is exercised end-to-end. Disclosed: a literal typed record,
 * not a real capture.
 */
export function barePnlEvaluation(real: PolicyEvaluation): PolicyEvaluation {
  return {
    ...real,
    reward: {
      ...real.reward,
      components: [
        {
          kind: "realized-pnl",
          rawValue: 1000,
          score: 1,
          weight: 1,
          contribution: 1,
          provenance: { capsuleIndices: [0], readings: ["literal-bare-pnl-fixture"] },
        },
      ],
      total: 1,
    },
  };
}
