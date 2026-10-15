# trajectory (W037)

The trajectory CAPTURE protocol — the typed, fail-closed record of ONE
agent-world session's outcome. Flat source-exported contract package (the
W035 `agent-world-protocol` / W036 `learning-objectives` pattern).

## What this package OWNS

- **identity.ts** — the explicit trajectory scope
  (tenant/project/world/experiment/session) and the canonical id encoding:
  a canonical JSON serializer + FNV-1a digest (the repository's W004/W016
  hashing family, re-implemented in-package so the capture protocol never
  imports the engine package), the OPAQUE `TrajectoryId`
  (`trajectoryIdOf` — pure, A9-deterministic; the same scope bytes always
  yield the same id), and the blank-scope-member gate.
- **record.ts** — `TrajectoryRecord` (identity, session binding, the
  evidence stream bound via W036's `evidenceStreamOfSession` pairing law,
  the outcome summaries as the W036 `PolicyEvaluation` data, A9 determinism
  metadata (world definition digest, engine version, seed), immutable
  branch lineage); `trajectoryRecordOf` — the capture gate (terminal
  session, world agreement across scope/session/stream, pairing law, §10
  chain validation, policy evaluation, determinism metadata, lineage —
  every violation a loud typed error, W036's own errors carried verbatim);
  `validateTrajectoryRecord` — the re-validation gate for assembled records
  (the store append law).
- **store.ts** — the append-only store CONTRACT (typed interface + the
  L1–L5 laws: append-only, validation at append, identity uniqueness,
  ordered reads, fail-closed reads). Async by design — implementations do
  the I/O.

## What this package deliberately does NOT own

- NO storage engine, NO persistence, NO I/O — the store is a typed
  contract; implementations live elsewhere (their own work items).
- NO execution: the world runtime runs sessions (W035); this package
  records what already happened.
- NO re-scoring: the outcome summaries are carried as data produced by the
  W036 evaluation seams; re-deriving/verifying them is the
  evaluation/verification consumer's job (W038 walks what we record).
- NO enforcement (A13): the world runtime's gates stay the sole authority —
  this package MEASURES and RECORDS, never enforces.
- NO experiment protocol: experiment descriptors, holdout splits, and
  manifests live in the sibling `experiments` package (W037's second half).
- NO id parsing (DOMAIN-MODEL): the scope is carried explicitly on every
  record; nothing ever splits an opaque id.

Consumers: W038 (evaluation/verification — walks trajectories),
W041 (skill extraction), W047 (RL interface — deterministic episode
records).

License: Apache-2.0 (the repository LICENSE).
