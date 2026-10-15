# tradrl-time-machine (W050) — the point-in-time CONTRACT

The Time Machine's contract half (`spec/REQUIREMENTS.md` R016 — "Runtime
point-in-time information firewall"; `spec/ARCHITECTURE-LOCK.md` A7/A9/A14).

W004 shipped the time vocabulary (`SimulationTimeMs`,
`eventObservationTime`, the A7 point-in-time laws). W027 shipped the
research/news/event information record types. THIS package types the
point-in-time REQUEST and the point-in-time FIREWALL:

- **`./query`** — the `PointInTimeQuery` as typed DATA: the declared cutoff
  (W004's own `SimulationTimeMs`, role-narrowed — the simulation axis,
  never wall time), the explicit tenant/project/world scope, the declared
  record families (closed set: the W004 `market-event` family + W027's four
  information record kinds), and the content-addressed `pitq-<digest>` id.
  Construction is fail-closed: blank scope members, unknown/duplicate
  families, an empty family set, an illegal cutoff — every violation
  collected and named, never silently repaired.
- **`./firewall`** — THE KNOWLEDGE FIREWALL LAW as a typed gate (R016):
  `sealView(query, records)` proves every record ≤ cutoff through the
  records' OWN timestamps (W004's `eventObservationTime` law; W027's
  publication-time mapping law) and REFUSES any post-cutoff record loudly
  naming R016. A sealed `PointInTimeView` structurally cannot reference
  anything recorded after its cutoff — enforced by the gate, never by
  convention. The view carries its proof (which records, which timestamps,
  the firewall digest) and its content-addressed `pitv-<digest>` id; the
  records are placed in canonical order so input order never leaks (A9).
- **`./validate`** — whole-record re-validation: the query id, the firewall
  digest and the view id are RE-DERIVED from recorded data; R016 is
  re-proven record by record; the canonical order is re-derived.

## Owns

- The point-in-time query contract (cutoff/scope/families/id).
- The knowledge firewall law as a typed gate + the sealed view + its proof.
- The whole-record re-validation of queries and sealed views.

## Does NOT own

- View ASSEMBLY from recorded streams — that is the pure query engine
  `services/time-machine` (`time-machine`, W050's service half).
- Deterministic-replay/fidelity PROOFS over assembled views (the W022-style
  twin + digest re-derivation findings) — the service's `./fidelity`.
- Search integrity (W051) and holdout integrity (W052) — later work items
  that CONSUME the sealed views.
- Execution, forecasting, scoring — never (A14: the machine assembles
  views; it does not run worlds, does not predict, does not re-score).
- The time vocabulary itself — W004's `tradrl-world-contracts/time` owns
  it; this package composes it.
- The information record types — W027's
  `tradrl-world-contracts/information-data` owns them; this package views
  them.

## Dependencies (trimmed to what is genuinely imported)

- `tradrl-world-contracts` — the W004 event envelope + time vocabulary +
  the W027 record contracts (`information-data`).
- `trajectory` — the canonical content digest family
  (`canonicalDigestHex`, the W037/W047 lineage).

License: Apache-2.0 (the repository LICENSE).
