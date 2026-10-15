/**
 * The seal-gate laws of the W054 memory contract: every record kind seals,
 * the A9 id twin, the R056 STRUCTURAL tenant law (the tenant is part of
 * the canonical identity; a cross-tenant record is a LOUD typed refusal
 * naming R056), the §14 scope laws, the closed vocabulary, the lineage
 * laws, the citation coherence law. REAL imports only.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_RECORD_ID_PREFIX,
  TENANT_ISOLATION_LAW,
  knowledgeRecordDigestOf,
  sealKnowledgeRecord,
} from "../index.js";
import type { CapabilityPayload, KnowledgeRecord, LessonSetPayload, PostMortemPayload, SearchHistoryPayload } from "../index.js";
import type { PostMortem, PostMortemId } from "outcome-learning";
import {
  OTHER_TENANT_SCOPE,
  OTHER_WORLD_SCOPE,
  SCOPE,
  aCapabilityRecord,
  aLessonSetRecord,
  aPostMortemRecord,
  aPostMortemValue,
  aSearchHistoryRecord,
} from "./fixtures.js";

function firstMessage(errors: readonly { message: string }[]): string {
  return errors[0]?.message ?? "";
}

describe("sealKnowledgeRecord", () => {
  it("seals a post-mortem record with a content-addressed mem- id", () => {
    const record = aPostMortemRecord();
    const payload = record.payload as PostMortemPayload;
    assert.ok(record.recordId.startsWith(KNOWLEDGE_RECORD_ID_PREFIX));
    assert.equal(record.citation.kind, "post-mortem");
    assert.equal(String(record.citation.postMortemId), String(payload.postMortem.postMortemId));
    assert.equal(record.citation.evaluationId, String(payload.postMortem.evaluation.evaluationId));
    assert.deepEqual(record.scope, SCOPE);
    assert.equal(record.lineage.ordinal, 0);
    assert.equal(record.lineage.root, record.recordId);
  });

  it("seals a lesson-set record citing its post-mortem and its digest", () => {
    const record = aLessonSetRecord();
    const payload = record.payload as LessonSetPayload;
    assert.equal(record.citation.kind, "lesson-set");
    assert.equal(String(record.citation.postMortemId), String(payload.postMortem.postMortemId));
    assert.equal(record.citation.lessonSetDigest, String(payload.lessons.digest));
    assert.equal(record.citation.lessonCount, payload.lessons.lessons.length);
  });

  it("seals a capability record citing the registered entry's own identity", () => {
    const record = aCapabilityRecord();
    const payload = record.payload as CapabilityPayload;
    assert.equal(record.citation.kind, "capability");
    assert.equal(String(record.citation.capabilityId), String(payload.entry.descriptor.capabilityId));
    assert.equal(record.citation.state, payload.entry.state);
  });

  it("seals a search-history record citing the history's own identity", () => {
    const record = aSearchHistoryRecord();
    const payload = record.payload as SearchHistoryPayload;
    assert.equal(record.citation.kind, "search-history");
    assert.equal(String(record.citation.historyId), String(payload.history.historyId));
    assert.equal(record.citation.trialCount, payload.history.trials.length);
  });

  it("A9 twin: independently built records seal deep-equal with the same id", () => {
    const left = aPostMortemRecord();
    const right = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
    assert.ok(right.ok);
    assert.equal(right.record.recordId, left.recordId);
    assert.deepEqual(right.record, left);
  });

  it("R056 structural: the tenant is weighed into the canonical identity", () => {
    const record = aPostMortemRecord();
    const otherTenant = { ...record, scope: OTHER_TENANT_SCOPE } as KnowledgeRecord;
    const otherWorld = { ...record, scope: OTHER_WORLD_SCOPE } as KnowledgeRecord;
    assert.notEqual(knowledgeRecordDigestOf(otherTenant), record.recordId);
    assert.notEqual(knowledgeRecordDigestOf(otherWorld), record.recordId);
  });

  it("refuses a cross-tenant payload LOUDLY, naming R056", () => {
    const sealed = sealKnowledgeRecord({ scope: OTHER_TENANT_SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "cross-tenant");
    assert.ok(firstMessage(sealed.errors).includes(TENANT_ISOLATION_LAW));
    assert.ok(firstMessage(sealed.errors).includes("tenant isolated"));
  });

  it("refuses a same-tenant/other-world payload naming §14", () => {
    const sealed = sealKnowledgeRecord({ scope: OTHER_WORLD_SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "scope-mismatch");
    assert.ok(firstMessage(sealed.errors).includes("§14"));
  });

  it("refuses a blank §14 scope member", () => {
    const sealed = sealKnowledgeRecord({ scope: { tenantId: "", projectId: SCOPE.projectId, worldId: SCOPE.worldId }, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "invalid-scope");
  });

  it("refuses an unknown source kind (the closed vocabulary)", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "hunch" } as never });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "unknown-source-kind");
  });

  it("refuses malformed input", () => {
    const sealed = sealKnowledgeRecord(null as never);
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "malformed-input");
  });

  it("refuses a payload whose source id is blank", () => {
    const postMortem = { ...aPostMortemValue(), postMortemId: "" as unknown as PostMortemId } as PostMortem;
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "blank-source-id");
  });

  it("refuses a lesson set that does not answer the post-mortem carried beside it", () => {
    const postMortem = aPostMortemValue();
    const payload = aLessonSetRecord(postMortem).payload as LessonSetPayload;
    const stranger: LessonSetPayload = { kind: "lesson-set", lessons: { ...payload.lessons, postMortemId: "pm-stranger" as unknown as PostMortemId }, postMortem };
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: stranger });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "citation-mismatch");
  });
});

describe("sealKnowledgeRecord lineage laws", () => {
  it("refuses a root record whose lineage cites a stranger root", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { root: "mem-stranger" as never } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "lineage-break");
  });

  it("refuses a root record whose ordinal is not 0", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { ordinal: 1 } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "lineage-break");
  });

  it("refuses a continuation with a blank parent", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { parent: "" as never, root: "mem-root" as never, ordinal: 1 } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "lineage-break");
  });

  it("refuses a continuation that declares no chain root", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { parent: "mem-parent" as never, ordinal: 1 } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "lineage-break");
  });

  it("refuses a continuation whose ordinal is not a positive integer", () => {
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { parent: "mem-parent" as never, root: "mem-root" as never, ordinal: 0 } });
    assert.ok(!sealed.ok);
    assert.equal(sealed.errors[0]?.code, "lineage-break");
  });

  it("seals a lawful continuation with the declared lineage carried verbatim", () => {
    const parent = aPostMortemRecord();
    const sealed = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() }, lineage: { parent: parent.recordId, root: parent.recordId, ordinal: 1 } });
    assert.ok(sealed.ok);
    assert.equal(sealed.record.lineage.parent, parent.recordId);
    assert.equal(sealed.record.lineage.ordinal, 1);
  });
});
