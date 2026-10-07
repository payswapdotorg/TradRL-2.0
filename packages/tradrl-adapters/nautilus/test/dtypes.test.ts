/**
 * Catalog/dtype declaration laws (W021): structural validation (the
 * honest-declaration laws), the baseline dtype set, and the fixture
 * provenance meta-test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baselineDtypes,
  dtypeOf,
  nautilusTraderCatalog,
  validateNautilusCatalog,
} from "../dtypes.js";
import type { NautilusCatalogDescriptor } from "../dtypes.js";
import { ALL_FIXTURES, NAUTILUS_INSTRUMENTS } from "./fixtures.js";

const catalog = nautilusTraderCatalog(NAUTILUS_INSTRUMENTS);

test("the baseline catalog validates cleanly (empty violation list)", () => {
  assert.deepEqual(validateNautilusCatalog(catalog), []);
});

test("the baseline dtype set: the mappable three + the honest unmappable fourth", () => {
  assert.deepEqual(
    baselineDtypes().map((dtype) => dtype.dtypeId),
    [
      "nautilus.bars",
      "nautilus.trade_ticks",
      "nautilus.quote_ticks",
      "nautilus.order_book_deltas",
    ],
  );
  assert.equal(dtypeOf(catalog, "nautilus.bars")?.outputKind, "bar");
  assert.equal(dtypeOf(catalog, "nautilus.trade_ticks")?.outputKind, "trade");
  assert.equal(dtypeOf(catalog, "nautilus.quote_ticks")?.outputKind, "quote");
  assert.equal(dtypeOf(catalog, "nautilus.order_book_deltas")?.outputKind, "unmappable");
});

test("every dtype declares its documented field names and ns timestamp fields", () => {
  for (const dtype of baselineDtypes()) {
    assert.ok(dtype.documentedFields.length > 0, `${dtype.dtypeId} documents its fields`);
    assert.deepEqual(dtype.timestampFields, ["ts_event (int64 ns)", "ts_init (int64 ns)"]);
    assert.equal(dtype.recordOrder, "ascending");
  }
  assert.ok(dtypeOf(catalog, "nautilus.bars")!.documentedFields.includes("bar_type"));
  assert.ok(dtypeOf(catalog, "nautilus.trade_ticks")!.documentedFields.includes("aggressor_side"));
  assert.ok(!dtypeOf(catalog, "nautilus.quote_ticks")!.documentedFields.includes("last"));
});

test("HONESTY LAW: a catalog claiming parquet reading is invalid", () => {
  const dishonest: NautilusCatalogDescriptor = {
    ...catalog,
    acquisition: {
      ...catalog.acquisition,
      parquetCatalog: "implemented" as never,
    },
  };
  const violations = validateNautilusCatalog(dishonest);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.kind, "invalid-catalog");
  assert.match(violations[0]?.detail ?? "", /must be 'not-implemented'/);
});

test("structural validation collects EVERY problem (blank fields, duplicate dtypes, empty table)", () => {
  const broken: NautilusCatalogDescriptor = {
    ...catalog,
    catalogId: " ",
    label: "",
    instruments: {},
    dtypes: [baselineDtypes()[0]!, baselineDtypes()[0]!],
  };
  const violations = validateNautilusCatalog(broken);
  const details = violations.map((violation) => violation.detail);
  assert.ok(details.some((detail) => detail.includes("catalogId")));
  assert.ok(details.some((detail) => detail.includes("label")));
  assert.ok(details.some((detail) => detail.includes("instruments must declare")));
  assert.ok(details.some((detail) => detail.includes("duplicate dtype id")));
  assert.ok(violations.every((violation) => violation.kind === "invalid-catalog"));
});

test("a dtype with a non-ascending declared order is invalid (the documented partition order)", () => {
  const [bars] = baselineDtypes();
  const broken: NautilusCatalogDescriptor = {
    ...catalog,
    dtypes: [{ ...bars!, recordOrder: "descending" as never }],
  };
  const violations = validateNautilusCatalog(broken);
  assert.ok(violations.some((violation) => violation.detail.includes("recordOrder must be 'ascending'")));
});

test("the fidelity declaration is honest and complete (gives/gaps/conventions)", () => {
  const fidelity = catalog.fidelity;
  assert.ok(fidelity.gives.length >= 3);
  // The known gaps DISCLOSE the precision reality instead of hiding it.
  const gaps = fidelity.knownGaps.join(" | ");
  assert.match(gaps, /TRUNCATED/);
  assert.match(gaps, /safe-integer/);
  assert.match(gaps, /last-trade price/);
  assert.match(gaps, /unmappable/);
  assert.match(gaps, /TL action item/);
  const conventions = fidelity.conventions.join(" | ");
  assert.match(conventions, /NANOSECONDS/);
  assert.match(conventions, /aggressor_side 'BUY'\/'SELL'/);
  assert.match(conventions, /shortest round-trip/);
  // The docs snapshot is labeled (the W026 discipline).
  assert.ok(catalog.docs.shapeSnapshotDate.length > 0);
  assert.match(catalog.docs.source, /NautilusTrader documentation/);
});

test("META: every fixture stays labeled with dtype + doc source + snapshot date", () => {
  assert.ok(ALL_FIXTURES.length >= 8);
  for (const fixture of ALL_FIXTURES) {
    const { provenance } = fixture;
    assert.ok(provenance.dtypeId.startsWith("nautilus."), "dtypeId");
    assert.ok(provenance.dtypeName.length > 0, "dtypeName");
    assert.match(provenance.docSource, /NautilusTrader documentation/);
    assert.ok(provenance.shapeSnapshotDate.length > 0, "shapeSnapshotDate");
    assert.match(provenance.note, /hand-authored/);
  }
});

test("every labeled fixture dtype is declared by the baseline catalog", () => {
  for (const fixture of ALL_FIXTURES) {
    const dtype = dtypeOf(catalog, fixture.provenance.dtypeId);
    assert.ok(dtype !== undefined, `${fixture.provenance.dtypeId} must be a declared dtype`);
    assert.equal(dtype.dtypeName, fixture.provenance.dtypeName);
  }
});
