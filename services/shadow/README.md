# shadow (W065)

The LIVE-MIRROR SERVICE: the mirror composition contract as typed DATA.
Spec: ARCHITECTURE.md "Live mirror" — real observations with simulated
positions/execution; never live execution. REQUIREMENTS.md R063 —
shadow/live separation is mandatory; R056 — tenant isolation is
structural; R016 — the runtime point-in-time information firewall.

## What this service OWNS

- **The mirror composition contract** — `openLiveMirrorSession` THE GATE:
  a `LiveMirrorSession` is typed data carrying a sealed W050 point-in-time
  VIEW verbatim (re-proven through W050's OWN `validatePointInTimeView`,
  errors carried verbatim), the market observations projected from that
  view (carried verbatim, each re-proven through the W065 broker adapter's
  OWN `validateMarketObservation`, each REQUIRED to cite the session's
  view + a REAL market-event record of it, each's timestamps proven to BE
  the cited event's own observation-law timestamps), and the simulated
  trading intents (shadow orders, re-proven through the adapter's OWN
  `validateShadowOrder`). R056 cross-tenant view/order/observation pairs
  are LOUD typed refusals.
- **The point-in-time law**: the session's cutoff IS the sealed view's
  cutoff (a mirror session never widens the knowledge firewall), and an
  observation is INVISIBLE to the session before its `availableAt` — a
  post-cutoff observation is the loud `post-cutoff-observation` refusal
  naming R016 (the W050 firewall law). A post-cutoff ORDER is refused the
  same way (an order may not rest on knowledge the session cannot see).
- **The isolation law (R056 structural)**: session ids are
  `mirror-<digest>` weighing the TENANT FIRST — the same declaration under
  two tenants is two sessions, and cross-tenant reads are loud typed
  refusals.
- **The simulated half** — `composeMirrorProjection`: every fill composed
  through the broker adapter's REAL `composeShadowFill` gate (order +
  observation BOTH carried verbatim; A6 structural — the fill's price IS
  the observation's carried price), positions derived decimal-exact from
  the carried fills (net quantity = the signed decimal-exact sum of
  carried fill quantities; notional basis = the decimal-exact Σ
  price×quantity — addition and multiplication of carried numbers ONLY, no
  rounding, no division), unfilled orders carried canonically. NEVER live
  execution (A13/A14): the service composes PROJECTION records — it does
  not transmit anything; there is no network code at all.
- **The audit step** — `mirrorSessionAudit`: every auditable step as TYPED
  W061 audit records (`world-accessed` — the view read; `record-written` —
  the session; `report-composed` — the projection) minted through
  packages/observability's OWN `mintAuditRecord`, the `session-recorded`
  operational event through its OWN `mintOperationalEvent`, the trail
  assembled through services/operations' OWN `assembleTrail` and verified
  END-TO-END through its OWN `verifyTrail` — a trail that fails
  verification is refused loudly, never returned.
- **Whole-record re-validation** — `validateLiveMirrorSession` /
  `validateMirrorProjection`: ids RE-DERIVED (a rewrite is caught loudly),
  the view + every carried observation/order/fill re-proven through their
  own source validators, the point-in-time laws re-proven, positions
  re-derived decimal-exact (a tampered position is caught by the
  derivation itself).

## What this service does NOT own

- NO execution venue, NO order routing to any engine, NO transmission, NO
  network code, NO websockets, NO market-data feeds — the mirror is a
  PROJECTION over recorded data (A13/A14, R063).
- NO point-in-time query/view/firewall semantics (W050 owns them; this
  service composes through W050's own gates and re-validates through
  W050's own validator).
- NO broker vocabulary (the W065 `tradrl-adapters-broker` package owns the
  closed venue/order/TIF/observation/execution-report vocabularies).
- NO secret custody (credentials ride as W060 typed handles inside the
  carried orders, re-proven through W060's own validator).
- NO audit-trail chain laws (W061 `observability` owns the record/trail
  contracts; `operations` owns assembly + verification — this service
  composes through them).

## Disclosed design decisions

1. **The observation's real-source citation is REQUIRED at the session
   gate** (while optional at the adapter gate): a mirror session's
   observations come from ITS sealed W050 view — the real-observations-IN
   law. The session gate additionally proves the cited record is a
   market-event of that view AND the observation's timestamps ARE that
   event's own `occurredAt` / `availableAt ?? occurredAt` (the projection
   carries the world's times verbatim). The observation's PRICE is carried
   data (A6) — tying it to the event's payload bytes would invent a
   projection law (mid/bid/ask choice) that belongs to a concrete feed
   adapter, so identity + time are proven, price is carried (disclosed).
2. **Positions derive by decimal-exact addition/multiplication only**
   (scaled BigInt over decimal strings): net quantity and notional basis,
   never an average price (division/rounding would mint numbers).
3. **The projection fills each order FULLY at the first eligible
   observation** (canonical observedAt-then-id order; same instrument;
   `observedAt >= declaredAt`) — the adapter's disclosed reference matching
   law, composed through the REAL fill gate. Orders with no eligible
   observation rest unfilled and are carried as data.
4. **The audit records' W028 provenance is the HONEST `no-declared-source`
   marker**: the mirror session's source chain is the sealed W050 view +
   the adapter's records, not a W027 information-dataset import (the
   closed W028 union has no member for that; the honest none marker is the
   lawful citation — named in every record).
5. **The audit timestamps are the session's own carried cutoff** (declared
   data — A9 has no clocks); the audit actor is the declared
   `service`/`shadow-mirror` principal.
6. **The mirror session's OpsScope kind is `tenant-project-world`** (the
   W059 §14 hierarchy's fullest member — the session carries a full
   tenant/project/world scope).

## Clean-room provenance

No third-party mirror/shadow-trading code exists in this repo's register;
this is a clean-room original implementation. Zero third-party code; zero
register obligations triggered.

License: Apache-2.0 (the repository LICENSE).
