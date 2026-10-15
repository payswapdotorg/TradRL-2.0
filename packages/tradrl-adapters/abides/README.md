# tradrl-adapters-abides (W024)

The ABIDES-style reactive-market adapter: an ORIGINAL, clean-room TypeScript
reimplementation of the documented public semantics of an agent-based
reactive market — message-driven participants, per-agent latency, an exchange
process over price-time-priority limit-order books, agents that wake on
observed market events and on their own scheduled wake times — behind the
typed World Protocol, driving participants through the REAL W023 reactive
participant seam (`tradrl-market-participants`: `createParticipantRuntime` +
`readSettledView`). There is no second execution path: every agent decides
purely over settled views and issues commands through the same typed
`CommandPort` humans use (A4/A15).

## Clean-room provenance (the license law)

`spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md` registers ABIDES
(github.com/abides-sim/abides) as BSD-3-Clause-by-text /
NOASSERTION-by-GitHub-metadata, upstream effectively unmaintained, with the
policy "Reference + adapter; prefer clean reimplementation … attribution
required if any code is copied; GitHub metadata mismatch must be resolved at
the pinned commit before a copy is permitted." This package is therefore a
**clean-room reimplementation**: no upstream source was fetched, read, or
ported; no Python, no verbatim algorithms. The semantic vocabulary
(market makers posting two-sided liquidity, noise traders supplying random
flow, latency-bounded message transport, exchange processes over order
books) is the documented public idea of an agent-based market, expressed
from scratch. **Zero upstream code copied; no pinned-commit obligation
triggered.**

## The message flow (the transport law, all simulated time — A7)

1. **Arrival = send time + latency.** An agent's command leaves at the
   agent's observation frontier and arrives at the venue `+ toVenueMs`
   (fixed, or a keyed seeded-uniform draw for ranges — pure function of
   `seed/direction/actor/key`, no RNG cursor, A9).
2. **The venue processes commands in arrival order.** The fabric's total
   order is (arrival time → message-class priority → enqueue sequence):
   deterministic, never wall time. Out-of-order traffic (sent from the
   future, arriving in the delivered past) is a typed
   `out-of-order-message` violation.
3. **Availability propagates.** Order acknowledgments become available at
   `occurredAt + venue.latency.acknowledgementMs`; trades/fills/books/quotes
   at `occurredAt + venue.latency.fillPropagationMs` (the canonical
   `VenueLatency` contract, reused verbatim). Outcome `order-delivery`
   messages (to every agent whose account the command touched; the issuer's
   carries the typed `CommandResult`) and `market-data` messages (to every
   agent whose declared view watches a touched instrument) then travel
   `+ fromVenueMs`. A typed rejection that touched nothing (no order was
   created) still reaches its issuer as a minimal pure-result delivery —
   the transport law's floor: the issuer's outcome promise ALWAYS settles.
4. **A delivery is the only thing that moves an agent's observation
   frontier** and pushes the W023 clock channel — the A7 firewall is
   structural: an agent's client serves ONLY delivered state (plus static,
   declared world configuration). The issuer's port promise resolves when
   the ack delivery ARRIVES, so the runtime's await spans the true round
   trip.
5. **Self-wakes.** Each agent declares a wake schedule (`everyMs`, optional
   `firstWakeMs`); `agent-wake` messages re-arm themselves.

The kernel (`./kernel.ts`) delivers one message, then yields exactly one
macrotask hop so every reaction chain runs to its blocking point before the
next delivery — reaction order equals message order, and behavior never
depends on the operator's await pattern. Twin runs and step-partition
changes produce deep-equal journals (A9, `test/determinism.twin.test.ts`).

## Declared policies (every one deterministic, every one tested)

- **Opening observation**: the PRE-SEED world at the clock origin — empty
  books, no tape, opening cash, no orders. Seed orders are placed AT the
  venue at the origin (the opening auction is part of the world's birth;
  they do not travel) and their effects reach observers under the same
  availability + latency law.
- **Matching**: price-time priority, mandatory partial fills, two-phase
  (plan, then apply) so FOK feasibility and post-only checks decide before
  any mutation; market/limit/stop/stop-limit, IOC/FOK/post-only/reduce-only;
  replace = cancel + fresh successor (priority re-earned); stops arm OFF the
  book, trigger on last-trade crossing, cascade in order-id order (guarded).
- **Economics** (`./ledger.ts`): weighted-average entry on increases
  (half-up at the 12-decimal kernel scale), realized P&L on reductions
  (crossing through zero realizes then re-opens), per-fill variable fees +
  the schedule's fixed fee on an order's first fill only, buying power =
  cash (leverage 1), marks = last trade else book mid.
- **Fail-closed everywhere**: unknown agent kind, malformed latency spec,
  unregistered venue, out-of-order messages, duplicate/unknown agents,
  view-config mismatches, malformed wake schedules, invalid clock calls,
  wall-time coupling, post-close traffic — typed `AbidesAdapterError`s,
  never silent defaults. Command outcomes are typed rejections
  (`CommandResult.rejected`), never throws. No live execution authority of
  any kind (A14; accounts declaring it fail world validation).
- **News is not modeled**: this reactive market mints no news artifacts;
  `getNews` serves the honest empty tape (a declared fact, not a silent
  default).

## What is deliberately NOT owned (scope honesty)

- The canonical deterministic engine (W014 `tradrl-world-sim`) stays
  canonical (A10): this adapter reuses its CONTRACT types
  (`tradrl-world-contracts`) and re-implements the minimal venue core in
  original TypeScript because an adapter must be engine-independent and
  self-contained behind the World Protocol.
- No `EvidencePort`/snapshot/branching/annotation operator surface here —
  world administration belongs to the canonical engine; the kernel exposes
  the journal, per-agent W023 telemetry, and the clock. `world-created` is
  journaled; the other operator event builders exist in `./events.ts` for
  the registration the TL owns at merge time.
- Post-trade breach surveillance belongs to the canonical risk engine
  (W015); this venue's risk state serves declared limits with an honest
  empty breach history.
- The reference agents hold no in-flight order tracking: a second wake
  before the first acknowledgement can duplicate intents (deterministic;
  disclosed here rather than papered over).
- Reused, not duplicated: `VenueLatency` (R022 contract), the W023
  12-decimal fixed-point kernel (`tradrl-market-participants/decimal`),
  `keyedRandom` (W023), and the whole W023 runtime/protocol
  (`tradrl-market-participants/runtime`,
  `tradrl-world-contracts/participantProtocol`).

## Package layout

Flat source-exported package (the W021 nautilus template): `index.ts` +
one module per concern, `package.json` exports map pointing at TypeScript
sources, `tsconfig.json` extending `../../tsconfig.base.json`, tests under
`test/` (node:test + node:assert/strict, real imports, ≤ 400 lines each):
fail-closed validation, scheduler/latency ordering, exchange/book/ledger
semantics, the reactive loop through the W023 seam, and twin determinism.
