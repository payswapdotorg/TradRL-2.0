# body-forge (W041 — the Body Forge)

The pure forge that composes **Bodies endowed with skills** — the builder
in the §12 chain: W037 captured trajectories, W040 registered the
measured capabilities, the `skills` package (W041) derived skill records,
W039's organizations declare demands and compose — and THIS service takes
a typed component input and produces the **ForgedBodyPlan** the runtime
commissioning path (W043+, reserved at `services/body-forge/commissioning/`)
will consume.

## What this service OWNS

- **forgeBody(components)** — the pure composition gate: given a W033
  substrate reference, body requirements, the endowed W041 skill records
  and the W040 capability registry, produce the **ForgedBodyPlan**:
  - the composed W032 **BodyDescriptor** (composed verbatim from the
    requirements, validated through W032's OWN gate with errors carried
    verbatim);
  - the **skill endowment manifest** (which skills, which capability,
    which evidence — canonical skill-id order, input order never leaks);
  - the **possession plan**: the deterministic possession id, the W034
    grant + scope carried verbatim, the possession digest, the initial
    possession lineage + its anchor (`initialPossessionLineage` /
    `lineageAnchorOf`, W034's own seams), and the world-less
    compatibility evidence proven through `checkPossessionCompatibility`
    (W034 carried verbatim — the W039 no-world precedent: the W032 attach
    constraints are NOT claimed here, attaching is the runtime's proof);
  - the W032 **initial body attachment** (declared, not yet bound);
  - the deterministic **content-addressed plan id** (`forge-<digest>`).
- **Fail-closed, never a silent drop**: an invalid body (W032 errors
  carried), an invalid registry (W040 errors carried), a registry/body/skill
  scope disagreement, an invalid skill (the skills package's errors
  carried), a duplicate skill id, an UNREGISTERED skill, a deprecated or
  revoked capability in the endowment (the W040 lifecycle carried
  loudly), a skill not demonstrated by the forging substrate (§12: the
  substrate carries ITS competence into the body it will possess), or an
  incompatible possession (W034 incompatibilities carried verbatim) —
  each is a loud typed error naming the law.
- **A9 determinism**: no clocks, no randomness, no env reads — the same
  components ALWAYS yield a byte-identical plan and the same id (the
  twin law, pinned by tests).

## What this service does NOT own (scope honesty)

- NO commissioning — `services/body-forge/commissioning/` is RESERVED
  for W043 and deliberately does not exist yet; the forge's public
  surface is composable so W043 can extend it.
- NO execution, NO possession runtime, NO attach, NO running — the forge
  COMPOSES typed plans, it never executes them (A14 boundaries). The
  world-less compatibility proof claims exactly what W034 proved.
- NO substrate/model selection (W042 — the substrate reference is an
  input, never a choice made here).
- NO skill extraction (the `skills` package owns extraction — skills are
  re-validated here, never re-derived).
- NO capability registration or lifecycle (W040 owns the registry —
  consumed and carried verbatim).
- NO store, NO persistence, NO I/O.

## The endowment law (documented, pinned by tests)

A forged body is endowed only with skills demonstrated by the VERY
substrate that will possess it (bearer = the forging substrate), and
only where they were measured (scope agreement by field equality) — the
§12 law: an Agent is a Body possessed by a Cognitive Substrate, so the
competence the plan claims is the SUBSTRATE's own measured competence.

License: Apache-2.0 (the repository LICENSE).
