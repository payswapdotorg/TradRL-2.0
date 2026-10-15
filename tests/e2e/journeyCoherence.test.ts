/**
 * The coherence law (A6) of the W064 reference journey: NO number appears
 * in the journey's reported summary that the cited records do not carry.
 * Every printed count is re-derived HERE from the composed records and
 * compared against the printed stage lines; every multi-record count is
 * cross-proven against a CARRYING record (the brain's record count, the
 * batch's episode count, the report's event total).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeJourney } from "../../examples/reference-trading/journey.js";
import { renderStageLine } from "../../examples/reference-trading/journeyHelpers.js";

const journey = composeJourney();
const founding = journey.records.founding;
const learning = journey.records.learning;
const commerce = journey.records.commerce;
const governance = journey.records.governance;

function carriedCountOf(stagePrefix: string): number {
  const line = journey.lines.find((candidate) => candidate.stage.startsWith(stagePrefix));
  assert.ok(line !== undefined, `the journey reports stage ${String(stagePrefix)}`);
  assert.ok(line.carriedCount !== null, `stage ${String(stagePrefix)} carries no count`);
  return line.carriedCount as number;
}

function recordIdOf(stagePrefix: string): string {
  const line = journey.lines.find((candidate) => candidate.stage.startsWith(stagePrefix));
  assert.ok(line !== undefined, `the journey reports stage ${String(stagePrefix)}`);
  return line.recordId;
}

test("every founding count is carried by the cited records", () => {
  assert.equal(carriedCountOf("S1"), founding.plan.endowment.entries.length);
  assert.equal(carriedCountOf("S2"), founding.commissioned.endowment.entries.length);
  assert.equal(carriedCountOf("S4"), founding.champion.membership.length);
  assert.equal(carriedCountOf("S5"), founding.challenger.membership.length);
});

test("every learning count is carried by the cited records", () => {
  assert.equal(carriedCountOf("S6"), learning.curriculum.stages.length);
  assert.equal(carriedCountOf("S7"), learning.selfPlay.memberCount);
  assert.equal(carriedCountOf("S10"), learning.postMortem.evaluation.passCount);
  assert.equal(carriedCountOf("S12"), learning.postMortem.history.trialCount);
  assert.equal(carriedCountOf("S14"), learning.view.records.length);
  assert.equal(carriedCountOf("S15"), learning.assembled.view.records.length);
  assert.equal(carriedCountOf("S17"), learning.brain.records.length);
  assert.equal(carriedCountOf("S18"), learning.recalled.length);
  assert.equal(carriedCountOf("S20"), learning.batchEpisodeCount);
});

test("every loop + commerce count is carried by the cited records", () => {
  assert.equal(carriedCountOf("S21"), commerce.cycle.steps.length);
  assert.equal(carriedCountOf("S22"), commerce.arena.offers.length);
  assert.equal(carriedCountOf("S23"), commerce.arenaLeaderboardSize);
  assert.equal(carriedCountOf("S24"), commerce.provider.offers.length);
  assert.equal(carriedCountOf("S25"), commerce.listing.registration.offers.length);
});

test("every governance count is carried by the cited records", () => {
  assert.equal(carriedCountOf("S29"), governance.isolation.checked);
  assert.equal(carriedCountOf("S30"), governance.enforcement.checked);
  assert.equal(carriedCountOf("S32"), governance.trailRecordCount);
  assert.equal(carriedCountOf("S33"), governance.report.eventTotal);
});

test("the multi-record counts are cross-proven against CARRYING records", () => {
  // S16 "N× mem-" — N is the knowledge-record count the BRAIN record carries.
  const knowledgeCount = Number(recordIdOf("S16").split("×")[0]);
  assert.equal(knowledgeCount, learning.knowledge.length);
  assert.equal(knowledgeCount, learning.brain.records.length);
  // S19 "N× epi-" — N is the episode count the BATCH record carries.
  const episodeCount = Number(recordIdOf("S19").split("×")[0]);
  assert.equal(episodeCount, learning.episodes.length);
  assert.equal(episodeCount, learning.batchEpisodeCount);
  // S31 "N× oev-" — N is the event total the REPORT record carries.
  const eventCount = Number(recordIdOf("S31").split("×")[0]);
  assert.equal(eventCount, governance.events.length);
  assert.equal(eventCount, governance.report.eventTotal);
});

test("every printed record id is the cited record's own id", () => {
  assert.equal(recordIdOf("S1"), String(founding.plan.planId));
  assert.equal(recordIdOf("S2"), String(founding.commissioned.commissionedId));
  assert.equal(recordIdOf("S3"), String(founding.binding.bindingId));
  assert.equal(recordIdOf("S4"), String(founding.champion.populationId));
  assert.equal(recordIdOf("S6"), String(learning.curriculum.curriculumId));
  assert.equal(recordIdOf("S7"), String(learning.selfPlay.pairingId));
  assert.equal(recordIdOf("S8"), String(learning.adversarial.pairingId));
  assert.equal(recordIdOf("S9"), String(learning.postMortem.evaluation.experimentId));
  assert.equal(recordIdOf("S10"), String(learning.postMortem.evaluation.evaluationId));
  assert.equal(recordIdOf("S12"), String(learning.postMortem.history.historyId));
  assert.equal(recordIdOf("S13"), String(learning.postMortem.postMortemId));
  assert.equal(recordIdOf("S14"), String(learning.view.viewId));
  assert.equal(recordIdOf("S15"), String(learning.assembled.view.viewId));
  assert.equal(recordIdOf("S17"), String(learning.brain.brainId));
  assert.equal(recordIdOf("S20"), learning.batchId);
  assert.equal(recordIdOf("S21"), String(commerce.cycle.cycleId));
  assert.equal(recordIdOf("S22"), String(commerce.arena.arenaId));
  assert.equal(recordIdOf("S24"), String(commerce.provider.providerId));
  assert.equal(recordIdOf("S25"), String(commerce.listing.listingId));
  assert.equal(recordIdOf("S26"), String(commerce.entitlement.entitlementId));
  assert.equal(recordIdOf("S27"), String(governance.policy.policyId));
  assert.equal(recordIdOf("S28"), String(governance.secret.secretId));
  assert.equal(recordIdOf("S29"), String(governance.isolation.proofId));
  assert.equal(recordIdOf("S30"), String(governance.enforcement.enforcementId));
  assert.equal(recordIdOf("S32"), String(governance.trail.trailId));
  assert.equal(recordIdOf("S33"), String(governance.report.reportId));
  assert.equal(recordIdOf("S34"), String(governance.preparedRequest.preparedRequestId));
});

test("the journey's reported stage total is the journey's own carried count", () => {
  assert.equal(journey.lines.length, 34);
});

test("the rendered summary lines are exactly the stage lines (no hidden numbers)", () => {
  const rendered = journey.lines.map((line) => renderStageLine(line));
  assert.equal(rendered.length, journey.lines.length);
  for (const text of rendered) {
    assert.match(text, /^S\d+ .* \[W\d+[^\]]*\] → .+( · carries \d+)?$/);
  }
});
