/**
 * The W019 golden journey — the frozen facts contract (suite helper, not a
 * test file). Split from goldenJourney.helpers.ts for the 400-line lint law;
 * the code is verbatim — see that file's journey docstring for the
 * methodology.
 */

import { alphaWorldDefinition } from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";

/** The golden world identity (seed = `alpha:world-w019-golden`). */
export const GOLDEN_WORLD_ID = "world-w019-golden";
/** Simulation origin of the alpha definition (2023-11-14T22:13:20Z). */
export const SIM_START = 1_700_000_000_000;
/** One simulation minute. */
export const MIN = 60_000;
/** The golden instrument (the alpha definition's only instrument). */
export const GOLDEN_INSTRUMENT_ID = `instrument-es-${GOLDEN_WORLD_ID}`;
/** The human trader's account + participant (the alpha definition). */
export const GOLDEN_ACCOUNT_ID = `account-trader-${GOLDEN_WORLD_ID}`;
export const GOLDEN_PARTICIPANT_ID = `participant-trader-${GOLDEN_WORLD_ID}`;

/** A wall-time source fixed at an arbitrary origin (determinism runs). */
export function fixedWallSource(at: number): () => number {
  return () => at;
}

/**
 * The per-stage facts the golden tests assert on. Everything is data read
 * from the REAL attached client (the same ports the surfaces consume) — the
 * tests derive the surface models from these and cross-check them.
 */
export interface GoldenJourneyFacts {
  readonly worldId: string;
  /** S0 — the world origin (before any clock advance). */
  readonly s0: {
    readonly clock: { simulationTime: number; status: string; speed: number };
    readonly bidLevels: number;
    readonly askLevels: number;
    readonly regimeAnnouncements: number;
  };
  /** S1 — after the first 10s step: the seeded market. */
  readonly s1: {
    readonly quote: Record<string, unknown>;
    readonly book: Record<string, unknown>;
    readonly trades: readonly Record<string, unknown>[];
    readonly regimes: readonly { at: number; to: string; parameters?: unknown }[];
  };
  /** S2 — the marketable buys (complete + partial fill). */
  readonly s2: {
    readonly buy1Ack: Record<string, unknown>;
    readonly buy19Ack: Record<string, unknown>;
    readonly quote: Record<string, unknown>;
    readonly askTop: readonly unknown[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S3 — the resting sell high + resting buy deep. */
  readonly s3: {
    readonly sellAck: Record<string, unknown>;
    readonly deepAck: Record<string, unknown>;
    readonly asks12: readonly unknown[];
    readonly bidsAtOrBelow4792: readonly unknown[];
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S5 — cancel of the partial remainder. */
  readonly s5: {
    readonly cancelAck: Record<string, unknown>;
    readonly canceledOrder: Record<string, unknown>;
    readonly askTop: readonly unknown[];
    readonly portfolio: Record<string, unknown>;
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S6 — replace of the resting sell (4802.25 → 4801.75). */
  readonly s6: {
    readonly replaceAck: Record<string, unknown>;
    readonly asksAtOrAbove4801: readonly unknown[];
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S7 — typed rejections (engine VALUES, not wire errors). */
  readonly s7: {
    readonly fokRejection: Record<string, unknown>;
    readonly unknownCancelRejection: Record<string, unknown>;
  };
  /** S10 — the mean-reversion dwell scan (when the replaced sell fills). */
  readonly s10: {
    readonly scan: readonly { readonly atMs: number; readonly sell: string; readonly deep: string }[];
    readonly sellFilledAtMs: number;
    readonly trades: number;
    readonly lastTrades: readonly Record<string, unknown>[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly quote: Record<string, unknown>;
  };
  /** S11 — the trend regime (when the deep resting buy fills). */
  readonly s11: {
    readonly scan: readonly {
      readonly atMs: number;
      readonly quote: Record<string, unknown>;
      readonly deep: string;
      readonly deepFilled: string;
    }[];
    readonly deepFilledAtMs: number;
    readonly regimes: readonly { to: string }[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly risk: Record<string, unknown>;
  };
  /** S12/S13/S14 — the HV, LL and closing-MR boundary crossings. */
  readonly s12: {
    readonly quote: Record<string, unknown>;
    readonly trades: number;
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly regimes: readonly { to: string }[];
  };
  readonly s13: { readonly quote: Record<string, unknown>; readonly trades: number; readonly regimes: readonly { to: string }[] };
  readonly s14: {
    readonly quote: Record<string, unknown>;
    readonly trades: number;
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly regimes: readonly { to: string }[];
  };
  /** S15 — clock ops (play/speed/pause/step) + the jump A8 refusal. */
  readonly s15: {
    readonly play: Record<string, unknown>;
    readonly speed2: Record<string, unknown>;
    readonly pause: Record<string, unknown>;
    readonly step: Record<string, unknown>;
    readonly jumpError: string;
  };
  /** S16 — the A8 backward-seek refusal, surfaced verbatim. */
  readonly s16: {
    readonly rewindError: string;
    readonly clockAfter: Record<string, unknown>;
  };
  /** S17 — snapshot + branch + lineage + parent immutability. */
  readonly s17: {
    readonly snapshotAck: Record<string, unknown>;
    readonly branchAck: Record<string, unknown>;
    readonly branchEvent: Record<string, unknown>;
    readonly childLineage: readonly Record<string, unknown>[];
    readonly selfLineage: readonly unknown[];
    readonly snapshotDescriptor: Record<string, unknown>;
    readonly snapshotDescriptorAfterParentMutation: Record<string, unknown>;
  };
  /** S18 — the end state: report, manifest, evidence, published stream. */
  readonly s18: {
    readonly report: Record<string, unknown>;
    readonly manifest: Record<string, unknown>;
    readonly evidenceEvents: number;
    readonly hiddenEventCount: number;
    readonly firstEvent: Record<string, unknown>;
    readonly lastEvent: Record<string, unknown>;
    readonly provenance: Record<string, unknown>;
    readonly timelineEvents: number;
    readonly publishedBatches: number;
    readonly publishedEvents: number;
    readonly clockViews: number;
    readonly finalClock: Record<string, unknown>;
  };
  /** Raw end-state reads for the surface cross-checks (ACCEPTANCE F). */
  readonly endState: {
    readonly quote: Record<string, unknown>;
    readonly book: Record<string, unknown>;
    readonly trades: readonly Record<string, unknown>[];
    readonly orders: readonly Record<string, unknown>[];
    readonly ourOrders: readonly Record<string, unknown>[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly risk: Record<string, unknown>;
    readonly regimes: readonly { at: number; to: string }[];
    readonly meta: Record<string, unknown>;
    readonly fillEvents: readonly Record<string, unknown>[];
  };
}

/** Input for {@link runGoldenJourney}. */
export interface GoldenJourneyInput {
  /**
   * Wall-axis source for the composed attachment (the W019 disclosed seam).
   * Default: the transport's own host clock — the production path.
   */
  readonly wallTimeSource?: () => number;
}

/**
 * Run the golden journey against a FRESH composed alpha attachment and
 * return every pinned fact. Disposes the client before resolving.
 */
/** The alpha definition of the golden world (imported for definition-level assertions). */
export { alphaWorldDefinition };
