# `security-service` — the SECURITY SERVICE (W060)

The pure machinery over the security contract (`packages/security`) —
W060's service twin (the W054 firm-brain pattern: the package owns the
typed contracts, the service owns the composition machinery).

## What this service OWNS

- **`proveIsolation(records)`** (`isolation.ts`) — THE CROSS-RECORD PROOF:
  every record's explicit §14 scope checked against the canonical
  reference scope (the canonically-first well-scoped record's — A9: input
  order never leaks). A TENANT disagreement is the LOUD typed
  `cross-tenant` finding naming R056; project/world disagreements are
  `scope-mismatch` findings; implicit scopes, malformed entries, and
  duplicate record ids are typed findings too — all collected, canonical
  order, sealed as the content-addressed `iso-<digest>` proof. Fail-closed
  gate: non-array input and EMPTY record sets are refused loudly (nothing
  is proven vacuously). Ships the W054 adapters (`knowledgeRecordEvidence`
  over memory KnowledgeRecords — the isolation law's first instance — and
  `brainEvidence` over brain generations).
- **`enforceSecretPolicy(policy, references)`** (`secrets.ts`) — THE PURE
  CUSTODY CHECK: every secret handle proven against the §14-scoped
  policy's requirements — THE REDACTION LAW re-scanned over every checked
  byte (`secret-value-detected`), the records' own laws re-validated with
  errors carried verbatim (`invalid-policy` / `invalid-reference`), scope
  agreement (R056 loud on cross-tenant; §14 on project/world), rotation
  compliance (the strictness lattice: on-every-use > shorter schedule >
  longer schedule > never), access-scope agreement (W059's closed
  hierarchy), redaction sufficiency (the closed strictness order), and
  duplicate-handle detection. The verdict is the content-addressed
  `enf-<digest>` enforcement record (canonical violation order — A9).
- **`validateSecretEnforcement`** (`validate.ts`) — the enforcement record
  proven again from its own carried bytes (id re-derived, canonical order,
  derived verdict, exact counts); the contract validators re-exported
  through the service surface for W062/W065 consumers.

## What this service does NOT own (deliberately)

- **No authentication, no authorization decisions** (A14) — the policy's
  authorization model CITES W058's entitlement grants as data; the
  grant-check itself is `verifyEntitlement` in `packages/entitlements`.
- **No decryption, no secret storage/transmission, no rotation execution**
  (rotation cadence is DECLARED data the check reasons about).
- **No deployment** (W062 production deploy), **no audit trail** (W061),
  **no shadow adapters** (W065), **no HTTP serving** (W062).

## Design decisions (disclosed)

1. **Package name `security-service`** — every existing service's package
   name matches its directory (`api`, `firm-brain`, …), but `security` is
   taken by the contract package; the order's anticipated
   `security-service` avoids the workspace-name collision.
2. **`enforceSecretPolicy(policy, references)` takes the full
   `SecurityPolicy` record** (not the bare custody policy): the record is
   the §14-scoped carrier of the custody requirement, so the check also
   proves scope agreement (R056 loud) — the custody check itself runs
   purely over `policy.secretCustody`.
3. **The enforcement record carries no provenance member** — its A9 proof
   is the `enf-<digest>` id re-derivation + the derived verdict (the
   package's closed deriver vocabulary stays exactly three; disclosed
   against the W054/W058 provenance-everywhere pattern).
4. **Empty record sets are refused by `proveIsolation`** (fail-closed:
   nothing proven vacuously) while **zero references are lawful for
   `enforceSecretPolicy`** (a valid policy governing no handles yet still
   checks the policy's own laws).
5. **The custody checks skip handles that fail their own laws** — an
   invalid handle already yields its typed `invalid-reference` violation;
   comparing its untrusted bytes against the policy would be noise, not
   law (same for a policy that fails `validateSecurityPolicy`).
