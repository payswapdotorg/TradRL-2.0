# firm-brain (W054 — the pure composition service)

The FIRM BRAIN: the firm's accumulated, **tenant-isolated** knowledge store,
as a pure, immutable value composed over the `memory` contract (W054's
other half).

## OWNS

- `brain.ts` — `foundBrain(scope)`: found ONE brain at ONE explicit §14
  scope (R056: the brain's tenant is part of its identity); `ingest(brain,
  records)`: THE INGESTION GATES — the input brain's invariants re-proven,
  every record re-proven through the memory contract's whole-record
  re-validation AND its payload re-proven through its SOURCE package's own
  validators (`validatePostMortem`/`validateLessonSet` (W053),
  `validateCapabilityRegistry` (W040), `validateSearchHistory` (W051) —
  errors carried VERBATIM), scope isolation proven per record (R056 named
  loudly), then the new generation sealed: canonical record-id order,
  lineage EXTENDED (never rewritten), the `brain-<digest>` id.
- `recall.ts` — the deterministic recall surface: typed
  by-kind/by-source/by-citation queries — each carrying its explicit §14
  scope (identity is explicit **in transport**) — over CARRIED results in
  canonical order; cross-tenant queries are refused loudly naming R056.
- `validate.ts` — `validateFirmBrain`: whole-brain re-validation from
  recorded data (id/scope/generation/lineage/order/provenance re-proofs +
  per-record re-validation through the memory contract's own laws).
- `test/` — REAL imports (W053/W040/W051 fixtures through their own gates;
  records sealed through memory's own seal gate).

## DOES NOT OWN

- **The knowledge-record contract itself** — `packages/memory` (W054's
  contract half) owns the record, the seal gate, the store contract.
- **Reasoning, deciding, acting on knowledge** — A14: this service composes
  typed records and carries them; the runtime (W044+) decides.
- **Autonomous improvement** — W055 builds ON the brain; nothing here ever
  trains, revises, or self-improves.
- **Security** — W060 (the brain is tenant-isolated structurally, not
  cryptographically).
- **Any engine/persistence** — pure values only; the store CONTRACT lives
  in `packages/memory/store.ts`, implementations in their own work items.

## THE HEADLINE LAW

R056, ENFORCED STRUCTURALLY: a record whose tenant is not the brain's
tenant is refused LOUDLY (`cross-tenant`, naming
`spec/REQUIREMENTS.md R056`) at ingestion, at whole-brain re-validation,
and at recall — there is NO seam in this service that can admit, carry, or
enumerate another tenant's knowledge.

## Determinism (A9)

Same records ⇒ deep-equal brain + recall (ingest order never leaks; the
records live in canonical `mem-` id order; the brain id is the content
digest over scope + generation + record ids). No clocks, no randomness, no
env reads.

License: Apache-2.0 (the repository LICENSE).
