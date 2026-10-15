# evaluation-splits (W052) — the split family contract

The SPLIT FAMILY CONTRACT: the declarative catalogue + deterministic
GENERATION of evaluation split families, as typed DATA. This package is the
W052 link in the evaluation chain — W037 shipped the `HoldoutSplitDescriptor`
+ split atoms + manifest gates; W038 evaluates experiments over splits; W050
ships point-in-time views (the sealed cutoffs); W051 ships search integrity
(the citation law). **This package generates the families**: walk-forward
window sequences, regime/asset/venue partitions, and the family validation
laws (disjointness, coverage, no-leakage through W050's cutoffs).

## What this package OWNS

- **families.ts** — the `SplitFamily` record (typed DATA): the
  content-addressed `fam-<digest>` id over the canonical declaration, the
  family policy (the closed §13 kind set: `walk-forward` / `regime` /
  `asset` / `venue` — carried verbatim out of W037's own descriptor kind
  vocabulary), the input range (W004's time vocabulary, extracted from
  W037's period atoms), the declared atom universe (W037's own atom
  vocabulary), the explicit scope (W050's `TimeMachineScope`, carried
  verbatim), the immutable lineage (the W037/W051 branch-lineage pattern),
  the deterministic provenance, and the W051 citation seam
  (`splitFamilyCitationOf` — a family used in a search is citable under
  §13). `buildSplitFamily` is THE CONSTRUCTION GATE (fail-closed, every law
  named, generator refusals carried verbatim). `atomSideOf` names an atom's
  side of one split in W038's own side-assignment vocabulary.
- **generate.ts** — THE GENERATORS (pure, deterministic):
  `generateWalkForward(range, windowPolicy)` rolls the train/evaluation
  window sequence — fold *i* trains on
  `[from + i·evaluationWindowMs, … + trainWindowMs)` and evaluates on the
  next `evaluationWindowMs` slice (the final slice clipped to `range.to`);
  every boundary an explicit W004 timestamp; every fold carries a sealed
  W050 `PointInTimeCutoff` equal to its train side's end — the R016
  no-leakage seam; the evaluation windows tile
  `[from + trainWindowMs, range.to]` exactly (disjoint + covering).
  `generateRegimePartitions` / `generateAssetPartitions` /
  `generateVenuePartitions` partition the declared atom universe (canonical
  code-unit order) under the closed partition-rule set
  (`tail-holdout` / `round-robin` / `explicit`) into disjoint, non-empty
  sides, emitted in W037's own `HoldoutSplitDescriptor` shapes.
- **validate.ts** — whole-family re-validation: the identity
  re-derivations (family id, provenance, lineage), the A9 re-generation
  proof (same range + same policy → deep-equal folds/splits), the
  disjointness/coverage proofs, THE NO-LEAKAGE LAW re-proven per fold
  naming R016 (a fold whose evaluation side could see its train side's
  future through an unsealed view is refused loudly), and the W037
  split-shape laws re-proven with W037's own error codes (`blank-split-axis`,
  `invalid-period-atom`, `empty-split-side`, `duplicate-split-atom`,
  `overlapping-split-sides`, `split-kind-mismatch`,
  `split-atom-kind-mismatch` — carried verbatim).

## What this package does NOT own

- **No evaluation** — walking experiments over splits, per-side
  aggregations, compliance gating: that is W038 (`evaluation`).
- **No outcome learning** — W053 builds on these families.
- **No benchmark publication** — W063 builds on these families.
- **No point-in-time sealing** — the cutoff vocabulary and the firewall are
  W050 (`tradrl-time-machine`); this package only *stamps and proves*
  cutoffs at fold boundaries.
- **No search-history records** — W051 (`search-integrity`) owns the
  record; this package only produces citable family ids (the citation seam).
- **No experiment manifests** — W037 (`experiments`) owns the manifest gate
  that binds splits to declared policy axes; the families this package
  generates produce W037's descriptor *shapes*.

## The laws (spec anchors)

- **§13** (spec/ARCHITECTURE.md, through W051's own constant): the four
  holdout kinds are first-class — `walk-forward`/`regime`/`asset`/`venue`
  as a closed set.
- **R016** (spec/REQUIREMENTS.md, through W050's own constant): window and
  side boundaries are proven against sealed cutoffs — any overlap leak is
  refused loudly, naming R016.
- **A9** (spec/ARCHITECTURE-LOCK.md): same input range + same family
  policy → deep-equal family, same canonical ids; no clocks, no
  randomness, no env reads. The canonical id order is plain code-unit
  comparison (never `localeCompare`, never the environment).
- **A14** (spec/ARCHITECTURE-LOCK.md): the package GENERATES typed split
  descriptors as data — never evaluates, never scores; carry never
  re-score.
- **Fail-closed at every seam**: malformed ranges (W004/W037 errors
  carried), empty sides, non-disjoint partitions, duplicate atoms, lineage
  breaks — every one a loud typed error naming the law.
- **Identity laws** (spec/DOMAIN-MODEL.md): ids are opaque and
  content-addressed; the scope is explicit; the lineage rides beside the id.

## Notes (deliberate, disclosed)

- `trajectory` is a dependency for the house digest family
  (`canonicalDigestHex` + `canonicalString`) — the same primitive every
  content-addressed id in this repository uses (the W046–W051 precedent);
  it is not in the work order's "expected" list and is disclosed as such.
- The walk-forward roll stride IS the evaluation window length (the
  canonical no-gap/no-overlap roll); the final evaluation window is clipped
  to the range's end so the tiling covers the whole evaluation span.
- Fold axis ids are derived as `${axisId}-fold-<index>` — one unique axis
  per fold (W037's one-axis-one-split law).
- The fold's sealed cutoff equals its train side's end: everything the
  train side may know is at or below it, every evaluation-side instant is
  after it (the leak-proof direction W050's firewall enforces).
- Test fixtures import the REAL W050 test fixtures
  (`tradrl-time-machine/test/fixtures.js`) for the shared scope constants
  and epoch — the W041+ fixture-lineage precedent.

License: Apache-2.0 (the repository LICENSE).
