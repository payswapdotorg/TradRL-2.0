/**
 * Whole-family re-validation (W052) — the record re-proven from its own
 * carried data: identity re-derivations, the A9 re-generation proof, the
 * R016 no-leakage law (named loudly on tampered folds), the W037-carried
 * split-shape laws, lineage + provenance re-proofs.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { asPointInTimeCutoff } from "tradrl-time-machine";
import type { TimeMachineScope } from "tradrl-time-machine";
import {
  validateSplitFamily,
  type SplitFamily,
  type SplitFamilyId,
  type WalkForwardFold,
} from "../index.js";
import type { HoldoutSplitDescriptor, SplitAtom } from "experiments";
import type { SplitAtomUniverse } from "../index.js";
import {
  DAY,
  WF_FROM,
  aRegimeFamily,
  aVenueFamily,
  aWalkForwardFamily,
  anAssetFamily,
  codes,
} from "./fixtures.js";

/** Rebuild the family with ONE replaced split (contextually typed). */
function withSplit(
  family: SplitFamily,
  split: HoldoutSplitDescriptor,
): SplitFamily {
  return { ...family, splits: [split] };
}

/** The id of one venue atom (kind-narrowed). */
function venueIdOf(atom: SplitAtom): string {
  assert.equal(atom.kind, "venue");
  return atom.venueId;
}

function withFolds(
  family: SplitFamily,
  mutate: (fold: WalkForwardFold, index: number) => WalkForwardFold,
): SplitFamily {
  return {
    ...family,
    folds: family.folds.map((fold, index) => mutate(fold, index)),
  };
}

describe("the whole-family re-validation happy path", () => {
  it("validates every built family (all four kinds)", () => {
    for (const family of [
      aWalkForwardFamily(),
      aRegimeFamily(),
      anAssetFamily(),
      aVenueFamily(),
    ]) {
      const validation = validateSplitFamily(family);
      assert.ok(validation.ok, family.kind);
      assert.deepEqual(validation.family, family);
    }
  });

  it("re-validates the A9 twin: a second identical build validates too", () => {
    const twin = aWalkForwardFamily();
    const validation = validateSplitFamily(twin);
    assert.ok(validation.ok);
    assert.equal(validation.family.familyId, twin.familyId);
  });
});

describe("the no-leakage law (R016) re-proven on walk-forward folds", () => {
  it("refuses a fold whose evaluation side could see its train side's future", () => {
    const family = aWalkForwardFamily();
    const leaky = withFolds(family, (fold, index) =>
      index === 1
        ? {
            ...fold,
            evaluation: {
              ...fold.evaluation,
              // Reaches back INTO the train window (at its end — the leak).
              from: fold.train.to,
            },
          }
        : fold,
    );
    const validation = validateSplitFamily(leaky);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("no-leakage"));
    assert.ok(
      validation.errors.some((error) => error.code === "no-leakage" && /R016/.test(error.message)),
      "the refusal must name R016",
    );
    assert.ok(codes(validation).includes("generation-mismatch"));
  });

  it("refuses a tampered sealed cutoff (the fold's knowledge boundary)", () => {
    const family = aWalkForwardFamily();
    const tampered = withFolds(family, (fold, index) =>
      index === 2 ? { ...fold, cutoff: asPointInTimeCutoff(Number(fold.train.to) + 1) } : fold,
    );
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("fold-cutoff-mismatch"));
    assert.ok(codes(validation).includes("generation-mismatch"));
  });

  it("refuses a broken tiling (covering + disjoint) and dropped folds", () => {
    const family = aWalkForwardFamily();
    const gapped = withFolds(family, (fold, index) =>
      index === 0 ? { ...fold, train: { ...fold.train, from: (WF_FROM + 1000) as typeof WF_FROM } } : fold,
    );
    assert.ok(!validateSplitFamily(gapped).ok);
    assert.ok(codes(validateSplitFamily(gapped)).includes("window-sequence"));

    const dropped = { ...family, folds: family.folds.slice(0, -1) };
    const droppedValidation = validateSplitFamily(dropped);
    assert.ok(!droppedValidation.ok);
    assert.ok(codes(droppedValidation).includes("generation-mismatch"));
    assert.ok(codes(droppedValidation).includes("window-sequence"));

    const emptied = { ...family, folds: [] };
    assert.ok(!validateSplitFamily(emptied).ok);
    assert.ok(codes(validateSplitFamily(emptied)).includes("generation-mismatch"));
  });

  it("refuses invalid period atoms inside folds (W037 carried)", () => {
    const family = aWalkForwardFamily();
    const inverted = withFolds(family, (fold, index) =>
      index === 0
        ? { ...fold, train: { ...fold.train, from: (WF_FROM + DAY) as typeof WF_FROM, to: WF_FROM } }
        : fold,
    );
    const validation = validateSplitFamily(inverted);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("invalid-period-atom"));
    assert.ok(codes(validation).includes("generation-mismatch"));
  });
});

describe("the identity re-derivations", () => {
  it("refuses a family id that does not re-derive (A9 content addressing)", () => {
    const family = aWalkForwardFamily();
    const tampered = { ...family, familyId: "fam-deadbeef" as SplitFamilyId };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("family-id-mismatch"));
    assert.ok(codes(validation).includes("lineage-break"));
  });

  it("refuses a broken lineage (the immutable lineage law)", () => {
    const family = aWalkForwardFamily();
    const tampered = { ...family, lineage: { ...family.lineage, ordinal: 2 } };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.deepEqual(codes(validation), ["lineage-break"]);
  });

  it("refuses a provenance that does not re-derive", () => {
    const family = aWalkForwardFamily();
    const wrongGenerator = {
      ...family,
      provenance: { ...family.provenance, generator: "generate-venue-partitions" as const },
    };
    assert.ok(!validateSplitFamily(wrongGenerator).ok);
    assert.ok(codes(validateSplitFamily(wrongGenerator)).includes("provenance-mismatch"));

    const wrongDigest = {
      ...family,
      provenance: { ...family.provenance, inputDigest: "deadbeef" },
    };
    assert.ok(!validateSplitFamily(wrongDigest).ok);
    assert.ok(codes(validateSplitFamily(wrongDigest)).includes("provenance-mismatch"));

    const wrongLaws = {
      ...family,
      provenance: { ...family.provenance, laws: ["R016"] },
    };
    assert.ok(!validateSplitFamily(wrongLaws).ok);
    assert.ok(codes(validateSplitFamily(wrongLaws)).includes("provenance-mismatch"));
  });
});

describe("the declaration + shape laws re-proven", () => {
  it("refuses a blank scope member (W050 carried)", () => {
    const family = aRegimeFamily();
    const tampered = {
      ...family,
      scope: { ...family.scope, tenantId: "" } as TimeMachineScope,
    };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("blank-scope-member"));
  });

  it("refuses an unknown family kind (§13's closed set)", () => {
    const family = aWalkForwardFamily();
    const tampered = { ...family, kind: "bogus" as typeof family.kind };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.deepEqual(codes(validation), ["unknown-family-kind"]);
  });

  it("refuses a non-canonical carried universe (A9 canonical orders)", () => {
    const family = aVenueFamily();
    const carried = family.universe as Extract<SplitAtomUniverse, { kind: "venue" }>;
    const tampered = {
      ...family,
      universe: { kind: "venue" as const, venueIds: [...carried.venueIds].reverse() },
    };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.deepEqual(codes(validation), ["universe-not-canonical"]);
  });

  it("refuses W037-carried split-shape violations on partition families", () => {
    const family = aVenueFamily();
    const split = family.splits[0]!;

    const overlapping = withSplit(family, {
      ...split,
      train: [...split.train, split.evaluation[0]!],
    });
    const overlappingValidation = validateSplitFamily(overlapping);
    assert.ok(!overlappingValidation.ok);
    assert.ok(codes(overlappingValidation).includes("overlapping-split-sides"));

    const duplicated = withSplit(family, {
      ...split,
      evaluation: [...split.evaluation, split.evaluation[0]!],
    });
    const duplicatedValidation = validateSplitFamily(duplicated);
    assert.ok(!duplicatedValidation.ok);
    assert.ok(codes(duplicatedValidation).includes("duplicate-split-atom"));

    const emptied = withSplit(family, { ...split, train: [] });
    const emptiedValidation = validateSplitFamily(emptied);
    assert.ok(!emptiedValidation.ok);
    assert.ok(codes(emptiedValidation).includes("empty-split-side"));

    const rekinded = withSplit(family, { ...split, kind: "regime" });
    const rekindedValidation = validateSplitFamily(rekinded);
    assert.ok(!rekindedValidation.ok);
    assert.ok(codes(rekindedValidation).includes("split-kind-mismatch"));

    // A venue atom re-rendered inside a venue split is lawful — pin the
    // mismatch on the regime family instead (a venue atom in a regime split).
    const foreignAtom = withSplit(family, {
      ...split,
      train: [{ kind: "venue", venueId: venueIdOf(split.train[0]!) }],
    });
    assert.ok(validateSplitFamily(foreignAtom).ok);
    const regimeFamily = aRegimeFamily();
    const regimeSplit = regimeFamily.splits[0]!;
    const foreignRegime = withSplit(regimeFamily, {
      ...regimeSplit,
      train: [{ kind: "venue", venueId: "venue-cme" }],
    });
    const foreignValidation = validateSplitFamily(foreignRegime);
    assert.ok(!foreignValidation.ok);
    assert.ok(codes(foreignValidation).includes("split-atom-kind-mismatch"));
  });

  it("refuses a partition split that does not re-derive (A9 re-generation)", () => {
    const family = aVenueFamily();
    const split = family.splits[0]!;
    const dropped = withSplit(family, {
      ...split,
      evaluation: split.evaluation.slice(0, 1),
    });
    const validation = validateSplitFamily(dropped);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("generation-mismatch"));
  });

  it("refuses a blank split axis (W037 carried)", () => {
    const family = aVenueFamily();
    const tampered = {
      ...family,
      splits: [{ ...family.splits[0]!, axisId: "" }],
    };
    const validation = validateSplitFamily(tampered);
    assert.ok(!validation.ok);
    assert.ok(codes(validation).includes("blank-split-axis"));
  });
});
