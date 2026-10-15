/**
 * The A9 twin of the W054 firm brain: same records ⇒ deep-equal brain
 * state + recall — the founding twin, the record-seal twin (through
 * memory's own gate), the ingest-permutation twin, and the honest
 * two-batch disclosure (the RECORD SET and every recall answer are equal;
 * the generation counter honestly counts the ingest events).
 * REAL imports only.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ingest, recall } from "../index.js";
import type { FirmBrain } from "../index.js";
import { sealKnowledgeRecord, sourceIdOf, validateKnowledgeRecord } from "memory";
import { SCOPE, aFoundedBrain, aPostMortemRecord, aPostMortemValue, theKnowledgeRecords } from "./fixtures.js";

describe("the A9 twin — founding", () => {
  it("founds deep-equal brains with the same id", () => {
    const left = aFoundedBrain();
    const right = aFoundedBrain();
    assert.equal(right.brainId, left.brainId);
    assert.deepEqual(right, left);
  });
});

describe("the A9 twin — record sealing (memory's own gate)", () => {
  it("seals independently built records deep-equal with the same mem- id", () => {
    const left = aPostMortemRecord();
    const right = sealKnowledgeRecord({ scope: SCOPE, source: { kind: "post-mortem", postMortem: aPostMortemValue() } });
    assert.ok(right.ok);
    assert.equal(right.record.recordId, left.recordId);
    assert.deepEqual(right.record, left);
    assert.deepEqual(validateKnowledgeRecord(right.record), { ok: true });
  });
});

describe("the A9 twin — ingestion", () => {
  it("same record set in ANY permutation ⇒ the same brain, deep-equal", () => {
    const records = theKnowledgeRecords();
    const baseline = ingest(aFoundedBrain(), records);
    assert.ok(baseline.ok);
    for (const permutation of [[3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1]]) {
      const shuffled = permutation.map((index) => records[index]!);
      const twin = ingest(aFoundedBrain(), shuffled);
      assert.ok(twin.ok);
      assert.equal(twin.brain.brainId, baseline.brain.brainId);
      assert.deepEqual(twin.brain, baseline.brain);
      assert.deepEqual(twin.appended, baseline.appended);
    }
  });

  it("two batches vs one batch: the same RECORD SET + the same recall answers (the generation counter honestly counts the ingest events)", () => {
    const records = theKnowledgeRecords();
    const oneBatch = ingest(aFoundedBrain(), records);
    assert.ok(oneBatch.ok);
    const firstHalf = ingest(aFoundedBrain(), [records[0]!, records[1]!]);
    assert.ok(firstHalf.ok);
    const twoBatches = ingest(firstHalf.brain, [records[2]!, records[3]!]);
    assert.ok(twoBatches.ok);
    assert.deepEqual(twoBatches.brain.records, oneBatch.brain.records);
    assert.equal(twoBatches.brain.generation, 2);
    assert.equal(oneBatch.brain.generation, 1);
    for (const kind of ["post-mortem", "lesson-set", "capability", "search-history"] as const) {
      const left = recall(oneBatch.brain, { kind: "by-kind", scope: SCOPE, knowledgeKind: kind });
      const right = recall(twoBatches.brain, { kind: "by-kind", scope: SCOPE, knowledgeKind: kind });
      assert.ok(left.ok && right.ok);
      assert.deepEqual(left.records, right.records);
    }
  });

  it("recall answers deep-equal from deep-equal brains (the recall twin)", () => {
    const left = ingest(aFoundedBrain(), theKnowledgeRecords());
    const right = ingest(aFoundedBrain(), [...theKnowledgeRecords()].reverse());
    assert.ok(left.ok && right.ok);
    const query = { kind: "by-source", scope: SCOPE, sourceId: sourceIdOf(aPostMortemRecord().citation) } as const;
    const leftRecall = recall(left.brain, query);
    const rightRecall = recall(right.brain, query);
    assert.ok(leftRecall.ok && rightRecall.ok);
    assert.deepEqual(leftRecall, rightRecall);
    assert.deepEqual(right.brain, left.brain as unknown as FirmBrain);
  });
});
