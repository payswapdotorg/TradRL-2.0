# agent-body (W032)

The typed contracts for an agent's **Body** — the part that acts in a world.
`Agent = Body possessed by Cognitive Substrate` (spec/ARCHITECTURE.md §12);
this package is the Body half. It carries **no intelligence** (R050) — that
is W033's Cognitive Substrate, unblocked by this work.

## What this package owns

- **The canonical Body contracts** live in the shared contracts package at
  `packages/tradrl-world-contracts/src/agentBody.ts` (the `data.ts`
  precedent; the subpath export `tradrl-world-contracts/agentBody` is a
  disclosed TL action item). `contracts.ts` bridges to that source — one
  line to flip when the exports entry lands.
- **`envelope.ts`** — the A13-shape envelope laws: structural validation
  (reusing the W015 risk-limits law + the canonical-decimal boundary law),
  the exact envelope-vs-world-limits comparison (a Body declaring a LOOSER
  limit than its world is invalid at attach — never silently clipped; the
  `minBuyingPowerAfterOrder` floor inverts the comparison direction), and
  `effectiveRiskEnvelope` (the tighter-of-each intersection the runtime
  enforces for this Body).
- **`validate.ts`** — descriptor structure, view ⊆ embodiment, and the
  attach-time world binding: the participant seat exists (account and kind
  match), the account exists and permits trading, every embodied
  instrument/venue exists, the venue policies admit every declared order
  kind, and the envelope sits within the world's declared limits. Every
  violation collected loudly (typed codes, exact values).
- **`lifecycle.ts`** — attach → active → detached as pure data transforms:
  fail-closed (refusals are typed results that never mutate state),
  `detached` is terminal, `attach` requires a passing validation outcome.
- **`view.ts`** — the A7 observation firewall: `projectBodyObservations`
  grants an available-then observation surface; artifacts with
  `availableAt` after `asOf` are withheld AND named; a non-finite `asOf`
  fails closed.

## Interop law

A Body IS a participant declaration plus the envelope:
`bodyAsParticipant(descriptor)` projects the W003 `Participant` shape. The
`participantKind` field consumes whatever `ParticipantKind` union is merged
at the consuming base (the W023 reactive-participant seam — design for
both, consume what is merged).

## What this package deliberately does NOT do

No scheduling, no transports, no engine calls, no model I/O, no decisions —
types, validators and honest states only (the W032 contract). The runtime
consumers are W035 (observation/action protocol), W033 (Cognitive
Substrate) and W034 (Possession/lineage).
