/**
 * The experiment descriptor (W037) — DECLARATIVE data, deterministic identity.
 *
 * Spec: spec/DOMAIN-MODEL.md — Experiment is a future-intelligence entity
 * under the identity laws (tenant/project/world scope explicit; ids opaque,
 * produced by canonical encoders, never parsed).
 * Spec: spec/ARCHITECTURE.md §13 — evaluation is constraint-aware with
 * holdouts/stress/ablations/integrity: the descriptor carries the W036
 * evaluation policy, the reward model, and the constraint set as DATA.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the experiment id is a
 * canonical hash over the descriptor (same descriptor bytes → same id, no
 * wall clocks, no randomness, no env reads).
 *
 * THE CONSTRUCTION GATE: a descriptor whose reward model, constraint
 * program, or evaluation policy fails the W036 construction laws is refused
 * with those packages' own typed errors carried VERBATIM (e.g. the §13
 * "pnl-sole-objective" law surfaces here by name) — an experiment never
 * declares an objective that cannot be lawfully evaluated.
 *
 * NO EXECUTION (scope honesty, the W036 precedent): this module records and
 * describes; the world runtime runs sessions (W035) and W038 walks the
 * experiments defined here. No RL, no training loops, no model calls.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  createConstraintProgram,
  createEvaluationPolicy,
  createRewardModel,
} from "learning-objectives";
import type {
  ConstraintProgram,
  ConstraintProgramError,
  ConstraintProgramSpec,
  EvaluationPolicy,
  EvaluationPolicyError,
  EvaluationPolicySpec,
  RewardModel,
  RewardModelError,
  RewardModelSpec,
} from "learning-objectives";
import { canonicalDigestHex } from "trajectory";

// ---------------------------------------------------------------------------
// The declarative vocabulary
// ---------------------------------------------------------------------------

/** The world definition reference (identity + content digest). */
export interface WorldDefinitionRef {
  readonly worldId: string;
  /** The digest of the world definition the experiment runs against. */
  readonly definitionDigest: string;
}

/** One participant spec (opaque identity references, as data). */
export interface ParticipantSpec {
  readonly possessionId: string;
  readonly bodyId: string;
  readonly substrateId: string;
}

/**
 * The experiment descriptor: WHICH world (definition reference), WHO runs
 * (participant specs), and WHAT success means (the W036 reward model, the
 * constraint set, and the §13 evaluation policy). All declarative — the
 * experiment protocol RECORDS and DESCRIBES, never executes.
 */
export interface ExperimentDescriptor {
  readonly name: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly world: WorldDefinitionRef;
  /** At least one participant (an experiment with nobody in it is refused). */
  readonly participants: readonly ParticipantSpec[];
  readonly rewardModel: RewardModelSpec;
  readonly constraints: ConstraintProgramSpec;
  readonly policy: EvaluationPolicySpec;
}

declare const experimentIdBrand: unique symbol;

/**
 * An OPAQUE experiment id — the canonical hash over the descriptor, produced
 * only by {@link experimentIdOf} and never parsed. The scope is carried
 * explicitly on the descriptor, never recovered by splitting the id.
 */
export type ExperimentId = string & { readonly [experimentIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const EXPERIMENT_ID_PREFIX = "exp-";

/** The canonical encoding of one descriptor (store keys, digest input). */
export function canonicalExperimentDescriptor(descriptor: ExperimentDescriptor): string {
  return canonicalDigestHex(descriptor);
}

// ---------------------------------------------------------------------------
// The typed error family (closed set)
// ---------------------------------------------------------------------------

export type ExperimentErrorCode =
  | "blank-experiment-name"
  | "blank-scope-member" // tenant/project scope is explicit, never blank
  | "blank-world-id"
  | "missing-world-digest" // an experiment without a world digest is not reproducible
  | "no-participants"
  | "blank-participant-member"
  | "duplicate-participant" // the possession id is the participant key
  | "reward-model-construction" // W036's own errors carried verbatim
  | "constraint-program-construction" // W036's own errors carried verbatim
  | "policy-construction"; // W036's own errors carried verbatim

/** One typed experiment error (fail-closed; carries the W036 errors). */
export interface ExperimentError {
  readonly code: ExperimentErrorCode;
  readonly message: string;
  /** Present on `reward-model-construction`: the W036 model errors, verbatim. */
  readonly rewardModelErrors?: readonly RewardModelError[];
  /** Present on `constraint-program-construction`: the W036 program errors, verbatim. */
  readonly constraintProgramErrors?: readonly ConstraintProgramError[];
  /** Present on `policy-construction`: the W036 policy errors, verbatim. */
  readonly policyErrors?: readonly EvaluationPolicyError[];
}

export type ExperimentOutcome =
  | { readonly ok: true; readonly experiment: Experiment }
  | { readonly ok: false; readonly errors: readonly ExperimentError[] };

/** A constructed experiment: the descriptor + derived id + live W036 handles. */
export interface Experiment {
  /** The declared descriptor, verbatim (declarative data). */
  readonly descriptor: ExperimentDescriptor;
  /** The deterministic identity (the canonical hash over the descriptor). */
  readonly experimentId: ExperimentId;
  /** The constructed reward model (W036 gate passed). */
  readonly rewardModel: RewardModel;
  /** The constructed constraint program (the registry, W036 gate passed). */
  readonly program: ConstraintProgram;
  /** The constructed evaluation policy (W036 gate passed). */
  readonly policy: EvaluationPolicy;
}

// ---------------------------------------------------------------------------
// The deterministic identity
// ---------------------------------------------------------------------------

/**
 * The experiment id: the canonical hash over the descriptor's bytes (A9 —
 * the same descriptor always yields the same id; any differing byte yields
 * a different one). Key order never matters (the canonical serializer sorts
 * keys); declaration order of arrays does (it is data).
 */
export function experimentIdOf(descriptor: ExperimentDescriptor): ExperimentId {
  return `${EXPERIMENT_ID_PREFIX}${canonicalDigestHex(descriptor)}` as ExperimentId;
}

// ---------------------------------------------------------------------------
// The construction gate
// ---------------------------------------------------------------------------

/**
 * Construct the experiment — THE CONSTRUCTION GATE. Structure first (blank
 * identity/world/participants), then the W036 construction laws: the reward
 * model must pass `createRewardModel` (the §13 sole-P&L law is structural),
 * the constraint program must pass `createConstraintProgram` (the registry),
 * and the evaluation policy must pass `createEvaluationPolicy` against the
 * descriptor's OWN model and program (a policy citing another model than
 * the experiment's is a typed error). Every W036 error is carried verbatim.
 */
export function createExperiment(descriptor: ExperimentDescriptor): ExperimentOutcome {
  const errors: ExperimentError[] = [];

  if (descriptor.name.trim().length === 0) {
    errors.push({ code: "blank-experiment-name", message: "the experiment name is blank" });
  }
  for (const member of ["tenantId", "projectId"] as const) {
    if (String(descriptor[member]).trim().length === 0) {
      errors.push({
        code: "blank-scope-member",
        message: `the experiment scope member '${member}' is blank — tenant/project scope is explicit (DOMAIN-MODEL identity law)`,
      });
    }
  }
  if (String(descriptor.world.worldId).trim().length === 0) {
    errors.push({ code: "blank-world-id", message: "the world reference's worldId is blank" });
  }
  if (String(descriptor.world.definitionDigest).trim().length === 0) {
    errors.push({
      code: "missing-world-digest",
      message: "the world reference carries no definition digest — an experiment without a content-addressed world is not reproducible under A9",
    });
  }
  if (descriptor.participants.length === 0) {
    errors.push({
      code: "no-participants",
      message: "the experiment declares no participants — an experiment with nobody in it is refused (fail-closed)",
    });
  }
  const seenPossessions = new Set<string>();
  for (const participant of descriptor.participants) {
    for (const member of ["possessionId", "bodyId", "substrateId"] as const) {
      if (String(participant[member]).trim().length === 0) {
        errors.push({
          code: "blank-participant-member",
          message: `a participant declares a blank '${member}' — participant specs are opaque identity references, never blank`,
        });
      }
    }
    if (seenPossessions.has(participant.possessionId)) {
      errors.push({
        code: "duplicate-participant",
        message: `the participant possession '${participant.possessionId}' is declared twice — the possession id is the participant key`,
      });
    }
    seenPossessions.add(participant.possessionId);
  }

  const modelOutcome = createRewardModel(descriptor.rewardModel);
  if (!modelOutcome.ok) {
    errors.push({
      code: "reward-model-construction",
      message: `[experiments] the declared reward model failed the W036 construction laws (${String(modelOutcome.errors.length)} error(s)) — an experiment never declares an objective that cannot be lawfully evaluated`,
      rewardModelErrors: modelOutcome.errors,
    });
  }
  const programOutcome = createConstraintProgram(descriptor.constraints);
  if (!programOutcome.ok) {
    errors.push({
      code: "constraint-program-construction",
      message: `[experiments] the declared constraint program failed the W036 registry gate (${String(programOutcome.errors.length)} error(s))`,
      constraintProgramErrors: programOutcome.errors,
    });
  }

  let policy: EvaluationPolicy | undefined;
  if (modelOutcome.ok && programOutcome.ok) {
    const policyOutcome = createEvaluationPolicy(
      descriptor.policy,
      modelOutcome.model,
      programOutcome.program,
    );
    if (!policyOutcome.ok) {
      errors.push({
        code: "policy-construction",
        message: `[experiments] the declared evaluation policy failed the W036 construction laws (${String(policyOutcome.errors.length)} error(s)) — the §13 axes must be lawful before any trajectory joins the experiment`,
        policyErrors: policyOutcome.errors,
      });
    } else {
      policy = policyOutcome.policy;
    }
  }

  if (errors.length > 0 || !modelOutcome.ok || !programOutcome.ok || policy === undefined) {
    return { ok: false, errors };
  }

  const experiment: Experiment = {
    descriptor,
    experimentId: experimentIdOf(descriptor),
    rewardModel: modelOutcome.model,
    program: programOutcome.program,
    policy,
  };
  Object.freeze(experiment);
  return { ok: true, experiment };
}
