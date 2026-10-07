/**
 * Cross-branch comparison (W025) — typed divergence summaries between
 * sibling counterfactual branches (and against the parent's continuation):
 * per-branch content-addressed digests, the first journal divergence point,
 * and portfolio/position diffs.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the digests are the W016 hashing
 * family (`stableDigest` over engine-side content; `eventStreamDigest` the
 * W004 journal digest), so they are content-addressed and comparable across
 * runs and across worlds.
 *
 * THE DIVERGENCE POINT is defined on WORLD-IDENTITY-NORMALIZED content: a
 * branch journal is stamped throughout with its OWN world id (event ids,
 * entry ids, generated command/turn ids, order/fill/trade ids — the
 * `prefix:world:discriminator` encoder law), so two branches that did the
 * same thing still differ by identity BY CONSTRUCTION (the honest W016
 * sibling semantics). The comparison therefore normalizes each side's
 * canonical serialization by replacing its branch world id (and the parent
 * world id) with neutral tokens — the W016 golden's eventId-substitution
 * precedent, generalized to whole envelopes — and reports the first
 * sequence position whose normalized records tell different stories
 * (content, time, type), or where one journal ends first. The identities
 * applied are disclosed on every result.
 */

import type { EventStreamDigest } from "tradrl-world-contracts/time";
import { eventStreamDigest } from "tradrl-world-contracts/time";
import type { Money, WorldEventEnvelope, WorldId } from "tradrl-world-contracts";
import type { JournalRecord } from "../journal/eventJournal.js";
import { canonicalString, stableDigest } from "../world/hashing.js";
import { serializeWorldState } from "../snapshot/stateCodec.js";
import { financialsOf, financialLedgerOf, projectBalances } from "../account/index.js";
import { isOpenPosition, projectPosition } from "../portfolio/index.js";
import type { CounterfactualBranchHandle } from "./engine.js";

/**
 * Per-branch content-addressed digest: the typed record, the branch
 * definition, the genesis capture, the W004 journal digest and the
 * serialized state — all the W016 hashing family, comparable as values.
 */
export interface CounterfactualBranchDigest {
  readonly worldId: WorldId;
  readonly recordDigest: string;
  readonly definitionDigest: string;
  readonly genesisSnapshotDigest: string;
  readonly journalDigest: EventStreamDigest;
  readonly stateDigest: string;
  readonly eventCount: number;
  readonly simulationTime: number;
}

/** The content digest of a typed counterfactual branch record. */
export function counterfactualRecordDigest(
  record: CounterfactualBranchHandle["record"],
): string {
  return stableDigest(record);
}

/** Digest one live branch (a pure read of its current truth). */
export function branchDigestOf(handle: CounterfactualBranchHandle): CounterfactualBranchDigest {
  const digest = handle.engine.journal.digest();
  return {
    worldId: handle.engine.worldId,
    recordDigest: counterfactualRecordDigest(handle.record),
    definitionDigest: stableDigest(handle.definition),
    genesisSnapshotDigest: handle.record.genesisSnapshotDigest,
    journalDigest: digest,
    stateDigest: stableDigest(serializeWorldState(handle.engine.worldState())),
    eventCount: digest.eventCount,
    simulationTime: handle.engine.clockState().simulationTime,
  };
}

/** One world-identity replacement applied during normalization. */
export interface DivergenceIdentity {
  readonly id: string;
  readonly token: string;
}

/** The record facts at a divergence position (plain values for consumers). */
interface DivergenceRecordFact {
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: number;
}

/** The typed journal divergence between two record sequences. */
export interface JournalDivergence {
  readonly leftCount: number;
  readonly rightCount: number;
  /** Leading records that tell the same story (normalized identity). */
  readonly sharedPrefix: number;
  /** First sequence position where the stories differ (undefined: none). */
  readonly firstDivergentSequence: number | undefined;
  readonly diverged: boolean;
  readonly leftAtDivergence: DivergenceRecordFact | undefined;
  readonly rightAtDivergence: DivergenceRecordFact | undefined;
  /** The identity replacements applied (the honest disclosure). */
  readonly identities: readonly DivergenceIdentity[];
}

/**
 * Recursively drop `sequence` keys from a payload: payload sequences are
 * JOURNAL POSITIONS in the citing world's own journal (the W014 causal
 * chain — `marketRef.sequence` and a fill's own `sequence` cite the trade
 * events that generated them), and a branch's journal restarts at 1 by the
 * one-journal-one-world law. The causal REFERENT stays identified by its
 * (normalized) trade/fill/order ids, which the comparison keys on — no
 * story information is lost. Disclosed: no current W004/W014 payload uses
 * `sequence` for anything but a journal position (pinned by the tests).
 */
function stripJournalPositions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripJournalPositions);
  }
  if (typeof value === "object" && value !== null) {
    const entries: [string, unknown][] = [];
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (key === "sequence") {
        continue;
      }
      entries.push([key, stripJournalPositions(member)]);
    }
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * The STORY PROJECTION of one envelope: everything except the pure
 * identity/position fields (`worldId`, `eventId`, `sequence`, and payload
 * journal positions). A branch's sequences restart at 1 (the
 * one-journal-one-world law) while its parent's continue — the position is
 * the comparison index itself, so dropping the sequence keeps same-story
 * events comparable across worlds. Causation and correlation ids stay
 * (they name the causing command/turn — world-stamped where the encoder
 * law says so, normalized by the identity replacements).
 */
function storyOf(envelope: WorldEventEnvelope): Record<string, unknown> {
  return {
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
    causationId: envelope.causationId,
    correlationId: envelope.correlationId,
    producer: envelope.producer,
    schemaVersion: envelope.schemaVersion,
    payload: stripJournalPositions(envelope.payload),
  };
}

/** Normalize one envelope's story projection by the given identities. */
function normalizedContent(
  envelope: WorldEventEnvelope,
  identities: readonly DivergenceIdentity[],
): string {
  let text = canonicalString(storyOf(envelope));
  for (const { id, token } of [...identities].sort((a, b) => b.id.length - a.id.length)) {
    if (id.length === 0) {
      continue;
    }
    text = text.split(id).join(token);
  }
  return text;
}

function atDivergence(records: readonly JournalRecord[], index: number): DivergenceRecordFact | undefined {
  const record = records[index];
  if (record === undefined) {
    return undefined;
  }
  const envelope = record.envelope;
  return {
    sequence: Number(envelope.sequence),
    eventId: String(envelope.eventId),
    eventType: String(envelope.eventType),
    occurredAt: Number(envelope.occurredAt),
  };
}

/** Compare two record sequences on normalized content (the core law). */
export function journalDivergenceOf(
  leftRecords: readonly JournalRecord[],
  rightRecords: readonly JournalRecord[],
  identities: readonly DivergenceIdentity[],
): JournalDivergence {
  const limit = Math.min(leftRecords.length, rightRecords.length);
  let sharedPrefix = 0;
  while (
    sharedPrefix < limit &&
    normalizedContent(leftRecords[sharedPrefix]!.envelope, identities) ===
      normalizedContent(rightRecords[sharedPrefix]!.envelope, identities)
  ) {
    sharedPrefix += 1;
  }
  const diverged = sharedPrefix < Math.max(leftRecords.length, rightRecords.length);
  const firstDivergentSequence = diverged ? sharedPrefix + 1 : undefined;
  return {
    leftCount: leftRecords.length,
    rightCount: rightRecords.length,
    sharedPrefix,
    firstDivergentSequence,
    diverged,
    leftAtDivergence: diverged ? atDivergence(leftRecords, sharedPrefix) : undefined,
    rightAtDivergence: diverged ? atDivergence(rightRecords, sharedPrefix) : undefined,
    identities,
  };
}

/**
 * The sibling identities: each branch's own world maps to the SAME story
 * token (siblings are peers), the shared parent's world to the parent token
 * (inherited references); different-origin parents get their own tokens so
 * cross-parent comparisons stay honest. Branch ids are longer than (and
 * contain) the parent id — the sort in `normalizedContent` applies them
 * first.
 */
function siblingIdentities(
  left: CounterfactualBranchHandle,
  right: CounterfactualBranchHandle,
): readonly DivergenceIdentity[] {
  const branchToken = "\u0001BRANCH\u0001";
  const identities: DivergenceIdentity[] = [
    { id: String(left.record.branchWorldId), token: branchToken },
    { id: String(right.record.branchWorldId), token: branchToken },
  ];
  if (left.record.parentWorldId === right.record.parentWorldId) {
    identities.push({ id: String(left.record.parentWorldId), token: "\u0001PARENT\u0001" });
  } else {
    identities.push({ id: String(left.record.parentWorldId), token: "\u0001LEFT-PARENT\u0001" });
    identities.push({ id: String(right.record.parentWorldId), token: "\u0001RIGHT-PARENT\u0001" });
  }
  return identities;
}

// --- the portfolio/position diff -------------------------------------------

/** One side of a position comparison (exact decimal text projections). */
export interface PositionSide {
  readonly quantity: string;
  readonly averageEntryPrice: string;
  readonly realizedPnl?: string;
  readonly unrealizedPnl?: string;
}

/** One side of an account comparison (balances + lifetime P&L text). */
export interface AccountSide {
  readonly balances: readonly Money[];
  readonly realizedPnl: string;
  readonly unrealizedPnl: string;
}

/** One (account, instrument) position difference between two worlds. */
export interface BranchPositionDiffEntry {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly change: "added" | "removed" | "changed";
  readonly left?: PositionSide;
  readonly right?: PositionSide;
}

/** One account's financial difference between two worlds. */
export interface BranchAccountDiffEntry {
  readonly accountId: string;
  readonly change: "added" | "removed" | "changed" | "unchanged";
  readonly left?: AccountSide;
  readonly right?: AccountSide;
}

/** The typed portfolio divergence between two worlds. */
export interface PortfolioDivergence {
  readonly positions: readonly BranchPositionDiffEntry[];
  readonly accounts: readonly BranchAccountDiffEntry[];
  readonly identical: boolean;
}

/** The world-state read surface the portfolio projection consumes. */
interface FinancialWorldReader {
  worldState(): {
    readonly financial: import("../account/index.js").FinancialState;
  };
}

/** One world's per-account open positions + financials (engine state read). */
function financialProjection(engine: FinancialWorldReader): Map<string, {
  readonly account: AccountSide;
  readonly positions: ReadonlyMap<string, PositionSide>;
}> {
  const financial = engine.worldState().financial;
  const projection = new Map<string, {
    readonly account: AccountSide;
    readonly positions: ReadonlyMap<string, PositionSide>;
  }>();
  const accountIds = Object.keys(financial.accounts.accounts).sort();
  for (const accountId of accountIds) {
    const financials = financialsOf(financial, accountId);
    const positions = new Map<string, PositionSide>();
    for (const record of financial.portfolio.positions) {
      if (String(record.accountId) !== accountId || !isOpenPosition(record)) {
        continue;
      }
      const projected = projectPosition(record);
      positions.set(String(record.instrumentId), {
        quantity: String(projected.quantity),
        averageEntryPrice: String(projected.averageEntryPrice),
        ...(projected.realizedPnl === undefined
          ? {}
          : { realizedPnl: String(projected.realizedPnl.amount) }),
        ...(projected.unrealizedPnl === undefined
          ? {}
          : { unrealizedPnl: String(projected.unrealizedPnl.amount) }),
      });
    }
    projection.set(accountId, {
      account: {
        balances: projectBalances(financialLedgerOf(financial, accountId)),
        realizedPnl: String(financials.realizedPnl),
        unrealizedPnl: String(financials.unrealizedPnl),
      },
      positions,
    });
  }
  return projection;
}

/** Compare two worlds' portfolios (positions + per-account financials). */
function portfolioDivergenceOf(
  left: FinancialWorldReader,
  right: FinancialWorldReader,
): PortfolioDivergence {
  const leftProjection = financialProjection(left);
  const rightProjection = financialProjection(right);

  const positions: BranchPositionDiffEntry[] = [];
  const positionKeys = new Set<string>();
  for (const [accountId, entry] of leftProjection) {
    for (const instrumentId of entry.positions.keys()) {
      positionKeys.add(`${accountId}\u0000${instrumentId}`);
    }
  }
  for (const [accountId, entry] of rightProjection) {
    for (const instrumentId of entry.positions.keys()) {
      positionKeys.add(`${accountId}\u0000${instrumentId}`);
    }
  }
  for (const key of [...positionKeys].sort()) {
    const separator = key.indexOf("\u0000");
    const accountId = key.slice(0, separator);
    const instrumentId = key.slice(separator + 1);
    const leftSide = leftProjection.get(accountId)?.positions.get(instrumentId);
    const rightSide = rightProjection.get(accountId)?.positions.get(instrumentId);
    if (leftSide === undefined && rightSide === undefined) {
      continue;
    }
    if (
      leftSide !== undefined &&
      rightSide !== undefined &&
      canonicalString(leftSide) === canonicalString(rightSide)
    ) {
      continue; // identical open positions are not a divergence
    }
    positions.push({
      accountId,
      instrumentId,
      change: leftSide === undefined ? "added" : rightSide === undefined ? "removed" : "changed",
      ...(leftSide === undefined ? {} : { left: leftSide }),
      ...(rightSide === undefined ? {} : { right: rightSide }),
    });
  }

  const accountIds = [...new Set([...leftProjection.keys(), ...rightProjection.keys()])].sort();
  const accounts: BranchAccountDiffEntry[] = [];
  for (const accountId of accountIds) {
    const leftSide = leftProjection.get(accountId)?.account;
    const rightSide = rightProjection.get(accountId)?.account;
    const change =
      leftSide === undefined
        ? "added"
        : rightSide === undefined
          ? "removed"
          : canonicalString(leftSide) === canonicalString(rightSide)
            ? "unchanged"
            : "changed";
    accounts.push({
      accountId,
      change,
      ...(leftSide === undefined ? {} : { left: leftSide }),
      ...(rightSide === undefined ? {} : { right: rightSide }),
    });
  }

  return {
    positions,
    accounts,
    identical: positions.length === 0 && accounts.every((entry) => entry.change === "unchanged"),
  };
}

// --- the public summaries ---------------------------------------------------

/** The origin facts two branches share (undefined: different origins). */
export interface SharedBranchOrigin {
  readonly parentWorldId: WorldId;
  readonly sourceSnapshotId: string;
  readonly snapshotDigest: string;
  readonly branchPointSequence: number;
  readonly branchPointTime: number;
}

/** The typed divergence summary between two sibling branches. */
export interface BranchDivergenceSummary {
  readonly left: CounterfactualBranchDigest;
  readonly right: CounterfactualBranchDigest;
  readonly sharedOrigin: SharedBranchOrigin | undefined;
  readonly journal: JournalDivergence;
  readonly portfolio: PortfolioDivergence;
}

/**
 * Compare two counterfactual branches: per-branch digests, the shared
 * origin (when both forked the same parent snapshot), the first journal
 * divergence point (world-identity normalized) and the portfolio diff.
 */
export function compareCounterfactualBranches(
  left: CounterfactualBranchHandle,
  right: CounterfactualBranchHandle,
): BranchDivergenceSummary {
  const sharedOrigin: SharedBranchOrigin | undefined =
    left.record.sourceSnapshotId === right.record.sourceSnapshotId &&
    left.record.snapshotDigest === right.record.snapshotDigest
      ? {
          parentWorldId: left.record.parentWorldId,
          sourceSnapshotId: String(left.record.sourceSnapshotId),
          snapshotDigest: left.record.snapshotDigest,
          branchPointSequence: left.record.branchPointSequence,
          branchPointTime: Number(left.record.branchPointTime),
        }
      : undefined;
  return {
    left: branchDigestOf(left),
    right: branchDigestOf(right),
    sharedOrigin,
    journal: journalDivergenceOf(
      left.engine.journal.records(),
      right.engine.journal.records(),
      siblingIdentities(left, right),
    ),
    portfolio: portfolioDivergenceOf(left.engine, right.engine),
  };
}

/** The typed divergence of a branch against its parent's continuation. */
export interface ParentContinuationDivergence {
  readonly branch: CounterfactualBranchDigest;
  readonly parentWorldId: WorldId;
  /** The parent's journal records AFTER the branch-point snapshot event. */
  readonly parentContinuationCount: number;
  /** The W004 digest of the parent's continuation records. */
  readonly parentContinuationDigest: EventStreamDigest;
  /** The parent sequence the branch's sequence 1 aligns with. */
  readonly parentContinuationFromSequence: number;
  readonly branchPoint: { readonly sequence: number; readonly time: number };
  /** Branch records vs parent continuation records (aligned at the branch point). */
  readonly journal: JournalDivergence;
  readonly portfolio: PortfolioDivergence;
}

/**
 * Compare a counterfactual branch against its parent's continuation: the
 * parent's records AFTER the branch-point snapshot event against the
 * branch's own records, sequence-aligned at the branch point and compared
 * on world-identity-normalized STORIES (peer semantics: the branch IS the
 * parent's counterfactual continuation, so both worlds' own entity ids map
 * to the same token — a same-seed control branch that reproduces the
 * parent's market compares EQUAL, and any divergence is a real story
 * difference).
 *
 * The branch-point snapshot event itself (the parent record at sequence
 * branchPoint+1, which the branch never mirrors) is EXCLUDED from the
 * continuation slice — the branch's timeline starts after the parent took
 * the snapshot. `parentContinuationFromSequence` discloses the alignment.
 */
export function compareBranchWithParentContinuation(
  parent: {
    readonly worldId: WorldId;
    readonly journal: { records(): readonly JournalRecord[] };
    worldState(): { readonly financial: import("../account/index.js").FinancialState };
  },
  branch: CounterfactualBranchHandle,
): ParentContinuationDivergence {
  const parentRecords = parent.journal.records();
  const cursor = branch.record.branchPointSequence;
  const continuation = parentRecords.slice(cursor + 1);
  // PEER semantics: the branch is the counterfactual CONTINUATION of its
  // parent — the branch's own entities and the parent's own entities are
  // peers of the same story, so both world ids map to the SAME token (the
  // branch id is longer and contains the parent id — sorted first).
  const worldToken = "\u0001WORLD\u0001";
  const identities: readonly DivergenceIdentity[] = [
    { id: String(branch.record.branchWorldId), token: worldToken },
    { id: String(branch.record.parentWorldId), token: worldToken },
  ];
  return {
    branch: branchDigestOf(branch),
    parentWorldId: parent.worldId,
    parentContinuationCount: continuation.length,
    parentContinuationDigest: eventStreamDigest(continuation.map((record) => record.envelope)),
    parentContinuationFromSequence: cursor + 2,
    branchPoint: {
      sequence: cursor,
      time: Number(branch.record.branchPointTime),
    },
    journal: journalDivergenceOf(
      continuation,
      branch.engine.journal.records(),
      identities,
    ),
    portfolio: portfolioDivergenceOf(parent, branch.engine),
  };
}
