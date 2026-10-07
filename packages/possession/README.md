# possession (W034)

The **POSSESSION** relation — `Agent = Body possessed by Cognitive
Substrate` (spec/ARCHITECTURE.md §12). W032 built the Body (the part that
acts); W033 built the Cognitive Substrate (the part that decides); this
package is the typed composition layer between them: who bound them, what
the grant covers, whether they are compatible (R051 — possession has
compatibility evidence), their honest lifecycle, their content-addressed
history, and the composed agent as one pure value.

## Where the contracts live

Unlike W032/W033 (canonical contracts in
`packages/tradrl-world-contracts/src/{agentBody,cognitiveSubstrate}.ts`),
the possession contracts are owned **in-package** (`contracts.ts`): this
Work Order's frozen surface is `packages/possession/` only, and the
possession domain is an agent-layer composition — it CONSUMES the Body
and Substrate contracts through their registered subpath exports
(`tradrl-world-contracts/agentBody`, `tradrl-world-contracts/cognitiveSubstrate`)
and adds no world-contract shapes. If the program later wants the
canonical file under the contracts package (the `data.ts` precedent),
`contracts.ts` is the one-file seam.

## What this package owns

- **`contracts.ts`** — the `PossessionDescriptor` (substrate descriptor ×
  body descriptor + the `PossessionGrant` — who/what/when/on what declared
  basis — + the `PossessionScope` — the instruments, observation families,
  command kinds and optional rate grant the possession covers, each ⊆ the
  body's own declarations), the lifecycle table, and every outcome/error
  union.
- **`validate.ts`** — loud validation (the W032 `validateBodyAttachment`
  style): blank identities, unknown channels, non-finite times, blank
  bases, duplicate scope entries, scope beyond the embodiment, malformed
  rate grants — every violation collected with typed codes; the embedded
  Body/Substrate descriptors are delegated to the W032/W033 validators
  with their errors carried **verbatim** (never re-derived, never
  dropped).
- **`compatibility.ts`** — **can THIS substrate possess THIS body?**
  - `checkPossessionCompatibility(descriptor, world?)` — the declaration
    level: the substrate's proposed command kinds vs the body's embodiment
    (a kind the body cannot issue is incompatible — never silently
    clipped), the substrate's rate envelope vs the possession's rate
    grant, and (with a world) the **W032 attach constraints**
    (`validateBodyAttachment`, errors verbatim). An ok outcome carries the
    `checked` evidence list — exactly what was proven, no more.
  - `checkDecisionStreamCompatibility(stream, descriptor)` — the decision
    level, the **ultimate proof**: W033's `validateDecisionStream` (the
    substrate's actual stream against the body's embodiment) plus the
    possession-scope layer (proposals beyond the possession's narrower
    grant). The ok branch cites the proven stream's content digest
    (`decisionStreamDigestOf`).
  - Every incompatibility names the exact field/limit mismatch in the W032
    envelope-breach style: `{limit, substrateValue, bodyValue}`.
- **`lifecycle.ts`** — `unpossessed → possessed → released` (+ the
  discard-before-possession path) as fail-closed pure transforms (the W032
  lifecycle precedent): `possess` requires a PASSING compatibility outcome
  (R051 gates the possession), `release` is always legal, `released` is
  terminal, refusals are typed and never mutate, a new possession is a new
  record.
- **`lineage.ts`** — the body's possession history as an ordered,
  content-addressed chain (the **W028 digest-chain discipline**, W016
  hashing family): each entry digests the FULL possession declaration +
  the event + the machine's resulting state + the declared time, and each
  link cites its predecessor (`fnv1aChainHex([previousLink, entryDigest])`).
  `extendPossessionLineage` refuses illegal events, concurrent possessions
  (one substrate at a time — the §12 law), changed declarations under the
  same id, and broken chains. `verifyPossessionLineage` recomputes
  everything — any mutation of history (an edit, a swap, a renumbering, a
  truncation, a forged head, a semantically impossible sequence) breaks
  loudly at the exact index. The honest W028 limit: a fully-consistent
  rewrite passes local verification but **changes the head** — detectable
  against any recorded head, never by local inspection alone.
- **`projection.ts`** — `projectEffectiveAgent(descriptor, world?)`: the
  composed agent AS DATA — body + substrate (verbatim) + the effective
  command surface (substrate ∩ scope), the **view grant intersection**
  (`maximalBodyView(body)` ∩ the possession scope — the only view the
  substrate receives through this possession, A7), the tighter-of decision
  rate, and the effective risk envelope (the W032
  `effectiveRiskEnvelope` with the world's limits; the body's declaration
  verbatim without a world). A pure projection, never a mutation; only
  defined for a compatible possession (fail-closed).

## Laws worth knowing before consuming

- The scope may NARROW the substrate's authority (the effective command
  kinds are the substrate's declaration ∩ the grant); it may never WIDEN
  the body's embodiment (rejected at validation).
- Compatibility requires the substrate's rate to FIT the grant
  (`maxDecisionsPerView` ≤ the grant's; `minViewIntervalMs` ≥ the
  grant's) — the W032 body-looser-than-world direction applied to the
  rate family; equal boundaries are compatible.
- A body has at most one held possession at a time (enforced at
  `extendPossessionLineage`, caught at verification for forged histories).
- `recordedAt`/`grantedAt` are DECLARED times (data, never clock reads —
  A9); determinism comes from the chain order, not from timestamps.
- No runtime here: no scheduling, no transports, no engine calls, no
  model IO — types, validators, honest states, digests and projections
  only. The runtime consumer is W035 (observation/action protocol) and
  W044 (world-agent runtime).

## Test seams (disclosed)

The alpha-world test imports the REAL alpha world definition
(`packages/ui/src/trading-world/runtime/engineAttachment.ts`) by relative
cross-package path — the W032/W033 test convention (`ui` is not a package
dependency); package `src/` has zero `ui` imports. The runtime
dependencies are `tradrl-world-contracts` (subpath exports),
`tradrl-world-sim` (the W016 hashing family + risk resolution),
`agent-body` and `cognitive-substrate` (their validators/envelope
projections, through the package specifiers). Until the lockfile
registration (TL action item), the workspace links are package-local
`node_modules` symlinks (untracked, the W021+ convention).
