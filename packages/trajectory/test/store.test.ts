/**
 * The append-only store CONTRACT laws (W037) — L1..L5 verified through a
 * minimal TEST-SIDE reference implementation (the package itself ships NO
 * engine, no I/O — the interface's implementability and the ordered
 * append/read guarantees are what is proven here).
 *
 * Run: pnpm --filter trajectory test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { trajectoryIdOf } from "../identity.js";
import type { TrajectoryId } from "../identity.js";
import { validateTrajectoryRecord } from "../record.js";
import type { TrajectoryRecord } from "../record.js";
import type {
  TrajectoryAppendOutcome,
  TrajectoryReadOutcome,
  TrajectoryStore,
  TrajectoryListOutcome,
} from "../store.js";
import {
  SCOPE,
  canonicalResultingStates,
  canonicalTelemetry,
  DETERMINISM,
  fixturePolicy,
  scopeOf,
} from "./fixtures.js";
import { trajectoryRecordOf } from "../record.js";

function recordOf(sessionId: string): TrajectoryRecord {
  const scope = scopeOf({ sessionId });
  const outcome = trajectoryRecordOf({
    scope,
    telemetry: canonicalTelemetry(),
    resultingStates: canonicalResultingStates(),
    policy: fixturePolicy(),
    determinism: DETERMINISM,
  });
  if (!outcome.ok) {
    throw new Error(`fixture trajectory for session '${sessionId}' failed capture`);
  }
  return outcome.record;
}

/**
 * The test-side reference store (L1: no update/delete seam exists to call;
 * L2: the append gate runs first; L3: ids unique; L4: append order; L5:
 * typed unknown reads).
 */
class ReferenceTrajectoryStore implements TrajectoryStore {
  private readonly appended: TrajectoryRecord[] = [];

  async append(record: TrajectoryRecord): Promise<TrajectoryAppendOutcome> {
    const gate = validateTrajectoryRecord(record);
    if (!gate.ok) {
      return {
        ok: false,
        errors: [
          {
            code: "invalid-record",
            message: "the record failed the capture-law gate (L2) — it never enters the store",
            recordErrors: gate.errors,
          },
        ],
      };
    }
    if (this.appended.some((stored) => stored.trajectoryId === record.trajectoryId)) {
      return {
        ok: false,
        errors: [
          {
            code: "duplicate-trajectory",
            message: `trajectory '${record.trajectoryId}' is already appended (L3) — append-only, never an overwrite`,
          },
        ],
      };
    }
    this.appended.push(record);
    return { ok: true, trajectoryId: record.trajectoryId, appendOrdinal: this.appended.length - 1 };
  }

  async read(trajectoryId: TrajectoryId): Promise<TrajectoryReadOutcome> {
    const index = this.appended.findIndex((stored) => stored.trajectoryId === trajectoryId);
    if (index < 0) {
      return {
        ok: false,
        errors: [
          {
            code: "unknown-trajectory",
            message: `trajectory '${trajectoryId}' was never appended (L5) — reads fail closed`,
          },
        ],
      };
    }
    const found = this.appended[index];
    assert.ok(found !== undefined);
    return { ok: true, record: found, appendOrdinal: index };
  }

  async list(): Promise<TrajectoryListOutcome> {
    return {
      ok: true,
      entries: this.appended.map((record, ordinal) => ({
        trajectoryId: record.trajectoryId,
        scope: record.scope,
        appendOrdinal: ordinal,
      })),
    };
  }
}

test("append admits lawful records in order and reads them back verbatim (L2/L4)", async () => {
  const store = new ReferenceTrajectoryStore();
  const first = recordOf("session-1");
  const second = recordOf("session-2");
  const append1 = await store.append(first);
  const append2 = await store.append(second);
  assert.ok(append1.ok && append2.ok);
  assert.equal(append1.appendOrdinal, 0);
  assert.equal(append2.appendOrdinal, 1);
  const read = await store.read(first.trajectoryId);
  assert.ok(read.ok);
  assert.deepEqual(read.record, first);
  assert.equal(read.appendOrdinal, 0);
});

test("a duplicate id is never an overwrite (L3)", async () => {
  const store = new ReferenceTrajectoryStore();
  const record = recordOf("session-1");
  const first = await store.append(record);
  assert.ok(first.ok);
  const second = await store.append(record);
  assert.ok(!second.ok);
  assert.ok(second.errors.some((entry) => entry.code === "duplicate-trajectory"));
});

test("a malformed record never enters the store (L2, capture errors carried)", async () => {
  const store = new ReferenceTrajectoryStore();
  const record = recordOf("session-1");
  const tampered: TrajectoryRecord = {
    ...record,
    trajectoryId: "traj-deadbeef" as TrajectoryId,
  };
  const outcome = await store.append(tampered);
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "invalid-record");
  assert.ok(error !== undefined);
  assert.ok(error.recordErrors?.some((entry) => entry.code === "identity-mismatch"));
  const listed = await store.list();
  assert.ok(listed.ok);
  assert.equal(listed.entries.length, 0);
});

test("an unknown id fails typed, never silently empty (L5)", async () => {
  const store = new ReferenceTrajectoryStore();
  const read = await store.read(trajectoryIdOf(SCOPE));
  assert.ok(!read.ok);
  assert.ok(read.errors.some((entry) => entry.code === "unknown-trajectory"));
});

test("list returns the append order with identity + scope only (L4)", async () => {
  const store = new ReferenceTrajectoryStore();
  await store.append(recordOf("session-1"));
  await store.append(recordOf("session-2"));
  const listed = await store.list();
  assert.ok(listed.ok);
  assert.deepEqual(
    listed.entries.map((entry) => entry.scope.sessionId),
    ["session-1", "session-2"],
  );
  assert.deepEqual(
    listed.entries.map((entry) => entry.appendOrdinal),
    [0, 1],
  );
  assert.ok(listed.entries.every((entry) => entry.trajectoryId.startsWith("traj-")));
});
