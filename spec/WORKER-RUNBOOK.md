# TL and Worker Runbook

## TL

The Tech Lead is the sole orchestrator.

Owns:

- program/graph.json
- readiness calculation
- worker dispatch
- shared-file serialization
- reviews/merges
- state synchronization
- architecture clarifications via repository edits
- final acceptance

## Workers

Workers implement only assigned Work Orders.

Every worker receives:

- Work Order id
- exact base SHA
- branch
- dependencies
- frozen write surface
- acceptance criteria
- test commands
- evidence format

## Three-worker concurrency law

Maximum active Work Orders: 3.

The TL must prefer 3-way concurrency when the graph exposes 3 independent ready items.

Two items may be concurrent only if their dependency and write-surface sets are safe.

The same file, shared fixture or protocol surface cannot be owned concurrently.

## Worker branch law

One Work Order = one branch = one PR = one worker.

No force-push after dispatch.

Meaningful checkpoints must be pushed.

## Shared surfaces

Serialized TL-owned surfaces:

- root package.json
- pnpm-lock.yaml
- architecture-policy.yaml
- shared protocol indexes
- WorkspaceShellLayout
- workspaceSidePane state registry
- global CI workflows

## Tests

Every behavior change must add/update tests.

UI changes require browser/E2E evidence.

World changes require headless deterministic evidence.

Run:

- pnpm typecheck
- pnpm lint

plus target tests.

## Merge

TL verifies:

1. base SHA
2. write surface
3. tests
4. lint/typecheck
5. architecture checks
6. license/third-party compliance
7. merge-result gates against current main

Then squash merge and update the graph/state.

## Re-entry

If a worker dies:

- inspect surviving GitHub branch;
- audit pushed checkpoints;
- recover sound work;
- do not blindly redo it.

## User interaction

Workers and TL do not ask the user questions for decisions already defined by the repository.
