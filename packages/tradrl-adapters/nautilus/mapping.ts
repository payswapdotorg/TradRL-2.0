/**
 * The batch mapping engine (W021 `tradrl-adapters-nautilus`).
 *
 * Binds the catalog/dtype declarations (`./dtypes.js`) to the per-dtype
 * record mappers (`./bar.js`, `./trade.js`, `./quote.js`) and produces the
 * W020-importable surface of one catalog batch: the `HistoricalRecord` set
 * (event-time ordered), the W020 `DatasetDescriptor` (`./dataset.js`) and
 * the import `symbolMap` — the exact triple `loadHistoricalDataset`
 * consumes (and, via the W031 CLI, the exact triple a `datasets` section
 * declaration runs through a world).
 *
 * Laws:
 * - NO parquet/nautilus_trader IO — the payload is recorded JSON rows (the
 *   real catalog reader is a TL action item; the acquisition declaration
 *   says so honestly);
 * - pure + deterministic (A9): same (catalog, dtypeId, payload, context)
 *   always yields the bit-identical mapping;
 * - collect-everything: one pass reports EVERY violation; a batch with any
 *   violation maps nothing (`ok: false` carries the complete list — the W020
 *   never-partially-import discipline);
 * - the declared record order is "ascending" (the documented catalog
 *   partition order) and is NEVER reordered here — residual ordering garbage
 *   is caught loudly at the W020 import boundary (`out-of-order-records`),
 *   the deliberate boundary (the adapter normalizes nothing it cannot
 *   declare);
 * - context requirements are dtype declarations, not guesses: irregular bar
 *   aggregations REQUIRE a declared granularityMs because the documented
 *   bar_type carries no derivable interval length (never invented).
 */

import type { DeterminismDeclaration } from "tradrl-world-contracts";
import type { DatasetDescriptor, DatasetId, HistoricalRecord } from "tradrl-world-contracts/data";
import type { RecordSymbolMap } from "tradrl-data";
import type { NautilusMappingViolation } from "./errors.js";
import type {
  NautilusCatalogDescriptor,
  NautilusDtypeDescriptor,
} from "./dtypes.js";
import { dtypeOf, validateNautilusCatalog } from "./dtypes.js";
import { instrumentMapOf } from "./instruments.js";
import { barGranularityLabel, mapNautilusBar, parseNautilusBarType } from "./bar.js";
import { mapNautilusTrade } from "./trade.js";
import { mapNautilusQuote } from "./quote.js";
import { buildNautilusDatasetDescriptor } from "./dataset.js";

/** The per-record mapping context (pure data the mappers consume). */
export interface NautilusRecordContext {
  /** The catalog's declared instrument table. */
  readonly instruments: NautilusCatalogDescriptor["instruments"];
  /**
   * Declared interval length in ms — REQUIRED for irregular bar
   * aggregations (TICK/VOLUME/NOTIONAL/DOLLAR/OPEN_INTEREST); for the
   * time aggregations a declared value is cross-checked loudly.
   */
  readonly granularityMs?: number;
}

/**
 * The batch mapping context: what the importer must DECLARE because the
 * documented dtype rows do not carry it, plus optional descriptor overrides.
 */
export interface NautilusDatasetContext {
  /** Declared interval in ms (irregular bar aggregations; see NautilusRecordContext). */
  readonly granularityMs?: number;
  /** Overrides the derived granularity label (e.g. "1m", "tick"). */
  readonly granularity?: string;
  /** Overrides the derived dataset id. */
  readonly datasetId?: DatasetId;
  /** Overrides the default `{ kind: "deterministic" }` declaration. */
  readonly determinism?: DeterminismDeclaration;
}

/** Typed outcome of mapping ONE dtype row. */
export type NautilusRecordMapping =
  | { readonly ok: true; readonly record: HistoricalRecord }
  | { readonly ok: false; readonly violations: readonly NautilusMappingViolation[] };

/** The complete outcome of mapping one catalog batch. */
export type NautilusDatasetMapping =
  | {
      readonly ok: true;
      readonly catalog: NautilusCatalogDescriptor;
      readonly dtype: NautilusDtypeDescriptor;
      /** Mapped records in event-time order (the documented partition order, kept). */
      readonly records: readonly HistoricalRecord[];
      /** W020 dataset descriptor, ready for `loadHistoricalDataset`. */
      readonly datasetDescriptor: DatasetDescriptor;
      /** W020 symbol map (the catalog's declared instrument table). */
      readonly symbolMap: RecordSymbolMap;
    }
  | { readonly ok: false; readonly violations: readonly NautilusMappingViolation[] };

/** One dtype row -> one W020 record (the mapper contract). */
type RecordMapper = (raw: unknown, context: NautilusRecordContext) => NautilusRecordMapping;

/** The baseline's dtype-id -> mapper registry (declared dtypes, bound mappers). */
const DTYPE_MAPPERS: Readonly<Record<string, RecordMapper>> = {
  "nautilus.bars": mapNautilusBar,
  "nautilus.trade_ticks": mapNautilusTrade,
  "nautilus.quote_ticks": mapNautilusQuote,
};

/** Catalog/dtype-level violations that make record mapping meaningless. */
function structuralViolations(
  catalog: NautilusCatalogDescriptor,
  dtypeId: string,
): readonly NautilusMappingViolation[] {
  const violations = validateNautilusCatalog(catalog);
  if (violations.length > 0) {
    return violations;
  }
  const dtype = dtypeOf(catalog, dtypeId);
  if (dtype === undefined) {
    return [
      {
        kind: "unsupported-dtype",
        detail: `catalog '${catalog.catalogId}' offers no dtype '${dtypeId}' (offered: ${catalog.dtypes.map((entry) => entry.dtypeId).join(", ")})`,
      },
    ];
  }
  if (dtype.outputKind === "unmappable") {
    return [
      {
        kind: "unmappable-dtype",
        detail:
          `dtype '${dtypeId}' is declared unmappable: ${dtype.notes.join("; ")} — ` +
          `mapping it would require reconstructing state this baseline never guesses`,
      },
    ];
  }
  if (DTYPE_MAPPERS[dtypeId] === undefined) {
    return [
      {
        kind: "unsupported-dtype",
        detail: `dtype '${dtypeId}' is declared but this baseline ships no mapper for it`,
      },
    ];
  }
  return [];
}

/** Build the per-record mapping context from the catalog + batch context. */
function recordContextOf(
  catalog: NautilusCatalogDescriptor,
  context: NautilusDatasetContext,
): NautilusRecordContext {
  return {
    instruments: catalog.instruments,
    ...(context.granularityMs === undefined ? {} : { granularityMs: context.granularityMs }),
  };
}

/**
 * Map ONE dtype row (the pure single-record surface — the future catalog
 * reader layer consumes this directly). The catalog and dtype must be
 * structurally valid and the dtype mappable; record-level problems arrive as
 * collected typed violations.
 */
export function mapNautilusRecord(
  catalog: NautilusCatalogDescriptor,
  dtypeId: string,
  raw: unknown,
  context: NautilusDatasetContext = {},
): NautilusRecordMapping {
  const structural = structuralViolations(catalog, dtypeId);
  if (structural.length > 0) {
    return { ok: false, violations: structural };
  }
  const mapper = DTYPE_MAPPERS[dtypeId]!;
  return mapper(raw, recordContextOf(catalog, context));
}

/**
 * The default honest scale label of a mapped batch: bars derive theirs from
 * the first row's parsed bar_type (one catalog partition carries ONE
 * bar_type by construction — a concatenated multi-partition batch must
 * declare its label through the context); trade/quote batches are "tick".
 * Only called after every row mapped OK (a bad bar_type is already a
 * violation); the fallbacks are belt-and-braces.
 */
function defaultGranularityOf(
  dtype: NautilusDtypeDescriptor,
  rows: readonly unknown[],
): string {
  if (dtype.outputKind !== "bar" || rows.length === 0) {
    return "tick";
  }
  const first = rows[0];
  if (typeof first !== "object" || first === null) {
    return "tick";
  }
  const parsed = parseNautilusBarType((first as Record<string, unknown>).bar_type);
  return parsed.ok ? barGranularityLabel(parsed.parts) : "tick";
}

/**
 * Map one recorded catalog batch onto the W020 import surface. Pure and
 * deterministic; collect-everything on failure (never a partial mapping);
 * the documented ascending partition order is kept verbatim (never
 * re-sorted — residual garbage surfaces as the W020 typed rejection).
 */
export function mapNautilusDataset(
  catalog: NautilusCatalogDescriptor,
  dtypeId: string,
  rawPayload: unknown,
  context: NautilusDatasetContext = {},
): NautilusDatasetMapping {
  const structural = structuralViolations(catalog, dtypeId);
  if (structural.length > 0) {
    return { ok: false, violations: structural };
  }
  const dtype = dtypeOf(catalog, dtypeId)!;
  const violations: NautilusMappingViolation[] = [];
  let rows: readonly unknown[];
  if (Array.isArray(rawPayload)) {
    rows = rawPayload;
  } else {
    violations.push({
      kind: "malformed-record",
      detail: `the documented ${dtype.dtypeName} batch is an array of rows (one catalog partition), got '${typeof rawPayload}'`,
    });
    rows = [];
  }
  const mapper = DTYPE_MAPPERS[dtypeId]!;
  const recordContext = recordContextOf(catalog, context);
  const mapped: HistoricalRecord[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = mapper(rows[index]!, recordContext);
    if (result.ok) {
      mapped.push(result.record);
    } else {
      for (const violation of result.violations) {
        violations.push({ ...violation, index });
      }
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  const datasetDescriptor = buildNautilusDatasetDescriptor({
    catalog,
    dtype,
    records: mapped,
    granularity: context.granularity ?? defaultGranularityOf(dtype, rows),
    ...(context.determinism === undefined ? {} : { determinism: context.determinism }),
    ...(context.datasetId === undefined ? {} : { datasetId: context.datasetId }),
  });
  return {
    ok: true,
    catalog,
    dtype,
    records: mapped,
    datasetDescriptor,
    symbolMap: instrumentMapOf(catalog.instruments),
  };
}
