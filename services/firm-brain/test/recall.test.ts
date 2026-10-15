/**
 * The deterministic recall surface laws of the W054 firm brain: the typed
 * by-kind/by-source/by-citation queries over CARRIED results in canonical
 * order, and EVERY refusal law — the R056 cross-tenant query refusal
 * (naming the law), the §14 query-scope mismatch, the closed vocabularies,
 * the blank-id law, the invalid-brain law. REAL imports only.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { TENANT_ISOLATION_LAW, citedIdsOf, sourceIdOf } from "memory";
import type { PostMortemSourceCitation } from "memory";
import { recall, validateFirmBrain } from "../index.js";
import type { FirmBrain } from "../index.js";
import { SCOPE, aCapabilityRecord, aFoundedBrain, aFedBrain, aLessonSetRecord, aPostMortemRecord, aSearchHistoryRecord } from "./fixtures.js";

function recordsOf(brain: FirmBrain, query: Parameters<typeof recall>[1]): readonly string[] {
  const outcome = recall(brain, query);
  assert.ok(outcome.ok);
  return outcome.records.map((record) => String(record.recordId));
}

describe("recall — by-kind", () => {
  it("recalls every kind in canonical order, carried verbatim", () => {
    const brain = aFedBrain();
    const expected: Record<string, string> = {
      "post-mortem": String(aPostMortemRecord().recordId),
      "lesson-set": String(aLessonSetRecord().recordId),
      capability: String(aCapabilityRecord().recordId),
      "search-history": String(aSearchHistoryRecord().recordId),
    };
    for (const kind of ["post-mortem", "lesson-set", "capability", "search-history"] as const) {
      assert.deepEqual(recordsOf(brain, { kind: "by-kind", scope: SCOPE, knowledgeKind: kind }), [expected[kind] ?? ""]);
    }
  });

  it("recalls nothing from the founding brain — an honest empty answer", () => {
    assert.deepEqual(recordsOf(aFoundedBrain(), { kind: "by-kind", scope: SCOPE, knowledgeKind: "capability" }), []);
  });

  it("refuses an unknown knowledge kind (the closed vocabulary)", () => {
    const refused = recall(aFedBrain(), { kind: "by-kind", scope: SCOPE, knowledgeKind: "hunch" as never });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "unknown-knowledge-kind");
  });
});

describe("recall — by-source (the primary source id key)", () => {
  it("recalls the post-mortem AND the lesson set that answers it", () => {
    const brain = aFedBrain();
    const postMortemId = sourceIdOf(aPostMortemRecord().citation);
    const ids = recordsOf(brain, { kind: "by-source", scope: SCOPE, sourceId: postMortemId });
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(String(aPostMortemRecord().recordId)));
    assert.ok(ids.includes(String(aLessonSetRecord().recordId)));
  });

  it("recalls the capability by its own capability id", () => {
    const brain = aFedBrain();
    const capabilityId = sourceIdOf(aCapabilityRecord().citation);
    assert.deepEqual(recordsOf(brain, { kind: "by-source", scope: SCOPE, sourceId: capabilityId }), [String(aCapabilityRecord().recordId)]);
  });

  it("recalls the search history by its own history id", () => {
    const brain = aFedBrain();
    const historyId = sourceIdOf(aSearchHistoryRecord().citation);
    assert.deepEqual(recordsOf(brain, { kind: "by-source", scope: SCOPE, sourceId: historyId }), [String(aSearchHistoryRecord().recordId)]);
  });
});

describe("recall — by-citation (every id the citation names)", () => {
  it("recalls the post-mortem by the evaluation id it cites", () => {
    const brain = aFedBrain();
    const evaluationId = (aPostMortemRecord().citation as PostMortemSourceCitation).evaluationId;
    assert.deepEqual(recordsOf(brain, { kind: "by-citation", scope: SCOPE, citedId: evaluationId }), [String(aPostMortemRecord().recordId)]);
  });

  it("recalls the search history by the experiment id it cites", () => {
    const brain = aFedBrain();
    const experimentId = citedIdsOf(aSearchHistoryRecord().citation)[1] ?? "";
    assert.deepEqual(recordsOf(brain, { kind: "by-citation", scope: SCOPE, citedId: experimentId }), [String(aSearchHistoryRecord().recordId)]);
  });

  it("recalls the lesson set by its own digest", () => {
    const brain = aFedBrain();
    const digest = citedIdsOf(aLessonSetRecord().citation)[1] ?? "";
    assert.deepEqual(recordsOf(brain, { kind: "by-citation", scope: SCOPE, citedId: digest }), [String(aLessonSetRecord().recordId)]);
  });

  it("answers an unknown cited id with an honest empty list", () => {
    assert.deepEqual(recordsOf(aFedBrain(), { kind: "by-citation", scope: SCOPE, citedId: "mem-stranger" }), []);
  });
});

describe("recall — the isolation + refusal laws", () => {
  it("refuses a cross-tenant query LOUDLY, naming R056", () => {
    const refused = recall(aFedBrain(), { kind: "by-kind", scope: { tenantId: "tenant-somewhere-else", projectId: SCOPE.projectId, worldId: SCOPE.worldId }, knowledgeKind: "capability" });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "cross-tenant-query");
    assert.ok((refused.errors[0]?.message ?? "").includes(TENANT_ISOLATION_LAW));
    assert.ok((refused.errors[0]?.message ?? "").includes("tenant isolated"));
  });

  it("refuses a same-tenant/other-world query naming §14", () => {
    const refused = recall(aFedBrain(), { kind: "by-kind", scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: "world-somewhere-else" }, knowledgeKind: "capability" });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "query-scope-mismatch");
  });

  it("refuses a blank query-scope member naming §14", () => {
    const refused = recall(aFedBrain(), { kind: "by-kind", scope: { tenantId: "", projectId: SCOPE.projectId, worldId: SCOPE.worldId }, knowledgeKind: "capability" });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "invalid-scope");
  });

  it("refuses a blank queried id", () => {
    const refused = recall(aFedBrain(), { kind: "by-source", scope: SCOPE, sourceId: " " });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "blank-query-id");
  });

  it("refuses an unknown recall kind (the closed vocabulary)", () => {
    const refused = recall(aFedBrain(), { kind: "by-vibes", scope: SCOPE } as never);
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "unknown-recall-kind");
  });

  it("refuses recall over an invalid brain (invariants carried verbatim)", () => {
    const broken = { ...aFedBrain(), generation: 9 } as unknown as FirmBrain;
    const refused = recall(broken, { kind: "by-kind", scope: SCOPE, knowledgeKind: "capability" });
    assert.ok(!refused.ok);
    assert.equal(refused.errors[0]?.code, "invalid-brain");
    assert.ok((refused.errors[0]?.brainErrors?.length ?? 0) > 0);
  });

  it("refuses malformed recall input", () => {
    const nullBrain = recall(null as never, { kind: "by-kind", scope: SCOPE, knowledgeKind: "capability" });
    assert.ok(!nullBrain.ok);
    assert.equal(nullBrain.errors[0]?.code, "malformed-input");
    const nullQuery = recall(aFoundedBrain(), null as never);
    assert.ok(!nullQuery.ok);
    assert.equal(nullQuery.errors[0]?.code, "malformed-input");
  });
});

describe("recall — determinism (A9)", () => {
  it("answers the same query with the same deep-equal results", () => {
    const brain = aFedBrain();
    const postMortemId = sourceIdOf(aPostMortemRecord().citation);
    const left = recall(brain, { kind: "by-citation", scope: SCOPE, citedId: postMortemId });
    const right = recall(brain, { kind: "by-citation", scope: SCOPE, citedId: postMortemId });
    assert.ok(left.ok && right.ok);
    assert.deepEqual(left, right);
  });

  it("carries the generation + brain id it answered from", () => {
    const outcome = recall(aFedBrain(), { kind: "by-kind", scope: SCOPE, knowledgeKind: "post-mortem" });
    assert.ok(outcome.ok);
    const brain = aFedBrain();
    assert.equal(outcome.generation, brain.generation);
    assert.equal(outcome.brainId, brain.brainId);
    assert.deepEqual(validateFirmBrain(brain), { ok: true });
  });
});
