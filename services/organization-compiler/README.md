# organization-compiler (W039)

The **pure compile service** — `compileOrganization(definition, registry)`:
the declarative organization MODEL (the `organization` package) plus a
typed component registry resolve into a `CompiledOrganization`, as DATA.

## OWNS

- **`registry.ts`** — the component registry input: registered W032
  bodies and W033 substrates with the capabilities each offers, plus the
  registry's declared (single) scope. Its own fail-closed validation:
  duplicate component ids, duplicate offerings, component-scope
  disagreement, and descriptor validity delegated to the components' OWN
  validators (`validateBodyDescriptor` / `validateSubstrateDescriptor`)
  with errors carried verbatim.
- **`compile.ts`** — `compileOrganization`: the resolved binding plan
  (which concrete body + substrate fill each position), the W034
  possession declaration for every seat verified through
  `checkPossessionCompatibility` (incompatibilities carried verbatim),
  the satisfied capability demands, the canonical A6-friendly
  execution-order plan (root positions sorted, then depth-first over
  the unit forest with sorted siblings), and the content-addressed
  compiled id `orgc-<digest>` (canonical JSON + FNV-1a over the
  organization id + the registry fingerprint + the plan). Also exports
  `canonicalExecutionOrder` as its own pure law.

## Determinism laws (A9)

- Candidates are considered in canonical sorted component-identity
  order; the **first eligible body and substrate win — no backtracking**.
  A capability or compatibility failure is a loud typed error, never a
  silent re-pick.
- Same definition + same registry ⇒ deep-equal plan and the same id
  (the twin law — proven by test). Registry input order is irrelevant:
  the fingerprint is computed over the sorted registry.
- No wall clocks, no randomness, no env reads.

## Fail-closed (never a silent drop)

`definition-invalid` (model errors verbatim) · `registry-invalid`
(registry errors verbatim) · `registry-scope-mismatch` ·
`unresolvable-position` (no registered component fills the seat) ·
`missing-capability` (the deterministic pair does not provide a
demanded capability) · `incompatible-binding` (W034 refused the
possession — incompatibilities verbatim).

## Does NOT own (scope honesty)

- **The organization model** — `packages/organization` owns the shapes,
  laws and ablations; this service only consumes them.
- **Possession semantics** — W034 (`packages/possession`) owns
  compatibility; this service constructs the declaration and carries
  W034's verdict verbatim, never re-derives it.
- **World attachment** — the compatibility proof runs WITHOUT a world
  (the W034 no-world branch): the W032 attach constraints are NOT
  claimed in `compatibility.checked`; attaching to a concrete world is
  the runtime's proof (W035+).
- **Execution** — nothing here runs the plan; the CompiledOrganization
  is data for the runtime. No model calls, no I/O, no env reads.
- **Discovery/selection policy** — which components get REGISTERED (and
  in what priority humans might prefer) is the caller's world; the
  compiler's only selection law is the deterministic first-eligible rule
  above.

## Conventions

Source-exported modules (the packages/* pattern; `services/` is a
pre-registered workspace glob); `package.json` "exports" maps `.` plus
one entry per module; tests are `node:test` + `node:assert/strict` over
REAL imports (no shims); every file ≤ 400 lines; Apache-2.0 (the
repository LICENSE).
