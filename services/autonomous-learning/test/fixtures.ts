/**
 * Shared deterministic fixtures for the W055 autonomous-learning tests.
 *
 * Every builder constructs the REAL shapes through the REAL seams (the
 * no-shim law), ALL at ONE explicit §14 scope — the populations fixture
 * family's own scope (the W044/W045/W046 chain): the post-mortem through
 * W053's own gate over a REAL W038 evaluation walk + W052 family + W051
 * history built AT THIS SCOPE (mirroring W053's own fixture construction,
 * disclosed — its builders are scope-parameterized through
 * buildSplitFamily/buildSearchHistory); the knowledge records through
 * memory's own seal gate; the brain through W054's own founding +
 * ingestion gates; the curriculum + pairing plans through W046's own
 * gates over the REAL W045 populations; the skills + forged plan through
 * W041's own forge over the REAL extracted skills. Zero fixture drift;
 * only opaque-id leaf values are cast (the repo's disclosed precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { buildSplitFamily } from "evaluation-splits";
import type { SplitFamily } from "evaluation-splits";
import { buildSearchHistory } from "search-integrity";
import type { SearchHistory } from "search-integrity";
import { asPointInTimeCutoff, buildPointInTimeQuery, sealView } from "tradrl-time-machine";
import type { PointInTimeView, ViewRecord } from "tradrl-time-machine";
import { createExperiment, experimentManifestOf } from "experiments";
import { evaluateExperiment } from "evaluation";
import { verifyExperimentEvaluation } from "verification";
import { trajectoryIdOf } from "trajectory";
import { deriveLessons, derivePostMortem } from "outcome-learning";
import type { PostMortem } from "outcome-learning";
import { sealKnowledgeRecord } from "memory";
import type { KnowledgeRecord, KnowledgeScope } from "memory";
import { foundBrain, ingest } from "firm-brain";
import type { FirmBrain } from "firm-brain";
import { composeAdversarial, composeSelfPlay } from "learning-populations";
import type { AdversarialPairing, SelfPlayPairing } from "learning-populations";
import { forgeBody } from "body-forge";
import type { ForgedBodyPlan } from "body-forge";
import type { Curriculum } from "learning-curriculum";
import type { SkillRecord } from "skills";
import { createCapabilityRegistry, registerCapability } from "capability-registry";
import type { RegistryEntry } from "capability-registry";
import { recordOf } from "../../../packages/evaluation/test/fixtures.js";
import { aMarketEvent, aResearchRecord, infoViewRecord, marketViewRecord, MINUTE, T0 } from "../../../packages/tradrl-time-machine/test/fixtures.js";
import { aTrial } from "../../../packages/search-integrity/test/fixtures.js";
import { evaluationFixture, experimentFixture, findingsFixture, registrationFixture } from "../../../packages/capability-registry/test/fixtures.js";
import { SCOPE as POPULATION_SCOPE } from "../../populations/test/fixtures.js";
import { championPopulation, challengerPopulation } from "../../learning/populations/test/fixtures.js";
import { canonicalCurriculum } from "../../learning/curriculum/test/fixtures.js";
import { forgeComponents } from "../../body-forge/commissioning/test/fixtures.js";
import { canonicalObservations, canonicalPairingCitations, canonicalPlanCitations, canonicalSkillCitations, canonicalSteps } from "../index.js";
import type { ImprovementStep } from "../index.js";

/** The cycle's scope — the populations fixture family's own (one §14 scope
 * for every cited record; the W044→W046 chain's own identity). */
export const SCOPE: KnowledgeScope = { tenantId: POPULATION_SCOPE.tenantId, projectId: POPULATION_SCOPE.projectId, worldId: POPULATION_SCOPE.worldId };

const DAY = 24 * 60 * 60 * 1000;
const MINUTE_MS = MINUTE;

// --- The W051 search history at THIS scope (the W050 views' own gates) ---

let cachedView: PointInTimeView | undefined;
function theView(): PointInTimeView {
  if (cachedView === undefined) {
    const query = buildPointInTimeQuery({ scope: { tenantId: SCOPE.tenantId as never, projectId: SCOPE.projectId as never, worldId: SCOPE.worldId as never }, cutoff: asPointInTimeCutoff(T0 + 5 * MINUTE_MS), families: ["market-event", "research-report"] });
    if (!query.ok) {
      throw new Error(`fixture query failed: ${query.errors.map((error) => String(error.message)).join("; ")}`);
    }
    const records: ViewRecord[] = [
      marketViewRecord({ ...aMarketEvent(T0), worldId: SCOPE.worldId as never }),
      infoViewRecord(aResearchRecord(T0 + 30_000, T0 + 90_000)),
      marketViewRecord({ ...aMarketEvent(T0 + MINUTE_MS), worldId: SCOPE.worldId as never }),
    ];
    const sealed = sealView(query.query, records);
    if (!sealed.ok) {
      throw new Error(`fixture view failed: ${sealed.refusal.message}`);
    }
    cachedView = sealed.view;
  }
  return cachedView;
}

// --- The post-mortem at THIS scope (W053's own construction, mirrored) ---

function theFamily(): SplitFamily {
  const outcome = buildSplitFamily({
    scope: { tenantId: SCOPE.tenantId as never, projectId: SCOPE.projectId as never, worldId: SCOPE.worldId as never },
    kind: "walk-forward",
    range: { from: T0 as never, to: (T0 + 10 * DAY - 1) as never },
    policy: { kind: "walk-forward", axisId: "axis-w055", trainWindowMs: 2 * DAY, evaluationWindowMs: DAY },
  });
  if (!outcome.ok) {
    throw new Error(`fixture family failed: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.family;
}

function theExperimentBundle(): { readonly postMortem: PostMortem; readonly history: SearchHistory } {
  const family = theFamily();
  const experiment = createExperiment({
    name: "exp-w055-autonomous-learning",
    tenantId: "tenant-1",
    projectId: "project-1",
    world: { worldId: "world-alpha", definitionDigest: "defdigest-fixture-1" },
    participants: [{ possessionId: "possession-1", bodyId: "body-1", substrateId: "substrate-fixture" }],
    rewardModel: { modelId: "model-fixture", version: "1", components: [{ kind: "realized-pnl", weight: 1, scale: 1000 }, { kind: "drawdown-control", weight: 1, scale: 1000 }] },
    constraints: { programId: "cp-soft", constraints: [
      { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
      { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
    ] },
    policy: { policyId: "pol-w055", rewardModelId: "model-fixture", rewardModelVersion: "1", constraintProgramId: "cp-soft", penalizedConstraintIds: ["eb-1"], penaltyWeight: 0.5, axes: { holdouts: family.splits.map((split) => ({ axisId: split.axisId, kind: split.kind })), stresses: [{ axisId: "s-1", kind: "execution" }], ablations: [], integrity: ["evidence-chain", "deterministic-replay"] } } as never,
  });
  if (!experiment.ok) {
    throw new Error(`fixture experiment failed: ${experiment.errors.map((error) => error.message).join("; ")}`);
  }
  const policy = experiment.experiment.policy;
  const experimentId = String(experiment.experiment.experimentId);
  const manifest = experimentManifestOf(experiment.experiment, {
    trajectories: ["session-1", "session-2", "session-3"].map((sessionId) => {
      const scope = { tenantId: "tenant-1", projectId: "project-1", worldId: "world-alpha", experimentId, sessionId };
      return { trajectoryId: trajectoryIdOf(scope), scope };
    }),
    holdoutSplits: family.splits,
  });
  if (!manifest.ok) {
    throw new Error(`fixture manifest failed: ${manifest.errors.map((error) => error.message).join("; ")}`);
  }
  const records = [
    recordOf({ sessionId: "session-1", experimentId, instants: [T0 + 100, T0 + 200] }, policy),
    recordOf({ sessionId: "session-2", experimentId, instants: [T0 + 2 * DAY + 100, T0 + 2 * DAY + 500] }, policy),
    recordOf({ sessionId: "session-3", experimentId, instants: [T0 + 3 * DAY + 100] }, policy),
  ];
  const walked = evaluateExperiment({ manifest: manifest.manifest, records, policy });
  if (!walked.ok) {
    throw new Error(`fixture evaluation failed: ${walked.errors.map((error) => error.message).join("; ")}`);
  }
  const findings = verifyExperimentEvaluation({ manifest: manifest.manifest, records, policy, evaluation: walked.evaluation });
  const view = theView();
  const trials = [
    aTrial("trial-w055-a", "cand-alpha", "hyperparameter", [{ name: "learning-rate", value: 0.001 }, { name: "depth", value: 3 }], view, "a"),
    aTrial("trial-w055-b", "cand-beta", "config", [{ name: "window", value: 64 }], view, "b"),
  ];
  const selections = [{ decisionId: "decision-w055", chosenTrialId: "trial-w055-a", citedEvidence: [String(view.viewId)], decidedAsOf: asPointInTimeCutoff(T0 + 10 * MINUTE_MS) }];
  const history = buildSearchHistory({ scope: { ...SCOPE, experimentId } as never, trials, selections });
  if (!history.ok) {
    throw new Error(`fixture history failed: ${history.errors.map((error) => error.message).join("; ")}`);
  }
  const derived = derivePostMortem({ evaluation: { evaluation: walked.evaluation, findings }, family, history: history.history });
  if (!derived.ok) {
    throw new Error(`fixture post-mortem failed: ${derived.errors.map((error) => error.message).join("; ")}`);
  }
  return { postMortem: derived.postMortem, history: history.history };
}

let cachedPostMortem: PostMortem | undefined;
/** The REAL post-mortem at THIS scope (W053's own gate). */
export function thePostMortem(): PostMortem {
  cachedPostMortem ??= theExperimentBundle().postMortem;
  return cachedPostMortem;
}

// --- The capability entry at THIS scope (W054's memory precedent) ---

function theCapabilityEntry(): RegistryEntry {
  const experiment = experimentFixture({ name: "exp-w055-autonomous-learning-capability", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, world: { worldId: SCOPE.worldId, definitionDigest: "defdigest-w055-capability-1" } });
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
  const registered = registerCapability(createCapabilityRegistry(SCOPE), { ...registrationFixture(), scope: SCOPE as never, evidence: [{ experiment, evaluation, findings }] });
  if (!registered.ok) {
    throw new Error(`fixture capability failed: ${registered.errors.map((error) => error.message).join("; ")}`);
  }
  const entry = registered.registry.entries[0];
  if (entry === undefined) {
    throw new Error("fixture capability registry carries no entry");
  }
  return entry;
}

// --- The brain at THIS scope (W054's own founding + ingestion gates) ---

function sealOrThrow(input: Parameters<typeof sealKnowledgeRecord>[0]): KnowledgeRecord {
  const sealed = sealKnowledgeRecord(input);
  if (!sealed.ok) {
    throw new Error(`fixture record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}

/** The four-kind knowledge fixture set at THIS scope (memory's own seal gate). */
export function theKnowledgeRecords(): readonly KnowledgeRecord[] {
  const postMortem = thePostMortem();
  const history = theExperimentBundle().history;
  return [
    sealOrThrow({ scope: SCOPE, source: { kind: "post-mortem", postMortem } }),
    sealOrThrow({ scope: SCOPE, source: { kind: "lesson-set", lessons: deriveLessonsOrThrow(postMortem), postMortem } }),
    sealOrThrow({ scope: SCOPE, source: { kind: "capability", entry: theCapabilityEntry() } }),
    sealOrThrow({ scope: SCOPE, source: { kind: "search-history", history } }),
  ];
}

function deriveLessonsOrThrow(postMortem: PostMortem): ReturnType<typeof deriveLessons> extends { ok: true; lessons: infer L } ? L : never {
  const derived = deriveLessons(postMortem);
  if (!derived.ok) {
    throw new Error(`fixture lessons failed: ${derived.errors.map((error) => error.message).join("; ")}`);
  }
  return derived.lessons as never;
}

let cachedBrain: FirmBrain | undefined;
/** The fed brain at THIS scope: all four knowledge kinds in ONE generation. */
export function theFedBrain(): FirmBrain {
  if (cachedBrain === undefined) {
    const founded = foundBrain(SCOPE);
    if (!founded.ok) {
      throw new Error(`fixture brain failed to found: ${founded.errors.map((error) => error.message).join("; ")}`);
    }
    const fed = ingest(founded.brain, theKnowledgeRecords());
    if (!fed.ok) {
      throw new Error(`fixture brain failed to ingest: ${fed.errors.map((error) => error.message).join("; ")}`);
    }
    cachedBrain = fed.brain;
  }
  return cachedBrain;
}

// --- The curriculum, pairings, skills + forged plan (W046/W041's own) ---

let cachedCurriculum: Curriculum | undefined;
/** The REAL canonical curriculum (W046's own founding gate). */
export function theCurriculum(): Curriculum {
  cachedCurriculum ??= canonicalCurriculum().curriculum;
  return cachedCurriculum;
}

let cachedSelfPlay: SelfPlayPairing | undefined;
/** The REAL self-play pairing (W046's own composition gate). */
export function theSelfPlayPairing(): SelfPlayPairing {
  if (cachedSelfPlay === undefined) {
    const composed = composeSelfPlay(championPopulation(), { kind: "alternate" });
    if (!composed.ok) {
      throw new Error(`fixture self-play pairing failed: ${composed.errors.map((error) => error.message).join("; ")}`);
    }
    cachedSelfPlay = composed.pairing;
  }
  return cachedSelfPlay;
}

let cachedAdversarial: AdversarialPairing | undefined;
/** The REAL adversarial pairing (W046's own composition gate). */
export function theAdversarialPairing(): AdversarialPairing {
  if (cachedAdversarial === undefined) {
    const composed = composeAdversarial(championPopulation(), challengerPopulation());
    if (!composed.ok) {
      throw new Error(`fixture adversarial pairing failed: ${composed.errors.map((error) => error.message).join("; ")}`);
    }
    cachedAdversarial = composed.pairing;
  }
  return cachedAdversarial;
}

/** The REAL extracted skill records (W041's own extraction, the forge's own endowment). */
export function theSkills(): readonly SkillRecord[] {
  return [...forgeComponents().skills];
}

let cachedPlan: ForgedBodyPlan | undefined;
/** The REAL forged plan (W041's own forge gate). */
export function theForgedPlan(): ForgedBodyPlan {
  if (cachedPlan === undefined) {
    const forged = forgeBody(forgeComponents());
    if (!forged.ok) {
      throw new Error(`fixture forged plan failed: ${forged.errors.map((error) => error.message).join("; ")}`);
    }
    cachedPlan = forged.plan;
  }
  return cachedPlan;
}

// --- The canonical step declarations + the full cycle input ---

/** The six lawful step declarations (the full loop, each citing its evidence). */
export function theSteps(): ImprovementStep[] {
  const brain = theFedBrain();
  const curriculum = theCurriculum();
  return [
    { kind: "observe", observations: brain.records.map((record) => ({ recordId: String(record.recordId), kind: record.citation.kind })) },
    { kind: "post-mortem", citation: { postMortemId: String(thePostMortem().postMortemId), evaluationId: String(thePostMortem().evaluation.evaluationId) } },
    { kind: "brain-update", citation: { brainId: String(brain.brainId), generation: brain.generation, recordCount: brain.records.length } },
    { kind: "curriculum-adjustment", citation: { curriculumId: String(curriculum.curriculumId), activeStage: curriculum.activeStage, stageCount: curriculum.stages.length }, declaration: { action: "advance-stage", toStage: curriculum.activeStage + 1 } },
    { kind: "re-selection", citations: [
      { pairingId: String(theSelfPlayPairing().pairingId), kind: "self-play-pairing", populationId: String(theSelfPlayPairing().populationId) },
      { pairingId: String(theAdversarialPairing().pairingId), kind: "adversarial-pairing", populationId: String(theAdversarialPairing().challenger.populationId) },
    ], declaration: { action: "re-run-selection" } },
    { kind: "re-commissioning", skillCitations: theSkills().map((skill) => ({ skillId: String(skill.skillId), capabilityId: String(skill.competence.capabilityId), evidenceCount: skill.evidence.trajectoryIds.length })), planCitations: [{ planId: String(theForgedPlan().planId), endowmentCount: theForgedPlan().endowment.entries.length }], declaration: { action: "commission-plans" } },
  ];
}

/** The full composition input at THIS scope (the happy-path fixture). */
export function aCycleInput(): { readonly scope: KnowledgeScope; readonly steps: ImprovementStep[]; readonly postMortem: PostMortem; readonly brain: FirmBrain; readonly curriculum: Curriculum; readonly pairings: readonly (SelfPlayPairing | AdversarialPairing)[]; readonly skills: readonly SkillRecord[]; readonly plans: readonly ForgedBodyPlan[] } {
  return { scope: SCOPE, steps: theSteps(), postMortem: thePostMortem(), brain: theFedBrain(), curriculum: theCurriculum(), pairings: [theSelfPlayPairing(), theAdversarialPairing()], skills: theSkills(), plans: [theForgedPlan()] };
}

/** The canonicalized step list (the sealed order — for the A9 order proofs). */
export function canonicalStepList(steps: readonly ImprovementStep[]): readonly ImprovementStep[] {
  return canonicalSteps(steps).map((step) => {
    switch (step.kind) {
      case "observe": return { ...step, observations: canonicalObservations(step.observations) };
      case "re-selection": return { ...step, citations: canonicalPairingCitations(step.citations) };
      case "re-commissioning": return { ...step, skillCitations: canonicalSkillCitations(step.skillCitations), planCitations: canonicalPlanCitations(step.planCitations) };
      default: return { ...step };
    }
  });
}

/** The error codes of a fail-closed outcome, for pinning refusal laws. */
export function codes(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}
