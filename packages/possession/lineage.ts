/**
 * The possession lineage (W034): a body's possession history as an
 * ordered, content-addressed chain — the W028 digest-chain discipline
 * applied to the possession relation.
 *
 * Spec: spec/ARCHITECTURE.md §12 — a body's possession history is part of
 * what the composed agent IS; this module makes it verifiable data.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the same events in
 * the same order ALWAYS produce the same chain, bit-for-bit (no wall
 * time, no randomness; `recordedAt` is declared data).
 *
 * Shape (content-addressed at every level, using the W016 hashing family
 * — canonical JSON + FNV-1a, `tradrl-world-sim/world` `stableDigest` /
 * `fnv1aChainHex` — so digests agree with the engine's own content
 * addressing):
 * - `possessionDigestOf(descriptor)` — the content digest of the WHOLE
 *   possession declaration; every lineage entry commits to it, so any
 *   later edit of a declaration breaks the chain;
 * - the lineage ANCHOR — the digest of the body identity the history
 *   belongs to (the W028 `inventoryDigest` precedent);
 * - `entryDigest` — the digest of one entry's own core (identity, event,
 *   resulting state, declaration digest, declared time);
 * - `chainLink` — `fnv1aChainHex([previousLink, entryDigest])`: each
 *   record CITES ITS PREDECESSOR; the first link is anchored at the
 *   lineage anchor;
 * - `head` — the last link (or the anchor for an empty history): the
 *   content address of this history.
 *
 * `verifyPossessionLineage` recomputes everything locally — tamper
 * evidence: an edited entry, a swapped or renumbered record, a truncated
 * or forged head, a semantically impossible event sequence (an event the
 * lifecycle machine would refuse, two possessions held at once, a
 * rewritten declaration under the same id) is caught at the exact index.
 * The honest limit (the W028 law): an attacker who rewrites an entry AND
 * recomputes every downstream digest and the head produces a locally
 * consistent chain — detectable against any RECORDED head (the head is
 * the content address; it changes), never by local inspection alone.
 *
 * Building: `extendPossessionLineage` refuses to record an illegal event
 * (the machine is the authority), refuses a second concurrent possession
 * of the same body (one substrate at a time — the §12 law), refuses a
 * changed declaration under the same possession id, and refuses to build
 * on a lineage that does not verify (fail-closed).
 */

import type { BodyDescriptor, BodyId } from "tradrl-world-contracts/agentBody";
import type { TimestampMs, WorldId } from "tradrl-world-contracts";
import { fnv1aChainHex, stableDigest } from "tradrl-world-sim/world";
import type {
  ActivePossessionQuery,
  PossessionDescriptor,
  PossessionEvent,
  PossessionHistoryQuery,
  PossessionLineage,
  PossessionLineageEntry,
  PossessionLineageErrorCode,
  PossessionLineageExtension,
  PossessionLineageVerification,
  PossessionRecord,
  PossessionState,
  PossessionTransitionErrorCode,
} from "./contracts.js";
import { initialPossessionRecord, transitionPossession } from "./lifecycle.js";

/** The content digest of one possession declaration (the W016 hashing family). */
export function possessionDigestOf(descriptor: PossessionDescriptor): string {
  return stableDigest(descriptor);
}

/**
 * The lineage anchor: the content digest of the body identity a history
 * belongs to (the W028 inventory-anchor precedent — the first chain link
 * cites it, and the empty lineage's head IS it).
 */
export function lineageAnchorOf(body: {
  readonly bodyId: BodyId;
  readonly worldId: WorldId;
}): string {
  return stableDigest({
    kind: "possession-lineage",
    bodyId: body.bodyId,
    worldId: body.worldId,
  });
}

/** The empty lineage for one body: no entries, head = the anchor. */
export function initialPossessionLineage(body: BodyDescriptor): PossessionLineage {
  return {
    bodyId: body.bodyId,
    worldId: body.scope.worldId,
    entries: [],
    head: lineageAnchorOf({ bodyId: body.bodyId, worldId: body.scope.worldId }),
  };
}

/** The digest-covered core of one entry (every field except the three chain fields). */
function entryCoreOf(entry: PossessionLineageEntry): Record<string, unknown> {
  const core: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key !== "entryDigest" && key !== "previousEntryDigest" && key !== "chainLink") {
      core[key] = value;
    }
  }
  return core;
}

/** The initial record for a possession seen only through a lineage entry. */
function freshRecordOf(entry: PossessionLineageEntry): PossessionRecord {
  return {
    possessionId: entry.possessionId,
    bodyId: entry.bodyId,
    substrateId: entry.substrateId,
    worldId: entry.worldId,
    state: "unpossessed",
  };
}

/** The replayed state of every possession in a lineage + which (if any) is held. */
interface LineageReplay {
  /** Per-possession records keyed by possession id (string identity). */
  readonly records: ReadonlyMap<string, PossessionRecord>;
  /** The possession currently held, and since which sequence. */
  readonly active: { readonly possessionId: PossessionLineageEntry["possessionId"]; readonly sinceSequence: number } | undefined;
  /** First entry whose event the machine refuses (forged history). */
  readonly firstRefusal: { readonly index: number; readonly code: PossessionTransitionErrorCode; readonly message: string } | undefined;
  /** First successful possess while another possession was held (the §12 law). */
  readonly firstConcurrent: { readonly index: number; readonly possessionId: PossessionLineageEntry["possessionId"]; readonly heldBy: PossessionLineageEntry["possessionId"] } | undefined;
  /** First entry that re-declares an existing possession under a different digest. */
  readonly firstDeclarationChange: { readonly index: number } | undefined;
  /** First entry whose claimed resulting state is not what the machine produces. */
  readonly firstStateMismatch: { readonly index: number; readonly claimed: PossessionState; readonly replayed: PossessionState } | undefined;
}

/** Replay a lineage's entries through the lifecycle machine (pure; never throws). */
function replayLineage(lineage: PossessionLineage): LineageReplay {
  const records = new Map<string, PossessionRecord>();
  const digests = new Map<string, string>();
  let active: LineageReplay["active"];
  let firstRefusal: LineageReplay["firstRefusal"];
  let firstConcurrent: LineageReplay["firstConcurrent"];
  let firstDeclarationChange: LineageReplay["firstDeclarationChange"];
  let firstStateMismatch: LineageReplay["firstStateMismatch"];

  for (const [index, entry] of lineage.entries.entries()) {
    const key = String(entry.possessionId);
    const record = records.get(key) ?? freshRecordOf(entry);
    if (digests.get(key) !== undefined && digests.get(key) !== entry.possessionDigest) {
      firstDeclarationChange ??= { index };
    }
    digests.set(key, entry.possessionDigest);
    const result = transitionPossession(record, entry.event);
    if (!result.ok) {
      firstRefusal ??= { index, code: result.code, message: result.message };
      continue;
    }
    if (
      result.record.state !== entry.resultingState ||
      result.record.releaseReason !== entry.releaseReason
    ) {
      firstStateMismatch ??= { index, claimed: entry.resultingState, replayed: result.record.state };
      continue;
    }
    if (
      entry.event.kind === "possess" &&
      active !== undefined &&
      String(active.possessionId) !== key
    ) {
      firstConcurrent ??= { index, possessionId: entry.possessionId, heldBy: active.possessionId };
    }
    records.set(key, result.record);
    if (result.record.state === "possessed") {
      active = { possessionId: entry.possessionId, sinceSequence: entry.sequence };
    } else if (active !== undefined && String(active.possessionId) === key) {
      active = undefined;
    }
  }
  return { records, active, firstRefusal, firstConcurrent, firstDeclarationChange, firstStateMismatch };
}

/**
 * Append one possession event to a body's lineage. Fail-closed and pure:
 * every refusal carries the lineage UNCHANGED. The entry commits to the
 * full possession declaration, the event, the machine's resulting state
 * and the declared time — and cites its predecessor through the chain
 * link.
 */
export function extendPossessionLineage(
  lineage: PossessionLineage,
  descriptor: PossessionDescriptor,
  event: PossessionEvent,
  recordedAt: TimestampMs,
): PossessionLineageExtension {
  const refuse = (
    code: PossessionLineageErrorCode,
    message: string,
    transitionCode?: PossessionTransitionErrorCode,
  ): PossessionLineageExtension => ({
    ok: false,
    code,
    message,
    ...(transitionCode === undefined ? {} : { transitionCode }),
    lineage,
  });

  if (
    descriptor.body.bodyId !== lineage.bodyId ||
    descriptor.body.scope.worldId !== lineage.worldId
  ) {
    return refuse(
      "lineage-scope-mismatch",
      `the descriptor binds body ${String(descriptor.body.bodyId)} in world ${String(descriptor.body.scope.worldId)}, but this lineage is body ${String(lineage.bodyId)} in world ${String(lineage.worldId)}`,
    );
  }
  if (!Number.isFinite(recordedAt)) {
    return refuse(
      "non-finite-time",
      `recordedAt must be a finite declared time (got '${String(recordedAt)}')`,
    );
  }

  // Fail-closed: never build on a chain that does not verify.
  const intact = verifyPossessionLineage(lineage);
  if (!intact.ok) {
    return refuse(
      "lineage-not-intact",
      `the lineage being extended fails verification at index ${String(intact.index)} (${intact.code}: ${intact.detail}) — refusing to build on a broken chain`,
    );
  }

  const possessionId = String(descriptor.possessionId);
  const digest = possessionDigestOf(descriptor);
  const history = lineage.entries.filter((entry) => String(entry.possessionId) === possessionId);
  if (history.some((entry) => entry.possessionDigest !== digest)) {
    return refuse(
      "possession-declaration-changed",
      `possession ${possessionId} is already in this lineage under a different declaration — a changed declaration is a NEW possession (a new possessionId), never a rewrite`,
    );
  }

  const replay = replayLineage(lineage);
  // The §12 law: one substrate possesses a body at a time.
  if (
    event.kind === "possess" &&
    replay.active !== undefined &&
    String(replay.active.possessionId) !== possessionId
  ) {
    return refuse(
      "body-already-possessed",
      `body ${String(lineage.bodyId)} is already possessed by ${String(replay.active.possessionId)} (since sequence ${String(replay.active.sinceSequence)}) — one substrate at a time; release it first`,
    );
  }

  const current: PossessionRecord =
    replay.records.get(possessionId) ?? initialPossessionRecord(descriptor);
  const result = transitionPossession(current, event);
  if (!result.ok) {
    return refuse(
      "illegal-event",
      `the lifecycle machine refuses this event for possession ${possessionId}: ${result.message}`,
      result.code,
    );
  }

  const previous = lineage.entries[lineage.entries.length - 1];
  const core = {
    sequence: lineage.entries.length,
    bodyId: lineage.bodyId,
    worldId: lineage.worldId,
    possessionId: descriptor.possessionId,
    substrateId: descriptor.substrate.substrateId,
    event,
    resultingState: result.record.state,
    ...(result.record.releaseReason === undefined
      ? {}
      : { releaseReason: result.record.releaseReason }),
    possessionDigest: digest,
    recordedAt,
  };
  const entryDigest = stableDigest(core);
  const chainLink = fnv1aChainHex([previous?.chainLink ?? lineage.head, entryDigest]);
  const entry: PossessionLineageEntry = {
    ...core,
    entryDigest,
    previousEntryDigest: previous?.entryDigest ?? null,
    chainLink,
  };
  return {
    ok: true,
    lineage: {
      ...lineage,
      entries: [...lineage.entries, entry],
      head: chainLink,
    },
  };
}

/**
 * The active possession of a lineage's body, if any (a pure read of the
 * declared history; `verifyPossessionLineage` is the integrity authority).
 */
export function activePossessionOf(lineage: PossessionLineage): ActivePossessionQuery {
  let active: { possessionId: PossessionLineageEntry["possessionId"]; sinceSequence: number } | undefined;
  for (const entry of lineage.entries) {
    if (entry.resultingState === "possessed") {
      active = { possessionId: entry.possessionId, sinceSequence: entry.sequence };
    } else if (active !== undefined && String(active.possessionId) === String(entry.possessionId)) {
      active = undefined;
    }
  }
  return active === undefined
    ? { ok: false, code: "no-active-possession" }
    : { ok: true, possessionId: active.possessionId, sinceSequence: active.sinceSequence };
}

/** One possession's entries from a lineage, in order (typed unknown-possession). */
export function possessionHistoryOf(
  lineage: PossessionLineage,
  possessionId: PossessionLineageEntry["possessionId"],
): PossessionHistoryQuery {
  const entries = lineage.entries.filter(
    (entry) => String(entry.possessionId) === String(possessionId),
  );
  return entries.length === 0
    ? { ok: false, code: "unknown-possession" }
    : { ok: true, entries };
}

/**
 * Recompute the whole chain from a lineage's own entries — local tamper
 * evidence (see module doc): digests, links, the head, and the SEMANTIC
 * replay (every event must be one the machine would accept; the claimed
 * resulting states must be what the machine produces; one possession at
 * a time; one declaration per possession id). Pure; never throws.
 */
export function verifyPossessionLineage(lineage: PossessionLineage): PossessionLineageVerification {
  const anchor = lineageAnchorOf({
    bodyId: lineage.bodyId,
    worldId: lineage.worldId,
  });

  let previousLink = anchor;
  let previousEntryDigest: string | null = null;
  for (const [index, entry] of lineage.entries.entries()) {
    if (entry.sequence !== index) {
      return {
        ok: false,
        code: "sequence-mismatch",
        index,
        detail: `entry at position ${String(index)} carries sequence ${String(entry.sequence)} — the history is ordered, renumbering breaks it`,
      };
    }
    if (entry.bodyId !== lineage.bodyId || entry.worldId !== lineage.worldId) {
      return {
        ok: false,
        code: "body-mismatch",
        index,
        detail: `entry at position ${String(index)} names body ${String(entry.bodyId)} in world ${String(entry.worldId)}, not this lineage's body ${String(lineage.bodyId)} in ${String(lineage.worldId)}`,
      };
    }
    const expectedEntryDigest = stableDigest(entryCoreOf(entry));
    if (expectedEntryDigest !== entry.entryDigest) {
      return {
        ok: false,
        code: "entry-digest-mismatch",
        index,
        detail: `entry digest at position ${String(index)} (possession ${String(entry.possessionId)}) does not match its own content — the record was edited after the fact`,
      };
    }
    if (entry.previousEntryDigest !== previousEntryDigest) {
      return {
        ok: false,
        code: "link-mismatch",
        index,
        detail: `entry at position ${String(index)} cites predecessor digest ${String(entry.previousEntryDigest)}, not the actual predecessor ${String(previousEntryDigest)}`,
      };
    }
    const expectedLink = fnv1aChainHex([previousLink, entry.entryDigest]);
    if (expectedLink !== entry.chainLink) {
      return {
        ok: false,
        code: "link-mismatch",
        index,
        detail: `chain link at position ${String(index)} does not follow from ${previousLink}`,
      };
    }
    previousLink = entry.chainLink;
    previousEntryDigest = entry.entryDigest;
  }

  const expectedHead = lineage.entries.length === 0
    ? anchor
    : lineage.entries[lineage.entries.length - 1]!.chainLink;
  if (lineage.head !== expectedHead) {
    return {
      ok: false,
      code: "head-mismatch",
      index: lineage.entries.length,
      detail: `lineage head ${lineage.head} is not the recomputed head ${expectedHead} — the chain was truncated or the head was forged`,
    };
  }

  const replay = replayLineage(lineage);
  if (replay.firstDeclarationChange !== undefined) {
    const at = replay.firstDeclarationChange.index;
    return {
      ok: false,
      code: "possession-declaration-changed",
      index: at,
      detail: `entry at position ${String(at)} re-declares possession ${String(lineage.entries[at]?.possessionId)} under a different declaration digest`,
    };
  }
  if (replay.firstRefusal !== undefined) {
    const at = replay.firstRefusal.index;
    return {
      ok: false,
      code: "illegal-transition",
      index: at,
      detail: `entry at position ${String(at)} records an event the lifecycle machine refuses (${replay.firstRefusal.code}: ${replay.firstRefusal.message})`,
    };
  }
  if (replay.firstStateMismatch !== undefined) {
    const at = replay.firstStateMismatch.index;
    return {
      ok: false,
      code: "illegal-transition",
      index: at,
      detail: `entry at position ${String(at)} claims resulting state '${replay.firstStateMismatch.claimed}' but the machine produces '${replay.firstStateMismatch.replayed}'`,
    };
  }
  if (replay.firstConcurrent !== undefined) {
    const at = replay.firstConcurrent.index;
    return {
      ok: false,
      code: "concurrent-possession",
      index: at,
      detail: `entry at position ${String(at)} possesses body ${String(lineage.bodyId)} with ${String(replay.firstConcurrent.possessionId)} while ${String(replay.firstConcurrent.heldBy)} still holds it — one substrate at a time (§12)`,
    };
  }

  return { ok: true };
}
