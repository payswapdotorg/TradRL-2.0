# populations (W045)

Multi-agent populations: the typed record of MANY agents bound into one
world — ARCHITECTURE.md §12 "Organization discovers capabilities and
composes Bodies", composed one level up. W044 binds individual
commissioned agents (and whole organizations, through their compiled
plans) to a World; **W045 composes those bindings into a POPULATION**:
the membership (each member a proven W044 binding, carried VERBATIM),
the canonical member order, the aggregate view AS CARRIED DATA, and the
immutable generational lifecycle — populations evolve by adding and
retiring members, and every transition seals a NEW generation; the
lineage is never rewritten. R053's "Organization is optimizable" moves
over populations as its substrate; R050/R051 are carried through the
member bindings themselves.

## What this package owns

- **`population.ts`** — `foundPopulation(worldIdentity, bindings)` + the
  `Population` record: the founding GATE re-proves every member through
  world-agent-runtime's own validators (W044's errors carried
  verbatim), proves scope agreement and that every member's slot is a
  REAL declared participant of the world, refuses duplicate member ids
  and empty membership, then seals the content-addressed
  `pop-<digest>` record — membership in canonical binding-id order, the
  aggregate view carried (the pure projection of `view.ts`), the
  explicit scope, the genesis lineage, deterministic provenance (A9:
  the seal time is the members' own declared `boundAt`, never a clock).
- **`transitions.ts`** — `addMembers` / `retireMembers` /
  `ablateMembers` (the ablation op citing the W036/W039 axis
  vocabulary): every transition re-validates the PARENT generation
  first (a broken lineage never extends — this package's own
  validation errors carried verbatim), re-proves the W040 registry
  through its own validator (carried verbatim) with scope agreement,
  re-proves every NEW member through W044's validator (carried
  verbatim) with scope agreement and duplicate refusal, demands
  retirements as DATA (member id + non-blank reason; unknown ids,
  duplicates and blank reasons refused), refuses an empty result (the
  lineage never dead-ends), and refuses DEAD endowment capabilities at
  transition time LOUDLY — a capability borne by a member's substrate
  surface (the W040 bearer dimension) that is now deprecated or
  revoked, with the registry's own lifecycle transitions carried
  verbatim. Then the NEW generation is sealed citing its parent; the
  parent record is never mutated in place.
- **`view.ts`** — `membersView`: the PURE aggregate projection —
  per-capability coverage (the observation kinds and command kinds the
  members' own W044 routing contracts carry), per-position fill (the
  W039 positions realized by organization members' seats), the
  membership census — all CARRIED from the members' own records,
  canonical-id ordered, never re-scored.
- **`validate.ts`** — `validatePopulation`: whole-population
  re-validation from recorded data alone — identity re-derivation, the
  canonical membership laws, every member re-proven through W044's
  validators (errors carried verbatim), the CARRY law (the recorded
  view must deep-equal the pure projection — a drifted view is a
  re-scored view, refused), the lineage laws, the provenance laws.

## What this package does NOT own

- **No world execution** — a population COMPOSES records (A14); it
  never steps a world, never executes a trade, never routes an
  observation or action (W044's routing owns the wiring).
- **No curriculum, no self-play, no adversarial populations** — W046
  owns them; this package is the membership/lineage substrate they
  build on.
- **No episode generation** — W048's distributed episode generation
  CONSUMES populations; it is not built here.
- **No training** — no model training of any kind (W047 owns the RL
  trainer bridge).
- **No member minting** — members are proven W044 bindings; this
  package never commissions, forges, or binds (that authority stays in
  W041/W042/W043/W044).

## Conventions

Flat source-exported package (the W035–W044 pattern): the package.json
`exports` map points at TypeScript sources; `tsc -p .` typechecks
including tests; `tsx --test test/*.test.ts` runs node:test +
node:assert/strict over REAL imports — real W044 bindings built through
world-agent-runtime's own gates (its test fixtures imported via the
disclosed cross-package relative path, themselves built through
body-forge's commissioning fixtures and the W039 compiler's own gate),
real W040 registries including the deprecated/revoked momentum
variants. Every file ≤ 400 lines. Apache-2.0 (the repository LICENSE).
