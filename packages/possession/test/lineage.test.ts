/**
 * The possession lineage (W034): the body's possession history as an
 * ordered, content-addressed chain — the W028 digest-chain discipline.
 * Each record is digested, each link cites its predecessor, and ANY
 * mutation of history breaks the chain loudly at the exact index.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  activePossessionOf,
  checkPossessionCompatibility,
  extendPossessionLineage,
  initialPossessionLineage,
  lineageAnchorOf,
  possessionDigestOf,
  possessionHistoryOf,
  verifyPossessionLineage,
} from "../index.js";
import type {
  PossessionLineage,
  PossessionLineageEntry,
} from "../index.js";
import { fnv1aChainHex, stableDigest } from "tradrl-world-sim/world";
import {
  AT_START,
  LATER,
  MUCH_LATER,
  POSSESSION_ONE,
  POSSESSION_TWO,
  possessionOne,
  possessionTwo,
  traderBody,
} from "./fixtures.js";

function compatibleEvent() {
  const outcome = checkPossessionCompatibility(possessionOne());
  assert.equal(outcome.ok, true);
  return { kind: "possess", compatibility: outcome } as const;
}

/** The canonical succession history: P1 possessed → released, then P2 possessed. */
function successionHistory(): PossessionLineage {
  let lineage = initialPossessionLineage(traderBody());
  let step = extendPossessionLineage(lineage, possessionOne(), compatibleEvent(), AT_START);
  assert.equal(step.ok, true);
  if (!step.ok) throw new Error("unreachable");
  lineage = step.lineage;
  step = extendPossessionLineage(lineage, possessionOne(), { kind: "release", reason: "operator-request" }, LATER);
  assert.equal(step.ok, true);
  if (!step.ok) throw new Error("unreachable");
  lineage = step.lineage;
  const secondOutcome = checkPossessionCompatibility(possessionTwo());
  assert.equal(secondOutcome.ok, true);
  step = extendPossessionLineage(lineage, possessionTwo(), { kind: "possess", compatibility: secondOutcome }, MUCH_LATER);
  assert.equal(step.ok, true);
  if (!step.ok) throw new Error("unreachable");
  return step.lineage;
}

/** Rebuild an entry's core digest exactly the way the builder does. */
function coreDigestOf(entry: PossessionLineageEntry): string {
  const core: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key !== "entryDigest" && key !== "previousEntryDigest" && key !== "chainLink") {
      core[key] = value;
    }
  }
  return stableDigest(core);
}

/** Recompute the whole chain over (possibly edited) entries, the honest way. */
function recomputeChain(
  lineage: PossessionLineage,
  entries: readonly PossessionLineageEntry[],
): PossessionLineage {
  const anchor = lineageAnchorOf({ bodyId: lineage.bodyId, worldId: lineage.worldId });
  let previousLink = anchor;
  let previousEntryDigest: string | null = null;
  const rebuilt = entries.map((entry) => {
    const entryDigest = coreDigestOf(entry);
    const chainLink = fnv1aChainHex([previousLink, entryDigest]);
    const rebuiltEntry: PossessionLineageEntry = {
      ...entry,
      entryDigest,
      previousEntryDigest: previousEntryDigest,
      chainLink,
    };
    previousLink = chainLink;
    previousEntryDigest = entryDigest;
    return rebuiltEntry;
  });
  return { ...lineage, entries: rebuilt, head: previousLink };
}

test("an empty lineage verifies and has no active possession", () => {
  const lineage = initialPossessionLineage(traderBody());
  assert.deepEqual(verifyPossessionLineage(lineage), { ok: true });
  assert.deepEqual(activePossessionOf(lineage), { ok: false, code: "no-active-possession" });
});

test("a built history verifies, cites predecessors, and ends at its head", () => {
  const lineage = successionHistory();
  assert.deepEqual(verifyPossessionLineage(lineage), { ok: true });
  const [first, second, third] = lineage.entries;
  assert.ok(first && second && third);
  assert.equal(first.sequence, 0);
  assert.equal(second.sequence, 1);
  assert.equal(third.sequence, 2);
  // each record cites its predecessor
  assert.equal(first.previousEntryDigest, null);
  assert.equal(second.previousEntryDigest, first.entryDigest);
  assert.equal(third.previousEntryDigest, second.entryDigest);
  // the links are the W028 rolling chain, anchored at the lineage anchor
  const anchor = lineageAnchorOf({ bodyId: lineage.bodyId, worldId: lineage.worldId });
  assert.equal(first.chainLink, fnv1aChainHex([anchor, first.entryDigest]));
  assert.equal(second.chainLink, fnv1aChainHex([first.chainLink, second.entryDigest]));
  assert.equal(third.chainLink, fnv1aChainHex([second.chainLink, third.entryDigest]));
  assert.equal(lineage.head, third.chainLink);
  // every entry commits to its possession's full declaration
  assert.equal(first.possessionDigest, possessionDigestOf(possessionOne()));
  assert.equal(third.possessionDigest, possessionDigestOf(possessionTwo()));
});

test("the active-possession query tracks the succession exactly", () => {
  let lineage = initialPossessionLineage(traderBody());
  assert.deepEqual(activePossessionOf(lineage), { ok: false, code: "no-active-possession" });

  let step = extendPossessionLineage(lineage, possessionOne(), compatibleEvent(), AT_START);
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  assert.deepEqual(activePossessionOf(lineage), {
    ok: true,
    possessionId: POSSESSION_ONE,
    sinceSequence: 0,
  });

  step = extendPossessionLineage(lineage, possessionOne(), { kind: "release", reason: "operator-request" }, LATER);
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  assert.deepEqual(activePossessionOf(lineage), { ok: false, code: "no-active-possession" });

  const secondOutcome = checkPossessionCompatibility(possessionTwo());
  step = extendPossessionLineage(lineage, possessionTwo(), { kind: "possess", compatibility: secondOutcome }, MUCH_LATER);
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  assert.deepEqual(activePossessionOf(lineage), {
    ok: true,
    possessionId: POSSESSION_TWO,
    sinceSequence: 2,
  });
});

test("the per-possession history query is typed", () => {
  const lineage = successionHistory();
  const first = possessionHistoryOf(lineage, POSSESSION_ONE);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(
    first.entries.map((entry) => [entry.sequence, entry.resultingState]),
    [[0, "possessed"], [1, "released"]],
  );
  assert.deepEqual(possessionHistoryOf(lineage, "possession-never" as never), {
    ok: false,
    code: "unknown-possession",
  });
});

test("A9: the same history built twice is bit-identical (fresh objects, same digests)", () => {
  const first = successionHistory();
  const second = successionHistory();
  assert.deepEqual(first, second);
  assert.equal(first.head, second.head);
});

test("editing one entry's content breaks verification at that exact index", () => {
  const lineage = successionHistory();
  const tampered: PossessionLineage = {
    ...lineage,
    entries: lineage.entries.map((entry, index) =>
      index === 1
        ? { ...entry, recordedAt: (entry.recordedAt + 1) as never }
        : entry,
    ),
  };
  const verification = verifyPossessionLineage(tampered);
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.code, "entry-digest-mismatch");
  assert.equal(verification.index, 1);
});

test("swapping two entries breaks verification (sequence law)", () => {
  const lineage = successionHistory();
  const entries = [...lineage.entries];
  const [first] = entries;
  const second = entries[1];
  entries[0] = second!;
  entries[1] = first!;
  const swapped: PossessionLineage = { ...lineage, entries };
  const verification = verifyPossessionLineage(swapped);
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.code, "sequence-mismatch");
  assert.equal(verification.index, 0);
});

test("truncating the history breaks the head (the recorded head is the content address)", () => {
  const lineage = successionHistory();
  const truncated: PossessionLineage = {
    ...lineage,
    entries: lineage.entries.slice(0, 2),
    // head kept from the full history
  };
  const verification = verifyPossessionLineage(truncated);
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.code, "head-mismatch");
  assert.equal(verification.index, 2);
});

test("a forged link (recomputed for tampered content) breaks against the semantic replay", () => {
  const lineage = successionHistory();
  // the attacker edits entry 1 (P1's release) to claim the possession was
  // never released, recomputes its digest, and re-chains everything after
  // it — locally consistent all the way to the head.
  const editedEntries = lineage.entries.map((entry, index) =>
    index === 1
      ? { ...entry, resultingState: "possessed" as const, releaseReason: undefined }
      : entry,
  );
  const forged = recomputeChain(lineage, editedEntries);
  // every digest and link check passes; the REPLAY catches the lie: a
  // release event produces `released`, never `possessed`.
  const verification = verifyPossessionLineage(forged);
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.code, "illegal-transition");
  assert.equal(verification.index, 1);
  assert.match(verification.detail, /machine produces/u);
});

test("a fully-consistent rewrite passes local verification but CHANGES the head (the honest W028 limit)", () => {
  const lineage = successionHistory();
  const editedEntries = lineage.entries.map((entry, index) =>
    index === 0
      ? { ...entry, recordedAt: (entry.recordedAt + 1) as never }
      : entry,
  );
  const rewritten = recomputeChain(lineage, editedEntries);
  // locally consistent — and that is the honest limit: only comparison
  // against the RECORDED head exposes the rewrite (it changed).
  assert.deepEqual(verifyPossessionLineage(rewritten), { ok: true });
  assert.notEqual(rewritten.head, lineage.head);
});

test("a concurrent possession cannot be recorded (the §12 law, one substrate at a time)", () => {
  const lineage = successionHistory(); // POSSESSION_TWO currently held
  const thirdOutcome = checkPossessionCompatibility(
    possessionOne({ possessionId: "possession-three" as never }),
  );
  assert.equal(thirdOutcome.ok, true);
  const step = extendPossessionLineage(
    lineage,
    possessionOne({ possessionId: "possession-three" as never }),
    { kind: "possess", compatibility: thirdOutcome },
    MUCH_LATER,
  );
  assert.equal(step.ok, false);
  if (step.ok) return;
  assert.equal(step.code, "body-already-possessed");
  assert.match(step.message, /already possessed/u);
  // the no-mutation law
  assert.deepEqual(step.lineage, lineage);
});

test("a FORGED concurrent possession is caught at verification, at the exact index", () => {
  const lineage = successionHistory();
  // forge: a third possession possesses while POSSESSION_TWO is held —
  // digests/links recomputed consistently (the attacker is thorough)
  const third = possessionOne({ possessionId: "possession-three" as never });
  const thirdOutcome = checkPossessionCompatibility(third);
  assert.equal(thirdOutcome.ok, true);
  const core = {
    sequence: 3,
    bodyId: lineage.bodyId,
    worldId: lineage.worldId,
    possessionId: third.possessionId,
    substrateId: third.substrate.substrateId,
    event: { kind: "possess" as const, compatibility: thirdOutcome },
    resultingState: "possessed" as const,
    possessionDigest: possessionDigestOf(third),
    recordedAt: MUCH_LATER,
  };
  const entryDigest = stableDigest(core);
  const previous = lineage.entries[lineage.entries.length - 1]!;
  const entry: PossessionLineageEntry = {
    ...core,
    entryDigest,
    previousEntryDigest: previous.entryDigest,
    chainLink: fnv1aChainHex([previous.chainLink, entryDigest]),
  };
  const forged: PossessionLineage = {
    ...lineage,
    entries: [...lineage.entries, entry],
    head: entry.chainLink,
  };
  const verification = verifyPossessionLineage(forged);
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.code, "concurrent-possession");
  assert.equal(verification.index, 3);
});

test("a changed declaration under the same possession id is refused and caught", () => {
  let lineage = initialPossessionLineage(traderBody());
  const step = extendPossessionLineage(lineage, possessionOne(), compatibleEvent(), AT_START);
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  const rewritten = possessionOne({
    grant: { ...possessionOne().grant, basis: "a quietly rewritten basis" },
  });
  const releaseAttempt = extendPossessionLineage(
    lineage,
    rewritten,
    { kind: "release", reason: "operator-request" },
    LATER,
  );
  assert.equal(releaseAttempt.ok, false);
  if (releaseAttempt.ok) return;
  assert.equal(releaseAttempt.code, "possession-declaration-changed");
  assert.deepEqual(releaseAttempt.lineage, lineage);
});

test("an illegal event is refused with the machine's own code (terminal release)", () => {
  const lineage = successionHistory();
  const firstReleased = extendPossessionLineage(
    lineage,
    possessionOne(), // POSSESSION_ONE is terminal in this history
    { kind: "release", reason: "operator-request" },
    MUCH_LATER,
  );
  assert.equal(firstReleased.ok, false);
  if (firstReleased.ok) return;
  assert.equal(firstReleased.code, "illegal-event");
  assert.equal(firstReleased.transitionCode, "terminal-state");
});

test("a possess event with failing compatibility cannot be recorded (R051 gates the lineage)", () => {
  let lineage = initialPossessionLineage(traderBody());
  const failing = checkPossessionCompatibility(
    possessionOne({ substrate: { ...possessionOne().substrate, commandKinds: ["branch-world"] } }),
  );
  assert.equal(failing.ok, false);
  const step = extendPossessionLineage(
    lineage,
    possessionOne({ substrate: { ...possessionOne().substrate, commandKinds: ["branch-world"] } }),
    { kind: "possess", compatibility: failing },
    AT_START,
  );
  assert.equal(step.ok, false);
  if (step.ok) return;
  assert.equal(step.code, "illegal-event");
  assert.equal(step.transitionCode, "possess-compatibility-failed");
  assert.deepEqual(step.lineage, lineage);
});

test("a descriptor from another body/world is refused (scope mismatch)", () => {
  const lineage = initialPossessionLineage(traderBody());
  const foreign = possessionOne({
    body: traderBody({ bodyId: "body-someone-else" as never }),
  });
  const step = extendPossessionLineage(lineage, foreign, compatibleEvent(), AT_START);
  assert.equal(step.ok, false);
  if (step.ok) return;
  assert.equal(step.code, "lineage-scope-mismatch");
  assert.deepEqual(step.lineage, lineage);
});

test("a non-finite recorded time is refused (declared data, never a clock read)", () => {
  const lineage = initialPossessionLineage(traderBody());
  const step = extendPossessionLineage(
    lineage,
    possessionOne(),
    compatibleEvent(),
    Number.POSITIVE_INFINITY as never,
  );
  assert.equal(step.ok, false);
  if (step.ok) return;
  assert.equal(step.code, "non-finite-time");
});

test("extending a broken chain is refused (never build on unverifiable history)", () => {
  const lineage = successionHistory();
  const tampered: PossessionLineage = {
    ...lineage,
    entries: lineage.entries.map((entry, index) =>
      index === 2 ? { ...entry, recordedAt: (entry.recordedAt + 1) as never } : entry,
    ),
  };
  const outcome = checkPossessionCompatibility(possessionTwo());
  assert.equal(outcome.ok, true);
  const step = extendPossessionLineage(
    tampered,
    possessionTwo(),
    { kind: "release", reason: "operator-request" },
    MUCH_LATER,
  );
  assert.equal(step.ok, false);
  if (step.ok) return;
  assert.equal(step.code, "lineage-not-intact");
  assert.match(step.message, /entry-digest-mismatch/u);
  assert.deepEqual(step.lineage, tampered);
});
