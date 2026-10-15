# memory (W054 — the MEMORY CONTRACT)

The firm's accumulated knowledge as **typed DATA**: the `KnowledgeRecord`
contract over the evidence the chain already produced — W053 post-mortems
and lessons, W040 capabilities, W051 search histories (W038 evaluation
summaries ride **carried** inside the post-mortems' own citations).

## OWNS

- `record.ts` — the KnowledgeRecord: the typed source-citation union
  (post-mortem / lesson-set / capability / search-history), the carried
  payload, the explicit `tenantId/projectId/worldId` scope (§14), the
  immutable lineage, the deterministic provenance, the content-addressed
  `mem-<digest>` id, and `sealKnowledgeRecord` — the seal gate enforcing
  the record's own identity laws.
- `store.ts` — the append-only store **CONTRACT** (laws M1–M6): typed
  interface only; no engine, no persistence, no I/O (the W037
  trajectory-store precedent).
- `validate.ts` — `validateKnowledgeRecord`: whole-record re-validation
  from recorded data (id/citation/scope/lineage/provenance re-proofs).
- `test/` — REAL imports (W053/W040/W051 fixtures through their own gates).

## DOES NOT OWN

- **The deep source re-proof at ingestion** — running a payload back
  through W053/W040/W051's own validators is the **firm-brain service's**
  ingestion gate (`services/firm-brain`).
- **Any engine or persistence** — the store is a typed contract;
  implementations live in their own work items.
- **Reasoning, deciding, applying knowledge** — A14: this package composes
  typed records and carries them; the runtime (W044+) and autonomous
  improvement (W055) consume it.
- **Security (W060)**, **recall/query surfaces** (the firm-brain service),
  **post-mortem/lesson/capability/history derivation** (W053/W040/W051).

## THE HEADLINE LAW

R056, ENFORCED STRUCTURALLY: the **tenant** scope is part of a record's
canonical identity — the `mem-<digest>` id is minted over a canonical form
whose first weighed member is the tenant, and the payload's own scope must
agree with the record's declared tenant. A cross-tenant record is a loud
typed `cross-tenant` refusal naming `spec/REQUIREMENTS.md R056` — never a
silent adoption, never a silent id collision.

## Determinism (A9)

Same scope + source + payload ⇒ deep-equal record, same `mem-` id. No
clocks, no randomness, no env reads. The lineage rides BESIDE the id (the
W053 precedent).

License: Apache-2.0 (the repository LICENSE).
