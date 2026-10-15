# Runbook — the incident vocabulary (W062, aligned with W061)

The canonical vocabulary for describing operational incidents. Every
vocabulary below is OWNED by W061 `packages/observability` — this runbook
cites it verbatim and re-declares nothing. The alignment is pinned by the
`ops/` test suite against the real exported constants (`OPS_EVENT_KINDS`,
`AUDIT_ACTION_KINDS`, `OPS_HEALTH_STATUSES`, `OPS_ACTOR_KINDS`).

## The operational event kinds (the incident's WHAT)

An incident is described with W061's closed event-kind vocabulary — no other
kind is lawful, in an incident record or anywhere downstream:

- `artifact-published`
- `audit-appended`
- `dataset-imported`
- `evaluation-completed`
- `report-composed`
- `session-recorded`
- `world-created`
- `world-started`
- `world-stopped`

## The audit action kinds (what the responder DID)

Every responder action is recorded as a W061 audit record with one of the
closed audit actions:

- `config-declared`
- `data-exported`
- `policy-changed`
- `record-written`
- `report-composed`
- `verification-run`
- `world-accessed`

## The health statuses (the declared posture)

A health descriptor carries one of the closed statuses — statuses are
DECLARED DATA in W061 (no probing, no thresholding, no alerting there):

- `degraded`
- `down`
- `healthy`

## The actor kinds (WHO)

Every event/audit record names its actor with one of the closed actor kinds:

- `platform`
- `service`
- `tenant-operator`
- `worker`

## Procedure

1. **Classify the incident** with exactly one event kind from the closed
   vocabulary above. A phenomenon outside the vocabulary is FIRST a
   vocabulary question (take it to the owning package), never a silent
   free-form label.
2. **Record the response** as audit records with the closed audit actions,
   each citing its W028 provenance through W061's own citation vocabulary
   (an audit record without provenance is refused).
3. **Declare the posture** with a health descriptor (declared status, never
   a probe result), at the incident's explicit §14 scope.
4. **Assemble + verify** the trail through `services/operations`
   (`assembleTrail` + `verifyTrail`) — see the audit-trail verification
   runbook.

## What this vocabulary does NOT carry

- Numbers. No counts, durations or thresholds live in this runbook — every
  measured number is carried by a typed record (A6), never by a doc.
- Alerting rules, paging policies or notification wiring (A14 — W061 owns
  statuses as data; nobody here fires an alert).

License: Apache-2.0 (the repository LICENSE).
