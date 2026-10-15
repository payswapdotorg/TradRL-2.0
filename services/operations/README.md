# operations (W061)

The pure ops-record **machinery** of TradRL 2.0's observability layer — the
sibling service of the `observability` contract package (the W035–W059 flat
source-exported pattern; the W050 `services/time-machine` shape).

## What this service OWNS

- **`trail.ts`** — `assembleTrail(records)`: DETERMINISTIC assembly over
  already-minted audit records — canonical sequence order (input order never
  leaks, A9), whole-record re-validation first (ids re-derived, W028
  provenance re-guarded — violations carried VERBATIM with indexes), one §14
  scope, a contiguous 1..n lineage (duplicates and gaps are loud typed
  violations), trail id + hash-chained head minted through the contract's own
  laws. `verifyTrail(trail)`: the END-TO-END tamper gate — every record's id
  re-derived from its own content (a rewrite is caught at the exact index),
  scope re-proven per record, the sequence axis re-walked, the whole digest
  chain RECOMPUTED from the scope anchor, head + trail id re-derived.
- **`reports.ts`** — `composeOperationsReport(trail, events)`: the
  deterministic operational report — FAIL-CLOSED over a trail that verified
  end-to-end (a tampered trail is refused with the verification carried),
  events re-validated + scope-checked + de-duplicated + canonically ordered
  by (declaredAt, eventId), counts carried in the closed vocabularies'
  canonical order (zero-filled), content-addressed `opr-<digest>` report id.
- **`validate.ts`** — whole-report re-validation: the report id re-derived
  from the carried summaries, count coherence (sums match the carried
  totals), window law, provenance citation law.

## What this service does NOT own (by law)

- **No scraping, no serving, no alerting** (A14) — it composes typed
  records; W062 (production deployment) renders the operations routes
  declared in `observability`; nothing here probes a system or fires a
  notification.
- **No contracts** — the event/audit/trail vocabulary lives in
  `packages/observability`; this service imports it, never re-declares it.
- **No persistence** — the records arrive as data; stores are elsewhere.
- **No authn/authz execution** (W060), no benchmark publication (W063).

## Determinism (A9)

Same records ⇒ same trail (id + head), bit-for-bit. Same trail + events ⇒
same report, bit-for-bit. No clocks, no randomness, no env reads — every
timestamp is DECLARED data carried by the caller.

License: Apache-2.0 (the repository LICENSE).
