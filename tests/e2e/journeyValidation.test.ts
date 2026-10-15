/**
 * The whole-record re-validation law of the W064 reference journey: EVERY
 * composed record re-validates through its SOURCE package's own validator
 * (REAL relative imports — no shims). A record is re-provable from its
 * recorded data alone; a gate that sealed it must re-accept it.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeJourney } from "../../examples/reference-trading/journey.js";
import { validateCommissionedBody } from "../../services/body-forge/commissioning/index.js";
import { validateAgentBinding } from "../../services/world-agent-runtime/index.js";
import { validatePopulation } from "../../services/populations/index.js";
import {
  validateAdversarialPairing,
  validateSelfPlayPairing,
} from "../../services/learning/populations/index.js";
import { validateCurriculum } from "../../services/learning/curriculum/index.js";
import { validatePostMortem } from "../../services/outcome-learning/index.js";
import {
  validatePointInTimeQuery,
  validatePointInTimeView,
} from "../../packages/tradrl-time-machine/index.js";
import { validateAssembledPointInTimeView } from "../../services/time-machine/index.js";
import { validateKnowledgeRecord } from "../../packages/memory/index.js";
import { validateFirmBrain } from "../../services/firm-brain/index.js";
import { validateEpisode } from "../../packages/rl-protocol/index.js";
import { validateImprovementCycle } from "../../services/autonomous-learning/index.js";
import { validateArenaRegistration } from "../../packages/tradrl-adapters/arena/index.js";
import { validateProviderRegistration } from "../../packages/capability-provider/index.js";
import { validateListing } from "../../packages/marketplace/index.js";
import { validateEntitlement } from "../../packages/entitlements/index.js";
import {
  validateIsolationProof,
  validateSecretReference,
  validateSecurityPolicy,
} from "../../packages/security/index.js";
import { validateSecretEnforcement } from "../../services/security/index.js";
import {
  validateAuditRecord,
  validateOperationalEvent,
} from "../../packages/observability/index.js";
import { validateOperationsReport, verifyTrail } from "../../services/operations/index.js";
import { WORLD_ALPHA_API_V1, validateRouteTable } from "../../services/api/index.js";
import { validateSdkPreparedRequest } from "../../packages/sdk/index.js";

const journey = composeJourney();
const founding = journey.records.founding;
const learning = journey.records.learning;
const commerce = journey.records.commerce;
const governance = journey.records.governance;

test("the founded population generations re-validate through W045's own validator", () => {
  assert.ok(validatePopulation(founding.champion).ok);
  assert.ok(validatePopulation(founding.challenger).ok);
});

test("the commissioned body re-validates through W043's own validator", () => {
  assert.ok(validateCommissionedBody(founding.commissioned).ok);
});

test("the agent binding re-validates through W044's own validator", () => {
  assert.ok(validateAgentBinding(founding.binding).ok);
});

test("the curriculum + both pairings re-validate through W046's own validators", () => {
  assert.ok(validateCurriculum(learning.curriculum).ok);
  assert.ok(validateSelfPlayPairing(learning.selfPlay).ok);
  assert.ok(validateAdversarialPairing(learning.adversarial).ok);
});

test("the post-mortem re-validates through W053's own validator", () => {
  assert.ok(validatePostMortem(learning.postMortem).ok);
});

test("the point-in-time view re-validates through W050's own validators (query + sealed view + assembled view)", () => {
  assert.ok(validatePointInTimeQuery(learning.view.query).ok);
  assert.ok(validatePointInTimeView(learning.view).ok);
  assert.ok(validateAssembledPointInTimeView(learning.assembled).ok);
});

test("every knowledge record re-validates through the memory contract's own validator", () => {
  for (const record of learning.knowledge) {
    assert.ok(validateKnowledgeRecord(record).ok);
  }
});

test("the fed brain re-validates through W054's own whole-brain validator", () => {
  assert.ok(validateFirmBrain(learning.brain).ok);
});

test("every RL episode re-validates through the rl-protocol contract's own validator", () => {
  for (const episode of learning.episodes) {
    assert.ok(validateEpisode(episode).ok);
  }
});

test("the improvement cycle re-validates through W055's own validator", () => {
  assert.ok(validateImprovementCycle(commerce.cycle).ok);
});

test("the arena registration re-validates through W057's own validator", () => {
  assert.ok(validateArenaRegistration(commerce.arena).ok);
});

test("the provider registration + the listing re-validate through W056/W058's own validators", () => {
  assert.ok(validateProviderRegistration(commerce.provider).ok);
  assert.ok(validateListing(commerce.listing).ok);
});

test("the entitlement re-validates through W058's own validator", () => {
  assert.ok(validateEntitlement(commerce.entitlement).ok);
});

test("the security records re-validate through W060's own validators", () => {
  assert.ok(validateSecurityPolicy(governance.policy).ok);
  assert.ok(validateSecretReference(governance.secret).ok);
  assert.ok(validateIsolationProof(governance.isolation).ok);
  assert.ok(validateSecretEnforcement(governance.enforcement).ok);
});

test("the audit records + the events + the trail + the report re-validate through W061's own validators", () => {
  for (const record of governance.trail.records) {
    assert.deepEqual(validateAuditRecord(record), []);
  }
  for (const event of governance.events) {
    assert.deepEqual(validateOperationalEvent(event), []);
  }
  const verification = verifyTrail(governance.trail);
  assert.ok(verification.ok);
  assert.equal(verification.recordCount, governance.trailRecordCount);
  assert.deepEqual(validateOperationsReport(governance.report), []);
});

test("the API projection re-validates through W059's own validators (table + prepared request)", () => {
  assert.ok(validateRouteTable(WORLD_ALPHA_API_V1).ok);
  assert.ok(validateSdkPreparedRequest(governance.preparedRequest, WORLD_ALPHA_API_V1).ok);
});
