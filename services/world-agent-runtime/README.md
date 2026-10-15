# world-agent-runtime (W044)

The typed wiring layer that BINDS commissioned agents — and whole
organizations, through their compiled plans — to a World.

The chain this service closes (ARCHITECTURE.md §12): W032 bodies, W033
substrates, W034 possession grants, W039 organizations + compiled binding
plans, W041 forged plans, W042 empirical substrate selection, W043
`CommissionedBody` activation records — and **W044, the missing bridge**:
the runtime binding record that attaches a commissioned agent to a world
participant slot, routes observations in and actions out through W035's
protocol surface, and routes EXECUTION AUTHORITY exclusively through W034
possession grants (A13: execution authority is always outside model
outputs — the runtime never lets a model claim authority; grants do).

## What this package owns

- **`contracts.ts`** — the typed wiring records (`AgentBinding`,
  `OrganizationBinding`, the participant-slot attachment in the W023
  vocabulary, the observation routing contract carrying a REAL W035
  `ObservationProtocolConfig`, the action routing contract whose every
  authority channel cites its covering W034 grants) + the closed error
  family.
- **`binding.ts`** — `bindAgent(worldIdentity, commissionedBody, grants)`
  and `bindOrganization(worldIdentity, compiledPlan, commissionedBodies,
  grants)`: THE GATES. Every CommissionedBody re-proven through
  commissioning's own validation (errors carried verbatim); the compiled
  plan re-proven through the W039 compiler's own recorded output laws
  (canonical binding order, execution-order permutation, per-seat grant +
  scope + compatibility evidence — W039 ships no whole-plan validator,
  so its walk's output invariants are re-proved from recorded data, the
  W042/W043 precedent); world-scope agreement across body/plan/grants;
  the W023 participant-slot lookup; every grants entry LIVE (a
  released/revoked possession never authorizes) and its record matching
  its descriptor; the commissioned possession itself among the grants
  (R050); the W034 compatibility re-proof **WITH THE WORLD** — the
  attach proof W039/W043 deferred to the runtime; endowment capability
  liveness at binding time (the W040 lifecycle carried verbatim); then
  the sealed, content-addressed record (A9: same commissioned body +
  same compiled plan + same world identity ⇒ deep-equal binding, same
  canonical id; the binding time is the latest declared grantedAt —
  DATA, never a clock read).
- **`routing.ts`** — the pure routing WIRING: `routeObservationEvent`
  (an inbound observation event → the addressed substrate surface) and
  `routeActionIntent` (an outbound action intent → its authority-proof
  chain — which grant authorizes exactly it). Fail-closed on unknown
  channels; an intent with no covering grant is refused LOUDLY (A13).
- **`validate.ts`** — whole-binding re-validation from recorded data
  alone (identity re-derivation, slot laws, routing-contract laws,
  lineage laws, provenance laws, organization seat laws).

## What this package does NOT own

- **No world execution** — a binding is wiring DATA; the world engine
  (W006+) owns execution; this runtime never steps a world, never
  executes a trade, never issues a command (A14).
- **No training** — no model training of any kind.
- **No multi-agent populations** — W045 owns population dynamics.
- **No RL trainer bridge** — W047 owns it.
- **No session lifecycle** — W035 owns the live attach → observe →
  decide → act → detach session; a W044 binding is the typed wiring a
  session is constructed FROM.

## Conventions

Flat source-exported package (the W035–W043 pattern): the package.json
`exports` map points at TypeScript sources; `tsc -p .` typechecks
including tests; `tsx --test test/*.test.ts` runs node:test +
node:assert/strict over REAL imports — real commissioned bodies through
commissioning's own gate (imported from body-forge's commissioning test
fixtures, a disclosed cross-package relative import), a real compiled
plan through the W039 compiler's own gate, real W040 registries, real
W034 grants, and the W035-protocol-style world definition adapted for
the commissioning fixture's seat. Every file ≤ 400 lines. Apache-2.0
(the repository LICENSE).
