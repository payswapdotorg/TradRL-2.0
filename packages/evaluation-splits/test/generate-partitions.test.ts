/**
 * The id-based partition generators' laws (W052) — regime/asset/venue
 * partitions over the declared atom universe: deterministic rules, disjoint
 * non-empty sides, canonical order, W037 descriptor shapes, and every
 * refusal law pinned.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import {
  generateAssetPartitions,
  generateRegimePartitions,
  generateVenuePartitions,
} from "../index.js";
import type { PartitionRule } from "../index.js";
import type { SplitAtom } from "experiments";
import { ASSET_IDS, REGIME_IDS, VENUE_IDS, codes } from "./fixtures.js";

/** The id rendering of one side's atoms (kind-narrowed per atom). */
function idsOf(atoms: readonly SplitAtom[]): string[] {
  return atoms.map((atom) =>
    atom.kind === "regime"
      ? atom.regimeId
      : atom.kind === "asset"
        ? String(atom.instrumentId)
        : atom.kind === "venue"
          ? atom.venueId
          : `${String(atom.from)}→${String(atom.to)}`,
  );
}

describe("the partition happy paths", () => {
  it("tail-holdout holds out the LAST atoms of the canonical order", () => {
    const outcome = generateRegimePartitions(
      REGIME_IDS,
      { kind: "tail-holdout", evaluationCount: 2 },
      "axis-regime",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.split.kind, "regime");
    assert.equal(outcome.split.axisId, "axis-regime");
    assert.deepEqual(idsOf(outcome.split.train), ["regime-calm", "regime-crisis"]);
    assert.deepEqual(idsOf(outcome.split.evaluation), ["regime-mania", "regime-volatile"]);
    for (const atom of [...outcome.split.train, ...outcome.split.evaluation]) {
      assert.equal(atom.kind, "regime");
    }
  });

  it("round-robin holds out the atoms whose canonical index hits the offset", () => {
    const outcome = generateAssetPartitions(
      ASSET_IDS,
      { kind: "round-robin", modulus: 2, offset: 1 },
      "axis-asset",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.split.kind, "asset");
    assert.deepEqual(idsOf(outcome.split.train), ["BTC-USD", "SOL-USD"]);
    assert.deepEqual(idsOf(outcome.split.evaluation), ["ETH-USD"]);
  });

  it("explicit partitions carry the declared sides, canonically ordered and covering", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      {
        kind: "explicit",
        train: ["venue-cme"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
      "axis-venue",
    );
    assert.ok(outcome.ok);
    assert.equal(outcome.split.kind, "venue");
    assert.deepEqual(idsOf(outcome.split.train), ["venue-cme"]);
    assert.deepEqual(idsOf(outcome.split.evaluation), ["venue-coinbase", "venue-nyse"]);
  });
});

describe("the partition A9 twins (declaration order never matters)", () => {
  it("re-partitions deep-equal from a shuffled universe (regime)", () => {
    const left = generateRegimePartitions(
      REGIME_IDS,
      { kind: "tail-holdout", evaluationCount: 1 },
      "axis-regime",
    );
    const right = generateRegimePartitions(
      [...REGIME_IDS].reverse(),
      { kind: "tail-holdout", evaluationCount: 1 },
      "axis-regime",
    );
    assert.ok(left.ok && right.ok);
    assert.equal(canonicalString(left.split), canonicalString(right.split));
  });

  it("re-partitions deep-equal from a shuffled universe (asset)", () => {
    const rule: PartitionRule = { kind: "round-robin", modulus: 2, offset: 1 };
    const left = generateAssetPartitions(ASSET_IDS, rule, "axis-asset");
    const right = generateAssetPartitions([...ASSET_IDS].reverse(), rule, "axis-asset");
    assert.ok(left.ok && right.ok);
    assert.equal(canonicalString(left.split), canonicalString(right.split));
  });

  it("re-partitions deep-equal from shuffled explicit sides (venue)", () => {
    const rule: PartitionRule = {
      kind: "explicit",
      train: ["venue-cme"],
      evaluation: ["venue-coinbase", "venue-nyse"],
    };
    const left = generateVenuePartitions(VENUE_IDS, rule, "axis-venue");
    const right = generateVenuePartitions(
      [...VENUE_IDS].reverse(),
      {
        kind: "explicit",
        train: ["venue-cme"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
      "axis-venue",
    );
    assert.ok(left.ok && right.ok);
    assert.equal(canonicalString(left.split), canonicalString(right.split));
  });
});

describe("the partition refusal laws", () => {
  it("refuses a blank axis id", () => {
    assert.deepEqual(
      codes(generateRegimePartitions(REGIME_IDS, { kind: "tail-holdout", evaluationCount: 1 }, " ")),
      ["blank-family-axis"],
    );
    assert.deepEqual(
      codes(generateAssetPartitions(ASSET_IDS, { kind: "tail-holdout", evaluationCount: 1 }, " ")),
      ["blank-family-axis"],
    );
    assert.deepEqual(
      codes(generateVenuePartitions(VENUE_IDS, { kind: "tail-holdout", evaluationCount: 1 }, " ")),
      ["blank-family-axis"],
    );
  });

  it("refuses an empty universe", () => {
    const outcome = generateRegimePartitions([], { kind: "tail-holdout", evaluationCount: 1 }, "axis");
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["empty-universe"]);
  });

  it("refuses duplicate atoms in the universe (never silently deduplicated)", () => {
    const outcome = generateVenuePartitions(
      ["venue-a", "venue-a"],
      { kind: "tail-holdout", evaluationCount: 1 },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["duplicate-atom"]);
  });

  it("refuses blank atoms in the universe", () => {
    const outcome = generateRegimePartitions(
      ["regime-a", ""],
      { kind: "tail-holdout", evaluationCount: 1 },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["blank-atom"]);
  });

  it("refuses tail-holdout rules outside their own laws", () => {
    for (const evaluationCount of [0, -1, 1.5]) {
      const outcome = generateRegimePartitions(
        REGIME_IDS,
        { kind: "tail-holdout", evaluationCount },
        "axis",
      );
      assert.ok(!outcome.ok, `evaluationCount=${String(evaluationCount)} must refuse`);
      assert.deepEqual(codes(outcome), ["invalid-partition-rule"]);
    }
  });

  it("refuses a tail-holdout that empties the train side (W037 carried)", () => {
    const outcome = generateRegimePartitions(
      REGIME_IDS,
      { kind: "tail-holdout", evaluationCount: REGIME_IDS.length },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["empty-split-side"]);
  });

  it("refuses round-robin rules outside their own laws", () => {
    for (const rule of [
      { kind: "round-robin", modulus: 1, offset: 0 },
      { kind: "round-robin", modulus: 0, offset: 0 },
      { kind: "round-robin", modulus: 3, offset: 3 },
      { kind: "round-robin", modulus: 3, offset: -1 },
      { kind: "round-robin", modulus: 2.5, offset: 0 },
    ] as const) {
      const outcome = generateRegimePartitions(REGIME_IDS, rule, "axis");
      assert.ok(!outcome.ok, JSON.stringify(rule));
      assert.deepEqual(codes(outcome), ["invalid-partition-rule"]);
    }
  });

  it("refuses a round-robin that empties a side (W037 carried)", () => {
    const outcome = generateRegimePartitions(
      ["regime-a", "regime-b", "regime-c"],
      { kind: "round-robin", modulus: 5, offset: 3 },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["empty-split-side"]);
  });

  it("refuses atoms outside the declared universe (splits never invent atoms)", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      {
        kind: "explicit",
        train: ["venue-cme", "venue-imaginary"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["atom-outside-universe"]);
  });

  it("refuses duplicate atoms within a side (W037 carried)", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      {
        kind: "explicit",
        train: ["venue-cme", "venue-cme"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["duplicate-split-atom"]);
  });

  it("refuses an atom declared on both sides (W037 carried)", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      {
        kind: "explicit",
        train: ["venue-cme", "venue-nyse"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["overlapping-split-sides"]);
  });

  it("refuses an uncovered universe atom (coverage)", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      {
        kind: "explicit",
        train: ["venue-cme"],
        evaluation: ["venue-coinbase"],
      },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["uncovered-atom"]);
  });

  it("refuses an empty side in an explicit partition (W037 carried)", () => {
    const outcome = generateVenuePartitions(
      VENUE_IDS,
      { kind: "explicit", train: [], evaluation: ["venue-nyse", "venue-coinbase"] },
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.ok(codes(outcome).includes("empty-split-side"));
  });

  it("refuses an unknown partition rule (the closed set)", () => {
    const outcome = generateRegimePartitions(
      REGIME_IDS,
      { kind: "hash-based" } as unknown as PartitionRule,
      "axis",
    );
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["invalid-partition-rule"]);
    assert.match(outcome.errors[0]!.message, /closed set: tail-holdout, round-robin, explicit/);
  });
});
