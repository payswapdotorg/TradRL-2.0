/**
 * W020 dataset-descriptor building (W021 `tradrl-adapters-nautilus`).
 *
 * Turns a mapped, event-time-ordered record batch + its catalog/dtype
 * declarations into a W020 `DatasetDescriptor` that feeds
 * `loadHistoricalDataset` directly (spec/WORK-ITEMS.md W021 — "dataset
 * descriptors declaring the fidelity honestly").
 *
 * Honesty laws (the W026 `tradrl-adapters-crypto` dataset precedent):
 * - the range is DERIVED from the records (min/max extent) — computed, not
 *   claimed, so it can never overstate the data;
 * - bar-sequence holes are DETECTED (a bar whose open time skips past the
 *   previous same-symbol close) and declared as known gaps — an honest
 *   declaration of what the batch does not cover, never an invention.
 *   Hole detection is per single-symbol batch only (the documented catalog
 *   partitions are per-instrument by construction); multi-symbol batches
 *   skip detection and say so in the limitations;
 * - the limitations carry the catalog's declared known gaps verbatim, plus
 *   this baseline's own disclosures (fixture batch, no parquet IO, the
 *   ns->ms truncation and the int64/JSON precision reality).
 */

import type { DeterminismDeclaration, TimestampMs } from "tradrl-world-contracts";
import type {
  DatasetDescriptor,
  DatasetGap,
  DatasetId,
  HistoricalRecord,
} from "tradrl-world-contracts/data";
import { historicalRecordEventTime, historicalRecordExtent } from "tradrl-data";
import type { NautilusCatalogDescriptor, NautilusDtypeDescriptor } from "./dtypes.js";
import { isNonBlank } from "./instruments.js";

/** Everything needed to build the W020 descriptor of one mapped batch. */
export interface NautilusDescriptorContext {
  readonly catalog: NautilusCatalogDescriptor;
  readonly dtype: NautilusDtypeDescriptor;
  /** Mapped records in event-time order (the batch mapper's output). */
  readonly records: readonly HistoricalRecord[];
  /** Honest scale label (e.g. "1m" for bars; "tick" for trade/quote batches). */
  readonly granularity: string;
  /** Default: `{ kind: "deterministic" }` (fixture batches are deterministic). */
  readonly determinism?: DeterminismDeclaration;
  /** Override for the derived dataset id. */
  readonly datasetId?: DatasetId;
}

/** The honest interchange-format label of a dtype's output kind. */
function formatLabelOf(dtype: NautilusDtypeDescriptor): string {
  if (dtype.outputKind === "bar") return "ohlcv-bars";
  if (dtype.outputKind === "trade") return "trade-prints";
  if (dtype.outputKind === "quote") return "top-of-book-quotes";
  return "unmappable";
}

/**
 * Deterministic dataset id of one batch: derived from (catalog, dtype, the
 * batch's event-time span) — the same batch always yields the same id, and
 * two batches of the same dtype with different spans never collide.
 */
export function deriveNautilusDatasetId(
  catalog: NautilusCatalogDescriptor,
  dtype: NautilusDtypeDescriptor,
  records: readonly HistoricalRecord[],
): DatasetId {
  if (records.length === 0) {
    return `nautilus:${catalog.catalogId}:${dtype.dtypeId}:empty` as DatasetId;
  }
  const first = historicalRecordEventTime(records[0]!);
  const last = historicalRecordEventTime(records[records.length - 1]!);
  return `nautilus:${catalog.catalogId}:${dtype.dtypeId}:${String(first)}-${String(last)}` as DatasetId;
}

/**
 * Detect bar-sequence holes: same-symbol bars whose interval leaves a gap
 * between the previous close and the next open. Deterministic; only runs
 * for single-symbol batches (the documented catalog partitions are
 * per-instrument — the W026 `detectBarHoles` law, reimplemented locally so
 * sibling adapter packages stay independent).
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
          "no bar covers this interval in the catalog batch (adapter-detected sequence hole — declared, not invented)",
      });
    }
    previousClose = record.closeTime;
  }
  return gaps;
}

/**
 * Build the W020 `DatasetDescriptor` of one mapped batch. Pure: derived only
 * from the context (catalog/dtype declarations + the records' own fields).
 * The determinism default is `deterministic` — honest for a fixture batch
 * (this baseline performs no live acquisition); callers importing real
 * catalog exports must declare their sources (A9).
 */
export function buildNautilusDatasetDescriptor(context: NautilusDescriptorContext): DatasetDescriptor {
  const { catalog, dtype, records } = context;
  if (dtype.outputKind === "unmappable") {
    // Belt and braces: the batch engine rejects unmappable dtypes before
    // ever building a descriptor — reaching here is an internal bug.
    throw new Error(
      `internal invariant: cannot build a dataset descriptor for the unmappable dtype '${dtype.dtypeId}'`,
    );
  }
  const multiSymbol = new Set(records.map((record) => record.symbol)).size > 1;
  const limitations = [
    ...catalog.fidelity.knownGaps,
    ...(multiSymbol
      ? [
          "multi-symbol batch: bar-sequence hole detection is skipped (declare per-symbol gaps when concatenating catalog partitions)",
        ]
      : []),
    "W021 baseline: fixture batch mapped deterministically from the documented NautilusTrader dtype shapes — " +
      "no parquet catalog IO (the real nautilus_trader reader is a TL action item)",
  ];
  const extents = records.map((record) => historicalRecordExtent(record));
  const datasetId =
    context.datasetId !== undefined && isNonBlank(context.datasetId)
      ? context.datasetId
      : deriveNautilusDatasetId(catalog, dtype, records);
  return {
    datasetId,
    source: {
      provider: catalog.catalogId,
      name: `${catalog.label} — ${dtype.dtypeName} (${dtype.dtypeId})`,
      format: formatLabelOf(dtype),
      obtained:
        "recorded batch mapped by tradrl-adapters-nautilus (documented NautilusTrader dtype shapes; " +
        `doc snapshot ${catalog.docs.shapeSnapshotDate}: ${catalog.docs.note})`,
    },
    range:
      records.length === 0
        ? {}
        : {
            from: Math.min(...extents.map((extent) => extent.from)) as TimestampMs,
            to: Math.max(...extents.map((extent) => extent.to)) as TimestampMs,
          },
    recordKinds: [dtype.outputKind],
    granularity: context.granularity,
    knownGaps: dtype.outputKind === "bar" ? detectBarHoles(records) : [],
    limitations,
    determinism: context.determinism ?? { kind: "deterministic" },
  };
}
