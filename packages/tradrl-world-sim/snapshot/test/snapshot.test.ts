/**
 * W016 snapshot engine tests: capture, descriptors, content addressing,
 * integrity and the port surfaces (QueryPort/EvidencePort).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Snapshots" (immutable, self-describing),
 * spec/ARCHITECTURE-LOCK.md A8/A9, spec/ACCEPTANCE-WORLD-ALPHA.md E
 * (snapshot), L (evidence).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreateSnapshotCommand } from "tradrl-world-contracts";
import { eventStreamDigest } from "tradrl-world-contracts/time";
import { verifyWorldSnapshot, snapshotIdFor, hydrateWorldState, serializeWorldState } from "../index.js";
import type { WorldSnapshot } from "../index.js";
import { createEventJournalFromRecords } from "../../journal/index.js";
import { createHeadlessWorldEngine } from "../../world/index.js";
import { UnknownWorldEntityError } from "../../world/index.js";
import {
  START,
  TRADER,
  WALL_START,
  WORLD,
  addAnnotationCommand,
  fixedWallTimeSource,
  submitOrderCommand,
  testDefinition,
} from "../../world/test/helpers.js";

function snapshotCommand(overrides: Partial<CreateSnapshotCommand> = {}): CreateSnapshotCommand {
  return {
    kind: "create-snapshot",
    commandId: "cmd-snap" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    ...overrides,
  };
}

/** A small deterministic pre-snapshot flow: annotation + a resting maker. */
async function engineWithFlow() {
  const definition = testDefinition();
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
  });
  await engine.command.addAnnotation(addAnnotationCommand());
  await engine.clock.step(2_000);
  await engine.command.submitOrder(submitOrderCommand());
  return { definition, engine };
}

test("create-snapshot acks, journals its descriptor and serves both snapshot ports", async () => {
  const { engine } = await engineWithFlow();
  const cursorBefore = engine.journal.getCursor();
  const simTime = engine.clockState().simulationTime;

  const acked = await engine.command.createSnapshot(snapshotCommand({ label: "before the sweep" }));
  assert.equal(acked.status, "acked");
  if (acked.status !== "acked") return;
  assert.equal(acked.ack.resultingEventIds.length, 1);
  assert.equal(acked.ack.journalCursor, cursorBefore + 1, "one snapshot event appended");

  const eventId = acked.ack.resultingEventIds[0]!;
  const event = await engine.evidence.getEvent(eventId);
  assert.ok(event !== undefined, "the snapshot event is journaled evidence");
  assert.equal(event.eventType, "world.snapshot.created");

  const snapshotId = snapshotIdFor(WORLD, 1);
  const descriptor = {
    snapshotId,
    worldId: WORLD,
    createdAt: simTime,
    journalCursor: cursorBefore,
    digest: (event.payload as { digest: string }).digest,
  };
  // QueryPort: latest + by id
  assert.deepEqual(await engine.query.getSnapshot(), descriptor);
  assert.deepEqual(await engine.query.getSnapshot(snapshotId), descriptor);
  // EvidencePort: by id (and undefined for unknown ids)
  assert.deepEqual(await engine.evidence.getSnapshot(snapshotId), descriptor);
  assert.equal(await engine.evidence.getSnapshot("snap-ghost" as never), undefined);

  // the engine surface exposes the full restorable payload
  const payload = engine.getSnapshotPayload(snapshotId);
  assert.ok(payload !== undefined, "payload registered at ack");
  assert.deepEqual(payload?.descriptor, descriptor);
  assert.ok(verifyWorldSnapshot(payload!), "the stored payload verifies");
});

test("snapshots capture the world BEFORE their own event; ids chain deterministically", async () => {
  const { engine } = await engineWithFlow();
  await engine.command.createSnapshot(snapshotCommand({ commandId: "cmd-snap-1" as never }));
  const first = engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;

  // the payload's state is the state at the cursor — its own event is NOT in it
  assert.equal(first.descriptor.journalCursor, first.records.length);
  assert.deepEqual(
    first.journalDigest,
    eventStreamDigest(first.records.map((record) => record.envelope)),
  );
  // the captured acked-command set is the PRE-event one (the snapshot's own
  // command id is not in it); registry slices are not part of a snapshot's
  // state payload at all (stateCodec — they are event-derived)
  assert.deepEqual(first.state.ackedCommandIds, ["cmd-annotation-1", "cmd-order-1"]);

  // state snapshots slice is event-derived and includes the new summary
  assert.equal(engine.worldState().snapshots.length, 1);
  assert.equal(engine.worldState().snapshots[0]?.label, undefined);

  await engine.command.addAnnotation(addAnnotationCommand({ commandId: "cmd-ann-2" as never, text: "after" }));
  await engine.command.createSnapshot(snapshotCommand({ commandId: "cmd-snap-2" as never }));
  const second = engine.getSnapshotPayload(snapshotIdFor(WORLD, 2))!;
  assert.equal(second.descriptor.parentSnapshotId, first.descriptor.snapshotId);
  assert.ok(second.descriptor.journalCursor > first.descriptor.journalCursor);
  assert.equal(engine.worldState().snapshots[1]?.parentSnapshotId, first.descriptor.snapshotId);
});

test("content addressing: equal worlds give equal digests; a changed world changes the digest", async () => {
  const runA = await engineWithFlow();
  const runB = await engineWithFlow();
  await runA.engine.command.createSnapshot(snapshotCommand());
  await runB.engine.command.createSnapshot(snapshotCommand());
  const a = runA.engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  const b = runB.engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  assert.equal(a.descriptor.digest, b.descriptor.digest, "identical inputs ⇒ identical digest");

  const drifted = createHeadlessWorldEngine({
    definition: runA.definition,
    wallTimeSource: fixedWallTimeSource(),
  });
  await drifted.command.addAnnotation(addAnnotationCommand());
  await drifted.clock.step(2_000);
  await drifted.command.submitOrder(submitOrderCommand());
  await drifted.command.submitOrder(
    submitOrderCommand({
      commandId: "cmd-order-2" as never,
      submission: {
        kind: "limit",
        side: "sell",
        quantity: "5" as never,
        limitPrice: "4800.50" as never,
        constraints: { timeInForce: "GTC" },
      },
    }),
  );
  await drifted.command.createSnapshot(snapshotCommand());
  const other = drifted.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  assert.notEqual(other.descriptor.digest, a.descriptor.digest, "changed state ⇒ changed digest");
  assert.ok(verifyWorldSnapshot(other));
});

test("a snapshot of an empty journal is valid (the genesis state is restorable)", async () => {
  const engine = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
  });
  const acked = await engine.command.createSnapshot(snapshotCommand());
  assert.equal(acked.status, "acked");
  const payload = engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  assert.equal(payload.descriptor.journalCursor, 0);
  assert.deepEqual(payload.records, []);
  assert.deepEqual(payload.journalDigest, eventStreamDigest([]));
  assert.ok(verifyWorldSnapshot(payload));
});

test("verifyWorldSnapshot detects tampering (digest, cursor, journal digest)", async () => {
  const { engine } = await engineWithFlow();
  await engine.command.createSnapshot(snapshotCommand());
  const snapshot = engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;

  const tamperedState: WorldSnapshot = {
    ...snapshot,
    state: { ...snapshot.state, annotations: [] },
  };
  assert.deepEqual(verifyWorldSnapshot(tamperedState), { ok: false, problems: ["digest-mismatch"] });

  const tamperedCursor: WorldSnapshot = {
    ...snapshot,
    descriptor: {
      ...snapshot.descriptor,
      journalCursor: (snapshot.descriptor.journalCursor + 1) as never,
    },
  };
  assert.ok(!verifyWorldSnapshot(tamperedCursor).ok);

  const tamperedRecords: WorldSnapshot = {
    ...snapshot,
    records: snapshot.records.slice(0, -1),
  };
  const problems = verifyWorldSnapshot(tamperedRecords);
  assert.ok(!problems.ok);
  assert.deepEqual([...problems.problems].sort(), ["cursor-record-count-mismatch", "digest-mismatch", "journal-digest-mismatch"]);
});

test("QueryPort.getSnapshot fails closed for a snapshot-less world / unknown id", async () => {
  const engine = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
  });
  await assert.rejects(engine.query.getSnapshot(), (error: unknown) => {
    assert.ok(error instanceof UnknownWorldEntityError);
    assert.equal(error.kind, "snapshot");
    return true;
  });
  await assert.rejects(engine.query.getSnapshot("snap-none" as never), (error: unknown) => {
    assert.ok(error instanceof UnknownWorldEntityError);
    return true;
  });
});

test("replaying the journal rebuilds the snapshot registry AND the payloads", async () => {
  const { definition, engine } = await engineWithFlow();
  await engine.command.createSnapshot(snapshotCommand({ commandId: "cmd-snap-1" as never }));
  await engine.command.addAnnotation(addAnnotationCommand({ commandId: "cmd-ann-post" as never, text: "after the snapshot" }));

  // bare-journal replay (W013 path): descriptors AND payloads come back
  const replayed = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(WALL_START + 123_456),
    restore: {
      journal: createEventJournalFromRecords({
        worldId: definition.scope.worldId,
        records: engine.journal.records(),
      }),
    },
  });
  assert.deepEqual(replayed.worldState().snapshots, engine.worldState().snapshots);
  const rebuilt = replayed.getSnapshotPayload(snapshotIdFor(WORLD, 1));
  assert.ok(rebuilt !== undefined, "payload rebuilt from journaled truth during the fold");
  assert.deepEqual(rebuilt, engine.getSnapshotPayload(snapshotIdFor(WORLD, 1)));
  assert.deepEqual(replayed.worldState(), engine.worldState());
  // ...and the replayed engine can branch from the rebuilt payload (proved
  // further in branch/test/branch.test.ts)
});

test("the duplicate-command law covers snapshot commands", async () => {
  const { engine } = await engineWithFlow();
  const first = await engine.command.createSnapshot(snapshotCommand({ commandId: "cmd-snap-dup" as never }));
  assert.equal(first.status, "acked");
  const second = await engine.command.createSnapshot(snapshotCommand({ commandId: "cmd-snap-dup" as never }));
  assert.equal(second.status, "rejected");
  assert.equal(second.status === "rejected" && second.rejection.code, "duplicate-command");
});

test("stateCodec round-trips the authoritative state (Set included)", async () => {
  const { engine } = await engineWithFlow();
  await engine.command.createSnapshot(snapshotCommand());
  const snapshot = engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  const hydrated = hydrateWorldState(snapshot.state);
  assert.deepEqual(serializeWorldState(hydrated), snapshot.state);
  assert.ok(hydrated.ackedCommandIds instanceof Set);
  assert.deepEqual([...hydrated.ackedCommandIds], snapshot.state.ackedCommandIds);
  // the hydrated matching slice keeps the bigint decimal scale verbatim
  const book = Object.values(hydrated.matching.books)[0]!;
  assert.ok(book.bids.length >= 1, "the resting maker is in the captured book");
});
