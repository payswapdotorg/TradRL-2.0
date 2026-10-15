# body-forge/commissioning (W043 — Autonomous Body commissioning)

The pure, typed act that brings an autonomous Body **INTO EXISTENCE** as
an attachable agent — the §12 chain's last pure step before runtime:
W039 organizations declare positions and compile binding plans, W042
selects the substrate empirically, W041's forge forges the
**ForgedBodyPlan** (the plan, never the act) — and `commissionBody` seals
the **activation record**: the **CommissionedBody**.

## What this module OWNS

- **commissionBody(forgedPlan, selectionPlan, registry)** — THE GATE:
  - the W040 registry re-proven through its OWN validator (errors
    carried verbatim) and scope-proven against the plan body;
  - the forged plan re-proven through the forge's own validation seams
    (the W032 descriptor gate with errors carried verbatim; the plan-id
    prefix law; the sealed endowment manifest's internal laws; the W032
    initial-attachment law; the W034 seams re-derived — possession
    digest, lineage anchor, lineage verification);
  - the selection plan re-proven through the W042 output laws over its
    recorded data (selected-first rank, R052 measured chain,
    live-at-selection states, honest carried counts, the closed
    variant-kind family) — **disclosed**: W042 ships no whole-plan
    validator, so its own walk's output invariants are re-proved here;
  - plan/selection **coherence**: scope + substrate identity (the
    selected substrate MUST be the plan's substrate reference — R050:
    the commissioning records the selection, never assumes a substrate)
    + endowment agreement (the sealed manifest's skills must be the
    plan's AND justified by the selection's evidence chain);
  - **liveness at commissioning time**: every endowment capability AND
    every selected-chain capability must be REGISTERED in the registry
    NOW — unregistered, deprecated or revoked (the W040 lifecycle
    carried verbatim) refuses the commissioning loudly; a **stale
    selection** is refused here;
  - possession compatibility re-proven through W034 **verbatim**
    (world-less — the W039 no-world precedent; the attach proof is
    W044's), then the possession lineage **EXTENDED** to the
    commissioned generation through W034's own `extendPossessionLineage`
    (the anchor is immutable — the chain only grows);
  - the sealed **CommissionedBody**: the attached body (W032 attachment,
    still unattached — declared, not yet bound), the selected-substrate
    binding, the endowment sealed VERBATIM from the plan (commissioning
    never invents a skill), the commissioned possession (new head +
    chain back to the plan's anchor), the explicit scope, the
    deterministic commissioning provenance (plan id + selection id +
    registry fingerprint + the grant's declared grantedAt — WHICH run),
    and the content-addressed commissioned id
    (`commission-<digest>` over plan id + selection id + lineage anchor
    + registry fingerprint).
- **validateCommissionedBody(record)** — whole-record re-validation from
  the record's OWN data: identity re-derivation, scope agreement, the
  binding laws (R050/R052), the manifest laws, the W032 unattached
  attachment law, the possession digest + anchor re-derivation, W034's
  `verifyPossessionLineage`, the commissioned-generation law, and the
  declared-time provenance law.
- **A9 determinism**: no clocks (the commissioning time is the grant's
  declared grantedAt — DATA), no randomness, no env reads — the same
  plan + selection + registry ALWAYS yield a byte-identical record and
  the same commissioned id (the twin law, pinned by tests).
- **Fail-closed, never a silent drop**: every law above is a loud typed
  error naming the law, with the upstream errors carried verbatim.

## What this module does NOT own (scope honesty)

- NO execution, NO trading, NO world running — commissioning COMPOSES
  the activation record (A14); it never executes it.
- NO world binding / attach — W044's world-agent-runtime binds
  commissioned bodies to Worlds (the attachment stays `unattached`;
  the W032 attach constraints are the runtime's proof).
- NO substrate/model selection — W042 owns the SelectionPlan; this gate
  records it, never re-chooses it (carry, never re-score).
- NO skill extraction / endowment derivation — the `skills` package and
  the W041 forge own those; the endowment is sealed VERBATIM from the
  plan.
- NO capability registration or lifecycle — W040 owns the registry;
  it is consumed and carried verbatim (the fingerprint commits to the
  exact registry content the commissioning saw).
- NO training, NO benchmarks — W049/W063 own those.
- NO store, NO persistence, NO I/O.

## Import law (disclosed)

`model-selection` is consumed through its package INDEX
(`../../model-selection/index.js`) via a RELATIVE import: the TL's
4445ed3 pre-registration froze body-forge's package.json (model-
selection is not among its declared dependencies, and the hoisted
node_modules linker does not expose undeclared workspace names), so the
index file is imported by path — the same "via each package's index"
law, mechanically adapted. All other consumed packages (`agent-body`,
`possession`, `capability-registry`, `skills`) are declared dependencies
imported by package specifier; the forge's own modules are imported
relatively (`../`) — this module lives INSIDE body-forge.

License: Apache-2.0 (the repository LICENSE).
