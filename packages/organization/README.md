# organization (W039)

The declarative **Organization MODEL** — spec/ARCHITECTURE.md §12: "Agent =
Body possessed by Cognitive Substrate. **Organization discovers
capabilities and composes Bodies.**" An organization is DATA + LAWS,
never execution.

## OWNS

- **`identity.ts`** — the opaque id family (`OrganizationId`,
  `OrganizationUnitId`, `OrganizationPositionId`,
  `OrganizationCapabilityId`), the explicit `OrganizationScope`
  (tenant/project/world), and the deterministic canonical identity:
  canonical JSON (recursively sorted keys) + FNV-1a 32-bit over a
  canonical projection of the whole definition (every semantic list
  sorted by its canonical key) — same bytes ⇒ same id (A9). This is the
  repo's W004/W016 hashing family re-implemented in-package (the W037
  trajectory precedent, byte-compatible).
- **`definition.ts`** — the model shapes: positions (body requirements /
  substrate requirements / capability demands), the composition tree
  (positions compose into units, units into the organization — a
  parent-pointer forest, the root being the organization itself),
  possession bindings declared through W034's channel/grant vocabulary
  (the **"organization"** channel), the declared capability catalogue,
  and the immutable lineage.
- **`validate.ts`** — the fail-closed laws, each violation a loud typed
  error naming the law: unknown capability reference,
  position-without-requirements, cyclic composition, duplicate ids
  (positions/units/capabilities/bindings/list entries), scope mismatch
  (a binding narrowing that widens beyond the position's own
  requirement — the W034 scope law), invalid channel (off
  `"organization"`), unbound position, invalid lineage, empty
  organization. Closed-set membership is proven against the W032/W033
  runtime tables (`BODY_COMMAND_KINDS`, `BODY_OBSERVATION_KINDS`,
  `SUBSTRATE_STATE_MODES`) and W036's `ABLATION_KINDS`.
- **`ablation.ts`** — ablation-readiness (R053 + §13): typed PURE
  operations producing a NEW valid definition with a DERIVED identity
  and a lineage citing the parent: `ablatePosition` / `ablateUnit`
  (the "organization" axis) and `substituteSubstrateRequirement` (the
  "model-substitution" axis) / `substituteBodyRequirement` (body-side,
  filed under "organization"). Fail-closed: unknown ids and
  law-violating results are refused with the validation errors carried
  verbatim — nothing is emitted, and the input is never mutated.

## Does NOT own (scope honesty)

- **Execution / runtime / model calls** — none. The model is data +
  laws; nothing here runs, decides, or calls a model.
- **Compilation** — resolving concrete bodies/substrates into positions
  is the *services/organization-compiler* package (the compile service).
- **Possession semantics** — the grant/scope vocabulary is W034's
  (`packages/possession`); this package only DECLARES bindings in that
  vocabulary (the "organization" channel) and proves declaration-level
  laws.
- **World attachment** — proving a body can attach to a concrete world
  is the W032 attach validation (runtime-facing, W035+); the model has
  no world object.
- **Evaluation/optimization loops** — scoring ablated organizations is
  W036 (policy) + W037/W038 (experiments/evaluation); this package
  only makes the structure those axes act on.
- **Registry contents** — which concrete bodies/substrates exist is the
  compiler's registry input, never model state.

## Conventions

Flat source-exported modules (the possession/agent-body pattern);
`package.json` "exports" maps `.` plus one entry per module; tests are
`node:test` + `node:assert/strict` over REAL imports (no shims); every
file ≤ 400 lines; Apache-2.0 (the repository LICENSE).
