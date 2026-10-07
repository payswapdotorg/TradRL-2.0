/**
 * Tests for the command lifecycle stages (W013 `world` module).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — validate → authorize →
 * apply domain rules (the engine then mutates, emits, journals, publishes,
 * acks). Spec/ARCHITECTURE-LOCK.md A6/A13, spec/ACCEPTANCE-WORLD-ALPHA.md K.
 *
 * The boundary is asserted per command kind: implemented kinds (add-
 * annotation, set-scenario, the W014 order commands through the typed
 * matching seam, and the W016 snapshot/branch commands through their
 * typed seams) produce ordered event drafts; domain-ruled kinds reject
 * at the documented stage with honest codes (unknown-order for cancel/
 * replace on ids no journal ever accepted, unknown-snapshot and the
 * sibling codes for branch-world, not-implemented-in-skeleton naming the
 * owning work order for the rest).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BranchWorldCommand,
  CancelOrderCommand,
  CommandRejection,
  CreateSnapshotCommand,
  SnapshotId,
  WorldCommand,
} from "tradrl-world-contracts";
import {
  applyCommand,
  authorizeCommand,
  initialWorldState,
  reduceWorldEvent,
  runCommandLifecycle,
  validateCommand,
  type LifecycleContext,
} from "../index.js";
import { createEventJournal } from "../../journal/index.js";
import type { JournalRecord } from "../../journal/index.js";
import { buildWorldSnapshot, type WorldSnapshot } from "../../snapshot/index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  WORLD,
  addAnnotationCommand,
  closePositionCommand,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "./helpers.js";

/** A lifecycle context with the W016 seam fields (journal + payload store). */
interface SeamContext extends LifecycleContext {
  readonly journal: ReturnType<typeof createEventJournal>;
  readonly snapshotPayloads: Map<SnapshotId, WorldSnapshot>;
}

function ctx(): SeamContext {
  return {
    definition: testDefinition(),
    state: initialWorldState(testDefinition()),
    simulationTime: (START + 10_000) as never,
    nextSequence: 1 as never,
    journal: createEventJournal(WORLD),
    snapshotPayloads: new Map(),
  };
}

/**
 * Advance a context's state exactly the way the engine does: run the
 * lifecycle, journal the drafts (dense sequences from 1) and reduce the
 * sealed records — the single-path law, so later commands see real state.
 */
function ctxAfter(...commands: readonly WorldCommand[]): SeamContext {
  const definition = testDefinition();
  const journal = createEventJournal(WORLD);
  let state = initialWorldState(definition);
  for (const command of commands) {
    const outcome = runCommandLifecycle(command, {
      definition,
      state,
      simulationTime: (START + 10_000) as never,
      nextSequence: (journal.getCursor() + 1) as never,
      journal,
      snapshotPayloads: new Map(),
    });
    if (outcome.kind === "applied") {
      const sealed = journal.append(outcome.drafts, { recordedAt: (START + 10_000) as never });
      for (const envelope of sealed) {
        state = reduceWorldEvent(state, {
          entryId: `jrn:${WORLD}:${String(envelope.sequence)}` as never,
          envelope,
          recordedAt: (START + 10_000) as never,
        });
      }
    }
  }
  return {
    definition,
    state,
    simulationTime: (START + 10_000) as never,
    nextSequence: (journal.getCursor() + 1) as never,
    journal,
    snapshotPayloads: new Map(),
  };
}

/**
 * Advance a context AND take a real snapshot through the lifecycle (the
 * snapshot event is journaled + reduced like the engine does; the payload
 * is rebuilt exactly the engine way so the branch seam can consume it).
 */
function ctxAfterSnapshot(
  ...commands: readonly WorldCommand[]
): SeamContext & { readonly snapshot: WorldSnapshot } {
  const advanced = ctxAfter(...commands);
  const outcome = runCommandLifecycle(
    {
      kind: "create-snapshot",
      commandId: "cmd-ctx-snap" as never,
      worldId: WORLD,
      issuedBy: TRADER,
      issuedAt: (START + 10_000) as never,
    },
    advanced,
  );
  if (outcome.kind !== "applied") {
    throw new Error("ctx snapshot command failed");
  }
  const sealed = advanced.journal.append(outcome.drafts, { recordedAt: (START + 10_000) as never });
  let state = advanced.state;
  const payload = (sealed[0] as unknown as { payload: {
    snapshotId: SnapshotId; digest: string; journalCursor: number; createdAt: number;
  } }).payload;
  for (const envelope of sealed) {
    const record: JournalRecord = {
      entryId: `jrn:${WORLD}:${String(envelope.sequence)}` as never,
      envelope,
      recordedAt: (START + 10_000) as never,
    };
    state = reduceWorldEvent(state, record);
  }
  const snapshot = buildWorldSnapshot({
    definition: advanced.definition,
    state: advanced.state,
    records: advanced.journal.records().slice(0, payload.journalCursor),
    snapshotId: payload.snapshotId,
    createdAt: payload.createdAt as never,
  });
  if (snapshot.descriptor.digest !== payload.digest) {
    throw new Error("ctx snapshot digest mismatch");
  }
  const snapshotPayloads = new Map<SnapshotId, WorldSnapshot>([[payload.snapshotId, snapshot]]);
  return {
    definition: advanced.definition,
    state,
    simulationTime: (START + 10_000) as never,
    nextSequence: (advanced.journal.getCursor() + 1) as never,
    journal: advanced.journal,
    snapshotPayloads,
    snapshot,
  };
}

function rejectionOf(outcome: { kind: string }): CommandRejection | undefined {
  return outcome.kind === "rejected"
    ? (outcome as unknown as { rejection: CommandRejection }).rejection
    : undefined;
}

test("validate: a sound command passes", () => {
  assert.deepEqual(validateCommand(addAnnotationCommand(), ctx()), { ok: true });
});

test("validate: structural malformations are typed malformed-command", () => {
  // base-field problems are reported first and short-circuit kind checks
  const base = validateCommand(addAnnotationCommand({ commandId: "" as never }), ctx());
  assert.equal(base.ok, false);
  assert.deepEqual(
    base.ok === false && base.errors.map((error) => error.code),
    ["malformed-command"],
  );
  // per-kind problems are collected once the base fields are sound
  const kind = validateCommand(addAnnotationCommand({ text: "  " }), ctx());
  assert.equal(kind.ok, false);
  assert.deepEqual(
    kind.ok === false && kind.errors.map((error) => error.code),
    ["malformed-command"],
  );
});

test("validate: a foreign world is unknown-world", () => {
  const result = validateCommand(
    addAnnotationCommand({ worldId: "world-elsewhere" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-world");
});

test("validate: an undeclared issuer is unknown-participant", () => {
  const result = validateCommand(
    addAnnotationCommand({ issuedBy: "participant-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-participant");
});

test("validate: submit-order needs a limit for limit orders and a stop for stops", () => {
  const limitless = submitOrderCommand({
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "10" as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  const result = validateCommand(limitless, ctx());
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "malformed-command");
  assert.match(
    result.ok === false ? (result.errors[0]?.message ?? "") : "",
    /limitPrice/,
  );

  const stopless = submitOrderCommand({
    submission: {
      kind: "stop",
      side: "buy",
      quantity: "10" as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  const stoplessResult = validateCommand(stopless, ctx());
  assert.equal(stoplessResult.ok, false);
  assert.match(
    stoplessResult.ok === false ? (stoplessResult.errors[0]?.message ?? "") : "",
    /stopPrice/,
  );
});

test("validate: unknown instruments and accounts are typed rejections", () => {
  const instrument = validateCommand(
    submitOrderCommand({ instrumentId: "instrument-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(instrument.ok === false && instrument.errors[0]?.code, "unknown-instrument");

  const account = validateCommand(
    submitOrderCommand({ accountId: "account-ghost" as never }),
    ctx(),
  );
  assert.deepEqual(account.ok === false && account.errors[0]?.code, "unknown-account");
});

test("validate: cancel/replace on an id no journal ever accepted is unknown-order", () => {
  const cancel: CancelOrderCommand = {
    kind: "cancel-order",
    commandId: "cmd-cancel-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    orderId: "order-1" as never,
  };
  const result = validateCommand(cancel, ctx());
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "unknown-order");
});

test("validate: scenario entries are structurally checked", () => {
  const result = validateCommand(
    setScenarioCommand({
      scenario: { entries: [{ regime: "nonsense" as never, from: START as never }] },
    }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "malformed-command");
});

test("validate: an acked command id is duplicate-command", () => {
  const command = addAnnotationCommand();
  const applied = applyCommand(command, ctx());
  assert.equal(applied.kind, "applied");
  const context = ctx();
  // simulate the post-append state: the reducer registers the ack
  const withAck = {
    ...context.state,
    ackedCommandIds: new Set([command.commandId as never]),
  };
  const result = validateCommand(command, { ...context, state: withAck });
  assert.deepEqual(result.ok === false && result.errors[0]?.code, "duplicate-command");
});

test("authorize: participants act only through their declared account", () => {
  const result = authorizeCommand(
    submitOrderCommand({ accountId: "account-other" as never }),
    ctx(),
  );
  assert.deepEqual(result.ok === false && result.denial.code, "permission-denied");
});

test("authorize: the trader's own tradable account passes", () => {
  const own = authorizeCommand(submitOrderCommand({ accountId: TRADER_ACCOUNT }), ctx());
  assert.deepEqual(own, { ok: true });
});

test("authorize: a canTrade=false account is account-not-tradable", () => {
  const definition = testDefinition();
  const account = definition.accounts[1]!; // account-other: canTrade=false
  const participants = [
    { participantId: TRADER, worldId: WORLD, kind: "human" as const, accountId: account.accountId },
  ];
  const context: LifecycleContext = {
    definition: { ...definition, participants },
    state: initialWorldState(definition),
    simulationTime: START as never,
    nextSequence: 1 as never,
  };
  const result = authorizeCommand(
    submitOrderCommand({ accountId: account.accountId }),
    context,
  );
  assert.deepEqual(result.ok === false && result.denial.code, "account-not-tradable");
});

test("authorize: world-ops are permissive for declared participants", () => {
  assert.deepEqual(authorizeCommand(addAnnotationCommand(), ctx()), { ok: true });
  assert.deepEqual(authorizeCommand(setScenarioCommand(), ctx()), { ok: true });
});

test("apply: add-annotation builds the deterministic event draft", () => {
  const command = addAnnotationCommand({ instrumentId: INSTRUMENT });
  const outcome = applyCommand(command, ctx());
  assert.equal(outcome.kind, "applied");
  if (outcome.kind === "applied") {
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0]!;
    assert.equal(draft.eventType, "world.annotation.added");
    assert.equal(draft.occurredAt, START + 10_000);
    assert.equal(draft.causationId, command.commandId);
    assert.equal(draft.correlationId, command.commandId, "uncorrelated commands correlate with themselves");
    assert.deepEqual(draft.payload, {
      type: "world.annotation.added",
      annotationId: "ann:world-w013-tests:1",
      issuedBy: TRADER,
      instrumentId: INSTRUMENT,
      at: START + 500,
      text: "golden region start",
    });
  }
});

test("apply: set-scenario builds the scenario event draft", () => {
  const command = setScenarioCommand();
  const outcome = applyCommand(command, ctx());
  assert.equal(outcome.kind, "applied");
  if (outcome.kind === "applied") {
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0]!;
    assert.equal(draft.eventType, "world.scenario.set");
    assert.deepEqual(draft.payload, {
      type: "world.scenario.set",
      issuedBy: TRADER,
      label: command.scenario.label,
      entries: command.scenario.entries,
    });
  }
});

test("apply: submit-order delegates to the matching seam and journals its drafts", () => {
  const command = submitOrderCommand();
  const outcome = runCommandLifecycle(command, ctx());
  assert.equal(outcome.kind, "applied");
  if (outcome.kind !== "applied") {
    return;
  }
  // the matcher's batch: acceptance + the W004 book delta of the resting order
  assert.deepEqual(
    outcome.drafts.map((draft) => draft.eventType),
    ["matching.order.accepted", "market.book.delta"],
  );
  const accepted = outcome.drafts[0]!.payload as Record<string, unknown>;
  assert.equal(accepted.orderId, "ord:world-w013-tests:1");
  assert.equal(accepted.restingQuantity, "10");
  assert.equal(accepted.constraints, command.submission.constraints);
  for (const draft of outcome.drafts) {
    assert.equal(draft.causationId, command.commandId);
    assert.equal(draft.producer, "matching-engine");
    assert.equal(draft.schemaVersion, "tradrl-world-sim.matching@1");
  }
});

test("apply: a seam domain-rules rejection surfaces with its stage and code", () => {
  // post-only limit that would cross — but the book is empty, so first make
  // resting liquidity through the seam itself (single-path state advance)
  const context = ctxAfter(submitOrderCommand({ commandId: "cmd-rest" as never }));
  const crossing = submitOrderCommand({
    commandId: "cmd-cross" as never,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "5" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC", postOnly: true },
    },
  });
  const outcome = runCommandLifecycle(crossing, context);
  const rejection = rejectionOf(outcome);
  assert.deepEqual(rejection, {
    stage: "domain-rules",
    code: "post-only-would-take",
    message: rejection?.message,
  });
  assert.match(rejection?.message ?? "", /would cross the book/);
});

test("lifecycle: cancel-order works through the seam on real journaled state", () => {
  const context = ctxAfter(submitOrderCommand({ commandId: "cmd-rest" as never }));
  const cancel = {
    kind: "cancel-order",
    commandId: "cmd-cancel-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    orderId: "ord:world-w013-tests:1" as never,
  } as const;
  assert.deepEqual(validateCommand(cancel, context), { ok: true });
  const outcome = runCommandLifecycle(cancel, context);
  assert.equal(outcome.kind, "applied");
  if (outcome.kind === "applied") {
    assert.deepEqual(
      outcome.drafts.map((draft) => draft.eventType),
      ["matching.order.canceled", "market.book.delta"],
    );
  }
});

test("lifecycle: cancel of a terminal order is order-not-modifiable at domain rules", () => {
  const marketSweep = submitOrderCommand({
    commandId: "cmd-sweep" as never,
    submission: {
      kind: "market",
      side: "sell",
      quantity: "10" as never,
      constraints: { timeInForce: "IOC" },
    },
  });
  const context = ctxAfter(
    submitOrderCommand({ commandId: "cmd-rest" as never }),
    marketSweep,
  );
  // the resting maker was fully filled by the sweep: terminal, not modifiable
  const cancel = {
    kind: "cancel-order",
    commandId: "cmd-cancel-2" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    orderId: "ord:world-w013-tests:1" as never,
  } as const;
  const outcome = runCommandLifecycle(cancel, context);
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "domain-rules");
  assert.equal(rejection?.code, "order-not-modifiable");
});

test("W015: close-position on a flat account is the typed no-open-position rejection", () => {
  const outcome = runCommandLifecycle(closePositionCommand(), ctx());
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "domain-rules");
  assert.equal(rejection?.code, "no-open-position");
  assert.match(rejection?.message ?? "", /no open position/);
});

test("W016 seam: create-snapshot captures the world at the cursor and drafts its descriptor", () => {
  const context = ctxAfter(addAnnotationCommand(), submitOrderCommand());
  const before = context.state;
  const snapshot: CreateSnapshotCommand = {
    kind: "create-snapshot",
    commandId: "cmd-snap-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    label: "pre-branch",
  };
  const outcome = runCommandLifecycle(snapshot, context);
  assert.equal(outcome.kind, "applied");
  if (outcome.kind !== "applied") return;
  const draft = outcome.drafts[0]!;
  assert.equal(draft.eventType, "world.snapshot.created");
  const payload = draft.payload as {
    snapshotId: string;
    journalCursor: number;
    digest: string;
    createdAt: number;
    parentSnapshotId?: string;
    label?: string;
  };
  assert.equal(payload.snapshotId, "snap:world-w013-tests:1");
  assert.equal(payload.journalCursor, context.journal.getCursor());
  assert.equal(payload.label, "pre-branch");
  assert.equal(payload.parentSnapshotId, undefined, "first snapshot has no parent");
  // the digest is the content address of the captured state + prefix
  const rebuilt = buildWorldSnapshot({
    definition: context.definition,
    state: before,
    records: context.journal.records().slice(0, payload.journalCursor),
    snapshotId: payload.snapshotId as never,
    createdAt: payload.createdAt as never,
  });
  assert.equal(rebuilt.descriptor.digest, payload.digest);
  // a second snapshot chains its parent and gets the next deterministic id
  const second = runCommandLifecycle(
    { ...snapshot, commandId: "cmd-snap-2" as never },
    {
      ...context,
      state: {
        ...context.state,
        snapshots: [
          {
            snapshotId: payload.snapshotId as never,
            journalCursor: payload.journalCursor as never,
            digest: payload.digest,
            createdAt: payload.createdAt as never,
          },
        ],
      },
    },
  );
  assert.equal(second.kind, "applied");
  const secondPayload =
    second.kind === "applied" ? (second.drafts[0]!.payload as { snapshotId: string; parentSnapshotId: string }) : undefined;
  assert.equal(secondPayload?.snapshotId, "snap:world-w013-tests:2");
  assert.equal(secondPayload?.parentSnapshotId, "snap:world-w013-tests:1");
});

test("W016 seam: create-snapshot rejects a blank label at validate", () => {
  const snapshot: CreateSnapshotCommand = {
    kind: "create-snapshot",
    commandId: "cmd-snap-blank" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    label: "   ",
  };
  const outcome = runCommandLifecycle(snapshot, ctx());
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "validate");
  assert.equal(rejection?.code, "malformed-command");
});

test("W016 seam: branch-world drafts the parent record and rejects unknown snapshots", () => {
  const context = ctxAfterSnapshot(addAnnotationCommand());
  const branch: BranchWorldCommand = {
    kind: "branch-world",
    commandId: "cmd-branch-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: context.snapshot.descriptor.snapshotId,
    configuration: { label: "what-if" },
  };
  const outcome = runCommandLifecycle(branch, context);
  assert.equal(outcome.kind, "applied");
  if (outcome.kind !== "applied") return;
  const draft = outcome.drafts[0]!;
  assert.equal(draft.eventType, "world.branch.created");
  const payload = draft.payload as {
    branchWorldId: string;
    parentWorldId: string;
    sourceSnapshotId: string;
    snapshotDigest: string;
    branchPointSequence: number;
    configuration: { label: string };
    createdViaCommand: string;
  };
  assert.equal(payload.branchWorldId, "wld:world-w013-tests:1");
  assert.equal(payload.parentWorldId, WORLD);
  assert.equal(payload.sourceSnapshotId, context.snapshot.descriptor.snapshotId);
  assert.equal(payload.snapshotDigest, context.snapshot.descriptor.digest);
  assert.equal(payload.branchPointSequence, context.snapshot.descriptor.journalCursor);
  assert.equal(payload.createdViaCommand, "cmd-branch-1");
  assert.deepEqual(payload.configuration, { label: "what-if" });

  // unknown snapshot id: the honest domain-rules rejection
  const unknown = runCommandLifecycle(
    { ...branch, commandId: "cmd-branch-2" as never, sourceSnapshotId: "snap-ghost" as never },
    context,
  );
  assert.equal(rejectionOf(unknown)?.stage, "domain-rules");
  assert.equal(rejectionOf(unknown)?.code, "unknown-snapshot");

  // journaled descriptor but no restorable payload in the session store
  const summaryOnly = ctxAfterSnapshot(addAnnotationCommand());
  const notRestorable = runCommandLifecycle(
    { ...branch, commandId: "cmd-branch-3" as never },
    { ...summaryOnly, snapshotPayloads: new Map() },
  );
  assert.equal(rejectionOf(notRestorable)?.stage, "domain-rules");
  assert.equal(rejectionOf(notRestorable)?.code, "snapshot-not-restorable");
});

test("lifecycle ordering: validation precedes authorization precedes domain rules", () => {
  // unknown participant (validate) wins even though the domain op is live
  const outcome = runCommandLifecycle(
    submitOrderCommand({ issuedBy: "participant-ghost" as never }),
    ctx(),
  );
  const rejection = rejectionOf(outcome);
  assert.equal(rejection?.stage, "validate");
  assert.equal(rejection?.code, "unknown-participant");

  // permission-denied (authorize) wins before the matching seam runs
  const denied = runCommandLifecycle(
    submitOrderCommand({ accountId: "account-other" as never }),
    ctx(),
  );
  assert.equal(rejectionOf(denied)?.stage, "authorize");
  assert.equal(rejectionOf(denied)?.code, "permission-denied");
});

test("lifecycle: rejected outcomes never build drafts", () => {
  const outcome = runCommandLifecycle(
    addAnnotationCommand({ text: "" }),
    ctx(),
  );
  assert.equal(outcome.kind, "rejected");
  assert.equal(rejectionOf(outcome)?.stage, "validate");
});
