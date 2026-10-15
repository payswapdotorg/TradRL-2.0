/**
 * The founding + ingestion gate laws of the W054 firm brain: founding at an
 * explicit §14 scope, the generation sealing (canonical order, lineage
 * EXTENDED never rewritten), THE GATES — every refusal law pinned: the
 * memory re-validation, the source-package re-proofs (W053/W040/W051
 * errors carried VERBATIM), the R056 cross-tenant refusal, the §14
 * scope-mismatch, the append-only duplicate law, the invalid-brain law.
 * REAL imports only.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { TENANT_ISOLATION_LAW } from "memory";
import type { KnowledgeRecord } from "memory";
import { foundBrain, ingest } from "../index.js";
import type { FirmBrain } from "../index.js";
import {
  SCOPE,
  aBogusStateCapabilityRecord,
  aCapabilityRecord,
  anEmptiedHistoryRecord,
  aFoundedBrain,
  aFedBrain,
  aPostMortemRecord,
  aReorderedLessonSetRecord,
  aTamperedPostMortemRecord,
  theKnowledgeRecords,
} from "./fixtures.js";

describe("foundBrain", () => {
  it("founds the empty generation-0 brain at one explicit §14 scope", () => {
    const founded = foundBrain(SCOPE);
    assert.ok(founded.ok);
    assert.ok(founded.brain.brainId.startsWith("brain-"));
    assert.equal(founded.brain.generation, 0);
    assert.deepEqual(founded.brain.records, []);
    assert.deepEqual(founded.brain.scope, SCOPE);
    assert.equal(founded.brain.lineage.parent, undefined);
    assert.equal(founded.brain.lineage.root, founded.brain.brainId);
    assert.equal(founded.brain.provenance.deriver, "found-brain");
  });

  it("refuses a blank §14 scope member loudly", () => {
    const founded = foundBrain({ tenantId: " ", projectId: SCOPE.projectId, worldId: SCOPE.worldId });
    assert.ok(!founded.ok);
    assert.equal(founded.errors[0]?.code, "invalid-scope");
  });

  it("refuses malformed founding input", () => {
    const founded = foundBrain(null as never);
    assert.ok(!founded.ok);
    assert.equal(founded.errors[0]?.code, "malformed-input");
  });
});

describe("ingest — the generation sealing", () => {
  it("ingests all four knowledge kinds into one canonical generation", () => {
    const fed = ingest(aFoundedBrain(), theKnowledgeRecords());
    assert.ok(fed.ok);
    assert.equal(fed.brain.generation, 1);
    assert.equal(fed.brain.records.length, 4);
    assert.equal(fed.appended.length, 4);
    const ids = fed.brain.records.map((record) => String(record.recordId));
    const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    assert.deepEqual(ids, sorted);
    assert.equal(fed.brain.lineage.parent, aFoundedBrain().brainId);
    assert.equal(fed.brain.lineage.ordinal, 1);
    assert.equal(fed.brain.provenance.deriver, "ingest-knowledge");
  });

  it("extends the lineage across generations — never rewrites it", () => {
    const founding = aFoundedBrain();
    const first = ingest(founding, [aPostMortemRecord()]);
    assert.ok(first.ok);
    const second = ingest(first.brain, [aCapabilityRecord()]);
    assert.ok(second.ok);
    assert.equal(second.brain.generation, 2);
    assert.equal(second.brain.lineage.parent, first.brain.brainId);
    assert.equal(second.brain.lineage.root, founding.brainId);
    assert.equal(second.brain.records.length, 2);
    const firstIds = first.brain.records.map((record) => String(record.recordId));
    const secondIds = second.brain.records.map((record) => String(record.recordId));
    assert.ok(firstIds.every((id) => secondIds.includes(id)), "the first generation's records are all still carried — append-only, never rewritten");
  });

  it("keeps the founding brain value untouched (immutable values)", () => {
    const founding = aFoundedBrain();
    ingest(founding, theKnowledgeRecords());
    assert.deepEqual(founding, aFoundedBrain());
  });
});

describe("ingest — THE GATES (every refusal law)", () => {
  it("refuses a cross-tenant record LOUDLY, naming R056", () => {
    const brain = foundBrain({ tenantId: "tenant-somewhere-else", projectId: SCOPE.projectId, worldId: SCOPE.worldId });
    assert.ok(brain.ok);
    const fed = ingest(brain.brain, [aPostMortemRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "cross-tenant");
    assert.ok((fed.errors[0]?.message ?? "").includes(TENANT_ISOLATION_LAW));
    assert.ok((fed.errors[0]?.message ?? "").includes("tenant isolated"));
  });

  it("refuses a same-tenant/other-world record naming §14", () => {
    const brain = foundBrain({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: "world-somewhere-else" });
    assert.ok(brain.ok);
    const fed = ingest(brain.brain, [aPostMortemRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "scope-mismatch");
  });

  it("refuses a duplicate record — append-only, never an overwrite", () => {
    const duplicate = ingest(aFoundedBrain(), [aPostMortemRecord(), aPostMortemRecord()]);
    assert.ok(!duplicate.ok);
    assert.equal(duplicate.errors[0]?.code, "duplicate-record");
    const later = ingest(aFedBrain(), [aPostMortemRecord()]);
    assert.ok(!later.ok);
    assert.equal(later.errors[0]?.code, "duplicate-record");
    const stillCanonical = ingest(aFedBrain(), []);
    assert.ok(stillCanonical.ok);
    assert.equal(stillCanonical.brain.generation, 2);
    assert.equal(stillCanonical.brain.records.length, 4);
  });

  it("refuses a record that fails memory's whole-record re-validation (errors carried verbatim)", () => {
    const tampered = { ...aPostMortemRecord() } as KnowledgeRecord;
    (tampered as unknown as Record<string, unknown>).recordId = "mem-tampered" as never;
    const fed = ingest(aFoundedBrain(), [tampered]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-record");
    assert.ok((fed.errors[0]?.recordErrors?.length ?? 0) > 0);
  });

  it("refuses a tampered post-mortem payload through W053's own validator (errors carried verbatim)", () => {
    const fed = ingest(aFoundedBrain(), [aTamperedPostMortemRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-post-mortem");
    assert.ok((fed.errors[0]?.postMortemErrors?.length ?? 0) > 0);
  });

  it("refuses a reordered lesson set through W053's own validator (errors carried verbatim)", () => {
    const fed = ingest(aFoundedBrain(), [aReorderedLessonSetRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-lesson-set");
    assert.ok((fed.errors[0]?.postMortemErrors?.length ?? 0) > 0);
  });

  it("refuses a bogus-state capability through W040's own validator (errors carried verbatim)", () => {
    const fed = ingest(aFoundedBrain(), [aBogusStateCapabilityRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-capability");
    assert.ok((fed.errors[0]?.capabilityErrors?.length ?? 0) > 0);
  });

  it("refuses an emptied search history through W051's own validator (errors carried verbatim)", () => {
    const fed = ingest(aFoundedBrain(), [anEmptiedHistoryRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-history");
    assert.ok((fed.errors[0]?.historyErrors?.length ?? 0) > 0);
  });

  it("refuses to extend a broken brain (invariants carried verbatim)", () => {
    const broken = { ...aFedBrain(), generation: 5 } as unknown as FirmBrain;
    const fed = ingest(broken, [aPostMortemRecord()]);
    assert.ok(!fed.ok);
    assert.equal(fed.errors[0]?.code, "invalid-brain");
    assert.ok((fed.errors[0]?.brainErrors?.length ?? 0) > 0);
  });

  it("refuses malformed ingestion input", () => {
    const nullBrain = ingest(null as never, []);
    assert.ok(!nullBrain.ok);
    assert.equal(nullBrain.errors[0]?.code, "malformed-input");
    const nullRecords = ingest(aFoundedBrain(), null as never);
    assert.ok(!nullRecords.ok);
    assert.equal(nullRecords.errors[0]?.code, "malformed-input");
  });

  it("collects every violation across a batch — none silently dropped", () => {
    const fed = ingest(aFoundedBrain(), [aTamperedPostMortemRecord(), aBogusStateCapabilityRecord(), anEmptiedHistoryRecord()]);
    assert.ok(!fed.ok);
    assert.deepEqual(fed.errors.map((error) => error.code), ["invalid-post-mortem", "invalid-capability", "invalid-history"]);
  });
});

describe("ingest — the A9 record-set law (permutation invariance)", () => {
  it("ingests the same record set in any order to the same brain", () => {
    const records = theKnowledgeRecords();
    const forward = ingest(aFoundedBrain(), records);
    assert.ok(forward.ok);
    const reversed = ingest(aFoundedBrain(), [...records].reverse());
    assert.ok(reversed.ok);
    const rotated = ingest(aFoundedBrain(), [records[1]!, records[2]!, records[3]!, records[0]!]);
    assert.ok(rotated.ok);
    assert.equal(reversed.brain.brainId, forward.brain.brainId);
    assert.equal(rotated.brain.brainId, forward.brain.brainId);
    assert.deepEqual(reversed.brain, forward.brain);
    assert.deepEqual(rotated.brain, forward.brain);
  });
});
