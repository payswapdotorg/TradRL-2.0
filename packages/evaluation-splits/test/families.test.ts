/**
 * The SplitFamily construction-gate laws (W052) — every law checked loudly,
 * every violation named, generator refusals carried verbatim, the A9 twins.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import type { TimeMachineScope } from "tradrl-time-machine";
import {
  atomSideOf,
  buildSplitFamily,
  splitFamilyCitationOf,
  splitFamilyIdOf,
} from "../index.js";
import type { SplitFamilyKind, SplitTimestampMs } from "../index.js";
import {
  ASSET_IDS,
  DAY,
  REGIME_IDS,
  SCOPE,
  VENUE_IDS,
  WF_FROM,
  WF_TO,
  WF_TRAIN,
  WF_EVAL,
  aRegimeFamily,
  aVenueFamily,
  aWalkForwardFamily,
  anAssetFamily,
  codes,
} from "./fixtures.js";

const WF_INPUT = {
  scope: SCOPE,
  kind: "walk-forward" as const,
  range: { from: WF_FROM, to: WF_TO },
  policy: {
    kind: "walk-forward" as const,
    axisId: "axis-wf",
    trainWindowMs: WF_TRAIN,
    evaluationWindowMs: WF_EVAL,
  },
};

describe("the construction gate's happy path", () => {
  it("builds the walk-forward family with a content-addressed fam- id", () => {
    const family = aWalkForwardFamily();
    assert.ok(family.familyId.startsWith("fam-"));
    assert.equal(family.kind, "walk-forward");
    assert.equal(family.folds.length, 8);
    assert.equal(family.splits.length, 8);
    assert.ok(Object.isFrozen(family));
    assert.equal(family.lineage.parent, undefined);
    assert.equal(family.lineage.root, family.familyId);
    assert.equal(family.lineage.ordinal, 0);
  });

  it("derives the walk-forward period universe from the input range", () => {
    const family = aWalkForwardFamily();
    assert.deepEqual(family.universe, { kind: "period", from: WF_FROM, to: WF_TO });
  });

  it("carries the deterministic provenance (generator, digest, laws)", () => {
    const family = aWalkForwardFamily();
    assert.equal(family.provenance.generator, "generate-walk-forward");
    assert.equal(
      family.provenance.inputDigest,
      family.familyId.slice("fam-".length),
    );
    assert.deepEqual(family.provenance.laws, [
      "spec/ARCHITECTURE.md §13",
      "R016",
      "spec/ARCHITECTURE-LOCK.md A9",
      "spec/ARCHITECTURE-LOCK.md A14",
    ]);
  });

  it("names each kind's own generator in the provenance", () => {
    assert.equal(aRegimeFamily().provenance.generator, "generate-regime-partitions");
    assert.equal(anAssetFamily().provenance.generator, "generate-asset-partitions");
    assert.equal(aVenueFamily().provenance.generator, "generate-venue-partitions");
  });

  it("carries partition families as exactly one split with no folds", () => {
    const regime = aRegimeFamily();
    assert.equal(regime.folds.length, 0);
    assert.equal(regime.splits.length, 1);
    assert.equal(regime.splits[0]!.kind, "regime");
    assert.equal(regime.splits[0]!.axisId, "axis-regime");
    const asset = anAssetFamily();
    assert.equal(asset.splits[0]!.kind, "asset");
    assert.equal(asset.splits.length, 1);
    const venue = aVenueFamily();
    assert.equal(venue.splits[0]!.kind, "venue");
    assert.equal(venue.splits.length, 1);
  });

  it("carries a declared continuation lineage verbatim", () => {
    const root = aWalkForwardFamily();
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      lineage: { parent: root.familyId, root: root.familyId, ordinal: 3 },
    });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.family.lineage, {
      parent: root.familyId,
      root: root.familyId,
      ordinal: 3,
    });
    // The lineage rides BESIDE the id: same declaration, same family id.
    assert.equal(outcome.family.familyId, root.familyId);
  });
});

describe("the A9 twins (determinism, declaration order never matters)", () => {
  it("re-builds the same family deep-equal with the same id", () => {
    const left = buildSplitFamily(WF_INPUT);
    const right = buildSplitFamily(WF_INPUT);
    assert.ok(left.ok && right.ok);
    assert.equal(left.family.familyId, right.family.familyId);
    assert.equal(canonicalString(left.family), canonicalString(right.family));
  });

  it("ignores the universe's declaration order (canonical orders carried)", () => {
    const left = aRegimeFamily();
    const right = buildSplitFamily({
      scope: SCOPE,
      kind: "regime",
      range: { from: WF_FROM, to: WF_TO },
      universe: { kind: "regime", regimeIds: [...REGIME_IDS].reverse() },
      policy: {
        kind: "regime",
        axisId: "axis-regime",
        rule: { kind: "tail-holdout", evaluationCount: 1 },
      },
    });
    assert.ok(right.ok);
    assert.equal(right.family.familyId, left.familyId);
    assert.equal(canonicalString(right.family), canonicalString(left));
    const universe = right.family.universe as Extract<
      import("../index.js").SplitAtomUniverse,
      { kind: "regime" }
    >;
    assert.deepEqual(universe.regimeIds, [
      "regime-calm",
      "regime-crisis",
      "regime-mania",
      "regime-volatile",
    ]);
  });

  it("ignores the explicit partition's side declaration order", () => {
    const left = aVenueFamily();
    const right = buildSplitFamily({
      scope: SCOPE,
      kind: "venue",
      range: { from: WF_FROM, to: WF_TO },
      universe: { kind: "venue", venueIds: [...VENUE_IDS].reverse() },
      policy: {
        kind: "venue",
        axisId: "axis-venue",
        rule: {
          kind: "explicit",
          train: ["venue-cme"],
          evaluation: ["venue-coinbase", "venue-nyse"],
        },
      },
    });
    assert.ok(right.ok);
    assert.equal(right.family.familyId, left.familyId);
    assert.equal(canonicalString(right.family), canonicalString(left));
  });

  it("re-derives the same id through splitFamilyIdOf over the canonical form", () => {
    const family = aWalkForwardFamily();
    const derived = splitFamilyIdOf(
      family.scope,
      family.kind,
      family.range,
      family.universe,
      family.policy,
    );
    assert.equal(derived, family.familyId);
    const other = splitFamilyIdOf(
      family.scope,
      family.kind,
      { from: (WF_FROM + DAY) as SplitTimestampMs, to: WF_TO },
      family.universe,
      family.policy,
    );
    assert.notEqual(other, family.familyId);
  });
});

describe("the construction gate's refusal laws", () => {
  it("refuses a blank scope member (W050 carried)", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      scope: { tenantId: "", projectId: "p", worldId: "w" } as TimeMachineScope,
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["blank-scope-member"]);
  });

  it("refuses an unknown family kind (§13's closed set)", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      kind: "unseen-period" as unknown as SplitFamilyKind,
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["unknown-family-kind"]);
    assert.match(outcome.errors[0]!.message, /spec\/ARCHITECTURE\.md §13/);
  });

  it("refuses a policy that re-kinds the family", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      policy: { kind: "regime", axisId: "x", rule: { kind: "tail-holdout", evaluationCount: 1 } },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["policy-kind-mismatch"]);
  });

  it("refuses a missing universe on an id-based kind", () => {
    const outcome = buildSplitFamily({
      scope: SCOPE,
      kind: "regime",
      range: { from: WF_FROM, to: WF_TO },
      policy: {
        kind: "regime",
        axisId: "axis-regime",
        rule: { kind: "tail-holdout", evaluationCount: 1 },
      },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["missing-universe"]);
  });

  it("refuses a universe whose atom family disagrees with the kind", () => {
    const outcome = buildSplitFamily({
      scope: SCOPE,
      kind: "regime",
      range: { from: WF_FROM, to: WF_TO },
      universe: { kind: "venue", venueIds: VENUE_IDS },
      policy: {
        kind: "regime",
        axisId: "axis-regime",
        rule: { kind: "tail-holdout", evaluationCount: 1 },
      },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["universe-kind-mismatch"]);
  });

  it("refuses a walk-forward universe that is not the input range", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      universe: { kind: "period", from: WF_FROM, to: (WF_FROM + DAY) as SplitTimestampMs },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["walk-forward-universe-mismatch"]);
  });

  it("refuses malformed ranges (the W004/W037 period law)", () => {
    const inverted = buildSplitFamily({
      ...WF_INPUT,
      range: { from: WF_TO, to: WF_FROM },
    });
    assert.ok(!inverted.ok);
    assert.deepEqual(codes(inverted), ["invalid-range"]);
    const nonFinite = buildSplitFamily({
      ...WF_INPUT,
      range: { from: Number.NaN as SplitTimestampMs, to: WF_TO },
    });
    assert.ok(!nonFinite.ok);
    assert.deepEqual(codes(nonFinite), ["invalid-range"]);
  });

  it("refuses walk-forward range instants that are not cutoff-grade", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      range: { from: -1 as SplitTimestampMs, to: WF_TO },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["invalid-range"]);
    assert.match(outcome.errors[0]!.message, /cutoff/);
  });

  it("refuses non-positive-integer window policies", () => {
    for (const trainWindowMs of [0, -1000, 0.5]) {
      const outcome = buildSplitFamily({
        ...WF_INPUT,
        policy: { ...WF_INPUT.policy, trainWindowMs },
      });
      assert.ok(!outcome.ok, `trainWindowMs=${String(trainWindowMs)} must refuse`);
      assert.deepEqual(codes(outcome), ["invalid-window-policy"]);
    }
  });

  it("refuses a blank family axis", () => {
    const outcome = buildSplitFamily({
      ...WF_INPUT,
      policy: { ...WF_INPUT.policy, axisId: "  " },
    });
    assert.ok(!outcome.ok);
    assert.deepEqual(codes(outcome), ["blank-family-axis"]);
  });

  it("carries the generator's refusals verbatim (range too short, duplicate atoms)", () => {
    const tooShort = buildSplitFamily({
      ...WF_INPUT,
      range: { from: WF_FROM, to: (WF_FROM + WF_TRAIN - 1) as SplitTimestampMs },
    });
    assert.ok(!tooShort.ok);
    assert.deepEqual(codes(tooShort), ["range-too-short"]);

    const duplicateAtoms = buildSplitFamily({
      scope: SCOPE,
      kind: "asset",
      range: { from: WF_FROM, to: WF_TO },
      universe: { kind: "asset", instrumentIds: [...ASSET_IDS, ASSET_IDS[0]!] },
      policy: {
        kind: "asset",
        axisId: "axis-asset",
        rule: { kind: "round-robin", modulus: 2, offset: 1 },
      },
    });
    assert.ok(!duplicateAtoms.ok);
    assert.deepEqual(codes(duplicateAtoms), ["duplicate-atom"]);
  });

  it("refuses lineage breaks", () => {
    const family = aWalkForwardFamily();
    const wrongRoot = buildSplitFamily({
      ...WF_INPUT,
      lineage: { root: "fam-deadbeef" as typeof family.familyId, ordinal: 0 },
    });
    assert.ok(!wrongRoot.ok);
    assert.deepEqual(codes(wrongRoot), ["lineage-break"]);

    const rootWithOrdinal = buildSplitFamily({
      ...WF_INPUT,
      lineage: { root: family.familyId, ordinal: 3 },
    });
    assert.ok(!rootWithOrdinal.ok);
    assert.deepEqual(codes(rootWithOrdinal), ["lineage-break"]);

    const continuationWithoutRoot = buildSplitFamily({
      ...WF_INPUT,
      lineage: { parent: family.familyId, ordinal: 1 },
    });
    assert.ok(!continuationWithoutRoot.ok);
    assert.deepEqual(codes(continuationWithoutRoot), ["lineage-break"]);

    const continuationAtZero = buildSplitFamily({
      ...WF_INPUT,
      lineage: { parent: family.familyId, root: family.familyId, ordinal: 0 },
    });
    assert.ok(!continuationAtZero.ok);
    assert.deepEqual(codes(continuationAtZero), ["lineage-break"]);
  });
});

describe("the per-side vocabulary + the citation seam", () => {
  it("names an atom's side of one split in W038's own vocabulary", () => {
    const regime = aRegimeFamily();
    const split = regime.splits[0]!;
    assert.equal(
      atomSideOf(split, { kind: "regime", regimeId: "regime-calm" }),
      "train",
    );
    assert.equal(
      atomSideOf(split, { kind: "regime", regimeId: "regime-volatile" }),
      "evaluation",
    );
    assert.equal(
      atomSideOf(split, { kind: "regime", regimeId: "regime-unknown" }),
      "unassigned",
    );
    // An atom on BOTH sides of a malformed split is surfaced, not resolved.
    const malformed = {
      ...split,
      train: [...split.train, split.evaluation[0]!],
    };
    assert.equal(
      atomSideOf(malformed, split.evaluation[0]!),
      "unassigned",
    );
  });

  it("produces a citable family citation under W051's §13 law", () => {
    const family = aWalkForwardFamily();
    const citation = splitFamilyCitationOf(family);
    assert.deepEqual(citation, {
      familyId: family.familyId,
      kind: "walk-forward",
      law: "spec/ARCHITECTURE.md §13",
    });
    assert.ok(Object.isFrozen(citation));
    assert.deepEqual(splitFamilyCitationOf(aRegimeFamily()), {
      familyId: aRegimeFamily().familyId,
      kind: "regime",
      law: "spec/ARCHITECTURE.md §13",
    });
  });
});
