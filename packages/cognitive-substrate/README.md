# cognitive-substrate (W033)

The typed contracts for an agent's **MIND** — the part that decides. The W032 Body
carries no intelligence; this package is the other half of
spec/ARCHITECTURE.md §12: *Agent = Body possessed by Cognitive Substrate*.

A **CognitiveSubstrate** is a pure decision function over observed body views
producing decision streams:

- **Only BodyViews in, Decisions out** (spec/ARCHITECTURE-LOCK.md A7): the single
  input type is `ObservedBodyView` — the W032 A7-bounded `BodyView` grant plus the
  granted content at `asOf`. There is no port handle, no world handle, no clock; the
  substrate PROPOSES world commands and the Body executes (spec/WORLD-PROTOCOL.md
  human/agent symmetry, A4/A15).
- **Fail-closed** (`observedView.ts`): content beyond the view grant is a typed
  error, never silently seen — an unadmitted observation family, an instrument
  outside the view, own-state for another account, future-dated content, an
  artifact not yet available (the canonical `isInformationAvailable` predicate,
  reused), malformed decimals and duplicate projections are all loud.
- **Stateless-per-view OR declared-state**: the two contract state modes. A
  declared-state substrate is a seeded state machine whose state flows in and out
  of `decide` as data; determinism is A9 — same views + same seed ⇒ same
  DecisionStream (pinned by twin-run tests, wall clocks apart).
- **Rationale as data** (spec/ARCHITECTURE.md §10 Evidence): every decision carries
  its declared rule, its input signals and a deterministic explanation — decision
  metadata, never private chain-of-thought — plus a **declared confidence** ∈ [0,1]
  and a citation of the view's content digest (`viewDigestOf`, the W016 hashing
  family: canonical JSON + FNV-1a, the same family the engine and the W028
  evidence chain use).
- **Loud stream validation** (`validate.ts`): a substrate producing commands
  outside the body's embodiment is invalid (`validateDecisionStream` against the
  W032 `BodyDescriptor`); rate-envelope breaches are typed, never silently
  truncated; identity/time laws are enforced (the command is issued by the body's
  own seat at the view's asOf — the substrate reads no clock).

## Reference substrates

- `createMomentumSubstrate` — **declared-state** (the seeded state machine): a
  rolling window of one instrument's mid prices; a lookback cross against a
  declared threshold; entries on signal change, exits on opposing signals; the
  seed resolves exact-threshold ambiguity (a pure FNV-1a hash — never RNG; the
  seed never invents prices: the initial window is empty and warm-up proposes
  nothing).
- `createMeanReversionSubstrate` — **stateless-per-view**: the tape's edges from
  the view's own trades; trigger zones hug the edges; position awareness always
  from the view (own-positions), never from memory; the seed resolves exact
  boundary/equidistant ambiguity.

Both are tested against **REAL alpha-world body views** through the W032 maximal
view (`maximalBodyView`), driving the real generated engine for quotes, tape,
orders, positions, portfolio and risk — with the W032 attach validation binding
the real body first.

## Layout (the `agent-body` pattern)

```
contracts.ts      bridge to the canonical contracts (packages/tradrl-world-contracts/src/cognitiveSubstrate.ts)
observedView.ts   the A7 firewall (fail-closed) + the view content digest
decide.ts         validate-then-think: the shared decide machinery
validate.ts       descriptor + decision-stream validation (vs the body's embodiment)
momentum.ts       the declared-state reference mind
meanReversion.ts  the stateless-per-view reference mind
decimal.ts        thin disclosed wrappers over the W014 decimal kernel (signed text, ratios, mids)
```

The canonical contracts file's subpath export (`tradrl-world-contracts/cognitiveSubstrate`)
is a registered TL action item; `cognitive-substrate/contracts.ts` bridges to the
source until it lands (the W032 `agentBody` precedent).
