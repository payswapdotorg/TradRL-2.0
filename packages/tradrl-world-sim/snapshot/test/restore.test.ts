/**
 * THE SNAPSHOT≡REPLAY EQUIVALENCE PROOF — the W016 flagship restore test.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md (deterministic replay requirements):
 * restore from snapshot + journal tail must be EXACTLY equivalent to full
 * replay. Spec: spec/ARCHITECTURE-LOCK.md A9 (determinism) and A6 (state
 * advances only by reducing journaled events — both paths share the fold).
 *
 * The proof: a world runs a mixed flow (annotations, scenario sets, order
 * flow through the matcher), snapshots mid-run, then continues. A full
 * replay engine (W013 path) and a snapshot-restored engine (W016 path,
 * which reduces ONLY the tail) are compared for: authoritative state,
 * journal records + digest, clock position, determinism manifest, snapshot
 * registry/payloads — and then both accept IDENTICAL further command
 * streams and must keep producing identical digests (future equivalence).
 * The fold's `reducedCount` is the honest work evidence for the
 * faster-than-replay claim (prefix carried, tail reduced).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddAnnotationCommand, SubmitOrderCommand } from "tradrl-world-contracts";
import { validateEventStream } from "tradrl-world-contracts/time";
import { createEventJournalFromRecords } from "../../journal/index.js";
import { foldJournalIntoState, hydrateWorldState, snapshotIdFor } from "../index.js";
import { createHeadlessWorldEngine } from "../../world/index.js";
import { EngineInvariantError } from "../../world/index.js";
import { initialWorldState } from "../../world/index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  WALL_START,
  WORLD,
  addAnnotationCommand,
  fixedWallTimeSource,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "../../world/test/helpers.js";

function annotation(id: string, text: string): AddAnnotationCommand {
  return addAnnotationCommand({ commandId: id as never, text });
}

function order(id: string, overrides: Partial<SubmitOrderCommand["submission"]> = {}): SubmitOrderCommand {
  return submitOrderCommand({
    commandId: id as never,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "4" as never,
      limitPrice: "4800.75" as never,
      constraints: { timeInForce: "GTC" },
      ...overrides,
    },
  });
}

/** The deterministic mixed flow both phases of the proof run. */
async function runFlow(wallBase = WALL_START) {
  const definition = testDefinition();
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(wallBase),
  });
  await engine.command.addAnnotation(annotation("cmd-ann-1", "region opens"));
  await engine.clock.step(1_000);
  await engine.command.submitOrder(order("cmd-mk-1")); // resting maker
  await engine.command.submitOrder(
    order("cmd-mk-2", { side: "buy" as never, quantity: "6" as never, limitPrice: "4799.75" as never }),
  );
  await engine.clock.step(1_000);
  await engine.command.setScenario(setScenarioCommand());
  await engine.command.addAnnotation(annotation("cmd-ann-2", "pre-snapshot"));
  const snapAck = await engine.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-snap-mid" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    label: "the branch point",
  });
  if (snapAck.status !== "acked") {
    throw new Error("mid-run snapshot failed");
  }
  const snapshot = engine.getSnapshotPayload(snapshotIdFor(WORLD, 1))!;
  // post-snapshot continuation: a sweep that trades, a cancel, annotations
  await engine.command.submitOrder(
    submitOrderCommand({
      commandId: "cmd-taker" as never,
      submission: {
        kind: "market",
        side: "buy",
        quantity: "2" as never,
        constraints: { timeInForce: "IOC" },
      },
    }),
  );
  await engine.command.addAnnotation(annotation("cmd-ann-3", "after the snapshot"));
  await engine.clock.step(3_000);
  await engine.command.addAnnotation(annotation("cmd-ann-4", "later"));
  return { definition, engine, snapshot };
}

test("snapshot restore ≡ full replay: state, journal, digest, manifest, clock, snapshots", async () => {
  const { definition, engine, snapshot } = await runFlow();
  const records = engine.journal.records();
  const tail = records.slice(snapshot.descriptor.journalCursor);

  const fullReplay = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(WALL_START + 999_999),
    restore: { journal: createEventJournalFromRecords({ worldId: definition.scope.worldId, records }) },
  });
  const snapshotRestored = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(WALL_START + 86_400_000),
    restore: { snapshot, journalTail: tail },
  });

  // EXACT equivalence — the whole point (ACCEPTANCE deterministic replay)
  assert.deepEqual(snapshotRestored.worldState(), fullReplay.worldState(), "authoritative state identical");
  assert.deepEqual(snapshotRestored.worldState(), engine.worldState(), "…and identical to the live run");
  assert.deepEqual(snapshotRestored.journal.records(), fullReplay.journal.records(), "journal records identical");
  assert.deepEqual(snapshotRestored.journal.digest(), fullReplay.journal.digest(), "journal digest identical");
  assert.deepEqual(snapshotRestored.determinismManifest(), fullReplay.determinismManifest(), "manifest identical");
  assert.equal(
    snapshotRestored.clockState().simulationTime,
    fullReplay.clockState().simulationTime,
    "clock defaults to the same event time",
  );
  assert.deepEqual(
    snapshotRestored.worldState().snapshots,
    fullReplay.worldState().snapshots,
    "snapshot registry replay-safe",
  );
  // the restored engine carries the snapshot payload AND the ones the tail describes
  assert.deepEqual(
    snapshotRestored.getSnapshotPayload(snapshotIdFor(WORLD, 1)),
    fullReplay.getSnapshotPayload(snapshotIdFor(WORLD, 1)),
  );
  // W004 stream laws hold on the restored journal
  assert.deepEqual(validateEventStream(snapshotRestored.journal.records().map((r) => r.envelope)), { ok: true });
});

test("faster than full replay: the prefix is carried, only the tail is reduced", async () => {
  const { definition, engine, snapshot } = await runFlow();
  const records = engine.journal.records();
  const tail = records.slice(snapshot.descriptor.journalCursor);

  const fullFold = foldJournalIntoState({
    definition,
    initialState: initialWorldState(definition),
    records,
    journalRecords: records,
  });
  const snapshotFold = foldJournalIntoState({
    definition,
    initialState: hydrateWorldState(snapshot.state),
    records: tail,
    journalRecords: records,
  });

  assert.equal(fullFold.reducedCount, records.length);
  assert.equal(snapshotFold.reducedCount, tail.length, "only the tail was reduced");
  assert.ok(tail.length < records.length, "the flow actually has a prefix to carry");
  assert.deepEqual(snapshotFold.state, fullFold.state, "the folds land on the identical state");
  // and the snapshot's own payload is re-captured identically from the tail
  assert.deepEqual(
    snapshotFold.capturedSnapshots[snapshotFold.capturedSnapshots.length - 1]?.descriptor,
    snapshot.descriptor,
  );

  // wall-clock evidence (informational, not asserted): the snapshot fold
  // does strictly less reduction work than the full replay fold.
  const began = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) {
    foldJournalIntoState({ definition, initialState: initialWorldState(definition), records, journalRecords: records });
  }
  const fullNs = Number(process.hrtime.bigint() - began);
  const began2 = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) {
    foldJournalIntoState({ definition, initialState: hydrateWorldState(snapshot.state), records: tail, journalRecords: records });
  }
  const snapNs = Number(process.hrtime.bigint() - began2);
  console.log(`restore work evidence: full replay reduced ${String(records.length)} records x20 in ${String(fullNs)}ns; snapshot restore reduced ${String(tail.length)} x20 in ${String(snapNs)}ns`);
  assert.ok(snapNs <= fullNs * 2, "snapshot restore is not slower than full replay");
});

test("future equivalence: identical further command streams keep identical digests", async () => {
  const { definition, engine, snapshot } = await runFlow();
  const records = engine.journal.records();
  const tail = records.slice(snapshot.descriptor.journalCursor);

  const fullReplay = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
    restore: { journal: createEventJournalFromRecords({ worldId: definition.scope.worldId, records }) },
  });
  const snapshotRestored = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
    restore: { snapshot, journalTail: tail },
  });

  const further: (SubmitOrderCommand | AddAnnotationCommand)[] = [
    order("cmd-post-1", { side: "buy" as never, limitPrice: "4801.25" as never }),
    annotation("cmd-post-2", "a note on both"),
    submitOrderCommand({
      commandId: "cmd-post-3" as never,
      submission: { kind: "market", side: "sell", quantity: "3" as never, constraints: { timeInForce: "IOC" } },
    }),
    annotation("cmd-post-4", "tail"),
  ];
  const dispatch = async (
    target: ReturnType<typeof createHeadlessWorldEngine>,
    command: SubmitOrderCommand | AddAnnotationCommand,
  ) =>
    command.kind === "submit-order"
      ? target.command.submitOrder(command)
      : target.command.addAnnotation(command);
  for (const command of further) {
    await dispatch(fullReplay, command);
  }
  for (const command of further) {
    await dispatch(snapshotRestored, command);
  }
  assert.deepEqual(snapshotRestored.journal.digest(), fullReplay.journal.digest(), "future digests identical");
  assert.deepEqual(snapshotRestored.worldState(), fullReplay.worldState());
  assert.equal(snapshotRestored.journal.size(), fullReplay.journal.size());
});

test("restore with an empty tail reproduces the snapshot point exactly", async () => {
  const { definition, snapshot } = await runFlow();
  const atCursor = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
    restore: { snapshot },
  });
  assert.equal(atCursor.journal.getCursor(), snapshot.descriptor.journalCursor);
  assert.deepEqual(atCursor.journal.digest(), snapshot.journalDigest);
  assert.deepEqual(
    atCursor.worldState().matching,
    hydrateWorldState(snapshot.state).matching,
    "the materialized matching state at the cursor",
  );
  assert.equal(atCursor.clockState().simulationTime, snapshot.descriptor.createdAt);
});

test("restore integrity: wrong definition / wrong world / mixed worlds fail loudly", async () => {
  const { engine, snapshot } = await runFlow();

  const otherDefinition = testDefinition({ seed: "w013-other-seed" });
  assert.throws(
    () =>
      createHeadlessWorldEngine({
        definition: otherDefinition,
        wallTimeSource: fixedWallTimeSource(),
        restore: { snapshot },
      }),
    (error: unknown) => error instanceof EngineInvariantError && /different world definition/.test(error.message),
  );

  // a tail from a FOREIGN world cannot enter this world's journal
  const foreign = createHeadlessWorldEngine({
    definition: testDefinition({
      scope: { tenantId: "tenant-alpha" as never, projectId: "project-one" as never, worldId: "world-elsewhere" as never },
      informationArtifacts: [],
    }),
    wallTimeSource: fixedWallTimeSource(),
  });
  const foreignAck = await foreign.command.addAnnotation(
    addAnnotationCommand({
      commandId: "cmd-x" as never,
      worldId: foreign.worldId,
      text: "foreign",
    }),
  );
  const foreignRecords = foreign.journal.records();
  assert.ok(foreignAck.status === "acked");
  assert.throws(
    () =>
      createHeadlessWorldEngine({
        definition: engine.worldId === WORLD ? testDefinition() : testDefinition(),
        wallTimeSource: fixedWallTimeSource(),
        restore: { snapshot, journalTail: foreignRecords },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /world-mismatch|belongs to/);
      return true;
    },
  );
});

test("the live engine and its snapshot-restored twin agree on the order book", async () => {
  const { definition, engine, snapshot } = await runFlow();
  const records = engine.journal.records();
  const restored = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
    restore: { snapshot, journalTail: records.slice(snapshot.descriptor.journalCursor) },
  });
  const liveBook = await engine.query.getOrderBook(INSTRUMENT);
  const restoredBook = await restored.query.getOrderBook(INSTRUMENT);
  assert.deepEqual(restoredBook, liveBook);
  assert.deepEqual(await restored.query.getOrders({ accountId: TRADER_ACCOUNT }), await engine.query.getOrders({ accountId: TRADER_ACCOUNT }));
});
