/**
 * W020 dataset-descriptor building (W026 `tradrl-adapters-crypto`).
 *
 * Turns a mapped, event-time-ordered record batch + its provider/feed
 * declarations into a W020 `DatasetDescriptor` that feeds
 * `loadHistoricalDataset` directly (spec/WORK-ITEMS.md W026 — "maps real
 * exchange market data into the W020 dataset/import surfaces").
 *
 * Honesty laws:
 * - the range is DERIVED from the records (min/max extent) — computed, not
 *   claimed, so it can never overstate the data;
 * - bar-sequence holes are DETECTED (a bar whose open time skips past the
 *   previous same-symbol close) and declared as known gaps — an honest
 *   declaration of what the batch does not cover, never an invention. A
 *   hole is only detectable per symbol; multi-symbol batches skip detection
 *   and say so in the limitations (documented feed batches are
 *   single-symbol by construction — one REST request, one symbol);
 * - the limitations carry the provider's declared known gaps verbatim, plus
 *   the baseline's own disclosure (fixture-recorded batch, no live IO).
 */

import type { DeterminismDeclaration, TimestampMs } from "tradrl-world-contracts";
import type {
  DatasetDescriptor,
  DatasetGap,
  DatasetId,
  HistoricalRecord,
} from "tradrl-world-contracts/data";
import { historicalRecordEventTime, historicalRecordExtent } from "tradrl-data";
import type { CryptoFeedDescriptor, CryptoProviderDescriptor } from "./providers.js";
import { isNonBlank } from "./symbols.js";

/** Everything needed to build the W020 descriptor of one mapped batch. */
export interface CryptoDatasetContext {
  readonly provider: CryptoProviderDescriptor;
  readonly feed: CryptoFeedDescriptor;
  /** Mapped records in event-time order (the batch mapper's output). */
  readonly records: readonly HistoricalRecord[];
  /** Honest scale label (e.g. "1m" for bars; "tick" for trade/quote feeds). */
  readonly granularity: string;
  /** Default: `{ kind: "deterministic" }` (fixture-recorded batches are). */
  readonly determinism?: DeterminismDeclaration;
  /** Override for the derived dataset id. */
  readonly datasetId?: DatasetId;
}

/** The honest interchange-format label of a feed's output kind. */
function formatLabelOf(feed: CryptoFeedDescriptor): string {
  if (feed.outputKind === "bar") return "ohlcv-bars";
  if (feed.outputKind === "trade") return "trade-prints";
  if (feed.outputKind === "quote") return "top-of-book-quotes";
  return "unmappable";
}

/**
 * Deterministic dataset id of one batch: derived from (provider, feed, the
 * batch's event-time span) — the same batch always yields the same id, and
 * two batches of the same feed with different spans never collide.
 */
export function deriveCryptoDatasetId(
  provider: CryptoProviderDescriptor,
  feed: CryptoFeedDescriptor,
  records: readonly HistoricalRecord[],
): DatasetId {
  if (records.length === 0) {
    return `crypto:${provider.providerId}:${feed.feedId}:empty` as DatasetId;
  }
  const first = historicalRecordEventTime(records[0]!);
  const last = historicalRecordEventTime(records[records.length - 1]!);
  return `crypto:${provider.providerId}:${feed.feedId}:${String(first)}-${String(last)}` as DatasetId;
}

/**
 * Detect bar-sequence holes: same-symbol bars whose interval leaves a gap
 * between the previous close and the next open. Deterministic; only runs
 * for single-symbol batches (returns an empty list and relies on the
 * limitation note for multi-symbol batches — see `buildCryptoDatasetDescriptor`).
 */
export function detectBarHoles(records: readonly HistoricalRecord[]): readonly DatasetGap[] {
  const gaps: DatasetGap[] = [];
  const symbols = new Set(records.map((record) => record.symbol));
  if (symbols.size > 1) {
    return gaps;
  }
  let previousClose: TimestampMs | undefined;
  for (const record of records) {
    if (record.kind !== "bar") {
      continue;
    }
    if (previousClose !== undefined && record.openTime > previousClose) {
      gaps.push({
        from: previousClose,
        to: record.openTime,
        reason:
          "no bar covers this interval in the provider batch (adapter-detected sequence hole — declared, not invented)",
      });
    }
    previousClose = record.closeTime;
  }
  return gaps;
}

/**
 * Build the W020 `DatasetDescriptor` of one mapped batch. Pure: derived
 * only from the context (provider/feed declarations + the records' own
 * fields). The determinism default is `deterministic` — honest for a
 * fixture-recorded batch (this baseline performs no live acquisition);
 * callers importing live-polled batches must declare their sources (A9).
 */
export function buildCryptoDatasetDescriptor(context: CryptoDatasetContext): DatasetDescriptor {
  const { provider, feed, records } = context;
  if (feed.outputKind === "unmappable") {
    // Belt and braces: the batch engine rejects unmappable feeds before
    // ever building a descriptor — reaching here is an internal bug.
    throw new Error(
      `internal invariant: cannot build a dataset descriptor for the unmappable feed '${feed.feedId}'`,
    );
  }
  const multiSymbol = new Set(records.map((record) => record.symbol)).size > 1;
  const limitations = [
    ...provider.fidelity.knownGaps,
    ...(multiSymbol
      ? [
          "multi-symbol batch: bar-sequence hole detection is skipped (declare per-symbol gaps when concatenating request batches)",
        ]
      : []),
    "W026 baseline: fixture-recorded batch mapped deterministically from documented exchange record shapes — no live network IO (the live fetch layer is a later work order)",
  ];
  const extents = records.map((record) => historicalRecordExtent(record));
  const datasetId =
    context.datasetId !== undefined && isNonBlank(context.datasetId)
      ? context.datasetId
      : deriveCryptoDatasetId(provider, feed, records);
  return {
    datasetId,
    source: {
      provider: provider.providerId,
      name: `${provider.exchange} — ${feed.feedId} (${feed.endpoint})`,
      format: formatLabelOf(feed),
      obtained:
        "recorded batch mapped by tradrl-adapters-crypto (documented exchange record shapes; " +
        `doc snapshot ${provider.docs.shapeSnapshotDate}: ${provider.docs.note})`,
    },
    range:
      records.length === 0
        ? {}
        : {
            from: Math.min(...extents.map((extent) => extent.from)) as TimestampMs,
            to: Math.max(...extents.map((extent) => extent.to)) as TimestampMs,
          },
    recordKinds: [feed.outputKind],
    granularity: context.granularity,
    knownGaps: feed.outputKind === "bar" ? detectBarHoles(records) : [],
    limitations,
    determinism: context.determinism ?? { kind: "deterministic" },
  };
}
