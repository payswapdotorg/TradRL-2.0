/**
 * Order ticket tests (W010) — the form model, the command builders and the
 * REAL-engine submission outcomes.
 *
 * Guards the work order's core laws:
 * - FORM DISCIPLINE: the ticket validates structurally (venue policy, price
 *   fields per kind, canonical decimal text, tick/lot grids, the
 *   post-only/market conflict) with VISIBLE reasons — and that validation
 *   only PREPARES the submission, it never replaces the engine's verdict;
 * - TYPED OUTCOMES: submissions through the REAL CommandPort surface the
 *   engine's typed VALUES — acks (journalCursor + commandId, displayed by
 *   describeCommandOutcome) and typed rejections (stage + code) — never
 *   wire errors, never fabricated state;
 * - COMMAND SHAPES: the builders emit the exact W003 command contracts
 *   (compile-time typed; runtime shape asserted).
 *
 * The real-engine section runs the REAL in-process adapter + engine
 * (tradrl-world-sim, imported directly — the W005/W018-established
 * test-side pattern).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldOrderTicket.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA_TRADER_IDENTITY,
  ALPHA_VENUE_POLICY,
  alphaTraderIdentity,
  buildCancelOrderCommand,
  buildReplaceOrderCommand,
  buildSubmitOrderCommand,
  createDefaultOrderTicketFormState,
  newUiCommandId,
  resolveOrderTicketIdentity,
  validateOrderTicketForm,
  type OrderTicketFormState,
  type OrderTicketInstrumentFacts,
  type OrderTicketVenuePolicy,
} from "../src/trading-world/orders/orderTicket.js";
import { describeCommandOutcome } from "../src/trading-world/orders/orderLifecycle.js";
import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import {
  at,
  fixedWallTimeSource,
  START,
  testDefinition,
  TRADER,
  TRADER_ACCOUNT,
  INSTRUMENT,
  WORLD,
} from "../../tradrl-world-sim/world/test/helpers.js";
import type { CommandResult, Order } from "tradrl-world-contracts";

const ES_FACTS: OrderTicketInstrumentFacts = {
  tickSize: "0.25",
  lotSize: "1",
  tradingState: "open",
  tradable: true,
};

function form(overrides: Partial<OrderTicketFormState> = {}): OrderTicketFormState {
  return { ...createDefaultOrderTicketFormState(), ...overrides };
}

function problemsOf(
  state: OrderTicketFormState,
  options: { policy?: OrderTicketVenuePolicy; instrument?: OrderTicketInstrumentFacts } = {},
): readonly string[] {
  return validateOrderTicketForm(state, {
    policy: options.policy ?? ALPHA_VENUE_POLICY,
    ...(options.instrument === undefined ? {} : { instrument: options.instrument }),
  }).map((problem) => problem.message);
}

// --- form model -----------------------------------------------------------------

test("default ticket state is a resting GTC limit buy with the limit price unfilled", () => {
  const state = createDefaultOrderTicketFormState();
  assert.equal(state.kind, "limit");
  assert.equal(state.side, "buy");
  assert.equal(state.timeInForce, "GTC");
  assert.equal(state.quantity, "1");
  // The one structural gap: no limit price yet (visible reason, not silent).
  const problems = problemsOf(form({ limitPrice: "4800.25" }));
  assert.equal(problems.length, 0);
});

test("structural validation: required price fields per kind", () => {
  assert.ok(
    problemsOf(form({ limitPrice: "" })).some((m) => m.includes("limit requires a limit price")),
  );
  assert.ok(
    problemsOf(form({ kind: "stop", stopPrice: "" })).some((m) =>
      m.includes("stop requires a stop price"),
    ),
  );
  const stopLimit = problemsOf(
    form({ kind: "stop-limit", limitPrice: "4800.00", stopPrice: "" }),
  );
  assert.ok(stopLimit.some((m) => m.includes("stop-limit requires a stop price")));
  assert.equal(stopLimit.length, 1);
});

test("structural validation: a kind that cannot carry a price is called out, not silently dropped", () => {
  assert.ok(
    problemsOf(form({ kind: "market", limitPrice: "4800.25" })).some((m) =>
      m.includes("a market order cannot carry a limit price"),
    ),
  );
  assert.ok(
    problemsOf(form({ kind: "limit", stopPrice: "4800.00" })).some((m) =>
      m.includes("a limit order cannot carry a stop price"),
    ),
  );
});

test("structural validation: canonical decimal text (the W003 boundary law)", () => {
  for (const bad of ["", "abc", "1e3", "-5", "007", "1.", ".5"]) {
    assert.ok(
      problemsOf(form({ limitPrice: "4800.25", quantity: bad })).some((m) =>
        m.startsWith("quantity is required"),
      ),
      `quantity '${bad}' must be rejected`,
    );
  }
  // Canonical but not positive: its own visible reason.
  assert.ok(
    problemsOf(form({ limitPrice: "4800.25", quantity: "0" })).some((m) =>
      m.includes("quantity must be positive"),
    ),
  );
});

test("structural validation: tick and lot grids against real instrument facts", () => {
  assert.ok(
    problemsOf(form({ limitPrice: "4800.30" }), { instrument: ES_FACTS }).some((m) =>
      m.includes("not a multiple of the tick size 0.25"),
    ),
  );
  assert.ok(
    problemsOf(form({ limitPrice: "4800.25", quantity: "0.5" }), { instrument: ES_FACTS }).some(
      (m) => m.includes("not a positive multiple of the lot size 1"),
    ),
  );
  // Without instrument facts the grid checks are honestly absent (the engine
  // still judges the submission — structural hints never replace it).
  assert.equal(problemsOf(form({ limitPrice: "4800.30" })).length, 0);
});

test("structural validation: the post-only/market conflict mirrors the engine rule", () => {
  assert.ok(
    problemsOf(form({ kind: "market", postOnly: true, quantity: "1" })).some((m) =>
      m.includes("post-only-would-take"),
    ),
  );
  assert.equal(problemsOf(form({ kind: "limit", limitPrice: "4800.25", postOnly: true })).length, 0);
});

test("structural validation: venue policy forbids with reasons (never silently)", () => {
  const restricted: OrderTicketVenuePolicy = {
    label: "venue-limits",
    allowedOrderKinds: ["market", "limit"],
    allowedTimeInForce: ["GTC", "IOC"],
  };
  assert.ok(
    problemsOf(form({ kind: "stop", stopPrice: "4800.00" }), { policy: restricted }).some((m) =>
      m.includes("venue venue-limits does not accept stop orders"),
    ),
  );
  assert.ok(
    problemsOf(form({ limitPrice: "4800.25", timeInForce: "FOK" }), { policy: restricted }).some(
      (m) => m.includes("venue venue-limits does not accept FOK orders"),
    ),
  );
});

test("structural validation: instrument trading state and tradability", () => {
  assert.ok(
    problemsOf(form({ limitPrice: "4800.25" }), {
      instrument: { ...ES_FACTS, tradingState: "halted" },
    }).some((m) => m.includes("trading state is halted")),
  );
  assert.ok(
    problemsOf(form({ limitPrice: "4800.25" }), {
      instrument: { ...ES_FACTS, tradable: false },
    }).some((m) => m.includes("not tradable")),
  );
});

// --- identity + command builders --------------------------------------------------

test("alpha trader identity derives the attachment convention from the pane worldId", () => {
  const identity = alphaTraderIdentity("world-42");
  assert.equal(identity.participantId, "participant-trader-world-42");
  assert.equal(identity.accountId, "account-trader-world-42");
  assert.equal(identity.instrumentId, "instrument-es-world-42");
  assert.equal(resolveOrderTicketIdentity(ALPHA_TRADER_IDENTITY, "w").accountId, "account-trader-w");
  const explicit = resolveOrderTicketIdentity(
    { participantId: "p" as never, accountId: "a" as never, instrumentId: "i" as never },
    "w",
  );
  assert.equal(explicit.participantId, "p");
});

test("buildSubmitOrderCommand emits the exact W003 command shape (relevant prices only)", () => {
  const identity = alphaTraderIdentity("world-x");
  const command = buildSubmitOrderCommand({
    identity,
    worldId: "world-x",
    form: form({
      kind: "stop-limit",
      side: "sell",
      quantity: "7",
      limitPrice: "4790.75",
      stopPrice: "4800.00",
      timeInForce: "IOC",
      reduceOnly: true,
    }),
    commandId: "cmd-test-1" as never,
    issuedAt: at(START),
    correlationId: "corr-1" as never,
  });
  assert.equal(command.kind, "submit-order");
  assert.equal(command.commandId, "cmd-test-1");
  assert.equal(command.worldId, "world-x");
  assert.equal(command.issuedBy, identity.participantId);
  assert.equal(command.issuedAt, START);
  assert.equal(command.correlationId, "corr-1");
  assert.equal(command.accountId, identity.accountId);
  assert.equal(command.instrumentId, identity.instrumentId);
  assert.deepEqual(command.submission, {
    kind: "stop-limit",
    side: "sell",
    quantity: "7",
    limitPrice: "4790.75",
    stopPrice: "4800.00",
    constraints: { timeInForce: "IOC", reduceOnly: true },
  });
  // Market orders carry neither price; postOnly only when set.
  const market = buildSubmitOrderCommand({
    identity,
    worldId: "world-x",
    form: form({ kind: "market", limitPrice: "", stopPrice: "", postOnly: true }),
    commandId: "cmd-test-2" as never,
    issuedAt: at(START),
  });
  assert.deepEqual(market.submission, {
    kind: "market",
    side: "buy",
    quantity: "1",
    constraints: { timeInForce: "GTC", postOnly: true },
  });
});

test("cancel/replace builders carry the essentials; empty replace edits are omitted", () => {
  const identity = alphaTraderIdentity("world-x");
  const cancel = buildCancelOrderCommand({
    identity,
    worldId: "world-x",
    orderId: "order-1",
    commandId: "cmd-c" as never,
    issuedAt: at(START),
    reason: "flatten",
  });
  assert.equal(cancel.kind, "cancel-order");
  assert.equal(cancel.orderId, "order-1");
  assert.equal(cancel.reason, "flatten");
  assert.equal(cancel.issuedBy, identity.participantId);

  const replace = buildReplaceOrderCommand({
    identity,
    worldId: "world-x",
    orderId: "order-1",
    commandId: "cmd-r" as never,
    issuedAt: at(START),
    quantity: "5",
    limitPrice: "",
    stopPrice: "",
  });
  assert.equal(replace.kind, "replace-order");
  assert.equal(replace.quantity, "5");
  assert.equal(replace.limitPrice, undefined);
  assert.equal(replace.stopPrice, undefined);
});

test("newUiCommandId yields fresh, distinct command ids", () => {
  const a = newUiCommandId("submit");
  const b = newUiCommandId("submit");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("cmd-submit-"));
});

// --- real-engine typed outcomes (the W018 in-process pattern) --------------------

async function attachTestEngine(): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
    expectedWorldId: WORLD,
  });
}

const IDENTITY = {
  participantId: TRADER,
  accountId: TRADER_ACCOUNT,
  instrumentId: INSTRUMENT,
};

test("a valid submission acks with the engine's journalCursor and commandId (displayed)", async () => {
  const client = await attachTestEngine();
  try {
    const result: CommandResult = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ limitPrice: "4800.25", quantity: "3" }),
        commandId: "cmd-ok-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(result.status === "acked");
    assert.equal(result.ack.commandId, "cmd-ok-1");
    assert.ok(result.ack.journalCursor >= 1);
    assert.ok(result.ack.resultingEventIds.length >= 1);
    const capsule = describeCommandOutcome(result);
    assert.equal(capsule.kind, "acked");
    assert.ok(capsule.text.includes("acked"));
    assert.ok(capsule.text.includes("journal cursor"));
    assert.ok(capsule.text.includes("cmd-ok-1"));
  } finally {
    client.dispose();
  }
});

test("a tick-grid violation rejects as the engine's typed VALUE (never a wire error)", async () => {
  const client = await attachTestEngine();
  try {
    const result = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ limitPrice: "4800.30" }),
        commandId: "cmd-tick-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(result.status === "rejected");
    assert.equal(result.rejection.stage, "domain-rules");
    assert.equal(result.rejection.code, "invalid-price");
    const capsule = describeCommandOutcome(result);
    assert.equal(capsule.kind, "rejected");
    assert.equal(capsule.code, "invalid-price");
    assert.ok(capsule.text.includes("not a multiple of the tick size"));
  } finally {
    client.dispose();
  }
});

test("FOK on an empty book rejects typed fok-unfillable; post-only market rejects post-only-would-take", async () => {
  const client = await attachTestEngine();
  try {
    const fok = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ kind: "market", timeInForce: "FOK", quantity: "2" }),
        commandId: "cmd-fok-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(fok.status === "rejected");
    assert.equal(fok.rejection.stage, "domain-rules");
    assert.equal(fok.rejection.code, "fok-unfillable");

    const postOnlyMarket = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ kind: "market", postOnly: true, timeInForce: "IOC", quantity: "1" }),
        commandId: "cmd-po-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(postOnlyMarket.status === "rejected");
    assert.equal(postOnlyMarket.rejection.code, "post-only-would-take");
  } finally {
    client.dispose();
  }
});

test("validate-stage rejections are typed values too (unknown instrument/account, duplicate command)", async () => {
  const client = await attachTestEngine();
  try {
    const unknownInstrument = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: { ...IDENTITY, instrumentId: "instrument-none" as never },
        worldId: WORLD,
        form: form({ limitPrice: "4800.25" }),
        commandId: "cmd-ui-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(unknownInstrument.status === "rejected");
    assert.equal(unknownInstrument.rejection.stage, "validate");
    assert.equal(unknownInstrument.rejection.code, "unknown-instrument");

    const unknownAccount = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: { ...IDENTITY, accountId: "account-none" as never },
        worldId: WORLD,
        form: form({ limitPrice: "4800.25" }),
        commandId: "cmd-ua-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(unknownAccount.status === "rejected");
    assert.equal(unknownAccount.rejection.stage, "validate");
    assert.equal(unknownAccount.rejection.code, "unknown-account");

    const first = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ limitPrice: "4800.25" }),
        commandId: "cmd-dup-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(first.status === "acked");
    const duplicate = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ limitPrice: "4800.25" }),
        commandId: "cmd-dup-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(duplicate.status === "rejected");
    assert.equal(duplicate.rejection.code, "duplicate-command");
  } finally {
    client.dispose();
  }
});

test("a marketable limit fills against resting liquidity; the projection shows the fill", async () => {
  const client = await attachTestEngine();
  try {
    const maker = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ kind: "limit", side: "sell", quantity: "10", limitPrice: "4800.25" }),
        commandId: "cmd-maker-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(maker.status === "acked");

    const taker = await client.command.submitOrder(
      buildSubmitOrderCommand({
        identity: IDENTITY,
        worldId: WORLD,
        form: form({ kind: "limit", side: "buy", quantity: "4", limitPrice: "4800.25" }),
        commandId: "cmd-taker-1" as never,
        issuedAt: at(START),
      }),
    );
    assert.ok(taker.status === "acked");

    const orders: readonly Order[] = await client.query.getOrders({
      accountId: TRADER_ACCOUNT,
    });
    const filledBuy = orders.find((order) => order.side === "buy");
    assert.ok(filledBuy !== undefined, "the buy order must exist in the projection");
    assert.equal(filledBuy.status, "filled");
    assert.equal(filledBuy.filledQuantity, "4");
    // The resting maker was partially lifted: venue truth, cumulative fills.
    const makerOrder = orders.find((order) => order.side === "sell");
    assert.ok(makerOrder !== undefined);
    assert.equal(makerOrder.status, "partially-filled");
    assert.equal(makerOrder.filledQuantity, "4");
  } finally {
    client.dispose();
  }
});
