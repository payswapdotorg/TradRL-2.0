# skills (W041 — Skill extraction)

The empirical bridge from **what happened** (W037 trajectories) to **what is
repeatable** (skills) — the middle of the §12 chain: W037 captures
trajectories, W040 registers capabilities with measured provenance, and
THIS package derives **skill records** from trajectory evidence against the
registry. W039's organizations compose bodies; the body-forge service
(W041, `services/body-forge`) endows composed bodies with these skills;
W042's empirical substrate/model selection builds on them.

## What this package OWNS

- **SkillRecord** — typed DATA: an opaque canonical id (`skill-<digest>`),
  the competence statement carried from the W040 capability it was
  measured as (kind/domain from W040's closed vocabularies — never
  re-declared), the evidence citations (the W037 trajectory canonical ids
  that demonstrated it + the capability's measured provenance carried
  verbatim), the bearer dimension (carried — WHO demonstrated it),
  explicit tenant/project/world scope, versioned immutable lineage, and
  deterministic extraction provenance (the `extraction-<digest>` run id).
- **extractSkills(trajectories, registry)** — the PURE extraction gate:
  inputs re-validated through W037's and W040's OWN gates (errors carried
  verbatim), scope agreement by field equality, then one candidate skill
  per REGISTERED measured capability the batch actually demonstrates.
  The **demonstrating binding** is structural: the trajectory's scope
  experiment member equals one of the capability's recorded provenance
  experiment citations, AND the trajectory's session names the
  capability's bearer. Measured summaries CARRY the records' own
  evaluation + session data verbatim — carry, never re-score.
- **Refusals as typed data** — no trajectory evidence ⇒ NO skill (the
  `no-trajectory-evidence` refusal names R052); deprecated/revoked
  capabilities refused loudly with the W040 lifecycle carried. Never a
  silent drop, never a label.
- **validateSkillRecord / validateSkillSet** — fail-closed re-validation
  from the recorded data: closed vocabularies, blank laws, R052
  evidence-presence, citation laws, canonical order, the summary-evidence
  carry law, lineage shape + chain laws, the duplicate/scope collection
  laws, and the identity law (the id IS the canonical derivation of the
  record's content).
- **Identity** — canonical JSON + FNV-1a in-package (the W037/W039/W040
  family, byte-compatible); the skill id weighs WHAT WAS DEMONSTRATED
  (capability + kind/domain + bearer + scope + sorted trajectory ids +
  lineage), NOT the run id — re-extracting the same evidence yields the
  same skill id with fresh run provenance.

## What this package does NOT own (scope honesty)

- NO measurement, NO execution, NO model calls, NO training — extraction
  is a pure walk over records; the measuring lived in the W037/W038
  artifacts the inputs record.
- NO capability registration (W040 owns the registry and its R052 gate —
  this package CONSUMES it and carries its errors/lifecycle verbatim).
- NO trajectory capture (W037 owns the capture protocol — re-validated
  here, never re-run).
- NO substrate/model selection (W042), NO body composition or possession
  (the body-forge service / W039 / W034), NO commissioning or runtime
  execution (W043+).
- NO store, NO persistence, NO I/O.

## Laws pinned by tests

R052 (no evidence ⇒ no skill, refused loudly naming the law) · A9 (same
trajectories + same registry ⇒ deep-equal run, same ids, input order never
leaks; the twin law) · A6 (evidence-linked truth — every skill cites the
trajectories that demonstrate it) · carry-never-re-score (summaries carry
the records' own outcome data) · fail-closed at every seam (upstream
errors carried verbatim, never re-derived) · identity laws (opaque ids,
canonical encoders, explicit scope, immutable lineage).

License: Apache-2.0 (the repository LICENSE).
