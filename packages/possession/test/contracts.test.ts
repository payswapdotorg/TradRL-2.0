/**
 * Contract-surface laws (W034): the closed sets, the lifecycle table, the
 * digest family and the type-level pins (the W032 contracts-test pattern).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  POSSESSION_CHANNELS,
  POSSESSION_LIFECYCLE_TRANSITIONS,
  initialPossessionLineage,
  isPossessionHeld,
  isTerminalPossessionState,
  lineageAnchorOf,
  possessionDigestOf,
} from "../index.js";
import type {
  PossessionChannel,
  PossessionLineage,
  PossessionState,
} from "../index.js";
import { possessionOne, traderBody } from "./fixtures.js";

test("the possession lifecycle table is exactly the spec law", () => {
  assert.deepEqual(POSSESSION_LIFECYCLE_TRANSITIONS, {
    unpossessed: ["possessed", "released"],
    possessed: ["released"],
    released: [],
  });
});

test("the lifecycle table covers every state (compile-time exhaustiveness pin)", () => {
  // A Record over the full state union: adding a state without a table
  // row is a compile error, not a runtime surprise.
  const table: Record<PossessionState, readonly PossessionState[]> =
    POSSESSION_LIFECYCLE_TRANSITIONS;
  assert.equal(table.released.length, 0);
});

test("terminal and held predicates follow the table", () => {
  assert.equal(isTerminalPossessionState("released"), true);
  assert.equal(isTerminalPossessionState("unpossessed"), false);
  assert.equal(isTerminalPossessionState("possessed"), false);
  assert.equal(isPossessionHeld("possessed"), true);
  assert.equal(isPossessionHeld("unpossessed"), false);
  assert.equal(isPossessionHeld("released"), false);
});

test("the channel set is closed and covers its union (compile-time pin)", () => {
  const channels: readonly PossessionChannel[] = POSSESSION_CHANNELS;
  assert.deepEqual(channels, ["operator", "organization", "commissioning"]);
});

test("possession digests are deterministic and content-addressed (the W016 family)", () => {
  const first = possessionDigestOf(possessionOne());
  const second = possessionDigestOf(possessionOne());
  assert.equal(first, second);
  // a one-character change in the declaration is a different possession
  const changed = possessionOne({
    grant: { ...possessionOne().grant, basis: "a different declared basis" },
  });
  assert.notEqual(first, possessionDigestOf(changed));
  // a different possession id is a different possession, always
  const other = possessionOne({ possessionId: "possession-other" as never });
  assert.notEqual(first, possessionDigestOf(other));
});

test("the lineage anchor commits to the body identity (the W028 inventory precedent)", () => {
  const body = traderBody();
  const anchor = lineageAnchorOf({ bodyId: body.bodyId, worldId: body.scope.worldId });
  assert.equal(anchor, lineageAnchorOf({ bodyId: body.bodyId, worldId: body.scope.worldId }));
  assert.notEqual(anchor, lineageAnchorOf({ bodyId: body.bodyId, worldId: "world-other" as never }));
  assert.notEqual(anchor, lineageAnchorOf({ bodyId: "body-other" as never, worldId: body.scope.worldId }));
  assert.match(anchor, /^[0-9a-f]{8}$/u);
});

test("the empty lineage is anchored, not empty-headed", () => {
  const lineage: PossessionLineage = initialPossessionLineage(traderBody());
  assert.deepEqual(lineage.entries, []);
  assert.equal(
    lineage.head,
    lineageAnchorOf({ bodyId: lineage.bodyId, worldId: lineage.worldId }),
  );
});
