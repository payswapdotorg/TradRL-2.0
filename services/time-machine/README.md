# time-machine (W050) — the pure query engine

The Time Machine's engine half (`spec/REQUIREMENTS.md` R016 — "Runtime
point-in-time information firewall"; `spec/ARCHITECTURE-LOCK.md` A7/A9/A14;
`spec/WORK-ITEMS.md` W050). The point-in-time CONTRACT is the
`tradrl-time-machine` package; THIS service assembles the views.

- **`./engine`** — `assembleView(query, streams)`: THE GATE. Every stream
  record is re-proven through W004's own `validateEventStream` and W027's
  own `loadInformationDataset` validator (errors carried VERBATIM — W004
  `EventStreamViolation[]` / W027 `InformationViolation[]`, never
  re-worded, never dropped); every stream's declared world, record families
  and declared time range are proven against the query (world mismatch,
  undeclared family, cutoff outside the declared range, duplicate record
  ids — every seam fail-closed); the knowable-at-cutoff records are
  SELECTED through W004's/W027's own observation laws
  (`isEventObservableAt`; the publication-time mapping law); and the
  selection is SEALED through the contract package's knowledge firewall
  (`sealView`, R016) — a leak would be refused loudly (defensive depth).
  The deterministic view carries the records in canonical order plus the
  per-stream summaries as data (W004's `EventStreamDigest`, W027's
  `InformationImportSummary`, and the honest included/withheld counts).
- **`./fidelity`** — `proveViewFidelity(query, streams)`: the W022-style
  deterministic-replay proofs as typed `{ claim, verdict, evidence }`
  findings: the A9 twin (the same inputs assembled twice deep-equal), the
  view digest re-derivation (a recorded view replays bit-for-bit through
  the whole-record validator), and the firewall seal reproducibility —
  assembled into the content-addressed `pitfr-<digest>` report.
- **`./validate`** — `validateAssembledPointInTimeView(assembled)`: the
  whole-record re-validation (the contract's view re-proof errors carried
  verbatim; the summaries' counts/worlds/families proven against the
  view's own data).

## Owns

- View assembly from recorded W004 market-event streams + W027 information
  streams (the pure selection + sealing + summarization).
- The stream seam laws (declared world/families/time-range, duplicate ids,
  W004/W027 errors carried verbatim).
- The fidelity proofs over assembled views.

## Does NOT own

- The point-in-time contract itself (the query, the firewall gate, the
  sealed view types) — `packages/tradrl-time-machine`.
- The time vocabulary / event envelopes — W004
  `tradrl-world-contracts/time`.
- The information record types + import validation — W027
  `tradrl-information` + `tradrl-world-contracts/information-data`.
- Search integrity (W051) and holdout integrity (W052) — later work items
  that CONSUME these sealed views.
- Execution, forecasting, scoring — never (A14: the machine ASSEMBLES
  views; it does not run worlds, does not predict, does not re-score;
  carried evaluations are never re-scored).
- The finding/claim REGISTRY shape beyond the `{ claim, verdict, evidence }`
  pattern — W022 `tradrl-evaluation-replay` owns the replay-verification
  domain; this service mirrors its pattern over its own claims.

## Dependencies (trimmed to what is genuinely imported)

- `tradrl-time-machine` — the point-in-time contract (query, firewall,
  sealed view, whole-record validators).
- `tradrl-world-contracts` — the W004 envelopes, dataset ranges, stream
  validation/digest, observation laws.
- `tradrl-information` — W027's import validator/loader + violation types
  + import summary (errors carried verbatim).
- `tradrl-evaluation-replay` — W022's `FidelityVerdict` (the verdict
  vocabulary of the fidelity findings).
- `trajectory` — the canonical serialization/digest family (the
  deep-equality witness + content addressing).

License: Apache-2.0 (the repository LICENSE).
