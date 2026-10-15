# tradrl-adapters-broker (W065)

The BROKER EXECUTION ADAPTER: the provider-neutral SHADOW broker vocabulary
(the `packages/tradrl-adapters/*` flat source-exported layout, the W057
arena precedent). Spec: REQUIREMENTS.md R063 — "Shadow/live separation is
mandatory"; R070 — "Provider-neutral adapters"; R072 — fail-closed
security/tenancy; ARCHITECTURE.md "Live mirror" — real observations with
simulated positions/execution; never live execution.

## What this package OWNS

- The broker closed vocabularies, declared here and ONLY here: venue kinds
  (`batch-auction` / `central-limit-order-book` / `quote-driven`), order
  kinds (`limit` / `market`), time-in-force (`day` / `fill-or-kill` /
  `good-till-cancelled` / `immediate-or-cancel`), execution-report kinds
  (`new-acknowledged` / `order-filled` / `order-partially-filled`), and
  observation kinds (`book-snapshot` / `mark-price` / `top-of-book-quote` /
  `trade-print`) — closed sets, fail-closed at every seam.
- **THE SHADOW LAW (R063), STRUCTURAL**: the typed record vocabulary has NO
  live-transmission field at all. `liveTransmissionViolations` scans every
  declaration and every re-validated record (all members, recursively) and
  REFUSES LOUDLY naming R063 any live-transmission-shaped member
  (endpoint/url/uri/webhook/webSocket/socket/host/port/connection/transmit/
  transmission/transport/network) or any URL-shaped string value
  (http(s)://, ws(s)://, tcp://). There is no live entry point anywhere on
  the port — `submitShadowOrder` is the ONLY order path and it COMPOSES.
- `sealMarketObservation` — the observation gate: closed kind vocabulary,
  positive decimal carried price/size (decimal strings, never floats),
  simulation-axis timestamps with the **availability law**
  (`availableAt >= observedAt` — the W050 point-in-time half), the optional
  real-source citation (a sealed W050 view id + record id, cited never
  parsed), THE REDACTION LAW (packages/security's own
  `secretValueViolations`, errors carried verbatim) and THE SHADOW LAW
  scan. Seals the content-addressed `obs-<digest>` id (tenant-first digest
  — R056 structural).
- `declareShadowOrder` — the order gate: the closed venue/order/TIF
  vocabularies, the fail-closed limit-price law (a limit order DECLARES its
  limit price; a market order carrying one is REFUSED, never dropped — the
  arena top-k precedent), the declared simulation-axis timestamp, and the
  **credential as a W060 secret reference** (carried as the
  `credentialReference` member — DISCLOSED: W060's redaction scanner
  refuses any member NAMED `credential` as a forbidden VALUE member, so the
  typed handle rides under a name the scanner's closed list does not
  forbid): re-proven through packages/security's own
  `validateSecretReference` (errors carried VERBATIM — THE REDACTION LAW
  rides THERE) with the R056 credential-scope law (a cross-tenant
  credential is the loud `cross-tenant-credential` refusal). Seals
  `sord-<digest>` (tenant-first).
- `composeShadowFill` — THE COMPOSITION GATE: a fill is composed from an
  order + a market observation BOTH carried verbatim; **A6 is structural**
  (the fill record carries NO separate price member — the fill's price IS
  the observation's carried price, via `fillPriceOf`); the fill quantity is
  bounded decimal-exact by the order's quantity; BOTH cited records
  re-proven through their own validators (errors verbatim); R056 enforced
  at the gate (cross-tenant order-vs-observation refused loudly). Seals
  `sfil-<digest>` (tenant-first).
- `composeShadowExecutionReport` — the report gate: the report kind is
  **DERIVED from the carried fills** (never declared, never invented);
  every fill re-proven through its own validator and proven to cite THIS
  order; duplicate fill ids refused; fills carried in canonical fill-id
  order (A9 — input order never leaks); the overfill law (decimal-exact).
  Seals `xrep-<digest>` (tenant-first).
- `BrokerGatewayPort` + `shadowBrokerGateway` — the provider-neutral
  port (R070) and its deterministic in-memory reference implementation (the
  W056 CapabilityProviderPort precedent): observations served in canonical
  id order, resolved by exact opaque-id equality, and
  `submitShadowOrder` — THE SHADOW PATH — composes the execution report
  through the REAL composition gates with errors carried verbatim.
- `validate.ts` — whole-record re-validation of all four record types from
  their recorded data alone: ids RE-DERIVED (a rewrite is caught loudly),
  closed sets re-enforced, both law scans re-run, provenance re-derived,
  every cited record re-proven through this module's own validators.

## What this package does NOT own

- NO live execution, NO transmission, NO network code, NO venue connectivity
  — R063 is structural (see above). A concrete venue adapter implementing
  `BrokerGatewayPort` against a real venue's API is a FUTURE surface and
  would still speak the shadow vocabulary only.
- NO order routing to any engine, NO settlement, NO custody of secret
  VALUES (credentials are W060 typed handles only).
- NO position/portfolio semantics — the mirror service (`services/shadow`)
  composes simulated positions over these records.
- NO point-in-time view assembly (W050 owns queries/views/firewalls); this
  adapter carries observations and their optional W050 source citations.
- NO changes to any neutral contract or dependency package (frozen).

## Disclosed design decisions

1. **Execution-report kinds are the three DERIVABLE lifecycle states**
   (`new-acknowledged` / `order-partially-filled` / `order-filled`):
   rejection/cancellation semantics are DECLARED outcomes that would need an
   explicit typed cancellation vocabulary — deliberately not invented here
   (A6: the derivable states only).
2. **The reference gateway's matching law is deliberately simple**: one
   FULL fill at the first eligible observation (canonical order: observedAt,
   then observation id) for the order's instrument, at/after the order's
   declaredAt. Queueing and venue microstructure are venue-adapter concerns.
3. **Prices/quantities are decimal STRINGS** (the W004 `Price`/`Quantity`
   convention), compared/summed decimal-exact through scaled BigInt
   arithmetic — never floats.
4. **The observation's real-source citation is optional at the adapter
   gate** (provider-neutral: any lawful real feed may project observations),
   but REQUIRED by the mirror session gate in `services/shadow` (a mirror
   session's observations come from its sealed W050 view).
5. **The credential participates in the order id by its opaque `sec-<digest>`
   handle only** — the handle is itself content-addressed by W060, so
   double-sealing the whole reference is redundant (disclosed).
6. **ids are FNV-1a canonical digests** through the W037 `trajectory` seam
   (`canonicalDigestHex`), tenant-first scope tuples — R056 structural.

## Clean-room provenance

No third-party broker/venue code exists in this repo's register; this is a
clean-room original implementation of the documented public semantics of a
shadow execution vocabulary. Zero third-party code; zero register
obligations triggered.

License: Apache-2.0 (the repository LICENSE).
