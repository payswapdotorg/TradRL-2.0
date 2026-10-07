# tradrl-evaluation-replay (W022)

The falsifiable replay-fidelity verification harness over the **W021 NautilusTrader
adapter's** declared fidelity conventions and the **W020/W031 replay path**.

A claim that cannot fail is worthless: every check here is an adversarial fixture
in, a typed verdict out — `{ claim, verdict: PASS | FAIL | PARTIAL, evidence }`.
A **FAIL** is a valid outcome (the harness working, not failing); a **PARTIAL**
means the claim held within its declared scope and the limitation is disclosed
in the adapter's own fidelity declaration.

## Surface

- `verifyFidelityClaims()` — the adapter/loader-level claims (sync):
  - **ns conventions** (`nsChecks`): exact-digit ns→ms truncation, the
    1990..2100 loud sanity window (floor/ceiling edges map; ms/us/s-in-ns
    corruptions and garbage-above-ceiling rejected loudly, the unit-applied-twice
    hint named).
  - **dtype conventions** (`dtypeChecks`): bar `ts_event`=interval-start /
    `ts_init`→`availableAt` at the close; aggressor mapping; QuoteTick
    no-`last`; trade id int64/legacy-string; the unmappable dtypes rejected
    **by declaration**.
  - **tick conventions** (`tickChecks`): float64→canonical decimal via the
    shortest round-trip representation.
  - **honesty declarations** (`honestyChecks`): the adapter's disclosed
    limitations (precision loss, window bounds) are REGISTERED and their loud
    boundaries verified to fire.
- `verifyNautilusReplayFidelity()` — the whole harness (async): the claims above
  **plus** the end-to-end replay pipeline (dataset → the W020
  `loadHistoricalDataset` → the W031 CLI run/replay seam → A9 twin stability +
  the W016 restore equivalence), assembled into the deterministic,
  content-addressed findings report (`report.ts` — the W028 digest family).

## The claim registry (`claims.ts`)

Every claim is declared before it is checked: a `FidelityClaimDescriptor` with
the declaration source and the needles its evidence must name. The registry is
the checklist; the checks are the trial; `findings.ts` is the typed verdict
record. Undeclared failures are surfaced as their own finding kind (a check may
not fail in a way its declaration does not anticipate).

## Fixtures

Fixture-based only (the THIRD-PARTY-TECHNOLOGY-REGISTER posture: NautilusTrader
is LGPL-3.0-only — shapes transcribed from the published docs, never imported).

## Tests

`cd packages/tradrl-evaluation/replay && ../../../node_modules/.bin/tsx --test test/*.test.ts`
— the claim registry completeness, each check family's verdicts (PASS, FAIL,
PARTIAL all pinned), the falsifiability laws (a mangled fixture MUST flip its
verdict), and the end-to-end replay report determinism.
