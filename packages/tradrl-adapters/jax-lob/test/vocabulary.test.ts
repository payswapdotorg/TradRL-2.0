/**
 * The clean-room LOB vocabulary laws (W049): the closed sets, the
 * book-state gate, the execution-event gate, and the episode-step shape
 * gate — happy paths and every refusal law, over REAL imports.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOB_BOOK_STATE_ID_PREFIX,
  LOB_EXECUTION_EVENT_KINDS,
  LOB_LEVEL_MEMBERS,
  LOB_ORDER_KINDS,
  LOB_SIDES,
  LOB_STEP_KINDS,
  lobBookStateIdOf,
  lobBookStateOf,
  lobEpisodeStepShapeOf,
  lobExecutionEventOf,
} from "../lob-vocabulary.js";
import type { LobExecutionEventKind, LobOrderKind, LobSide, LobStepKind } from "../lob-vocabulary.js";
import { CANONICAL_BOOK, LOB_SHAPE, MINIMAL_SHAPE } from "./fixtures.js";

// ---------------------------------------------------------------------------
// The closed sets (test-pinned — the vocabulary-law scan's twin)
// ---------------------------------------------------------------------------

test("the closed vocabularies are exactly the declared sets", () => {
  assert.deepEqual(LOB_SIDES, ["bid", "ask"]);
  assert.deepEqual(LOB_ORDER_KINDS, ["limit", "market", "cancel", "amend"]);
  assert.deepEqual(LOB_EXECUTION_EVENT_KINDS, ["submission", "cancellation", "execution", "amendment"]);
  assert.deepEqual(LOB_STEP_KINDS, [
    "book-observation",
    "order-action",
    "execution-report",
    "reward-signal",
    "terminal-marker",
  ]);
  assert.deepEqual(LOB_LEVEL_MEMBERS, ["price", "size", "orderCount"]);
});

// ---------------------------------------------------------------------------
// The book-state gate
// ---------------------------------------------------------------------------

test("a canonical book state seals with a content-addressed id", () => {
  const outcome = lobBookStateOf(CANONICAL_BOOK);
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  assert.equal(String(outcome.book.bookStateId).startsWith(LOB_BOOK_STATE_ID_PREFIX), true);
  assert.equal(outcome.book.bookStateId, lobBookStateIdOf(CANONICAL_BOOK));
  assert.deepEqual(outcome.book.bidLevels, CANONICAL_BOOK.bidLevels);
  assert.deepEqual(outcome.book.askLevels, CANONICAL_BOOK.askLevels);
  assert.equal(Object.isFrozen(outcome.book), true);
});

test("an empty book side is refused (empty-book-side)", () => {
  const outcome = lobBookStateOf({ bidLevels: [], askLevels: CANONICAL_BOOK.askLevels });
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors.map((entry) => entry.code), ["empty-book-side"]);
});

test("malformed levels are refused (malformed-level)", () => {
  const zeroPrice = lobBookStateOf({
    bidLevels: [{ price: 0, size: 10, orderCount: 1 }],
    askLevels: CANONICAL_BOOK.askLevels,
  });
  assert.ok(!zeroPrice.ok);
  assert.equal(zeroPrice.errors.some((entry) => entry.code === "malformed-level"), true);

  const fractionalCount = lobBookStateOf({
    bidLevels: [{ price: 99, size: 10, orderCount: 1.5 }],
    askLevels: CANONICAL_BOOK.askLevels,
  });
  assert.ok(!fractionalCount.ok);
  assert.equal(fractionalCount.errors.some((entry) => entry.code === "malformed-level"), true);
});

test("non-best-first levels are refused (non-canonical-level-order)", () => {
  const outcome = lobBookStateOf({
    bidLevels: [
      { price: 99, size: 10, orderCount: 1 },
      { price: 99.5, size: 10, orderCount: 1 },
    ],
    askLevels: CANONICAL_BOOK.askLevels,
  });
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "non-canonical-level-order"), true);
});

test("a crossed or locked book is refused (crossed-book)", () => {
  const crossed = lobBookStateOf({
    bidLevels: [{ price: 101, size: 10, orderCount: 1 }],
    askLevels: [{ price: 100.5, size: 10, orderCount: 1 }],
  });
  assert.ok(!crossed.ok);
  assert.equal(crossed.errors.some((entry) => entry.code === "crossed-book"), true);

  const locked = lobBookStateOf({
    bidLevels: [{ price: 100, size: 10, orderCount: 1 }],
    askLevels: [{ price: 100, size: 10, orderCount: 1 }],
  });
  assert.ok(!locked.ok);
  assert.equal(locked.errors.some((entry) => entry.code === "crossed-book"), true);
});

// ---------------------------------------------------------------------------
// The execution-event gate
// ---------------------------------------------------------------------------

test("a canonical execution event seals frozen", () => {
  const outcome = lobExecutionEventOf({ eventKind: "execution", side: "bid", orderKind: "limit", size: 12.5 });
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.event, { eventKind: "execution", side: "bid", orderKind: "limit", size: 12.5 });
  assert.equal(Object.isFrozen(outcome.event), true);
});

test("unknown event/side/order vocabularies are refused by name", () => {
  const kind = lobExecutionEventOf({ eventKind: "requote" as LobExecutionEventKind, side: "bid", orderKind: "limit", size: 1 });
  assert.ok(!kind.ok);
  assert.deepEqual(kind.errors.map((entry) => entry.code), ["unknown-execution-event-kind"]);

  const side = lobExecutionEventOf({ eventKind: "execution", side: "middle" as LobSide, orderKind: "limit", size: 1 });
  assert.ok(!side.ok);
  assert.deepEqual(side.errors.map((entry) => entry.code), ["unknown-side"]);

  const order = lobExecutionEventOf({ eventKind: "execution", side: "bid", orderKind: "iceberg" as LobOrderKind, size: 1 });
  assert.ok(!order.ok);
  assert.deepEqual(order.errors.map((entry) => entry.code), ["unknown-order-kind"]);
});

test("a non-positive event size is refused (malformed-execution-event)", () => {
  const outcome = lobExecutionEventOf({ eventKind: "submission", side: "ask", orderKind: "market", size: 0 });
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors.map((entry) => entry.code), ["malformed-execution-event"]);
});

// ---------------------------------------------------------------------------
// The episode-step shape gate
// ---------------------------------------------------------------------------

test("the canonical and minimal shapes seal frozen", () => {
  for (const shape of [LOB_SHAPE, MINIMAL_SHAPE]) {
    const outcome = lobEpisodeStepShapeOf(shape);
    assert.ok(outcome.ok);
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.shape.stepKinds, shape.stepKinds);
    assert.equal(Object.isFrozen(outcome.shape), true);
  }
});

test("an empty shape is refused (empty-step-shape)", () => {
  const outcome = lobEpisodeStepShapeOf({ stepKinds: [] });
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors.map((entry) => entry.code), ["empty-step-shape"]);
});

test("an unknown step kind is refused (unknown-step-kind)", () => {
  const outcome = lobEpisodeStepShapeOf({ stepKinds: ["book-observation", "order-action", "reward-signal", "level-2-snapshot" as LobStepKind] });
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors.map((entry) => entry.code), ["unknown-step-kind"]);
});

test("a duplicated step kind is refused (duplicate-step-kind)", () => {
  const outcome = lobEpisodeStepShapeOf({ stepKinds: ["book-observation", "order-action", "order-action", "reward-signal"] });
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-step-kind"), true);
});

test("out-of-protocol order is refused (step-order)", () => {
  const outcome = lobEpisodeStepShapeOf({ stepKinds: ["order-action", "book-observation", "reward-signal"] });
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "step-order"), true);
});

test("a shape missing the observation, the action, or the reward is refused (missing-step-kind)", () => {
  const noObservation = lobEpisodeStepShapeOf({ stepKinds: ["order-action", "reward-signal"] });
  assert.ok(!noObservation.ok);
  assert.equal(noObservation.errors.some((entry) => entry.code === "missing-step-kind"), true);

  const noAction = lobEpisodeStepShapeOf({ stepKinds: ["book-observation", "reward-signal"] });
  assert.ok(!noAction.ok);
  assert.equal(noAction.errors.some((entry) => entry.code === "missing-step-kind"), true);

  const noReward = lobEpisodeStepShapeOf({ stepKinds: ["book-observation", "order-action"] });
  assert.ok(!noReward.ok);
  assert.equal(noReward.errors.some((entry) => entry.code === "missing-step-kind"), true);
});

test("a misplaced terminal marker is refused (misplaced-terminal)", () => {
  const outcome = lobEpisodeStepShapeOf({
    stepKinds: ["book-observation", "terminal-marker", "order-action", "reward-signal"],
  });
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "misplaced-terminal"), true);
});
