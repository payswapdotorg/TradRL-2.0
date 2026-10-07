# tradrl-world-sim (W013 — headless deterministic World engine skeleton)

The deterministic world-engine **skeleton**: the clock, world core and journal
modules — the headless runtime foundation for W014 (orderbook/matching),
W015 (account/portfolio/risk), W016 (journal/snapshot/branch — journal basics
live here), W017 (generator) and W018 (worker adapter).

- Spec: `spec/SIMULATION.md` (determinism, event ordering, runtime topology,
  seed/version discipline), `spec/WORLD-PROTOCOL.md` (command lifecycle,
  event envelope, ports), `spec/DOMAIN-MODEL.md`, `spec/ARCHITECTURE-LOCK.md`
  (A6–A9), `spec/ACCEPTANCE-WORLD-ALPHA.md` (headless runner, parity,
  deterministic replay).
- Contracts: consumes **exactly** `tradrl-world-contracts` (`src/` + `time/`,
  W003/W004) — zero other runtime dependencies.
- Headless: pure Node, no DOM/worker/process deps (the worker adapter is
  W018's surface).

## Module map

| Module | Files | Spec anchors |
| --- | --- | --- |
| `clock/` | `simulationClock.ts` — `createSimulationClock`, `asClockPort` | SIMULATION "Runtime topology", WORLD-PROTOCOL "ClockPort"/"Time", LOCK A7/A8, ACCEPTANCE E |
| `journal/` | `eventJournal.ts` (append-only store, sequencing, laws, queries, digest, restore), `replay.ts` (deterministic fold) | WORLD-PROTOCOL "Event envelope", LOCK A6/A9, DOMAIN-MODEL "Ownership: Journal → authoritative history" |
| `world/` | `definition.ts`, `state.ts` (event reducer), `lifecycle.ts`, `engine.ts`, `projections.ts`, `manifest.ts`, `events.ts`, `hashing.ts`, `errors.ts` | WORLD-PROTOCOL "Command lifecycle" + "Ports", LOCK A5/A6/A13/A14, ACCEPTANCE E/L/K/I |

## Command lifecycle wiring (WORLD-PROTOCOL.md)

```
command ─▶ validate ─▶ authorize ─▶ apply domain rules ─▶ journal append
        ─▶ mutate state (reduce journaled events) ─▶ publish projections ─▶ ack
```

- **validate** (`lifecycle.ts`): W003 error codes — base fields, per-kind
  structural checks, entity lookups (instrument/account/participant/order),
  `duplicate-command` against the event-derived acked set.
- **authorize**: A13 runtime controls — `permission-denied` (participants act
  only through their declared account), `account-not-tradable`.
- **apply domain rules**: real drafts for `add-annotation` and `set-scenario`;
  honest typed `not-implemented-in-skeleton` rejections for the rest (below).
- **journal append**: the journal is the single writer of `sequence` and
  deterministic `eventId`; stream laws enforced on every append.
- **mutate**: state advances ONLY by reducing journaled events
  (`state.ts`) — the exact code path replay uses, which is what makes
  replay bit-identical.
- **publish**: the `onPublished` engine option (post-mutation side-channel
  for W018's streaming adapter; never state).
- **ack**: `CommandAck` with `resultingEventIds` + `journalCursor`.

Commands and clock operations serialize through one arrival-order queue;
emitted events are stamped at the current **simulation** time.

## Determinism proof (the A9 golden test)

`world/test/determinism.golden.test.ts`: fixed world definition + fixed seed
+ seeded command stream (mulberry32: acked annotations, scenario sets,
structural/unknown-entity/stub/duplicate rejections, interleaved clock ops)
⇒

1. two independent engine instances produce **identical journal digests**
   (W004 `eventStreamDigest`), **identical determinism manifests** and
   **identical authoritative state**;
2. wall time (varied between runs) never leaks into any of them (A7);
3. a **fresh instance replaying the same journal** reproduces digest + state
   and preserves the duplicate-command law and stub boundary;
4. the journal passes W004's `validateEventStream`; a different command
   stream produces a different digest (sensitivity).

## Stub boundary (honest, typed, work-order-named)

| Surface | Behavior today | Owner |
| --- | --- | --- |
| `submit-order` / `close-position` | `not-implemented-in-skeleton` (domain-rules stage) | W014 + W015 |
| `cancel-order` / `replace-order` | `unknown-order` (validate stage — the registry is truly empty) | W014 |
| `create-snapshot` / `branch-world`, `QueryPort.getSnapshot` | `not-implemented-in-skeleton` / typed error | W016 |
| `getQuote` | typed error | W017 |
| `getOrderBook`, `getTrades` | typed error | W014 |
| `getPortfolio`, `getRisk` | typed error | W015 |
| `getOrders`, `getPositions` | honest empty lists | W014/W015 fill |
| Web Worker adapter | none (in-process only) | W018 |

Financial fields of the headless report (balances/positions/P&L/risk) are
deliberately absent until W015 — never faked (SIMULATION.md "Headless
report").

## Gates

```bash
corepack pnpm --filter tradrl-world-sim typecheck   # tsc -p . (noEmit)
corepack pnpm --filter tradrl-world-sim test        # tsx --test (node:test)
corepack pnpm --filter tradrl-world-sim lint        # oxlint
```

The package is source-exported (no build artifact), mirroring
`tradrl-world-contracts`. Note for reviewers: this sandbox cannot run
`pnpm install` (the root lockfile is TL-owned/frozen), so the
`tradrl-world-contracts` workspace link is provided via an untracked
`node_modules` symlink during review runs; a post-merge `pnpm install` wires
the declared `workspace:*` dependency for real.
