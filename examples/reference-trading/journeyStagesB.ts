/**
 * The W064 reference journey — STAGE SET B, THE LEARNING FAMILY
 * (W037→W038→W046→W047→W050→W051→W053→W054→W055): the curriculum + the
 * self-play/adversarial pairings (W046's gates over W045 populations), the
 * experiment + evaluation + findings + search history + post-mortem (the
 * W055 fixture chain's own construction at this scope — W037/W038/W051/
 * W053 gates), the point-in-time view (W050's package gates + the
 * services/time-machine assembly gate — the R016 firewall), the knowledge
 * records + the founded/ingested/recalled brain (W054's gates), and the
 * RL episode bridge + batch (W047's gates). Every record is composed (or
 * carried, where the W055 chain already composed it at THIS scope)
 * through its own gate.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { composeAdversarial, composeSelfPlay } from "../../services/learning/populations/index.js";
import type { AdversarialPairing, SelfPlayPairing } from "../../services/learning/populations/index.js";
import { canonicalCurriculum } from "../../services/learning/curriculum/test/fixtures.js";
import type { Curriculum } from "../../services/learning/curriculum/index.js";
import { theKnowledgeRecords, thePostMortem } from "../../services/autonomous-learning/test/fixtures.js";
import type { PostMortem } from "../../services/outcome-learning/index.js";
import {
  asPointInTimeCutoff,
  buildPointInTimeQuery,
  sealView,
} from "../../packages/tradrl-time-machine/index.js";
import type { PointInTimeView, ViewRecord } from "../../packages/tradrl-time-machine/index.js";
import { T0, at, marketViewRecord } from "../../packages/tradrl-time-machine/test/fixtures.js";
import type { WorldEventEnvelope } from "../../packages/tradrl-world-contracts/src/index.js";
import { assembleView } from "../../services/time-machine/index.js";
import type { AssembledPointInTimeView } from "../../services/time-machine/index.js";
import type { KnowledgeRecord, KnowledgeScope } from "../../packages/memory/index.js";
import { foundBrain, ingest, recall } from "../../services/firm-brain/index.js";
import type { FirmBrain } from "../../services/firm-brain/index.js";
import { assembleBatch, assembleEpisodes } from "../../services/learning/rl/index.js";
import { bridgeFixture } from "../../services/learning/rl/test/fixtures.js";
import type { Episode } from "../../packages/rl-protocol/index.js";
import { SCOPE, VIEW_CUTOFF, MARKET_EVENT_INSTANTS, MARKET_RANGE } from "./journeyFacts.js";
import { mustOk, type StageLine } from "./journeyHelpers.js";
import type { FoundingRecords } from "./journeyStagesA.js";

/** The learning family's composed records. */
export interface LearningRecords {
  readonly curriculum: Curriculum;
  readonly selfPlay: SelfPlayPairing;
  readonly adversarial: AdversarialPairing;
  readonly postMortem: PostMortem;
  readonly view: PointInTimeView;
  readonly assembled: AssembledPointInTimeView;
  readonly knowledge: readonly KnowledgeRecord[];
  readonly brain: FirmBrain;
  readonly recalled: readonly KnowledgeRecord[];
  readonly episodes: readonly Episode[];
  readonly batchId: string;
  readonly batchEpisodeCount: number;
}

/** The declaration-order permutation the A9 twin exercises (the gates that
 * canonicalize: W054 ingest merges in canonical record-id order). */
export type DeclarationOrder = "canonical" | "reversed";

function multi(count: number, prefix: string): string {
  return `${String(count)}× ${prefix}…`;
}

/** One W004 quote-update envelope at a declared simulation instant — the
 * journey's OWN hand-fixed deterministic event (fixed event ids, no shared
 * counter: the journey's bytes never depend on composition call order). */
function journeyMarketEvent(instant: number, index: number): WorldEventEnvelope {
  return {
    worldId: SCOPE.worldId as never,
    sequence: (index + 1) as never,
    eventId: `evt-journey-${String(index + 1)}` as never,
    eventType: "market.quote.updated",
    occurredAt: at(T0 + instant),
    causationId: "cause-journey" as never,
    correlationId: "corr-journey" as never,
    producer: "producer-journey" as never,
    schemaVersion: "w064.reference-journey@1",
    payload: {
      type: "market.quote.updated",
      instrumentId: "instrument-btcusd" as never,
      bid: "5200.05" as never,
      ask: "5200.10" as never,
      bidSize: "1.5" as never,
      askSize: "0.75" as never,
    },
  };
}

/** Compose the learning family through every gate, at the journey's scope. */
export function stagesLearning(
  founding: FoundingRecords,
  order: DeclarationOrder = "canonical",
): { readonly lines: readonly StageLine[]; readonly records: LearningRecords } {
  const curriculum = canonicalCurriculum().curriculum;
  const curriculumLine: StageLine = {
    stage: "S6 found the curriculum",
    gate: "W046 foundCurriculum",
    recordId: String(curriculum.curriculumId),
    carriedCount: curriculum.stages.length,
  };

  const selfPlay = mustOk(
    composeSelfPlay(founding.champion, { kind: "alternate" }),
    "compose-self-play",
  ).pairing;
  const selfPlayLine: StageLine = {
    stage: "S7 pair the population for self-play",
    gate: "W046 composeSelfPlay",
    recordId: String(selfPlay.pairingId),
    carriedCount: selfPlay.memberCount,
  };

  const adversarial = mustOk(
    composeAdversarial(founding.champion, founding.challenger),
    "compose-adversarial",
  ).pairing;
  const adversarialLine: StageLine = {
    stage: "S8 pair champion against challenger",
    gate: "W046 composeAdversarial",
    recordId: String(adversarial.pairingId),
    carriedCount: null,
  };

  const postMortem = thePostMortem();
  const evaluation = postMortem.evaluation;
  const experimentLine: StageLine = {
    stage: "S9 compose the experiment",
    gate: "W037 createExperiment",
    recordId: String(evaluation.experimentId),
    carriedCount: null,
  };
  const evaluationLine: StageLine = {
    stage: "S10 evaluate the walk",
    gate: "W038 evaluateExperiment",
    recordId: String(evaluation.evaluationId),
    carriedCount: evaluation.passCount,
  };
  const findingsLine: StageLine = {
    stage: "S11 verify the evaluation",
    gate: "W038 verifyExperimentEvaluation",
    recordId: evaluation.findingsDigest,
    carriedCount: null,
  };
  const historyLine: StageLine = {
    stage: "S12 seal the search history",
    gate: "W051 buildSearchHistory",
    recordId: String(postMortem.history.historyId),
    carriedCount: postMortem.history.trialCount,
  };
  const postMortemLine: StageLine = {
    stage: "S13 derive the post-mortem",
    gate: "W053 derivePostMortem",
    recordId: String(postMortem.postMortemId),
    carriedCount: null,
  };

  const query = mustOk(
    buildPointInTimeQuery({
      scope: { tenantId: SCOPE.tenantId as never, projectId: SCOPE.projectId as never, worldId: SCOPE.worldId as never },
      cutoff: asPointInTimeCutoff(T0 + VIEW_CUTOFF),
      families: ["market-event"],
    }),
    "build-point-in-time-query",
  ).query;
  const viewRecords: ViewRecord[] = MARKET_EVENT_INSTANTS.map((instant, index) =>
    marketViewRecord(journeyMarketEvent(instant, index)),
  );
  const view = mustOk(sealView(query, viewRecords), "seal-view").view;
  const viewLine: StageLine = {
    stage: "S14 seal the point-in-time view",
    gate: "W050 buildPointInTimeQuery+sealView",
    recordId: String(view.viewId),
    carriedCount: view.records.length,
  };

  const marketEvents = MARKET_EVENT_INSTANTS.map((instant, index) => journeyMarketEvent(instant, index));
  const assembled = mustOk(
    assembleView(query, [
      {
        kind: "market-events",
        worldId: SCOPE.worldId as never,
        declaredRange: { from: at(T0 + MARKET_RANGE.from), to: at(T0 + MARKET_RANGE.to) },
        events: marketEvents,
      },
    ]),
    "assemble-view",
  ).assembled;
  const assembledLine: StageLine = {
    stage: "S15 assemble the view through the engine",
    gate: "W050 services/time-machine assembleView",
    recordId: String(assembled.view.viewId),
    carriedCount: assembled.view.records.length,
  };

  const knowledge =
    order === "canonical" ? theKnowledgeRecords() : [...theKnowledgeRecords()].reverse();
  const knowledgeLine: StageLine = {
    stage: "S16 seal the knowledge records",
    gate: "W054 sealKnowledgeRecord",
    recordId: multi(knowledge.length, "mem-"),
    carriedCount: null,
  };

  const founded = mustOk(foundBrain(SCOPE as KnowledgeScope), "found-brain").brain;
  const brain = mustOk(ingest(founded, knowledge), "ingest").brain;
  const brainLine: StageLine = {
    stage: "S17 found + feed the firm brain",
    gate: "W054 foundBrain+ingest",
    recordId: String(brain.brainId),
    carriedCount: brain.records.length,
  };

  const recalled = mustOk(
    recall(brain, { kind: "by-kind", scope: SCOPE as KnowledgeScope, knowledgeKind: "post-mortem" }),
    "recall",
  ).records;
  const recallLine: StageLine = {
    stage: "S18 recall post-mortem knowledge",
    gate: "W054 recall",
    recordId: `${String(brain.brainId)}@${String(brain.generation)}`,
    carriedCount: recalled.length,
  };

  const bridge = bridgeFixture();
  const episodes = mustOk(
    assembleEpisodes({
      trajectories: bridge.records,
      evaluations: [bridge.evaluation],
      bindings: [bridge.agentBinding],
    }),
    "assemble-episodes",
  ).episodes;
  const batch = mustOk(
    assembleBatch(episodes, { policyId: "sel-reference-journey", parameters: [{ name: "seedless", value: true }] }),
    "assemble-batch",
  );
  const episodesLine: StageLine = {
    stage: "S19 bridge trajectories into episodes",
    gate: "W047 assembleEpisodes",
    recordId: multi(episodes.length, "epi-"),
    carriedCount: null,
  };
  const batchLine: StageLine = {
    stage: "S20 assemble the training batch",
    gate: "W047 assembleBatch",
    recordId: String(batch.batch.batchId),
    carriedCount: batch.batch.episodeCount,
  };

  return {
    lines: [
      curriculumLine,
      selfPlayLine,
      adversarialLine,
      experimentLine,
      evaluationLine,
      findingsLine,
      historyLine,
      postMortemLine,
      viewLine,
      assembledLine,
      knowledgeLine,
      brainLine,
      recallLine,
      episodesLine,
      batchLine,
    ],
    records: {
      curriculum,
      selfPlay,
      adversarial,
      postMortem,
      view,
      assembled,
      knowledge,
      brain,
      recalled,
      episodes,
      batchId: String(batch.batch.batchId),
      batchEpisodeCount: batch.batch.episodeCount,
    },
  };
}
