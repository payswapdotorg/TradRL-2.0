# Walk-forward benchmark evidence publication

Publication record id: `pub-walk-forward-evidence-v1` (the declared
publication family in `research/benchmarks`; a sealed publication over
real records cites this id and is content-addressed `bp-<digest>` by the
publication gate).

## What this family publishes

The reproducible publication of evaluated **walk-forward holdout**
evidence: one W052 walk-forward split family, the W038 evaluation +
verification findings it judged, the W051 search history it came from,
the W061 audit trail that custodies it, and the W022 replay-fidelity
verdicts its reproducibility rests on. Publication is composition +
citation (A14): nothing is measured here — every number on a sealed
record is carried by its cited record (A6).

## The citation chain

- **Split family** — `packages/evaluation-splits` (W052): the opaque
  `fam-<digest>` id, the kind, and the record's own carried split and
  fold counts. Re-proven through W052's own `validateSplitFamily` (its
  errors carried verbatim).
- **Evaluation + findings** — `packages/evaluation` +
  `packages/verification` (W038): the opaque `expeval-<digest>` id, the
  experiment and policy it answers, the verification findings digest,
  and the carried outcome-side counts. Re-proven through W038's own
  id/digest/order laws.
- **Search history** — `packages/search-integrity` (W051): the opaque
  history id and the carried trial/selection counts, under the
  search-history integrity law. Re-proven through W051's own
  `validateSearchHistory` (its errors carried verbatim).
- **Audit trail** — `packages/observability` + `services/operations`
  (W061): the opaque `atr-<digest>` trail id, the hash-chain head, and
  the carried record count. Re-proven through operations' end-to-end
  `verifyTrail` (its failure carried verbatim).
- **Reproducibility verdicts** — `packages/tradrl-evaluation/replay`
  (W022): see below.

## Reproducibility statement

The reproducibility manifest of every publication in this family is in
the W022 claim shape and is BACKED, claim by claim, by carried W022
replay-fidelity findings — a verdict the cited findings do not carry is
a loud typed refusal (A6). This family requires the claims (verbatim ids
from the W022 claim registry):

- `ns-to-ms-exact-digit-truncation` — ns→ms by exact digit truncation
- `int64-carrier-fidelity` — int64 ns carrier fidelity (string/number)
- `a9-double-map-determinism` — double-map determinism (A9)

The manifest carries each claim's registry descriptor verbatim
(claimId/title/family/module), the verdict carried from the cited
finding, and that finding's own digest. The claims above are the W022
registry's own words; this doc adds no verdicts of its own.

## Scope + integrity

One explicit scope (tenant/project/world) proven identical across the
cited family, history and audit trail; the family is proven to have
JUDGED the evaluation (every family split carried by the evaluation's
own holdout aggregations); the search history is proven to have run
under the evaluation's own experiment. Same cited records ⇒ deep-equal
publication, same canonical id (A9).

License: Apache-2.0 (the repository LICENSE).
