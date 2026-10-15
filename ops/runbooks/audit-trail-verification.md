# Runbook — audit-trail verification (W062, through W061's machinery)

The operational procedure for verifying an audit trail end-to-end. The
machinery is W061's own: `packages/observability` (the record + trail
contracts) and `services/operations` (the assembly, verification and report
composition). This runbook cites it; it re-declares no law.

## Procedure

1. **Mint honestly.** Every audit record is minted through W061's
   `mintAuditRecord` — the closed audit-action vocabulary, the explicit §14
   scope, the actor, the W028 provenance citation (missing or malformed
   provenance is refused), the declared timestamp. Never hand-write a
   record.
2. **Assemble deterministically.** `assembleTrail(records)` (W061
   `services/operations`): the records are canonically ordered by their own
   sequence axis — the input's order never leaks (A9) — every record is
   whole-record re-validated first (violations carried verbatim with the
   offending index), all records must share ONE §14 scope, and the lineage
   must be contiguous. The trail id + hash-chained head are minted through
   the contract's own laws.
3. **Verify end-to-end.** `verifyTrail(trail)` — THE TAMPER GATE: every
   record's id is re-derived from its own content (a rewrite is caught at
   the exact index); every record's scope is re-proven; the sequence axis is
   re-walked; the whole digest chain is recomputed from the scope anchor
   (each link commits to the previous link, the record's content digest and
   the record's W028 citation digest); the head + trail id are re-derived.
   A verification failure names the exact break — read it, never re-run
   around it.
4. **Compose the report over a VERIFIED trail only.**
   `composeOperationsReport(trail, events)` is fail-closed over the
   verification: a tampered trail is refused with the verification outcome
   carried verbatim, never reported around. The events are re-validated,
   de-duplicated and canonically ordered; the counts are carried in the
   closed vocabularies' canonical order.
5. **Record the verification as an audit action.** The verification itself
   is auditable: the closed action `verification-run` (the incident
   vocabulary runbook) with the outcome carried as the record's declared
   detail.

## What this procedure does NOT do

- It never repairs a trail: the append-only law is structural; a broken
  chain is evidence of a rewrite, and the response is a NEW record + a new
  verification, never an edit.
- It never invents a number: every count in a report is carried by the
  report record over the verified trail (A6).
- It never scrapes, serves or alerts (A14).

## Citation chain

- W061 `packages/observability` — `mintAuditRecord`, `appendToTrail`,
  `auditLinkOf`, `auditTrailIdOf`, `validateAuditRecord`,
  `validateOperationalEvent`.
- W061 `services/operations` — `assembleTrail`, `verifyTrail`,
  `composeOperationsReport`, `validateOperationsReport`.

License: Apache-2.0 (the repository LICENSE).
