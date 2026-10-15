/**
 * Shared deterministic fixtures for the firm-brain tests (W054).
 *
 * The knowledge records are memory's OWN test fixtures (sealed through
 * memory's own seal gate over W053/W040/W051's REAL fixtures — zero
 * drift); the brains are founded + fed through THIS service's own gates.
 */

import { foundBrain, ingest } from "../index.js";
import type { FirmBrain } from "../index.js";
import type { KnowledgeRecord } from "memory";
import type { PostMortem as W053PostMortem } from "outcome-learning";
import { sealKnowledgeRecord } from "memory";
import {
  SCOPE,
  aCapabilityRecord,
  aLessonSetRecord,
  aPostMortemRecord,
  aSearchHistoryRecord,
} from "../../../packages/memory/test/fixtures.js";

export { SCOPE, aCapabilityRecord, aLessonSetRecord, aPostMortemRecord, aPostMortemValue, aSearchHistoryRecord } from "../../../packages/memory/test/fixtures.js";

function orThrow(brain: FirmBrain, records: readonly KnowledgeRecord[]): FirmBrain {
  const fed = ingest(brain, records);
  if (!fed.ok) {
    throw new Error(`fixture brain failed to ingest: ${fed.errors.map((error) => error.message).join("; ")}`);
  }
  return fed.brain;
}

/** The four-kind knowledge fixture set (one record per closed kind). */
export function theKnowledgeRecords(): readonly KnowledgeRecord[] {
  return [aPostMortemRecord(), aLessonSetRecord(), aCapabilityRecord(), aSearchHistoryRecord()];
}

/** The founded (empty, generation 0) brain at the fixture scope. */
export function aFoundedBrain(): FirmBrain {
  const founded = foundBrain(SCOPE);
  if (!founded.ok) {
    throw new Error(`fixture brain failed to found: ${founded.errors.map((error) => error.message).join("; ")}`);
  }
  return founded.brain;
}

/** The fed brain: all four kinds ingested in ONE generation. */
export function aFedBrain(): FirmBrain {
  return orThrow(aFoundedBrain(), theKnowledgeRecords());
}

/** A sealed record over a TAMPERED post-mortem payload (W053's validator
 * will refuse it — the source re-proof fixture). */
export function aTamperedPostMortemRecord(): KnowledgeRecord {
  const record = aPostMortemRecord();
  const postMortem = record.payload as { kind: "post-mortem"; postMortem: { evaluation: { passCount: number } } };
  const tampered = { ...postMortem.postMortem, evaluation: { ...postMortem.postMortem.evaluation, passCount: 999 } } as never;
  return sealOrThrow({ scope: SCOPE, source: { kind: "post-mortem", postMortem: tampered } });
}

/** A sealed record over a REVERSED lesson set (W053's lesson order law
 * will refuse it). */
export function aReorderedLessonSetRecord(): KnowledgeRecord {
  const record = aLessonSetRecord();
  const payload = record.payload as { kind: "lesson-set"; lessons: { lessons: readonly unknown[] }; postMortem: W053PostMortem };
  const reordered = { ...payload.lessons, lessons: [...payload.lessons.lessons].reverse() } as never;
  return sealOrThrow({ scope: SCOPE, source: { kind: "lesson-set", lessons: reordered, postMortem: payload.postMortem } });
}

/** A sealed record over a capability entry in a bogus state (W040's
 * closed lifecycle vocabulary will refuse it). */
export function aBogusStateCapabilityRecord(): KnowledgeRecord {
  const record = aCapabilityRecord();
  const payload = record.payload as { kind: "capability"; entry: { state: string } };
  const bogus = { ...payload.entry, state: "bogus" } as never;
  return sealOrThrow({ scope: SCOPE, source: { kind: "capability", entry: bogus } });
}

/** A sealed record over an emptied search history (W051's empty-trial-set
 * law will refuse it). */
export function anEmptiedHistoryRecord(): KnowledgeRecord {
  const record = aSearchHistoryRecord();
  const payload = record.payload as { kind: "search-history"; history: { trials: readonly unknown[] } };
  const emptied = { ...payload.history, trials: [] } as never;
  return sealOrThrow({ scope: SCOPE, source: { kind: "search-history", history: emptied } });
}

function sealOrThrow(input: Parameters<typeof sealKnowledgeRecord>[0]): KnowledgeRecord {
  const sealed = sealKnowledgeRecord(input);
  if (!sealed.ok) {
    throw new Error(`fixture record failed to seal: ${sealed.errors.map((error) => error.message).join("; ")}`);
  }
  return sealed.record;
}
