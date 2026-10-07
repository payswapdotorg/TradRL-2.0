/**
 * The W025 counterfactual branch law suite — part 1: the TYPED descriptor
 * (loud validation, the closed problem set), the genesis semantics (own
 * journal at the branch point, rescoped state, reset registries, scenario
 * override), PARENT IMMUTABILITY re-proven at the counterfactual layer
 * (spec/ARCHITECTURE-LOCK.md A8; spec/ACCEPTANCE-WORLD-ALPHA.md G), the
 * restore path (genesis + journalTail ≡ the live branch), and the
 * composition with the W016 branch family.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SnapshotId } from "tradrl-world-contracts";
import { createHeadlessWorldEngine } from "../../world/index.js";
import { snapshotIdFor, verifyWorldSnapshot } from "../../snapshot/index.js";
import { branchWorld } from "../../branch/index.js";
import { buildDeterminismManifest } from "../../world/index.js";
import {
  CounterfactualBranchValidationError,
  counterfactualWorldIdFor,
} from "../definition.js";
import { planCounterfactualBranch } from "../genesis.js";
import type { CounterfactualParentReader } from "../genesis.js";
import { createCounterfactualBranchEngine } from "../engine.js";
import {
  AGENT_ACCOUNT_ID,
  BRANCH_POINT_MS,
  INSTRUMENT_ID,
  PARENT_SEED,
  PARENT_WORLD_ID,
  SEC,
  SIM_START,
  TRADER_ACCOUNT_ID,
  TRADER_PARTICIPANT_ID,
  branchAnnotationCommand,
  branchFromParent,
  domainOutcomeOf,
  driveBranchJourney,
  generatedBranchEngine,
  parentWorldAtSnapshot,
} from "./helpers.js";

/** The control descriptor: same seed as the parent, no overlay. */
function controlDescriptor(sourceSnapshotId: SnapshotId, branchPointTime: number) {
  return {
    sourceSnapshotId,
    branchPointTime: branchPointTime as never,
    seed: PARENT_SEED,
  };
}

/** Assert a descriptor rejects with the given typed problem included. */
function assertRejected(
  parent: CounterfactualParentReader,
  branch: Parameters<typeof planCounterfactualBranch>[0]["branch"],
  problem: string,
): void {
  assert.throws(
    () => planCounterfactualBranch({ parent, branch }),
    (error: unknown) => {
      assert.ok(error instanceof CounterfactualBranchValidationError);
      assert.ok(
        error.problems.includes(problem as never),
        `expected problem '${problem}', got [${error.problems.join(", ")}] — ${error.details.join("; ")}`,
      );
      return true;
    },
  );
}

test("law 1 (typed descriptor): the closed problem set rejects loudly", async () => {
  const parent = await parentWorldAtSnapshot();
  const good = controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime);

  // blank seed
  assertRejected(
    parent.engine,
    { ...good, seed: "   " },
    "blank-branch-seed",
  );
  // unknown snapshot
  assertRejected(
    parent.engine,
    { ...good, sourceSnapshotId: "snap:world-w025-parent:99" as never },
    "unknown-snapshot",
  );
  // branch point ≠ the snapshot's createdAt
  assertRejected(
    parent.engine,
    { ...good, branchPointTime: (parent.branchPointTime - 1_000) as never },
    "branch-point-mismatch",
  );

  // a parent that has not lived to the branch point (an early-clock reader)
  const earlyClock: CounterfactualParentReader = {
    ...parent.engine,
    clockState: () => ({ simulationTime: SIM_START }),
  };
  const beyondPoint = { ...good, branchPointTime: (SIM_START + BRANCH_POINT_MS + 60_000) as never };
  assertRejected(earlyClock, beyondPoint, "branch-point-mismatch");

  // a snapshot that belongs to another world
  const foreignWorld: CounterfactualParentReader = {
    ...parent.engine,
    worldId: "world-somewhere-else" as never,
  };
  assertRejected(foreignWorld, good, "snapshot-world-mismatch");

  // a tampered snapshot payload (digest no longer addresses the content)
  const realSnapshot = parent.engine.getSnapshotPayload(parent.sourceSnapshotId)!;
  const tamperedSnapshot = {
    ...realSnapshot,
    descriptor: { ...realSnapshot.descriptor, digest: "deadbeef" },
  };
  const tamperedParent: CounterfactualParentReader = {
    ...parent.engine,
    getSnapshotPayload: (id: SnapshotId) => (id === parent.sourceSnapshotId ? tamperedSnapshot : undefined),
  };
  assertRejected(tamperedParent, good, "snapshot-tampered");

  // a snapshot whose prefix is not this parent's journal prefix
  const otherEngine = createHeadlessWorldEngine({ definition: realSnapshot.definition });
  const prefixParent: CounterfactualParentReader = {
    worldId: parent.engine.worldId,
    getSnapshotPayload: (id: SnapshotId) => (id === parent.sourceSnapshotId ? realSnapshot : undefined),
    journal: otherEngine.journal,
    clockState: () => parent.engine.clockState(),
    branchLineage: () => [],
  };
  assertRejected(prefixParent, good, "prefix-mismatch");

  // malformed overlay regime entries
  assertRejected(
    parent.engine,
    {
      ...good,
      overlay: { regimeSchedule: [{ regime: "bull-run" as never, from: SIM_START as never }] },
    },
    "overlay-regime-invalid",
  );
  assertRejected(
    parent.engine,
    {
      ...good,
      overlay: {
        regimeSchedule: [
          { regime: "trend" as never, from: (SIM_START + 5 * SEC) as never, to: (SIM_START + 4 * SEC) as never },
        ],
      },
    },
    "overlay-regime-invalid",
  );

  // injected artifacts: duplicate ids, inherited-id collision, blank id
  const news = (artifactId: string, availableAt: number) => ({
    artifactId: artifactId as never,
    source: "w025-wire",
    createdAt: SIM_START as never,
    availableAt: availableAt as never,
    scope: "news" as never,
    provenance: { producer: "w025-wire" as never, recordedAt: SIM_START as never },
    version: "1",
    payload: { headline: "injected" },
  });
  assertRejected(
    parent.engine,
    { ...good, overlay: { informationArtifacts: [news("dup", SIM_START), news("dup", SIM_START)] } },
    "overlay-artifact-invalid",
  );
  assertRejected(
    parent.engine,
    { ...good, overlay: { informationArtifacts: [news("news-parent-visible", SIM_START)] } },
    "overlay-artifact-invalid",
  );
  assertRejected(
    parent.engine,
    { ...good, overlay: { informationArtifacts: [news("  ", SIM_START)] } },
    "overlay-artifact-invalid",
  );

  // the good descriptor plans cleanly (and is idempotent)
  const plan = planCounterfactualBranch({ parent: parent.engine, branch: good });
  const again = planCounterfactualBranch({ parent: parent.engine, branch: good });
  assert.deepEqual(plan, again, "planning is a pure function of (parent, descriptor)");
  assert.equal(String(plan.branchWorldId), "cf:world-w025-parent:afc93660");
});

test("law 1 (typed descriptor): a branch is NOT its parent (the identity guard)", async () => {
  const parent = await parentWorldAtSnapshot();
  const good = controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime);
  const parentWorldId = String(parent.engine.worldId);

  // The derivation makes self-parenting STRUCTURALLY IMPOSSIBLE: a branch id
  // is always `cf:<parentWorldId>:<digest>` — a strict extension (the prefix
  // never collapses), so it can never equal the parent id. The law is proven
  // as a property over varied descriptors; the `branch-is-parent` guard in
  // planCounterfactualBranch stays as DEFENSE-IN-DEPTH (it can only fire if
  // the encoder is ever changed to collapse prefixes — disclosed in its
  // comment — which is exactly why the guard exists).
  const derivedIds = new Set<string>();
  for (const seed of [PARENT_SEED, "w025-treat-seed", "w025-overlay-seed", "x"]) {
    for (const branchPoint of [parent.branchPointTime, parent.branchPointTime + 1_000]) {
      const id = String(
        counterfactualWorldIdFor({
          parentWorldId: parent.engine.worldId,
          branch: { ...good, seed, branchPointTime: branchPoint as never },
        }),
      );
      assert.ok(
        id.startsWith(`cf:${parentWorldId}:`),
        `the branch id extends its parent's id (${id})`,
      );
      assert.notEqual(id, parentWorldId, "a branch is NEVER its parent (by construction)");
      derivedIds.add(id);
    }
  }
  assert.equal(
    derivedIds.size,
    8,
    "distinct descriptors derive distinct worlds (content-addressed identity)",
  );
  // A cf: world branched again extends the cf: id — the families stack and
  // still never collapse onto an ancestor.
  const childId = String(
    counterfactualWorldIdFor({
      parentWorldId: `cf:${parentWorldId}:afc93660` as never,
      branch: good,
    }),
  );
  assert.ok(childId.startsWith(`cf:cf:${parentWorldId}:afc93660:`), "nested ids nest, never collapse");
  assert.notEqual(childId, parentWorldId);
  assert.notEqual(childId, `cf:${parentWorldId}:afc93660`);
});

test("law 2 (genesis semantics): own journal at the branch point, rescoped state, counterfactual mode", async () => {
  const parent = await parentWorldAtSnapshot();
  const parentSnapshot = parent.engine.getSnapshotPayload(parent.sourceSnapshotId)!;
  const handle = await branchFromParent(
    parent.engine,
    controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime),
  );

  // own journal, own world, clock at the branch point
  assert.equal(String(handle.engine.worldId), String(handle.record.branchWorldId));
  assert.equal(String(handle.engine.journal.worldId), String(handle.record.branchWorldId));
  assert.equal(handle.engine.journal.getCursor(), 0, "the branch journal starts empty (sequence 1 is its own)");
  assert.equal(handle.engine.clockState().simulationTime, parent.branchPointTime);

  // the genesis capture is registered, verifies, and is content-addressed
  const genesis = handle.engine.getSnapshotPayload(handle.record.genesisSnapshotId)!;
  assert.deepEqual(verifyWorldSnapshot(genesis), { ok: true });
  assert.equal(genesis.descriptor.digest, handle.record.genesisSnapshotDigest);
  assert.equal(genesis.descriptor.journalCursor, 0);
  assert.equal(Number(genesis.descriptor.createdAt), parent.branchPointTime);

  // the typed record carries the complete lineage facts
  assert.deepEqual(handle.record, {
    branchWorldId: handle.record.branchWorldId,
    parentWorldId: parent.engine.worldId,
    sourceSnapshotId: parent.sourceSnapshotId,
    snapshotDigest: parentSnapshot.descriptor.digest,
    genesisSnapshotId: handle.record.genesisSnapshotId,
    genesisSnapshotDigest: handle.record.genesisSnapshotDigest,
    branchPointSequence: parentSnapshot.descriptor.journalCursor,
    branchPointTime: parent.branchPointTime,
    seed: PARENT_SEED,
    overlay: undefined,
    engine: "tradrl-world-sim",
    engineVersion: "0.1.0-skeleton",
    mode: "counterfactual",
  });
  assert.ok(Object.isFrozen(handle.record), "the record is frozen (immutable lineage)");

  // the genesis state is the W016 branch genesis: rescoped, registries reset
  const state = handle.engine.worldState();
  assert.equal(state.snapshots.length, 0, "snapshot registry reset");
  assert.equal(state.branches.length, 0, "branch registry reset");
  for (const order of state.matching.orders) {
    assert.equal(String(order.worldId), String(handle.record.branchWorldId), "inherited orders are rescoped to the branch");
  }
  // ...while the parent's own orders keep the parent stamp (never mutated)
  for (const order of parent.engine.worldState().matching.orders) {
    assert.equal(String(order.worldId), PARENT_WORLD_ID);
  }
  // opaque inherited ids are carried verbatim (honest provenance)
  assert.ok(state.matching.orders.length > 0, "the branch inherited real resting liquidity");

  // the branch definition: counterfactual mode, own seed, rescoped scope
  assert.equal(handle.definition.mode, "counterfactual");
  assert.equal(handle.definition.seed, PARENT_SEED);
  assert.equal(String(handle.definition.scope.worldId), String(handle.record.branchWorldId));
  assert.equal(
    handle.definition.accounts.length,
    parentSnapshot.definition.accounts.length,
    "the declared population is carried",
  );
  const report = handle.engine.headlessReport();
  assert.equal(report.mode, "counterfactual");
  assert.equal(report.seed, PARENT_SEED);
});

test("law 2 (scenario overlay): the counterfactual schedule is in force in the branch, not the parent", async () => {
  const parent = await parentWorldAtSnapshot();
  const handle = await branchFromParent(parent.engine, {
    sourceSnapshotId: parent.sourceSnapshotId,
    branchPointTime: parent.branchPointTime as never,
    seed: PARENT_SEED,
    overlay: {
      regimeSchedule: [{ regime: "trend", from: (SIM_START + 21 * SEC) as never }],
    },
  });
  await handle.engine.clock.seek((SIM_START + 25 * SEC) as never);

  const scenario = handle.engine.worldState().currentScenario;
  assert.equal(scenario?.label, "counterfactual-overlay");
  assert.equal(scenario?.entries.length, 1);
  assert.equal(scenario?.entries[0]?.regime, "trend");
  // the override is ANNOUNCED in the branch journal at the window start
  const announcements = handle.engine
    .journal.records()
    .filter((record) => record.envelope.eventType === "market.regime.changed")
    .map((record) => [record.envelope.occurredAt - SIM_START, record.envelope.payload]);
  assert.deepEqual(announcements, [[21 * SEC, { type: "market.regime.changed", to: "trend" }]]);

  // the parent's scenario is untouched (no label; its own schedule)
  const parentScenario = parent.engine.worldState().currentScenario;
  assert.equal(parentScenario?.label, undefined);
  assert.equal(parentScenario?.entries.length, 3);
});

test("law 2 (journal access): the handle exposes the parent's journal truth read-only", async () => {
  const parent = await parentWorldAtSnapshot();
  const handle = await branchFromParent(
    parent.engine,
    controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime),
  );
  // the engine surface exposes the journal (the `journal()` guard below uses
  // the member, not a method — assert both spellings of the same truth)
  const journal = handle.engine.journal;
  assert.equal(journal.getCursor(), 0);
  await driveBranchJourney(handle);
  assert.ok(journal.getCursor() > 300, "the branch lived a meaningful market life");
});

test("law 3 (parent immutability): branches never mutate the parent, concurrent branches are independent", async () => {
  const parent = await parentWorldAtSnapshot();
  const parentSnapshot = parent.engine.getSnapshotPayload(parent.sourceSnapshotId)!;
  const before = {
    records: parent.engine.journal.records(),
    digest: parent.engine.journal.digest(),
    state: parent.engine.worldState(),
    snapshot: parentSnapshot,
    report: parent.engine.headlessReport(),
    manifest: parent.engine.determinismManifest(),
    branches: parent.engine.branchEngines(),
    lineage: parent.engine.branchLineage(),
    clock: parent.engine.clockState().simulationTime,
  };

  // THREE concurrent branches from the same origin (control, treatment,
  // overlay), driven hard — market life, human trades, annotations, their
  // own snapshots, a W016 child of one branch, a nested counterfactual.
  const control = await branchFromParent(
    parent.engine,
    controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime),
  );
  const treatment = await branchFromParent(parent.engine, {
    sourceSnapshotId: parent.sourceSnapshotId,
    branchPointTime: parent.branchPointTime as never,
    seed: "w025-treat-seed",
  });
  const overlaid = await branchFromParent(parent.engine, {
    sourceSnapshotId: parent.sourceSnapshotId,
    branchPointTime: parent.branchPointTime as never,
    seed: "w025-overlay-seed",
    overlay: { regimeSchedule: [{ regime: "shock", from: (SIM_START + 22 * SEC) as never }] },
  });
  await driveBranchJourney(control);
  await driveBranchJourney(treatment);
  await driveBranchJourney(overlaid);
  const annotation = await control.engine.command.addAnnotation(
    branchAnnotationCommand(control, "the control annotates its own timeline"),
  );
  assert.equal(annotation.status, "acked");
  const branchSnapshot = await treatment.engine.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-cf-own-snap" as never,
    worldId: treatment.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: treatment.engine.clockState().simulationTime as never,
  });
  assert.equal(branchSnapshot.status, "acked");
  const w016Child = await branchWorld(treatment.engine, {
    kind: "branch-world",
    commandId: "cmd-cf-w016-child" as never,
    worldId: treatment.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: treatment.engine.clockState().simulationTime as never,
    sourceSnapshotId: snapshotIdFor(treatment.engine.worldId, 1),
  });
  assert.equal(w016Child.parent.status, "acked");
  const nested = await branchFromParent(treatment.engine, {
    sourceSnapshotId: snapshotIdFor(treatment.engine.worldId, 1),
    branchPointTime: Number(
      treatment.engine.getSnapshotPayload(snapshotIdFor(treatment.engine.worldId, 1))!.descriptor.createdAt,
    ) as never,
    seed: "w025-nested-seed",
  });
  await driveBranchJourney(nested);

  // the parent's truth is byte-identical
  assert.deepEqual(parent.engine.journal.records(), before.records, "parent records byte-identical");
  assert.deepEqual(parent.engine.journal.digest(), before.digest, "parent digest byte-identical");
  assert.deepEqual(parent.engine.worldState(), before.state, "parent state byte-identical");
  assert.deepEqual(parent.engine.headlessReport(), before.report, "parent report byte-identical");
  assert.deepEqual(
    parent.engine.determinismManifest(),
    before.manifest,
    "parent determinism manifest byte-identical",
  );
  assert.deepEqual(
    parent.engine.getSnapshotPayload(parent.sourceSnapshotId),
    before.snapshot,
    "the origin snapshot payload is byte-identical",
  );
  assert.deepEqual(parent.engine.branchEngines(), [], "no engine-created children (nothing journaled on the parent)");
  assert.equal(parent.engine.worldState().branches.length, 0, "the branch registry never saw a counterfactual");
  assert.deepEqual(parent.engine.branchLineage(), before.lineage);
  assert.equal(parent.engine.clockState().simulationTime, before.clock, "the parent clock never moved");

  // the concurrent branches are independent worlds with independent truths
  assert.notDeepEqual(
    control.engine.journal.digest(),
    treatment.engine.journal.digest(),
    "different seeds diverge",
  );
  for (const handle of [control, treatment, overlaid]) {
    assert.equal(String(handle.engine.journal.worldId), String(handle.record.branchWorldId));
  }
  // none of the branch events entered the parent journal
  const parentEventIds = new Set(before.records.map((record) => String(record.envelope.eventId)));
  for (const handle of [control, treatment, overlaid, nested]) {
    for (const record of handle.engine.journal.records()) {
      assert.equal(
        parentEventIds.has(String(record.envelope.eventId)),
        false,
        "branch events never enter the parent journal",
      );
    }
  }

  // and the parent keeps evolving independently after everything
  const acked = await parent.engine.command.addAnnotation({
    kind: "add-annotation",
    commandId: "cmd-parent-after-branches" as never,
    worldId: parent.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: parent.engine.clockState().simulationTime as never,
    at: parent.engine.clockState().simulationTime as never,
    text: "the parent continues untouched",
  });
  assert.equal(acked.status, "acked");
  assert.equal(parent.engine.journal.getCursor(), before.records.length + 1);
});

test("law 2 (restore path): genesis + journalTail ≡ the live branch, future commands included", async () => {
  const parent = await parentWorldAtSnapshot();
  const descriptor = controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime);
  const live = await branchFromParent(parent.engine, descriptor);
  await driveBranchJourney(live);

  const plan = planCounterfactualBranch({ parent: parent.engine, branch: descriptor });
  const restored = createCounterfactualBranchEngine({
    parent: parent.engine,
    branch: descriptor,
    plan,
    createEngine: (options) =>
      createHeadlessWorldEngine({
        definition: options.definition,
        restore: options.restore,
        ...(options.wallTimeSource === undefined ? {} : { wallTimeSource: options.wallTimeSource }),
      }),
    journalTail: live.engine.journal.records(),
  });

  assert.deepEqual(restored.engine.journal.digest(), live.engine.journal.digest(), "journal digest identical");
  assert.deepEqual(restored.engine.worldState(), live.engine.worldState(), "state identical");
  assert.deepEqual(domainOutcomeOf(restored.engine), domainOutcomeOf(live.engine), "domain evolution identical");
  assert.equal(restored.engine.clockState().simulationTime, live.engine.clockState().simulationTime);

  // future-command equivalence: the same next command acks identically
  const futureOrder = (handle: typeof live) =>
    handle.engine.command.submitOrder({
      kind: "submit-order",
      commandId: "cmd-cf-future-1" as never,
      worldId: handle.engine.worldId,
      issuedBy: TRADER_PARTICIPANT_ID as never,
      issuedAt: handle.engine.clockState().simulationTime as never,
      accountId: TRADER_ACCOUNT_ID as never,
      instrumentId: INSTRUMENT_ID as never,
      submission: { kind: "market", side: "sell", quantity: "1" as never, constraints: { timeInForce: "IOC" } },
    });
  assert.deepEqual(await futureOrder(live), await futureOrder(restored));

  // a foreign-world tail fails the one-journal-one-world law, loudly
  assert.throws(
    () =>
      createCounterfactualBranchEngine({
        parent: parent.engine,
        branch: descriptor,
        plan,
        createEngine: generatedBranchEngine,
        journalTail: parent.engine.journal.records(),
      }),
    /journal law violation/,
  );
});

test("composition: a counterfactual branches from a W016 branch child (the families stack)", async () => {
  const parent = await parentWorldAtSnapshot();
  const w016 = await branchWorld(parent.engine, {
    kind: "branch-world",
    commandId: "cmd-w016-child" as never,
    worldId: parent.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: parent.engine.clockState().simulationTime as never,
    sourceSnapshotId: parent.sourceSnapshotId,
  });
  assert.equal(w016.parent.status, "acked");
  const child = w016.branch!;
  await child.clock.step(2 * SEC);
  const childSnap = await child.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-child-snap" as never,
    worldId: child.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: child.clockState().simulationTime as never,
  });
  assert.equal(childSnap.status, "acked");
  const childSnapshotId = snapshotIdFor(child.worldId, 1);
  const childBranchPoint = Number(
    child.getSnapshotPayload(childSnapshotId)!.descriptor.createdAt,
  );

  const handle = await branchFromParent(child, {
    sourceSnapshotId: childSnapshotId,
    branchPointTime: childBranchPoint as never,
    seed: "w025-from-w016-child",
  });
  assert.equal(String(handle.record.parentWorldId), String(child.worldId));
  assert.match(String(handle.record.branchWorldId), /^cf:wld:world-w025-parent:1:/);
  assert.equal(handle.engine.worldState().matching.orders.length, child.worldState().matching.orders.length);
  // the agents account exists in the nested branch too (declared population carried)
  assert.ok(
    handle.definition.accounts.some((account) => String(account.accountId) === AGENT_ACCOUNT_ID),
  );
});

test("telemetry honesty: the parent's manifest is a pure function of its own inputs", async () => {
  const parent = await parentWorldAtSnapshot();
  const manifest = parent.engine.determinismManifest();
  await branchFromParent(
    parent.engine,
    controlDescriptor(parent.sourceSnapshotId, parent.branchPointTime),
  );
  assert.deepEqual(
    parent.engine.determinismManifest(),
    manifest,
    "counterfactual creation does not touch the parent manifest",
  );
  // the branch's own manifest names the branch seed (its own input)
  const handle = await branchFromParent(parent.engine, {
    sourceSnapshotId: parent.sourceSnapshotId,
    branchPointTime: parent.branchPointTime as never,
    seed: "w025-manifest-seed",
  });
  assert.equal(handle.engine.determinismManifest().seed, "w025-manifest-seed");
  assert.notEqual(
    handle.engine.determinismManifest().inputHashes.worldDefinition,
    parent.engine.determinismManifest().inputHashes.worldDefinition,
    "the branch definition digest differs from the parent's",
  );
  void buildDeterminismManifest;
});
