/**
 * The A9 determinism twin (W046, per-package law): same populations + same
 * policy ⇒ deep-equal pairings with identical canonical ids — input order
 * never leaks (permuted explicit cohort lists, swapped declaration order).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeAdversarial } from "../adversarial.js";
import { composeSelfPlay } from "../selfplay.js";
import { ablatedChallenger, challengerPopulation, championPopulation, championMemberIds } from "./fixtures.js";

test("THE TWIN: permuted explicit cohort lists compose the deep-equal self-play pairing, same canonical id", () => {
  const ids = championMemberIds();
  const canonical = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!, ids[2]!],
    competing: [ids[1]!],
  });
  const twin = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[2]!, ids[0]!],
    competing: [ids[1]!],
  });
  if (!canonical.ok || !twin.ok) {
    assert.fail("expected both to compose");
  }
  assert.deepEqual(twin.pairing, canonical.pairing);
  assert.equal(String(twin.pairing.pairingId), String(canonical.pairing.pairingId));
});

test("THE TWIN: the same population + the same alternate policy always compose the deep-equal pairing", () => {
  const first = composeSelfPlay(championPopulation(), { kind: "alternate" });
  const twin = composeSelfPlay(championPopulation(), { kind: "alternate" });
  if (!first.ok || !twin.ok) {
    assert.fail("expected both to compose");
  }
  assert.deepEqual(twin.pairing, first.pairing);
  assert.equal(String(twin.pairing.pairingId), String(first.pairing.pairingId));
});

test("THE TWIN: the same champion + the same challenger always compose the deep-equal adversarial pairing", () => {
  const first = composeAdversarial(championPopulation(), challengerPopulation());
  const twin = composeAdversarial(championPopulation(), challengerPopulation());
  if (!first.ok || !twin.ok) {
    assert.fail("expected both to compose");
  }
  assert.deepEqual(twin.pairing, first.pairing);
  assert.equal(String(twin.pairing.pairingId), String(first.pairing.pairingId));
});

test("THE TWIN: the ablate-origin challenger composes deterministically too (the citation carried verbatim)", () => {
  const first = composeAdversarial(championPopulation(), ablatedChallenger());
  const twin = composeAdversarial(championPopulation(), ablatedChallenger());
  if (!first.ok || !twin.ok) {
    assert.fail("expected both to compose");
  }
  assert.deepEqual(twin.pairing, first.pairing);
  assert.equal(String(twin.pairing.pairingId), String(first.pairing.pairingId));
  assert.deepEqual(twin.pairing.substitution, first.pairing.substitution);
});

test("THE TWIN: a different cohort split composes a DIFFERENT pairing (content addressing is real)", () => {
  const ids = championMemberIds();
  const first = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!, ids[2]!],
    competing: [ids[1]!],
  });
  const other = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!],
    competing: [ids[1]!, ids[2]!],
  });
  if (!first.ok || !other.ok) {
    assert.fail("expected both to compose");
  }
  assert.notEqual(String(other.pairing.pairingId), String(first.pairing.pairingId));
});
