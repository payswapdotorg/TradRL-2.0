/**
 * The honesty checks (W022): the W021 declared-limitation and
 * structural-honesty claims — the ones whose failure mode is SILENCE (an
 * undisclosed limitation, an invented field, a quiet sort, a claimed range).
 *
 * Claims verified here:
 * 11. `unmappable-dtype-declaration` — OrderBookDelta is refused BY
 *     DECLARATION (a well-formed delta row still maps to nothing); unknown
 *     dtype ids are refused loudly.
 * 12. `bar-hole-detection` — a bar-sequence hole is DETECTED and declared as
 *     a known gap; the declared gap imports honestly; a record inside a
 *     declared gap is a W020 contradiction; multi-symbol batches skip
 *     detection and SAY SO.
 * 13. `ascending-order-never-resorted` — a descending batch maps with the
 *     input order kept verbatim, and the W020 loader rejects it loudly
 *     (`out-of-order-records`) — proof there is no silent sort.
 * 14. `derived-range-never-claimed` — the descriptor range equals the
 *     records' extents exactly; a record outside it is a W020 rejection.
 * 15. `known-gap-declaration-honesty` — every limitation the adapter
 *     disclosed stays disclosed in the fidelity declaration.
 * 16. `acquisition-honesty` — the acquisition stays "not-implemented"
 *     (a catalog claiming parquet IO is invalid BY LAW).
 * 17. `a9-double-map-determinism` — the same batch maps bit-identically
 *     twice and imports to the same W004 digest.
 */

import type { NautilusCatalogDescriptor } from "tradrl-adapters-nautilus/dtypes";
import { dtypeOf, validateNautilusCatalog } from "tradrl-adapters-nautilus/dtypes";
import { mapNautilusDataset, mapNautilusRecord } from "tradrl-adapters-nautilus/mapping";
import type { WorldId } from "tradrl-world-contracts";
import { findingOf, type CaseVerdict, type FidelityFinding } from "./findings.js";
import { quoteDeclaration, undeclaredFinding, guardedFinding } from "./claims.js";
import {
  expectImported,
  expectImportThrows,
  expectMappedBatch,
  expectRejectedWith,
  observeBatch,
  observeImport,
  observeMapping,
  runCases,
  type FidelityCase,
} from "./cases.js";
import {
  barRow,
  CLEAN_BARS,
  HOLE_BARS,
  MINUTE_MS,
  MINUTE_NS,
  ORDER_BOOK_DELTA_ROW,
  T0_MS,
  T0_NS,
} from "./fixtures.js";

const WORLD = "world-w022-verify" as WorldId;

/** A pure data-verdict case (no adapter execution — a declaration property). */
function dataCase(id: string, describe: string, expected: string, problem: string | undefined): CaseVerdict {
  return Object.freeze({
    caseId: id,
    describe,
    expected,
    observed: problem === undefined ? "held" : "the declaration/property violates the expectation",
    ...(problem === undefined ? {} : { problem }),
  });
}

/** The mapped batch triple (throws when the batch fails to map — fail-closed upstream). */
function mappedBatch(catalog: NautilusCatalogDescriptor, dtypeId: string, rows: readonly unknown[]) {
  const result = mapNautilusDataset(catalog, dtypeId, rows);
  if (!result.ok) {
    throw new Error(`the harness expected this batch to map: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

/** The unmappable claim (11). */
function unmappableFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.order_book_deltas");
  const quote = quoteDeclaration("nautilus.order_book_deltas.dtypeNotes", dtype?.notes ?? [], ["UNMAPPABLE"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "unmappable-dtype-declaration",
      title: "unmappable dtypes rejected by declaration",
      declaredIn: "nautilus.order_book_deltas.dtypeNotes",
      needles: ["UNMAPPABLE"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "well-formed-delta-row-still-refused",
      describe: "a WELL-FORMED OrderBookDelta row (valid shape, in-window times) is still refused — the refusal is by declaration, never by validation",
      expectation: expectRejectedWith("a loud 'unmappable-dtype' rejection naming the reconstruction requirement", "unmappable-dtype", "reconstructing"),
      observe: () => observeMapping(catalog, "nautilus.order_book_deltas", ORDER_BOOK_DELTA_ROW),
    },
    {
      id: "unknown-dtype-id-refused",
      describe: "an unknown dtype id is a loud unsupported-dtype rejection listing the offered dtypes",
      expectation: expectRejectedWith("a loud 'unsupported-dtype' rejection", "unsupported-dtype", "offers no dtype"),
      observe: () => observeMapping(catalog, "nautilus.deltas_v9", ORDER_BOOK_DELTA_ROW),
    },
  ];
  const declared = dtype?.outputKind === "unmappable";
  return findingOf({
    claimId: "unmappable-dtype-declaration",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: [
      ...runCases(cases),
      dataCase(
        "dtype-descriptor-declares-unmappable",
        "the catalog's dtype descriptor itself declares outputKind 'unmappable'",
        "outputKind === 'unmappable'",
        declared ? undefined : `the dtype descriptor declares outputKind '${String(dtype?.outputKind)}' — not 'unmappable'`,
      ),
    ],
  });
}

/** The hole-detection claim (12). */
function holeFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const holeMapping = mapNautilusDataset(catalog, "nautilus.bars", HOLE_BARS);
  const reason = holeMapping.ok ? holeMapping.datasetDescriptor.knownGaps[0]?.reason : undefined;
  const quote = reason === undefined ? undefined : { text: reason, declaredIn: "the adapter's detected-gap reason (runtime dataset descriptor)" };
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "bar-hole-detection",
      title: "bar-sequence holes detected and declared",
      declaredIn: "the adapter's detected-gap reason (runtime dataset descriptor)",
      needles: ["sequence hole"],
    });
  }
  const middleBar = mapNautilusRecord(catalog, "nautilus.bars", CLEAN_BARS[1]);
  if (!middleBar.ok) {
    throw new Error(`the harness expected the middle bar to map: ${middleBar.violations.map((v) => v.detail).join("; ")}`);
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "hole-detected-and-declared",
      describe: "the missing middle bar yields exactly one declared gap [T0+60s, T0+120s) with the adapter's reason text",
      expectation: expectMappedBatch("knownGaps == [{from: T0+60000, to: T0+120000}]", (batch) => {
        const [gap] = batch.knownGaps;
        if (batch.knownGaps.length !== 1 || gap?.from !== T0_MS + MINUTE_MS || gap?.to !== T0_MS + 2 * MINUTE_MS) {
          return `knownGaps ${JSON.stringify(batch.knownGaps)} is not the single detected hole [${String(T0_MS + MINUTE_MS)}, ${String(T0_MS + 2 * MINUTE_MS)})`;
        }
        return undefined;
      }),
      observe: () => observeBatch(catalog, "nautilus.bars", HOLE_BARS),
    },
    {
      id: "declared-hole-imports-honestly",
      describe: "the hole batch imports cleanly through the W020 loader (the gap declaration and the data agree)",
      expectation: expectImported("2 records import as 2 events"),
      observe: () => observeImport(mappedBatch(catalog, "nautilus.bars", HOLE_BARS), WORLD),
    },
    {
      id: "record-inside-declared-gap-is-contradiction",
      describe: "re-inserting the middle bar inside the declared gap is a loud W020 record-in-declared-gap rejection",
      expectation: expectImportThrows("a loud 'record-in-declared-gap' rejection", "record-in-declared-gap", "inside the declared gap"),
      observe: () => {
        const mapping = mappedBatch(catalog, "nautilus.bars", HOLE_BARS);
        return observeImport({ ...mapping, records: [mapping.records[0]!, middleBar.record, mapping.records[1]!] }, WORLD);
      },
    },
    {
      id: "multi-symbol-skip-declared",
      describe: "a multi-symbol batch skips hole detection AND declares the skip in its limitations",
      expectation: expectMappedBatch("knownGaps == [] and a 'multi-symbol batch' limitation entry", (batch) => {
        if (batch.knownGaps.length !== 0) {
          return `a multi-symbol batch declared gaps ${JSON.stringify(batch.knownGaps)} — detection should be skipped`;
        }
        return batch.limitations.some((entry) => entry.includes("multi-symbol batch"))
          ? undefined
          : `no limitation declares the skipped hole detection: ${JSON.stringify(batch.limitations)}`;
      }),
      observe: () =>
        observeBatch(catalog, "nautilus.bars", [
          ...HOLE_BARS,
          barRow({ bar_type: "ETHUSD-BINANCE-1-MINUTE-LAST-EXTERNAL" }),
        ]),
    },
  ];
  return findingOf({
    claimId: "bar-hole-detection",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The never-resorted claim (13). */
function orderFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration("nautilus.fidelity.conventions", catalog.fidelity.conventions, ["never re-sorts"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "ascending-order-never-resorted",
      title: "ascending order kept, never re-sorted",
      declaredIn: "nautilus.fidelity.conventions",
      needles: ["never re-sorts"],
    });
  }
  const descending = [CLEAN_BARS[2]!, CLEAN_BARS[1]!, CLEAN_BARS[0]!];
  const cases: readonly FidelityCase[] = [
    {
      id: "descending-batch-maps-in-input-order",
      describe: "a descending batch maps with the input order kept VERBATIM (records[0] is still the latest bar — no silent sort)",
      expectation: expectMappedBatch("the first mapped record's closeTime is T0+180000 (the input's first row)", (batch) => {
        const first = batch.records[0];
        return first !== undefined && first.kind === "bar" && first.closeTime === T0_MS + 3 * MINUTE_MS
          ? undefined
          : `the mapped order was tampered with (first record: ${JSON.stringify(first)}) — the adapter re-sorted the batch`;
      }),
      observe: () => observeBatch(catalog, "nautilus.bars", descending),
    },
    {
      id: "descending-import-rejected-loudly",
      describe: "the descending mapping is rejected by the W020 loader as out-of-order-records (the loud boundary)",
      expectation: expectImportThrows("a loud 'out-of-order-records' rejection", "out-of-order-records", "never silently reordered"),
      observe: () => observeImport(mappedBatch(catalog, "nautilus.bars", descending), WORLD),
    },
  ];
  return findingOf({
    claimId: "ascending-order-never-resorted",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The derived-range claim (14). */
function rangeFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const cases: readonly FidelityCase[] = [
    {
      id: "range-equals-record-extents",
      describe: "the three-bar batch's derived range is exactly [T0, T0+180000) — the records' own extents, never wider",
      expectation: expectMappedBatch("range == {from: T0, to: T0+180000}", (batch) => {
        if (batch.range.from !== T0_MS || batch.range.to !== T0_MS + 3 * MINUTE_MS) {
          return `derived range ${JSON.stringify(batch.range)} is not the records' extents {from: ${String(T0_MS)}, to: ${String(T0_MS + 3 * MINUTE_MS)}}`;
        }
        return undefined;
      }),
      observe: () => observeBatch(catalog, "nautilus.bars", CLEAN_BARS),
    },
    {
      id: "record-outside-declared-range-rejected",
      describe: "a bar appended beyond the derived range is a loud W020 record-outside-range rejection (the range never silently widens)",
      expectation: expectImportThrows("a loud 'record-outside-range' rejection", "record-outside-range", "after the declared range.to"),
      observe: () => {
        const mapping = mappedBatch(catalog, "nautilus.bars", CLEAN_BARS);
        const beyond = mapNautilusRecord(catalog, "nautilus.bars", barRow({ ts_event: T0_NS + 3 * MINUTE_NS, ts_init: T0_NS + 4 * MINUTE_NS }));
        if (!beyond.ok) {
          throw new Error(`the harness expected the beyond-range bar to map: ${beyond.violations.map((v) => v.detail).join("; ")}`);
        }
        return observeImport({ ...mapping, records: [...mapping.records, beyond.record] }, WORLD);
      },
    },
  ];
  return findingOf({
    claimId: "derived-range-never-claimed",
    claim:
      "the range is DERIVED from the records (min/max extent) — computed, not claimed, so it can never overstate the data " +
      "(the W021 dataset-builder module declaration)",
    declaredIn: "tradrl-adapters-nautilus/dataset.ts (module declaration — behavior-bound claim)",
    cases: runCases(cases),
  });
}

/** The disclosure-honesty claim (15): every disclosed limitation stays disclosed. */
const DISCLOSURES: readonly { readonly id: string; readonly needle: string; readonly what: string }[] = [
  { id: "discloses-sub-ms-truncation", needle: "sub-millisecond precision is TRUNCATED", what: "the ns→ms truncation" },
  { id: "discloses-int64-json-rounding", needle: "safe-integer range", what: "the int64/JSON rounding reality" },
  { id: "discloses-quote-no-last", needle: "no last-trade price", what: "the QuoteTick no-`last` gap" },
  { id: "discloses-irregular-aggregation", needle: "granularityMs", what: "the irregular-aggregation gap" },
  { id: "discloses-unmappable-deltas", needle: "unmappable", what: "the order-book-delta refusal" },
  { id: "discloses-no-parquet-io", needle: "no parquet catalog IO", what: "the fixture-based baseline (no parquet IO)" },
];

function disclosureFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const cases = DISCLOSURES.map((entry) => {
    const found = catalog.fidelity.knownGaps.find((gap) => gap.includes(entry.needle));
    return dataCase(
      entry.id,
      `the fidelity declaration keeps disclosing ${entry.what}`,
      `a knownGaps entry containing '${entry.needle}'`,
      found === undefined
        ? `no knownGaps entry contains '${entry.needle}' — ${entry.what} went UNDISCLOSED (an honest limitation became a silent approximation)`
        : undefined,
    );
  });
  return findingOf({
    claimId: "known-gap-declaration-honesty",
    claim:
      "the fidelity declaration's knownGaps keep carrying every limitation the adapter disclosed (the honest disclosure channel — " +
      "limitations are declared, never dropped silently)",
    declaredIn: "nautilus.fidelity.knownGaps",
    cases,
  });
}

/** The acquisition claim (16). */
function acquisitionFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration("nautilus.acquisition.note", [catalog.acquisition.note], ["fixture-based"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "acquisition-honesty",
      title: "acquisition stays honestly not-implemented",
      declaredIn: "nautilus.acquisition.note",
      needles: ["fixture-based"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "catalog-claiming-parquet-is-invalid",
      describe: "a tampered catalog claiming parquetCatalog 'implemented' is an invalid-catalog rejection BY LAW",
      expectation: expectRejectedWith("a loud 'invalid-catalog' rejection naming the not-implemented law", "invalid-catalog", "not-implemented"),
      observe: () => ({
        kind: "rejected",
        violations: validateNautilusCatalog({
          ...catalog,
          acquisition: { ...catalog.acquisition, parquetCatalog: "implemented" as never },
        }),
      }),
    },
    {
      id: "descriptor-limitations-carry-baseline-disclosure",
      describe: "every built dataset descriptor's limitations carry the no-parquet-IO baseline disclosure",
      expectation: expectMappedBatch("a limitations entry contains 'no parquet catalog IO'", (batch) =>
        batch.limitations.some((entry) => entry.includes("no parquet catalog IO"))
          ? undefined
          : `no limitations entry discloses the no-parquet-IO baseline: ${JSON.stringify(batch.limitations)}`,
      ),
      observe: () => observeBatch(catalog, "nautilus.bars", CLEAN_BARS),
    },
  ];
  return findingOf({
    claimId: "acquisition-honesty",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: [
      ...runCases(cases),
      dataCase(
        "baseline-catalog-validates-cleanly",
        "the baseline catalog itself passes validateNautilusCatalog with zero violations",
        "validateNautilusCatalog(catalog) == []",
        validateNautilusCatalog(catalog).length === 0
          ? undefined
          : `the baseline catalog carries violations: ${validateNautilusCatalog(catalog).map((v) => v.detail).join("; ")}`,
      ),
    ],
  });
}

/** The double-map A9 claim (17). */
function determinismFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const first = mappedBatch(catalog, "nautilus.bars", CLEAN_BARS);
  const firstImport = loadOutcome(first);
  const cases: readonly FidelityCase[] = [
    {
      id: "double-map-bit-identical",
      describe: "mapping the same batch twice yields bit-identical records and dataset id (A9)",
      expectation: expectMappedBatch("the second mapping's records+datasetId equal the first's bit-for-bit", (batch) =>
        JSON.stringify(batch.records) === JSON.stringify(first.records) &&
        batch.datasetId === String(first.datasetDescriptor.datasetId)
          ? undefined
          : "the second mapping differs from the first — the mapping is not a pure function of its inputs (A9 broken)",
      ),
      observe: () => observeBatch(catalog, "nautilus.bars", CLEAN_BARS),
    },
    {
      id: "double-import-same-digest",
      describe: "both mappings import to the identical W004 eventChecksum (A9)",
      expectation: expectImported(`eventChecksum == ${firstImport.eventChecksum}`, (outcome) =>
        outcome.eventChecksum === firstImport.eventChecksum
          ? undefined
          : "the second import's digest differs from the first's (A9 broken)",
      ),
      observe: () => observeImport(mappedBatch(catalog, "nautilus.bars", CLEAN_BARS), WORLD),
    },
  ];
  return findingOf({
    claimId: "a9-double-map-determinism",
    claim:
      "pure + deterministic (A9): same (catalog, dtypeId, payload, context) always yields the bit-identical mapping " +
      "(the W021 batch-engine module declaration)",
    declaredIn: "tradrl-adapters-nautilus/mapping.ts (module declaration — behavior-bound claim)",
    cases: [
      ...runCases(cases),
      dataCase(
        "descriptor-declares-deterministic",
        "the built dataset descriptor declares determinism { kind: 'deterministic' }",
        "determinism.kind === 'deterministic'",
        first.datasetDescriptor.determinism.kind === "deterministic"
          ? undefined
          : `the descriptor declares determinism ${JSON.stringify(first.datasetDescriptor.determinism)}`,
      ),
    ],
  });
}

/** Import one mapped batch for the determinism comparison (fail-closed on rejection). */
function loadOutcome(mapping: ReturnType<typeof mappedBatch>) {
  const imported = observeImport(mapping, WORLD);
  if (imported.kind !== "imported") {
    throw new Error(`the harness expected the clean batch to import: ${imported.violations.map((v) => v.detail).join("; ")}`);
  }
  return imported;
}

/** Verify the honesty claims (11-17) against one catalog (crash-isolated per claim). */
export function verifyHonestyClaims(catalog: NautilusCatalogDescriptor): readonly FidelityFinding[] {
  return [
    guardedFinding("unmappable-dtype-declaration", () => unmappableFinding(catalog)),
    guardedFinding("bar-hole-detection", () => holeFinding(catalog)),
    guardedFinding("ascending-order-never-resorted", () => orderFinding(catalog)),
    guardedFinding("derived-range-never-claimed", () => rangeFinding(catalog)),
    guardedFinding("known-gap-declaration-honesty", () => disclosureFinding(catalog)),
    guardedFinding("acquisition-honesty", () => acquisitionFinding(catalog)),
    guardedFinding("a9-double-map-determinism", () => determinismFinding(catalog)),
  ];
}
