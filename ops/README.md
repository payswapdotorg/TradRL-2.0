# ops/ — the OPERATIONAL SURFACE (W062)

One plain directory (deliberately NOT a workspace package — the W063
`docs/benchmarks` + `research/benchmarks` precedent): no `package.json`, no
lockfile entry, no dependencies of its own.

## What this directory OWNS

- **The production-readiness checklist CONTRACT** (`readiness.ts` +
  `validate.ts`): typed, validated data. Every readiness gate is a PROVEN
  CITATION of a real battery surface — the closed package vocabulary is
  bound to REAL exported consts of the consumed packages (the compile-time
  drift guard), the battery command is DERIVED (`pnpm --filter <package>
  <battery>` — never free-form), and every number (exit code, test count,
  measured head) is CARRIED by the gate record (A6 — never invented, never
  inferred). `composeReadinessChecklist` is the gate (fail-closed, all
  violations collected: green-only, derived commands, carried counts, no
  duplicates, WHOLE-surface coverage); `validateReadinessChecklist`
  re-validates from the recorded data alone (ids re-derived).
- **The operational runbooks** (`runbooks/`): canonical markdown, one per
  procedure — deployment review, the incident vocabulary (aligned with
  W061's observability event kinds, pinned against the real exported
  constants by the test suite), and the audit-trail verification procedure
  (through W061 `services/operations`' trail verification). The runbooks
  carry NO numbers: every measured number lives on a typed record.

## What this directory does NOT own (A13/A14)

- **Battery execution** — the contract records what was measured; the
  operator (or the TL's harness) runs the commands. Nothing here spawns a
  process at runtime.
- **Monitoring, scraping, alerting, paging, serving** — statuses and
  counts are declared data (W061 owns the vocabulary); no thresholds, no
  notifications.
- **Any number** — no doc or contract in this directory invents a metric.

## Disclosed design decisions

1. **The coverage law**: a lawful checklist carries EVERY package of the
   closed vocabulary × EVERY battery (the full battery surface of this
   dependency family). A subset is refused loudly (`coverage-gap`) —
   production readiness is whole-surface, never partial.
2. **The gate record is measured data, not a measurement**: the contract
   validates what is carried (green exit, derived command, carried count,
   explicit measured head); it cannot and must not re-run anything (A13).
   The pinned fixture in the test suite carries the counts measured at this
   work item's head, with the head SHA cited on every gate.
3. **The incident-vocabulary runbook is test-pinned against W061's real
   exported constants** — the runbook file is read by the test suite
   (run from the repo root) and its vocabularies are proven equal to
   `OPS_EVENT_KINDS` / `AUDIT_ACTION_KINDS` / `OPS_HEALTH_STATUSES` /
   `OPS_ACTOR_KINDS`, so the doc cannot drift from the owning package.
4. **Run the tests** (repo root): `npx tsx --test ops/*.test.ts`.

License: Apache-2.0 (the repository LICENSE).
