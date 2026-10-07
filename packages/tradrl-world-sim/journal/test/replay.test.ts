/**
 * Tests for deterministic journal replay (W013 `journal` module).
 *
 * Laws under test (spec/ARCHITECTURE-LOCK.md A6/A9,
 * spec/ACCEPTANCE-WORLD-ALPHA.md I):
 * - replay applies records strictly in stored (sequence) order;
 * - the fold is pure: replaying the same records twice yields identical
 *   state, and replaying the live append sequence reproduces the live state.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProducerId, WorldId } from "tradrl-world-contracts";
import { createEventJournal, replayJournal, type PendingEventDraft } from "../index.js";

const WORLD = "world-replay-test" as WorldId;
const PRODUCER = "replay-test" as ProducerId;
const T0 = 1_700_000_000_000;

function draft(overrides: Partial<PendingEventDraft> = {}): PendingEventDraft {
  return {
    eventType: "test.event",
    occurredAt: T0 as PendingEventDraft["occurredAt"],
    causationId: "cmd-1" as `cmd-${string}` as import("tradrl-world-contracts").CausationId,
    correlationId: "corr-1" as `corr-${string}` as import("tradrl-world-contracts").CorrelationId,
    producer: PRODUCER,
    schemaVersion: "test@1",
    payload: { n: 0 },
    ...overrides,
  };
}

test("replaying an empty record set returns the initial state", () => {
  const outcome = replayJournal([], () => {
    throw new Error("reducer must not run");
  }, { value: 7 });
  assert.deepEqual(outcome, { state: { value: 7 }, appliedCount: 0 });
  assert.equal("lastEventTime" in outcome, false);
});

test("replay applies records strictly in stored order", () => {
  const journal = createEventJournal(WORLD);
  journal.append([
    draft({ payload: { n: 1 } }),
    draft({ occurredAt: (T0 + 1) as never, payload: { n: 2 } }),
    draft({ occurredAt: (T0 + 2) as never, payload: { n: 3 } }),
  ]);
  // order-sensitive fold: the final n proves application order
  const outcome = replayJournal(
    journal.records(),
    (state: { last: unknown }, record) => ({ last: record.envelope.payload }),
    { last: null },
  );
  assert.deepEqual(outcome.state, { last: { n: 3 } });
  assert.equal(outcome.appliedCount, 3);
  assert.equal(outcome.lastEventTime, T0 + 2);
});

test("replay is pure: same records, same outcome", () => {
  const journal = createEventJournal(WORLD);
  journal.append([draft(), draft({ occurredAt: (T0 + 1) as never })]);
  const fold = (state: number[], record: { envelope: { sequence: number } }) => [
    ...state,
    record.envelope.sequence,
  ];
  assert.deepEqual(
    replayJournal(journal.records(), fold, []),
    replayJournal(journal.records(), fold, []),
  );
});

test("replay reproduces the live incremental fold bit-for-bit", () => {
  const journal = createEventJournal(WORLD);
  const liveState: string[] = [];
  const drafts = [
    draft({ payload: "a" }),
    draft({ occurredAt: (T0 + 1) as never, payload: "b" }),
    draft({ occurredAt: (T0 + 2) as never, payload: "c" }),
  ];
  // live: each append immediately folds into state (what the engine does)
  for (const single of drafts) {
    const [envelope] = journal.append([single]);
    liveState.push(`live:${String(envelope?.eventType)}:${String(envelope?.payload)}`);
  }
  const replayed = replayJournal(
    journal.records(),
    (state, record) => [
      ...state,
      `live:${record.envelope.eventType}:${String(record.envelope.payload)}`,
    ],
    [] as string[],
  );
  assert.deepEqual(replayed.state, liveState);
});
