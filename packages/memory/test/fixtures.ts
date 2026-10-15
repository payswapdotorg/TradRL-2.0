/**
 * Shared deterministic fixtures for the memory tests (W054).
 *
 * Every builder constructs the REAL shapes through the REAL seams (the
 * no-shim law): the post-mortem + lesson set + search history through
 * W053's own gates over W053's own REAL fixtures (the W038 evaluation walk
 * + the W051 history builders); the capability entry through W040's own
 * registration gate over W040's REAL experiment/evaluation/findings
 * fixtures (scope-aligned to the brain's own scope); the knowledge records
 * through THIS package's own seal gate. Zero fixture drift; only
 * opaque-id leaf values are cast.
 */

import { aLessonSet, aPostMortem, aSoftOutcome } from "../../../services/outcome-learning/test/fixtures.js";
import type { PostMortem } from "outcome-learning";
import { createCapabilityRegistry, registerCapability } from "capability-registry";
import type { RegistryEntry } from "capability-registry";
import {
  experimentFixture,
  evaluationFixture,
  findingsFixture,
  registrationFixture,
} from "../../../packages/capability-registry/test/fixtures.js";
import { sealKnowledgeRecord } from "../index.js";
import type { KnowledgeRecord, KnowledgeScope } from "../index.js";

/** The brain's scope — the W053 fixtures' own scope (tenant-w050 family). */
export const SCOPE: KnowledgeScope = { tenantId: "tenant-w050", projectId: "project-w050", worldId: "world-w050-tests" };

/** Another tenant's scope (the R056 cross-tenant refusal fixture). */
export const OTHER_TENANT_SCOPE: KnowledgeScope = { tenantId: "tenant-somewhere-else", projectId: SCOPE.projectId, worldId: SCOPE.worldId };

/** The same tenant, another world (the §14 scope-mismatch fixture). */
export const OTHER_WORLD_SCOPE: KnowledgeScope = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: "world-somewhere-else" };

/** The soft post-mortem fixture (W053's own gate, W053's own outcome). */
export function aPostMortemValue(): PostMortem {
  return aPostMortem(aSoftOutcome());
}

/** A MEASURED capability entry, scope-aligned through W040's own gate. */
export function aCapabilityEntryValue(): RegistryEntry {
  const experiment = experimentFixture({
    name: "exp-w054-firm-brain-capability",
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    world: { worldId: SCOPE.worldId, definitionDigest: "defdigest-w054-firm-brain-1" },
  });
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
  const registered = registerCapability(createCapabilityRegistry(SCOPE), {
    ...registrationFixture(),
    scope: SCOPE,
    evidence: [{ experiment, evaluation, findings }],
  });
  if (!registered.ok) {
    throw new Error(`fixture capability failed registration: ${registered.errors.map((error) => error.message).join("; ")}`);
  }
  const entry = registered.registry.entries[0];
  if (entry === undefined) {
    throw new Error("fixture capability registry carries no entry");
  }
  return entry;
}

/** The search-history fixture (W053's own outcome's own history). */
export function aSearchHistoryValue() {
  return aSoftOutcome().history;
}

/** One sealed post-mortem knowledge record. */
export function aPostMortemRecord(): KnowledgeRecord {
  const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
  if (!sealed.ok) {
    throw new Error(`fixture post-mortem record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}

/** One sealed lesson-set knowledge record (its post-mortem carried beside). */
export function aLessonSetRecord(postMortem: PostMortem = aPostMortemValue()): KnowledgeRecord {
  const sealed = sealKnowledgeRecord({
    scope: SCOPE,
    source: { kind: "lesson-set", lessons: aLessonSet(postMortem), postMortem },
  });
  if (!sealed.ok) {
    throw new Error(`fixture lesson-set record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}

/** One sealed capability knowledge record. */
export function aCapabilityRecord(): KnowledgeRecord {
  const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "capability", entry: aCapabilityEntryValue() } });
  if (!sealed.ok) {
    throw new Error(`fixture capability record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}

/** One sealed search-history knowledge record. */
export function aSearchHistoryRecord(): KnowledgeRecord {
  const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "search-history", history: aSearchHistoryValue() } });
  if (!sealed.ok) {
    throw new Error(`fixture search-history record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}
