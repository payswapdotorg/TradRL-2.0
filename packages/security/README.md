# `security` — the SECURITY CONTRACT (W060)

The typed contracts of the security layer, AS DATA (the W035–W058 flat
source-exported pattern). The pure machinery lives in
`services/security` (W060's service twin).

## What this package OWNS

- **The tenant-isolation proof vocabulary** (`isolation.ts`) — the R056
  generalization: W054 enforced the tenant-isolation law on one knowledge
  record at a time; this package owns the vocabulary of CROSS-RECORD
  isolation proofs over §14-scoped records — the typed finding set
  (`malformed-record` / `implicit-scope` / `cross-tenant` (R056, loud) /
  `scope-mismatch` / `duplicate-record`), the canonical findings order,
  the content-addressed `iso-<digest>` proof id, the evidence-envelope
  record-shape laws, and the proof laws (scope explicit; mismatches typed;
  input order never leaks — A9).
- **The SECRET-REFERENCE contract** (`secrets.ts`) — typed handles: a
  secret's IDENTITY (closed kind vocabulary, §14 scope, display name) +
  its CUSTODY POLICY (rotation cadence / access scopes / redaction level —
  closed sets, ALL declared data), the opaque `sec-<digest>` id weighing
  the TENANT first (R056 structural), and **THE REDACTION LAW, enforced
  structurally at construction**: `sealSecretReference` scans its entire
  input and refuses LOUDLY (`secret-value-refused`) any forbidden VALUE
  member (`value`/`secret`/`password`/`token`/`apiKey`/`credential`/
  `privateKey`/`plaintext`/`key`) or any secret-shaped string (known
  token grammar, PEM private-key blocks, bearer material, AWS-style secret
  keys, JWTs, high-entropy long tokens) — the push-protection lesson made
  law. The scanner (`secretValueViolations`, `isSecretShaped`) is exported
  and re-run by every re-validation.
- **The security-policy vocabulary** (`policy.ts`) — the `SecurityPolicy`
  record: the §14 scope governed, the declaring principal (W058's grantee
  vocabulary — `blankEntitlementScopeMembers` imported and re-run, never
  re-declared), the minimum §14 explicitness (W059's closed route-scope
  hierarchy, imported), the secret-custody requirement, and the
  authorization model — closed to `entitlement-grants`: access decisions
  defer to W058's pure grant-check, always.
- **Whole-record re-validation** (`validate.ts`) — all three contracts
  proven again from their own carried bytes: ids re-derived (A9), closed
  sets re-enforced, canonical orders re-proven, THE REDACTION LAW
  re-scanned (a record carrying a secret-shaped string is INVALID).

## What this package does NOT own (deliberately)

- **No proof MINTING** — `proveIsolation(records)` (every record's §14
  scope checked against the canonical reference scope) lives in
  `services/security`.
- **No custody ENFORCEMENT** — `enforceSecretPolicy(policy, references)`
  lives in `services/security`.
- **No authentication execution, no authorization decisions** (A14 — the
  authorization model member CITES W058's grant-check; this layer never
  runs it), **no decryption, no secret storage or transmission, no
  rotation execution** (rotation is DECLARED data here), **no deployment**
  (W062), **no audit trail** (W061), **no shadow adapters** (W065).

## Design decisions (disclosed)

1. **`SecurityScope` = the W054 `KnowledgeScope`**, imported as a type
   alias — R056's domain is every §14-scoped record, and the generalization
   cites the first instance instead of re-declaring a parallel shape.
2. **THE REDACTION LAW's signature list is closed and exported** — known
   token grammar (prefixes), PEM private-key blocks, bearer-header material,
   AWS-style 40-char secret keys, JWT shape, and long high-entropy tokens
   (≥ 32 chars, ≥ 12 distinct characters). The list is deliberately
   conservative: ids, digests, and scope members of this repo's records
   never trip it. The detector's OWN grammar is assembled at runtime from
   non-secret fragments, so the law's own implementation passes its own
   scan (the redaction law is structural, even over its own source).
3. **The enforcement vocabulary lives here, the enforcement record lives
   in the service** — `SecretPolicyViolation` (typed codes) is part of the
   contract surface; `enforceSecretPolicy` mints the enforcement record.
4. **No lineage on secret references** — a handle's identity is its
   content (scope + kind + name + custody policy); rotation state is
   observed data the custody check reasons about, never part of the
   handle's identity (disclosed against the W054/W058 lineage pattern).
5. **The test suite contains NO secret-shaped literals** — redaction-law
   fixtures are constructed at RUNTIME from non-secret fragments, so the
   law applies to its own tests (the redaction law is structural).
