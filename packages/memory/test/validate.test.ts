/**
 * The whole-record re-validation laws of the W054 memory contract: a
 * lawfully sealed record re-validates; every tamper — a rewritten payload
 * (the id no longer re-derives), a cross-tenant scope edit (R056 named
 * loudly), a project/world drift (§14), a citation edit, a provenance
 * edit, a lineage edit — is a LOUD typed refusal. REAL imports only.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { TENANT_ISOLATION_LAW, validateKnowledgeRecord } from "../index.js";
import type { KnowledgeRecord } from "../index.js";
import {
  SCOPE,
  aCapabilityRecord,
  aLessonSetRecord,
  aPostMortemRecord,
  aSearchHistoryRecord,
} from "./fixtures.js";

function codes(record: KnowledgeRecord): string[] {
  const validation = validateKnowledgeRecord(record);
  assert.ok(!validation.ok);
  return validation.errors.map((error) => error.code);
}

function tamper(record: KnowledgeRecord, edit: (draft: Record<string, unknown>) => void): KnowledgeRecord {
  const draft = { ...record } as unknown as Record<string, unknown>;
  edit(draft);
  return draft as unknown as KnowledgeRecord;
}

describe("validateKnowledgeRecord — lawful records", () => {
  it("re-validates a sealed post-mortem record", () => {
    assert.deepEqual(validateKnowledgeRecord(aPostMortemRecord()), { ok: true });
  });

  it("re-validates a sealed lesson-set record", () => {
    assert.deepEqual(validateKnowledgeRecord(aLessonSetRecord()), { ok: true });
  });

  it("re-validates a sealed capability record", () => {
    assert.deepEqual(validateKnowledgeRecord(aCapabilityRecord()), { ok: true });
  });

  it("re-validates a sealed search-history record", () => {
    assert.deepEqual(validateKnowledgeRecord(aSearchHistoryRecord()), { ok: true });
  });
});

describe("validateKnowledgeRecord — the refusals", () => {
  it("refuses malformed records", () => {
    assert.equal(validateKnowledgeRecord(null as never).ok, false);
    const blank = validateKnowledgeRecord({ recordId: "" } as never);
    assert.ok(!blank.ok);
    assert.equal(blank.errors[0]?.code, "malformed-record");
    const wrongVocabulary = validateKnowledgeRecord({ recordId: "not-a-mem-id" } as never);
    assert.ok(!wrongVocabulary.ok);
    assert.equal(wrongVocabulary.errors[0]?.code, "record-id-mismatch");
  });

  it("refuses a rewritten payload — the id no longer re-derives (A9)", () => {
    const record = aPostMortemRecord();
    const rewritten = tamper(record, (draft) => {
      const payload = draft.payload as Record<string, unknown>;
      const postMortem = payload.postMortem as Record<string, unknown>;
      const evaluation = postMortem.evaluation as Record<string, unknown>;
      evaluation.passCount = 999;
    });
    assert.ok(codes(rewritten).includes("record-id-mismatch"));
  });

  it("refuses a cross-tenant scope edit LOUDLY, naming R056", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const scope = draft.scope as Record<string, unknown>;
      scope.tenantId = "tenant-somewhere-else";
    });
    const validation = validateKnowledgeRecord(edited);
    assert.ok(!validation.ok);
    const cross = validation.errors.find((error) => error.code === "cross-tenant");
    assert.ok(cross !== undefined);
    assert.ok(cross.message.includes(TENANT_ISOLATION_LAW));
  });

  it("refuses a same-tenant/other-world scope edit naming §14", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const scope = draft.scope as Record<string, unknown>;
      scope.worldId = "world-somewhere-else";
    });
    assert.ok(codes(edited).includes("scope-mismatch"));
  });

  it("refuses a blank scope member edit", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const scope = draft.scope as Record<string, unknown>;
      scope.projectId = " ";
    });
    assert.ok(codes(edited).includes("invalid-scope"));
  });

  it("refuses a citation edit (citation ↔ payload coherence, A6)", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const citation = draft.citation as Record<string, unknown>;
      citation.evaluationId = "expeval-stranger";
    });
    assert.ok(codes(edited).includes("citation-mismatch"));
  });

  it("refuses a lesson-count edit on a lesson-set citation", () => {
    const record = aLessonSetRecord();
    const edited = tamper(record, (draft) => {
      const citation = draft.citation as Record<string, unknown>;
      citation.lessonCount = 999;
    });
    assert.ok(codes(edited).includes("citation-mismatch"));
  });

  it("refuses a citation kind edit that desynchronizes from the payload", () => {
    const record = aSearchHistoryRecord();
    const edited = tamper(record, (draft) => {
      const citation = draft.citation as Record<string, unknown>;
      citation.kind = "capability";
    });
    assert.ok(codes(edited).includes("citation-mismatch"));
  });

  it("refuses a lineage edit (the immutable lineage law)", () => {
    const record = aCapabilityRecord();
    const edited = tamper(record, (draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      lineage.root = "mem-stranger";
    });
    assert.ok(codes(edited).includes("lineage-break"));
  });

  it("refuses a provenance deriver edit (the closed deriver vocabulary)", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const provenance = draft.provenance as Record<string, unknown>;
      provenance.deriver = "someone-else";
    });
    assert.ok(codes(edited).includes("provenance-mismatch"));
  });

  it("refuses a provenance law-list edit (laws carried verbatim)", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const provenance = draft.provenance as Record<string, unknown>;
      provenance.laws = ["a made-up law"];
    });
    assert.ok(codes(edited).includes("provenance-mismatch"));
  });

  it("refuses a provenance input-digest edit (deterministic provenance, A9)", () => {
    const record = aPostMortemRecord();
    const edited = tamper(record, (draft) => {
      const provenance = draft.provenance as Record<string, unknown>;
      provenance.inputDigest = "deadbeef";
    });
    assert.ok(codes(edited).includes("provenance-mismatch"));
  });

  it("still agrees with the sealed scope after a benign deep copy", () => {
    const record = aSearchHistoryRecord();
    const copied = JSON.parse(JSON.stringify(record)) as KnowledgeRecord;
    assert.deepEqual(validateKnowledgeRecord(copied), { ok: true });
  });

  it("carries the scope law on blank-member records from any source kind", () => {
    for (const record of [aLessonSetRecord(), aCapabilityRecord()]) {
      const edited = tamper(record, (draft) => {
        const scope = draft.scope as Record<string, unknown>;
        scope.tenantId = "";
      });
      assert.ok(codes(edited).includes("invalid-scope"));
      assert.ok(String(edited.scope.tenantId) !== SCOPE.tenantId || codes(edited).length > 0);
    }
  });
});
