/**
 * Tests for the append-only ordered event journal (W013 `journal` module).
 *
 * Laws under test (spec/WORLD-PROTOCOL.md "Event envelope", spec/
 * ARCHITECTURE-LOCK.md A6/A9, W004's ordered-stream contracts):
 * - sequences are strictly monotonic per world and event/entry ids are
 *   deterministic functions of (worldId, sequence);
 * - the ordered-stream laws hold on append: occurredAt never decreases,
 *   availableAt is never before occurredAt, drafts are structurally sound;
 * - queries follow the documented EventQuery semantics;
 * - the digest is W004's eventStreamDigest and depends only on content;
 * - a restored journal accepts only record sets that satisfy the same laws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CausationId,
  CorrelationId,
  EventId,
  ProducerId,
  WorldId,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { eventStreamDigest, validateEventStream } from "tradrl-world-contracts/time";
import {
  EMPTY_JOURNAL_CURSOR,
  FIRST_EVENT_SEQUENCE,
  JournalLawViolationError,
  createEventJournal,
  createEventJournalFromRecords,
  entryIdFor,
  eventIdFor,
  type PendingEventDraft,
} from "../index.js";

const WORLD = "world-journal-test" as WorldId;
const PRODUCER = "world-core" as ProducerId;
const T0 = 1_700_000_000_000;

function causation(n: number): CausationId {
  return `cmd-${String(n)}` as CausationId;
}

function draft(overrides: Partial<PendingEventDraft> = {}): PendingEventDraft {
  return {
    eventType: "world.annotation.added",
    occurredAt: T0 as PendingEventDraft["occurredAt"],
    causationId: causation(1),
    correlationId: "corr-1" as CorrelationId,
    producer: PRODUCER,
    schemaVersion: "tradrl-world-sim.events@1",
    payload: { text: "hello" },
    ...overrides,
  };
}

test("append assigns sequences from 1 and deterministic ids", () => {
  const journal = createEventJournal(WORLD);
  const sealed = journal.append([draft()]);
  assert.equal(sealed.length, 1);
  const envelope = sealed[0] as WorldEventEnvelope;
  assert.equal(envelope.sequence, FIRST_EVENT_SEQUENCE);
  assert.equal(envelope.eventId, eventIdFor(WORLD, 1 as never));
  assert.equal(envelope.worldId, WORLD);
  assert.equal(journal.records()[0]?.entryId, entryIdFor(WORLD, 1 as never));
  assert.equal(journal.getCursor(), 1);
});

test("append seals optional envelope fields exactly when present", () => {
  const journal = createEventJournal(WORLD);
  const [without] = journal.append([draft()]);
  assert.ok(without !== undefined); // noUncheckedIndexedAccess
  assert.equal("availableAt" in without, false);
  const [withDelay] = journal.append([
    draft({
      occurredAt: (T0 + 1) as never,
      availableAt: (T0 + 2) as never,
      correlationId: "corr-7" as CorrelationId,
      causationId: causation(2),
    }),
  ]);
  assert.ok(withDelay !== undefined);
  assert.equal(withDelay.availableAt, T0 + 2);
  assert.equal(withDelay.correlationId, "corr-7");
});

test("append of several drafts sequences them consecutively in order", () => {
  const journal = createEventJournal(WORLD);
  const sealed = journal.append([
    draft({ causationId: causation(1), payload: { n: 1 } }),
    draft({ causationId: causation(2), payload: { n: 2 }, occurredAt: (T0 + 5) as never }),
    draft({ causationId: causation(3), payload: { n: 3 }, occurredAt: (T0 + 5) as never }),
  ]);
  assert.deepEqual(
    sealed.map((envelope) => envelope.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    sealed.map((envelope) => envelope.payload),
    [{ n: 1 }, { n: 2 }, { n: 3 }],
  );
  assert.equal(journal.getCursor(), 3);
  assert.equal(journal.size(), 3);
});

test("recordedAt defaults to the last draft's occurredAt and can be explicit", () => {
  const journal = createEventJournal(WORLD);
  journal.append([draft({ occurredAt: (T0 + 10) as never })]);
  assert.equal(journal.records()[0]?.recordedAt, T0 + 10);

  const journal2 = createEventJournal(WORLD);
  journal2.append([draft({ occurredAt: (T0 + 10) as never })], {
    recordedAt: (T0 + 99) as never,
  });
  assert.equal(journal2.records()[0]?.recordedAt, T0 + 99);
});

test("append enforces the time-not-monotonic law", () => {
  const journal = createEventJournal(WORLD);
  journal.append([draft({ occurredAt: (T0 + 1_000) as never })]);
  assert.throws(
    () => journal.append([draft({ occurredAt: (T0 + 999) as never })]),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "time-not-monotonic");
      return true;
    },
  );
  assert.equal(journal.size(), 1, "the violating draft was not journaled");
});

test("append enforces the available-before-occurred law", () => {
  const journal = createEventJournal(WORLD);
  assert.throws(
    () =>
      journal.append([
        draft({ occurredAt: (T0 + 1_000) as never, availableAt: (T0 + 999) as never }),
      ]),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "available-before-occurred");
      return true;
    },
  );
  // equal is legal (observable exactly at occurrence)
  assert.equal(journal.append([draft({ availableAt: (T0 + 1_000) as never })]).length, 1);
});

test("append rejects malformed drafts", () => {
  const journal = createEventJournal(WORLD);
  assert.throws(
    () => journal.append([draft({ eventType: "" })]),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "malformed-draft");
      return true;
    },
  );
  assert.throws(
    () => journal.append([draft({ occurredAt: Number.NaN as never })]),
    JournalLawViolationError,
  );
  assert.throws(
    () => journal.append([draft({ producer: undefined as never })]),
    JournalLawViolationError,
  );
  assert.throws(() => journal.append([]), JournalLawViolationError);
});

test("read follows the documented EventQuery semantics", () => {
  const journal = createEventJournal(WORLD);
  journal.append([
    draft({ eventType: "world.annotation.added", occurredAt: (T0 + 10) as never }),
    draft({ eventType: "world.scenario.set", occurredAt: (T0 + 20) as never }),
    draft({ eventType: "world.annotation.added", occurredAt: (T0 + 30) as never }),
    draft({ eventType: "world.scenario.set", occurredAt: (T0 + 40) as never }),
  ]);
  assert.equal(journal.read().length, 4);
  assert.deepEqual(
    journal.read({ from: (T0 + 20) as never }).map((e) => e.sequence),
    [2, 3, 4],
  );
  assert.deepEqual(
    journal.read({ to: (T0 + 30) as never }).map((e) => e.sequence),
    [1, 2, 3],
  );
  // from/to are inclusive on occurredAt
  assert.deepEqual(
    journal.read({ from: (T0 + 10) as never, to: (T0 + 30) as never }).map((e) => e.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    journal.read({ types: ["world.scenario.set"] }).map((e) => e.sequence),
    [2, 4],
  );
  assert.deepEqual(
    journal.read({ limit: 2 }).map((e) => e.sequence),
    [1, 2],
  );
  assert.deepEqual(
    journal.read({ types: ["world.scenario.set"], limit: 1 }).map((e) => e.sequence),
    [2],
  );
});

test("findEvent and getRecordByEventId resolve ids and sequences", () => {
  const journal = createEventJournal(WORLD);
  journal.append([draft(), draft({ occurredAt: (T0 + 1) as never })]);
  const second = journal.findEvent(2 as never) as WorldEventEnvelope;
  assert.equal(second.sequence, 2);
  const byId = journal.findEvent(second.eventId) as WorldEventEnvelope;
  assert.equal(byId.sequence, 2);
  assert.equal(journal.findEvent(99 as never), undefined);
  assert.equal(journal.findEvent("evt:none" as EventId), undefined);
  const record = journal.getRecordByEventId(second.eventId);
  assert.equal(record?.envelope.sequence, 2);
  assert.equal(journal.getRecordByEventId("evt:none" as EventId), undefined);
});

test("empty journal: zero cursor, zero-size digest, no events", () => {
  const journal = createEventJournal(WORLD);
  assert.equal(journal.getCursor(), EMPTY_JOURNAL_CURSOR);
  assert.equal(journal.size(), 0);
  assert.deepEqual(journal.digest(), { eventCount: 0, eventChecksum: "811c9dc5" });
});

test("digest is W004's eventStreamDigest over the whole ordered stream", () => {
  const journal = createEventJournal(WORLD);
  journal.append([
    draft(),
    draft({ occurredAt: (T0 + 5) as never, payload: { text: "second" } }),
  ]);
  const envelopes = journal.records().map((record) => record.envelope);
  assert.deepEqual(journal.digest(), eventStreamDigest(envelopes));
  assert.equal(journal.digest().eventCount, 2);
  assert.equal(journal.digest().lastSequence, 2);
  assert.equal(journal.digest().finalEventTime, T0 + 5);
});

test("the journal always satisfies W004's validateEventStream", () => {
  const journal = createEventJournal(WORLD);
  journal.append([
    draft(),
    draft({ occurredAt: (T0 + 5) as never, availableAt: (T0 + 6) as never }),
    draft({ occurredAt: (T0 + 5) as never }),
  ]);
  const validation = validateEventStream(journal.records().map((record) => record.envelope));
  assert.deepEqual(validation, { ok: true });
});

test("same drafts into two journals yield identical ids and digest", () => {
  const run = () => {
    const journal = createEventJournal(WORLD);
    journal.append([draft(), draft({ occurredAt: (T0 + 3) as never, payload: { n: 9 } })]);
    return {
      ids: journal.records().map((record) => String(record.envelope.eventId)),
      entries: journal.records().map((record) => String(record.entryId)),
      digest: journal.digest(),
    };
  };
  assert.deepEqual(run(), run());
});

test("different content produces a different digest", () => {
  const a = createEventJournal(WORLD);
  a.append([draft({ payload: { text: "alpha" } })]);
  const b = createEventJournal(WORLD);
  b.append([draft({ payload: { text: "beta" } })]);
  assert.notEqual(a.digest().eventChecksum, b.digest().eventChecksum);
});

test("createEventJournalFromRecords round-trips a live journal", () => {
  const live = createEventJournal(WORLD);
  live.append([draft(), draft({ occurredAt: (T0 + 7) as never, causationId: causation(2) })]);
  const restored = createEventJournalFromRecords({ worldId: WORLD, records: live.records() });
  assert.deepEqual(restored.records(), live.records());
  assert.equal(restored.getCursor(), live.getCursor());
  assert.deepEqual(restored.digest(), live.digest());
  // the restored journal continues the sequence like a live one
  const continued = restored.append([draft({ occurredAt: (T0 + 9) as never })]);
  assert.equal(continued[0]?.sequence, 3);
  assert.equal(restored.getCursor(), 3);
});

test("createEventJournalFromRecords rejects record sets the laws would refuse", () => {
  const good = createEventJournal(WORLD);
  good.append([draft(), draft({ occurredAt: (T0 + 5) as never })]);
  const records = good.records();

  // non-monotonic sequence inside the record set
  const swapped: typeof records = [records[1]!, records[0]!];
  assert.throws(
    () => createEventJournalFromRecords({ worldId: WORLD, records: swapped }),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.ok(
        error.kind === "sequence-not-contiguous" || error.kind === "sequence-not-monotonic",
      );
      return true;
    },
  );

  // record from another world
  const foreign = good.records().map((record, index) =>
    index === 0
      ? { ...record, envelope: { ...record.envelope, worldId: "world-other" as WorldId } }
      : record,
  );
  assert.throws(
    () => createEventJournalFromRecords({ worldId: WORLD, records: foreign }),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "world-mismatch");
      return true;
    },
  );

  // entry id that does not match its sequence position
  const wrongEntry = good.records().map((record, index) =>
    index === 1
      ? { ...record, entryId: "jrn:forged:99" as never }
      : record,
  );
  assert.throws(
    () => createEventJournalFromRecords({ worldId: WORLD, records: wrongEntry }),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "entry-id-mismatch");
      return true;
    },
  );

  // availableAt before occurredAt
  const early = createEventJournal(WORLD);
  early.append([draft({ availableAt: (T0 + 1) as never })]);
  assert.throws(
    () =>
      createEventJournalFromRecords({
        worldId: WORLD,
        records: early.records().map((record) => ({
          ...record,
          envelope: { ...record.envelope, availableAt: (T0 - 1) as never },
        })),
      }),
    (error: unknown) => {
      assert.ok(error instanceof JournalLawViolationError);
      assert.equal(error.kind, "available-before-occurred");
      return true;
    },
  );
});
