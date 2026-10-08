# agent-world-protocol (W035)

The **OBSERVATION/ACTION PROTOCOL** — the typed bridge between a POSSESSED
AGENT (W032 Body + W033 Substrate + W034 Possession) and a WORLD (the W023
reactive participant seam). Spec: `spec/WORK-ITEMS.md` W035. The composed
agent (W034's `EffectiveAgent` — Body possessed by Substrate) meets its
world through the SAME typed ports humans use (A4/A15 — human/agent
symmetry, headless parity): it observes SETTLED port projections only (A7),
and its substrate's proposals issue through the single CommandPort only
after the W033 stream law admits them.

## What this package owns

- **`contracts.ts`** — the protocol contracts (owned IN-PACKAGE, the W034
  possession precedent — the domain is the agent-layer composition; the
  world contracts stay in `tradrl-world-contracts`): the
  `ObservationProtocolConfig` (what the agent observes — kinds, instruments,
  book depth, trade window; may only NARROW the effective view, validated
  at attach), the `AgentObservation` record (the observed-stream contract:
  the settled instant + the W032 grant + the granted-content
  `ObservedBodyView` + the W033 `ViewDigest`), the `AgentCommandOutcome` /
  `AgentActionResult` (the action protocol's typed outcomes), the
  `AgentPassRecord` (observation → decision → admission → action, as data),
  the `AgentSessionTelemetry` (the W023 pass-record precedent, composed
  with the W032 attachment and W034 possession records), and every
  attach/detach outcome union (fail-closed, typed, closed sets).
- **`observation.ts`** — **the observation grant protocol**: how a
  possessed agent's substrate receives `ObservedBodyView`s. THE GRANT
  FIRST: one observation begins at a settled clock position and computes
  the W032 grant (`projectBodyObservations` over the W034 effective view,
  the protocol config and the world's DECLARED information artifacts);
  only then does it read the port projections the grant admits — content
  beyond the grant never enters the view. The W023 settled-view discipline
  drives the read (the trailing clock re-read; torn attempts discarded and
  retried; ≤64 then `torn-read-exhausted` fail-closed). The A7 firewall
  applies twice: the port serves available-then projections only, and the
  grant judges the declared artifacts against `asOf` — future-dated
  artifacts are WITHHELD AND NAMED (never in the view). The two sources are
  cross-checked: a port serving an artifact the grant withholds (or
  withholding a granted one) fails closed with `grant-inconsistency`.
  `resolveObservationProtocol` validates the config against the effective
  view at attach (loud typed errors, never per-pass denials).
- **`action.ts`** — **the action protocol**: how a substrate's
  `DecisionStream` becomes `WorldCommand`s through the Body's embodiment.
  The admission gate is W034's decision-level check — W033's
  `validateDecisionStream` (identity, seed, rate envelope, issuedAt = the
  view's asOf, the seat/account/world, the embodiment's command kinds,
  instruments, order kinds, TIFs) plus the possession-scope layer. A
  failing stream issues NOTHING — the whole stream is the unit of
  admission (never a partial acceptance, never a silent clip); the refusal
  is typed data (the incompatibilities verbatim). On admission, the
  commands issue through the CommandPort in stream order, one `await` per
  command (FIFO — the engine's arrival-order queue is the single
  serializer), each typed outcome (ack OR rejection) recorded verbatim.
  All eight `WorldCommand` kinds dispatch (the Body terminates at the same
  port; the embodiment and scope bound what may ever be proposed).
- **`session.ts`** — **the agent-world session**: the composed lifecycle —
  attach → observe → decide → act → detach, fail-closed at every seam,
  every state transition typed, telemetry as data. ATTACH is the typed
  gate: W034's `checkPossessionCompatibility` (with the W032
  `validateBodyAttachment` world binding), the live-substrate identity
  (content-addressed — a different mind never possesses through this
  session), the client/definition world match, the observation config, and
  a live clock handshake; ok turns BOTH machines (W032 attachment:
  unattached → active; W034 possession: unpossessed → possessed, gated on
  the R051 compatibility evidence). The event loop is the W023 discipline:
  react only to settled views, one pass at a time, coalescing declared,
  fail-closed on thrown port errors (the session fails, both machines
  release with `protocol-error`, nothing is ever fabricated). The declared
  rate spacing (`decisionRate.minViewIntervalMs`, the W034 tighter-of)
  governs which settled views the substrate ever sees — a closer view is
  skipped and counted, never silently observed. `detach` is the composed
  kill switch (the reason maps onto the W032 detach reason and the W034
  release reason); `settle` is the W023 quiet-round-trip.

## The laws worth knowing before consuming

- **The grant is the authority.** Nothing beyond the W032 grant is read,
  so nothing beyond it can enter the substrate's view. A lawful session's
  grants carry no denials (the config was validated at attach); the
  withheld-artifacts list is the honest A7 record.
- **The admission gate refuses WHOLE streams.** A stream with any command
  outside the embodiment, the possession scope, the rate envelope or the
  auditability spine issues NOTHING; the typed refusal is recorded in the
  pass (`admissionRefused` in telemetry) and the session CONTINUES —
  refusals and typed port rejections are outcomes, not failures (the W023
  law). The operator holds the kill switch. (Design choice disclosed for
  review: a rate-breaching stream does not auto-detach with the W034
  `rate-violation` release reason — the refusal is recorded; a W044
  runtime may layer the auto-release policy.)
- **A granted family is present even when its read is empty** (an empty
  tape is honest data); an absent field means "not granted, not read".
- **The declared view spacing is honored at the substrate boundary**: a
  rate-refused view is read coherently and discarded — the substrate never
  sees it; the skip is counted (`observationsSkipped`). The W023
  counterpart runtime reacted to every settled view (including a pause's
  same-instant push); the agent protocol instead honors the substrate's
  declared minimum spacing (a same-instant view is 0ms apart — skipped).
- **A substrate refusing its own granted view is a protocol breach** — the
  session guarantees valid granted views (the W033 firewall inside `decide`
  re-proves each one), so a refusal fails the session closed
  (`AgentProtocolBreachError`, the typed substrate errors carried as data).
- **A9 by construction**: no wall reads, no unseeded randomness, no
  invented identity — the pass counter, the settled asOf, the substrate's
  deterministic decision/command ids and the engine's own journal make the
  whole telemetry a pure function of world + agent + clock stream (proven
  by the twin runs: wall axes a day apart ⇒ identical telemetry AND
  journal).

## Test seams (disclosed)

- The alpha-world tests import the REAL alpha binding
  (`packages/ui/src/trading-world/runtime/engineAttachment.ts`) and the
  REAL W018 client (`engineWorldClient.ts`) by relative cross-package
  paths — the W032/W033/W034 test convention (`ui` is not a package
  dependency); package `src/` has zero `ui` imports.
- The compact protocol world (test/fixtures.ts) is this suite's own
  deterministic `WorldDefinition` hosted by the REAL W018 in-process
  transport over the REAL W017 generated engine — the engineAttachment
  wiring verbatim, the definition test-side (the W023 helpers precedent).
- The **scripted client** (`scriptedAgentWorldClient`) is a deterministic
  TEST seam for the two protocol guards a lawful engine can never produce
  (a never-settling clock; a port serving an artifact the grant withholds).
  The **armed-failure wrapper** and the **refusing substrate** (same
  descriptor, refusing `decide`) are the W023 fail-closed pattern.
- Until the lockfile registration (TL action item), the workspace links
  are package-local `node_modules` symlinks (untracked, the W021+
  convention).
