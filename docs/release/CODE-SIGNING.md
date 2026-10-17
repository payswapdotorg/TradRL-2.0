# Code Signing Pre-Research (SIGN-01)

Status: **research + decision document — nothing in this document is implemented.**
No workflow, script, package file, or build configuration is touched by SIGN-01;
the diff that carries this document is documentation-only. Every implementation
item in section 4 is a plan for a future work order that is **gated on the
operator providing credentials**, exactly as
[`DESKTOP-RELEASE.md`](DESKTOP-RELEASE.md) ("Signed builds — future work")
already anticipates.

Purpose: the release line ships unsigned installers. That fact is disclosed on
every user-facing surface (the README's *Download & install* section, the
release-notes template in `release-desktop.yml`, and the runbook's *Unsigned
builds* section). Signing requires credentials only the operator can provide,
and the operator has not yet chosen a path. This document exists so that the
choice can be made with full knowledge of cost, lead time, and exactly what
must be handed over — so that when credentials arrive, the implementation is a
small, well-scoped change rather than research-under-pressure.

Sourcing rules used throughout:

- Every factual claim about pricing, process, or tooling behavior carries an
  official-document link (Apple Developer, Microsoft Learn, electron-builder
  docs, GitHub docs, CA/Browser Forum, CA vendor pages). Full list in
  section 5.
- Where a number could not be verified from the official page, it is marked
  **verify at purchase time** with the link — no invented precision.
- Where two sources disagree, both are shown (see §2.5 on SmartScreen and EV).
- electron-builder behavior is cited from the **v26 documentation set**
  (`https://www.electron.build/v26/docs/...`). That is the version family this
  repository pins — `electron-builder@26.8.1` in `packages/desktop/package.json`
  — while the unversioned `electron.build` URLs currently serve the unreleased
  v27 docs. The `/v26/` links are the correct stable citations.

## 0. Executive summary

| Priority | Path | Verdict |
| --- | --- | --- |
| 1 | **macOS — Developer ID Application + notarization** | Do it first. $99 USD/year all-in, plain GitHub secrets, the repo's electron-builder config already carries the seam (`APPLE_SIGNING_IDENTITY` + `ZCODE_ENABLE_MAC_SIGN=1`), and it converts the worst first-launch experience we ship (Gatekeeper hard-block) into a clean launch. |
| 2 | **Windows — Azure Artifact Signing** (formerly Trusted Signing) | Best fit for a tag-triggered, GitHub-hosted CI: no hardware token to babysit, native electron-builder 26 support (`win.azureSignOptions`), entry price $9.99/month. Subject to Microsoft's org vetting (identity validation, 1–20 business days) and country restrictions — check §2.2 eligibility before committing. |
| 3 | **Windows — OV certificate from a public CA** | The fallback if Azure eligibility fails. CA-dependent pricing (Sectigo advertises "from $536.25/yr on a 5-year plan"), and since 2023-06-01 the CA/Browser Forum requires private keys on hardware, so the certificate cannot simply live in a GitHub secret — realistic patterns are a CA cloud-signing service or signing outside CI. |
| — | Windows — self-signed | Not a real option for distribution: no SmartScreen reputation, same warnings as unsigned. One paragraph in §2.3 so nobody proposes it in earnest. |
| — | **Linux — AppImage/deb/rpm signing** | **Defer.** No Linux desktop platform hard-blocks unsigned binaries; today's integrity story (`SHASUMS256.txt` + the quick installers' SHA256 refusal) already covers tamper-evidence, and ecosystem signature checks (AppImage `.sha256_sig`, apt/dnf repo GPG) are opt-in and effectively unused for GitHub-Release distribution. Grounded recommendation in §3.5. |

A note on naming: Microsoft renamed **Azure Trusted Signing** to **Azure
Artifact Signing**; the old `learn.microsoft.com/azure/trusted-signing/...`
URLs now redirect to `.../azure/artifact-signing/...` (verified 2026-10-17).
This document uses the new name with the old one in parentheses, and cites the
canonical new URLs.

## 1. macOS — the priority platform

### 1.1 Why unsigned hurts here most

Gatekeeper is the only OS gate among our three platforms that **hard-blocks**
an unsigned first launch. Today's documented workaround (README, release
notes): right-click `ZCode.app` → **Open**, or System Settings → Privacy &
Security → **Open Anyway** — Apple's support doc describes the latter path and
notes the "Open Anyway" button stays available for about an hour after the
blocked launch attempt ([support.apple.com — open-a-mac-app-from-an-unidentified-developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)).

Since macOS 10.15 (Catalina), apps distributed outside the Mac App Store must
be **notarized** or Gatekeeper blocks them — signing alone is not enough
([Apple — notarizing-macos-software-before-distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution);
the electron-builder v26 notarization page states the same rule:
[electron.build/v26 — notarization](https://www.electron.build/v26/docs/features/code-signing/notarization)).
So the macOS path is really two deliverables: a **Developer ID Application
certificate** (identity) and **notarization** (Apple's malware scan that issues
the Gatekeeper-accepted ticket).

### 1.2 What the certificate is and how it is obtained

- **What it is.** A Developer ID certificate lets Gatekeeper verify the app
  comes from a trusted developer when distributed outside the Mac App Store
  ([Apple — developer-id](https://developer.apple.com/developer-id/)). For our
  asset matrix (we ship a `.dmg`, not a `.pkg`) the correct type is **Developer
  ID Application** — electron-builder's certificate table maps "macOS direct
  distribution" to exactly that type, and lists Developer ID *Installer* as
  needed only for the `pkg` target
  ([electron.build/v26 — code-signing-mac](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac)).
- **Account prerequisite.** Apple Developer Program membership at **$99 USD
  per year**; the membership is what includes Developer ID certificates and
  notarization access — electron-builder's docs phrase the prerequisite as
  "An active Apple Developer Program membership ($99/year)"
  ([developer.apple.com/programs](https://developer.apple.com/programs/);
  [electron.build/v26 — notarization](https://www.electron.build/v26/docs/features/code-signing/notarization)).
  Enrollment is as an individual or as an organization; **organization
  enrollment requires a legal entity (no DBAs/trade names) and a D-U-N-S
  number** so Apple can verify legal-entity status and address
  ([developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)).
  Apple does not publish a fixed approval SLA; budget same-day-to-days for
  individuals and longer for organization verification — verify during
  enrollment.
- **Issuance flow.** The Account Holder generates a CSR (Keychain Access →
  Certificate Assistant → Request a Certificate from a Certificate Authority —
  [Apple Help — create-a-certificate-signing-request](https://developer.apple.com/help/account/create-certificates/create-a-certificate-signing-request)),
  then creates the Developer ID Application certificate from that CSR in the
  Certificates, Identifiers & Profiles section of the developer account or in
  Xcode; only the Account Holder can generate it
  ([Apple Help — create-developer-id-certificates](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates);
  [Apple — developer-id](https://developer.apple.com/developer-id/)).
- **Export for CI.** The certificate plus private key are exported from
  Keychain Access as a password-protected `.p12`; multiple certificates can be
  exported into one `.p12`, and electron-builder imports whatever it finds into
  a temporary keychain on CI
  ([electron.build/v26 — code-signing-mac](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac)).

### 1.3 electron-builder wiring (what the repo already has)

The signing seam **already exists** in
`packages/desktop/electron-builder.config.js`:

- `APPLE_SIGNING_IDENTITY` (or `CSC_NAME`) selects the keychain identity; the
  config strips the `Developer ID Application:` prefix because electron-builder
  26 rejects the prefixed form in `mac.identity` (config comment, lines 82–86
  and 667–673).
- `ZCODE_ENABLE_MAC_SIGN=1` gates `mac.identity` and
  `mac.hardenedRuntime` together (lines 85–86, 673, 678) — signing is
  deliberately opt-in so local dev builds are never bound to signing config.
- Entitlements files are already wired: `build/entitlements.mac.plist` and
  `build/entitlements.mac.inherit.plist` (lines 680–681; both files exist in
  `packages/desktop/build/`).
- `notarize: false` is hard-set (line 677) with a rationale comment: the
  workbench-inherited pipeline design is "sign at build stage, notarize in a
  separate stage," so electron-builder's built-in notarization (which reads
  Apple credentials during the build and would fail the build before the DMG
  exists if they are wrong) is intentionally off.
- There is even a fail-closed guard: a Preview-flavor build with
  `ZCODE_ENABLE_MAC_SIGN=1` but no identity throws instead of silently
  producing an unsigned artifact (lines 212–220).

The standard electron-builder credential env vars (documented for v26 at
[electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)):

| Variable | Meaning |
| --- | --- |
| `CSC_LINK` | Base64-encoded `.p12` (also accepts HTTPS URL / `file://` / local path) |
| `CSC_KEY_PASSWORD` | Password for the `.p12` at `CSC_LINK` |
| `CSC_NAME` | macOS keychain identity name, useful when several identities exist |

On CI, `CSC_LINK` + `CSC_KEY_PASSWORD` import the P12 into a temporary
keychain, and the identity env var selects it. The base64 encoding recipe
(`base64 -i cert.p12`) is documented on the same page.

### 1.4 Notarization

**What Apple requires** before submission (all from
[Apple — notarizing-macos-software-before-distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)):

- code-sign every executable with a **Developer ID** certificate (not Mac
  Distribution, ad hoc, or development certs);
- enable the **Hardened Runtime** ([Apple — hardened-runtime](https://developer.apple.com/documentation/security/hardened-runtime));
- include a **secure timestamp** with the signature;
- do **not** carry the `com.apple.security.get-task-allow` entitlement set to
  true; entitlements must be properly-formatted XML;
- link against the macOS 10.9-or-later SDK (a non-issue for current Electron).

The `notarytool` and `stapler` CLIs ship with Xcode; `altool` submissions were
rejected starting 2023-11-01 (same Apple page).

**Credential options for notarytool** (both work; Apple documents the flags on
[customizing-the-notarization-workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)):

1. **App Store Connect API key** — `--key <p8 path> --key-id <KeyID> --issuer <IssuerID>`.
   Keys are created under App Store Connect → Users and Access → Keys.
2. **Apple ID + app-specific password** — `--apple-id <id> --password <app-specific-password> --team-id <TEAMID>`.
   Because App Store Connect accounts enforce two-factor authentication,
   notarytool needs an app-specific password for this mode (same Apple page).

Either can be stored once with
`xcrun notarytool store-credentials <profile> ...` and reused via
`--keychain-profile`. **For CI, electron-builder's docs explicitly recommend
the API-key option** — it does not expire and avoids 2FA prompts
([electron.build/v26 — notarization](https://www.electron.build/v26/docs/features/code-signing/notarization)).

**Stapling.** After notarization, Apple issues a ticket; `xcrun stapler
staple` attaches it to the executable so Gatekeeper can validate **offline**
(Apple, same notarization page's stapling section). electron-builder performs
the staple automatically when its built-in notarization is enabled
("Stapling is performed automatically when `notarize: true`" —
[electron.build/v26 — notarization](https://www.electron.build/v26/docs/features/code-signing/notarization)).

**electron-builder's current recommended approach (v26 docs):** set
`mac.notarize: true` in the build config alongside
`hardenedRuntime: true` + entitlements, and provide credentials via env vars —
either the Apple-ID trio (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`) or the API-key set (`APPLE_API_KEY` as base64 of the `.p8`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, plus `APPLE_TEAM_ID`). electron-builder
then signs, notarizes, and staples in one build; a custom `afterSign` hook
with `@electron/notarize` remains the escape hatch for extra binaries
(all documented on the v26 notarization page above). The repo's current
`notarize: false` design (build-stage sign + separate notarization stage) is
the alternative; §4.3 sketches both with trade-offs.

### 1.5 Where this slots into `release-desktop.yml`

Signing belongs to the **`build-desktop`** job (matrix legs `mac-arm64` and
`mac-x64`), at the **"Bundle desktop installer"** step — that is the step that
runs `pnpm --filter @zcode/desktop run bundle -- --os <t> --arch <t>
--skip-prepare --skip-build`, i.e. the only step that invokes electron-builder
(where `CSC_LINK` / `CSC_KEY_PASSWORD` / identity env vars are consumed).
Credentials would be injected as step- or job-level `env:` mapping GitHub
secrets, scoped to the mac matrix legs only — see the scoping pitfall in §4.3.
If the two-stage design is kept instead of `notarize: true`, a new
**"Notarize and staple"** step would follow "Bundle desktop installer" (and
precede "Show installer inventory") on the mac legs, running
`xcrun notarytool submit ... --wait` + `xcrun stapler staple` against
`packages/desktop/dist/`.

Two workflow-level facts must be updated when that day comes:

- the header comment in `release-desktop.yml` (lines 17–18) says
  **"GITHUB_TOKEN only … No secrets, PATs or other tokens are used by this
  workflow"** — that statement stops being true the moment signing secrets are
  added and must be rewritten in the same PR;
- the release-notes template's *Unsigned-build disclosure* section (in the
  "Render release notes" step) needs its macOS bullet removed once builds are
  signed + notarized.

Secrets are standard repository/environment secrets
([docs.github.com — using-secrets-in-github-actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions));
because this workflow is tag-triggered (never fork-PR-triggered), the usual
"secrets are not passed to forked-repository runs" limitation is irrelevant
here.

### 1.6 Exactly which secrets macOS would need

| Proposed secret | Maps to env | Content |
| --- | --- | --- |
| `MACOS_P12_BASE64` | `CSC_LINK` | base64 of the exported Developer ID Application `.p12` |
| `MACOS_P12_PASSWORD` | `CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: <Legal Entity> (<TEAMID>)` — the repo config accepts the full string and normalizes the prefix |
| `APPLE_API_KEY` | `APPLE_API_KEY` | base64 of the App Store Connect API key `.p8` |
| `APPLE_API_KEY_ID` | `APPLE_API_KEY_ID` | the key's Key ID |
| `APPLE_API_ISSUER` | `APPLE_API_ISSUER` | the issuer UUID |
| `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | the 10-character team ID |

(`ZCODE_ENABLE_MAC_SIGN=1` is a switch, not a secret.) If the operator prefers
the Apple-ID mode instead of an API key, the last four collapse to
`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` — the electron-builder
docs list exactly these two credential sets
([electron.build/v26 — notarization](https://www.electron.build/v26/docs/features/code-signing/notarization)).

### 1.7 User-visible delta

Today: first launch of `ZCode.app` is blocked by Gatekeeper; the user must
right-click → **Open** or go to Privacy & Security → **Open Anyway** (and on
current macOS the "Open Anyway" button only appears *after* a blocked attempt,
within roughly an hour — [Apple support](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)).
The release notes and README must carry bypass instructions for every release.

After signing + notarization + stapling: a clean double-click first launch.
`spctl -a -vv -t exec` on the installed app reports
`source=Notarized Developer ID` — which is exactly what
`scripts/doctor-macos-release-app.sh` already knows how to check (it runs
`codesign --verify --deep --strict`, `spctl -a -vv -t exec`, and
`xcrun stapler validate` — the same commands the electron-builder docs
prescribe for post-build verification). The macOS bypass paragraph disappears
from README, release notes, and the installer's output.

## 2. Windows

### 2.1 Option A — OV code-signing certificate from a public CA

**What it is.** An Organization-Validated (OV) Authenticode certificate from a
public CA (Sectigo / DigiCert / SSL.com class). electron-builder's docs
describe it as "Most common choice … After reputation builds (days-weeks)",
CI-compatible when the key is exportable
([electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)).

**The hard constraint: private keys must live in hardware.** Since
**1 June 2023**, the CA/Browser Forum Code Signing Baseline Requirements
(CSBR §6.2.7.4.1) require that subscriber private keys for *all* code signing
certificates (OV included, not just EV) are generated, stored, and used in a
Hardware Crypto Module certified to at least **FIPS 140-2 Level 2 / Common
Criteria EAL4+** — with three acceptable patterns: (7) the subscriber's own
HSM/token, (8) a cloud key-protection solution whose keys never leave the
cloud HSM boundary (with access logging), or (9) a CA-side Signing Service
([CA/Browser Forum CSBR v3.11.0](https://github.com/cabforum/code-signing/blob/main/docs/CSBR.md),
published via [cabforum.org — baseline-requirements-code-signing](https://cabforum.org/baseline-requirements-code-signing/)).

**What that means for CI.** A CA cannot hand over a plain `.pfx` anymore, so
the `WIN_CSC_LINK`-as-base64 pattern only applies to self-signed/private-CA
certificates. Realistic patterns for a tag-triggered GitHub-hosted workflow:

1. **CA-operated cloud signing** (CSBR pattern 8): the key stays in the CA's
   HSM; CI authenticates to a signing API and submits digests. CAs sell this
   as a companion product (e.g. DigiCert KeyLocker, SSL.com eSigner, Sectigo
   signing offerings) — offerings and pricing vary by CA;
   **verify at purchase time**: [DigiCert code signing](https://www.digicert.com/signing/code-signing-certificates),
   [Sectigo code signing](https://www.sectigo.com/ssl-certificates-tls/code-signing),
   [SSL.com code signing](https://www.ssl.com/products/software-integrity/code-signing/).
   Wiring it into electron-builder means a custom `sign` hook
   (`win.signtoolOptions.sign`) that shells out to the vendor CLI — the
   documented pattern for hardware-backed signing on CI runners, with a worked
   JSign/PKCS#11 example in the v26 tutorial
   ([electron.build/v26 — code-signing-windows-apps-on-unix](https://www.electron.build/v26/docs/tutorials/code-signing-windows-apps-on-unix)).
2. **Hardware token outside CI** (CSBR pattern 7): the token is shipped to the
   operator; the release build produces the unsigned `.exe`, and the operator
   signs it on their machine before publishing. This breaks the
   "tag push → release appears" automation and adds a manual trust step, so it
   is a fallback, not a recommendation. (A USB token also cannot be attached to
   GitHub-hosted runners at all.)
3. **Self-hosted runner with the token attached** — possible, but it converts
   the release pipeline into partially self-managed infrastructure; out of
   proportion for this project.

**Pricing ballpark (sourced, not invented).** Sectigo's product page
advertises "Buy Sectigo EV or OV code signing certificates from **$536.25/yr
on a 5-year plan**. FIPS-compliant token included"
([sectigo.com](https://www.sectigo.com/ssl-certificates-tls/code-signing)) —
note that is the 5-year-term headline price, and tokens are shipped annually
per that page. DigiCert and SSL.com prices were not extractable from this
environment (JS-rendered pages): **verify at purchase time** —
[DigiCert](https://www.digicert.com/signing/code-signing-certificates),
[SSL.com](https://www.ssl.com/products/software-integrity/code-signing/).

### 2.2 Option B — Azure Artifact Signing (formerly Trusted Signing)

**What it is.** Microsoft's fully managed signing service — "zero-touch
certificate lifecycle management inside **FIPS 140-3 level 3 certified
HSMs**"; keys never leave the service, and your file never leaves your
endpoint (content-confidential digest signing)
([Microsoft Learn — artifact-signing overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)).

**Pricing (from the official pricing page).** Basic SKU **$9.99/month**
(5,000 signatures/month, 1 of each certificate-profile type) and Premium SKU
**$99.99/month** (100,000 signatures/month, 10 of each type); billing starts
at account creation and is not pro-rated
([azure.microsoft.com — artifact-signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)).
A desktop release signs on the order of dozens of files per tag, so the Basic
quota is effectively unlimited for us — the real cost is **$9.99/month ≈
$120/year**.

**Identity validation (the gating step).** Before a public-trust certificate
profile can issue, the operator completes an identity validation **in the
Azure portal only** (not via CLI):
- *Organization*: legal business entity name (CSBR requires the certificate CN
  to be the validated legal name — see the
  [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)),
  a monitored primary email **on a domain owned by the entity** (verification
  links expire in 7 days), and a named representative who performs individual
  verification with government-issued ID.
- *Individual*: identity details are sourced automatically from the Azure
  billing account (which must have Account Type "Individual"; legal name and
  sold-to address must match the government ID).
- Published processing time: **1 to 20 business days**, possibly longer if
  Microsoft requests more documentation.
  ([Microsoft Learn — artifact-signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).

**Availability constraints (the honest caveat).** Public-trust certificates
are available to organizations in the **United States, Canada, the EU, the
United Kingdom, Australia, New Zealand, Japan, South Korea, Singapore,
Switzerland, Norway, and Israel; individual developers must be located in the
United States or Canada** (private-trust certificates are not geographically
restricted). Quoted from the
[quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
If the operator's entity is not in that list, Option B is off the table for
public trust and Option A becomes the Windows path.

**CI integration (the good news).** electron-builder 26 supports it natively:
set `win.azureSignOptions` (`endpoint`, `codeSigningAccountName`,
`certificateProfileName`, `publisherName` — publisher name must match the
certificate CN; RFC3161 timestamping defaults to Microsoft's own
`http://timestamp.acs.microsoft.com`) and authenticate with a service
principal via `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`
env vars, which are read directly by the signing module
([electron.build/v26 — code-signing-win](https://www.electron.build/v26/docs/features/code-signing/code-signing-win)).
Microsoft also documents a SignTool integration (client tools installer via
`winget install Microsoft.Azure.ArtifactSigningClientTools`, `.NET 8`,
SignTool ≥ 10.0.2261.755, a `metadata.json` with endpoint/account/profile)
and an official GitHub Actions integration
([Microsoft Learn — how-to-signing-integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)) —
so even outside electron-builder the service is CI-friendly.

### 2.3 Option C — self-signed (and why it is not a real option)

A self-signed certificate has no chain to a trusted root, so Windows treats it
exactly like an unsigned binary: the installer still shows "Unknown
publisher", and SmartScreen still warns on files "without established
reputation — especially if the download is not digitally signed" (Microsoft's
SmartScreen overview describes the reputation model at
[learn.microsoft.com](https://learn.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)).
It also builds no reputation, because reputation is tied to the signing
identity's track record, and a self-made identity has none. Self-signing buys
tamper-evidence we **already have** via `SHASUMS256.txt` + HTTPS + the
installers' checksum refusal, at the cost of maintaining a key. It is useful
only for internal testing of the signing *pipeline* itself; it is not a
distribution path and should not be presented to users as a fix.

### 2.4 electron-builder Windows wiring

The repo's `win` config block currently contains only the NSIS target and the
artifact name — no signing configuration exists yet. The v26 mechanisms, per
the docs:

| Mechanism | When it applies |
| --- | --- |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` env vars (fall back to `CSC_LINK` / `CSC_KEY_PASSWORD`) | Exportable PFX — i.e. self-signed/private-CA only, since the 2023 CSBR hardware rule ended exportable public-CA keys |
| `win.signtoolOptions` (`certificateFile`, `certificatePassword`, `certificateSubjectName`, `rfc3161TimeStampServer`, …) | Classic signtool.exe signing; `certificateSubjectName` is the documented path for EV certs on Windows runners |
| `win.azureSignOptions` + `AZURE_*` env vars | Azure Artifact Signing — the no-hardware path |
| `win.signtoolOptions.sign` custom hook | Anything else (CA cloud-signing CLIs, PKCS#11 via JSign, remote KSP) |

Sources: [electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)
and [electron.build/v26 — code-signing-win](https://www.electron.build/v26/docs/features/code-signing/code-signing-win).

A hardening option the docs recommend once signing is real:
`forceCodeSigning: true` makes the build **fail** when no signing identity is
found, converting "misconfigured secret ships an unsigned build" into a loud
CI failure.

### 2.5 SmartScreen reputation — the honest picture

- **The model (Microsoft, official).** SmartScreen checks "a hash of the file
  and the file's digital signature … against an online service to determine
  the reputation of the downloaded program. If the file does not have
  established reputation … you are shown a warning." Reputation accrues from
  "download volumes, download history, URL reputation, and many other
  criteria" — programs "downloaded by many users over a long period of time
  without a history of malware are not likely to be malicious"
  ([Microsoft Learn — SmartScreen overview](https://learn.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)).
  Nowhere does Microsoft promise that any certificate class skips reputation
  building.
- **What electron-builder's docs say (the conflicting claim).** The v26 docs
  state OV trust arrives "after reputation builds (days-weeks)" while EV and
  Azure Trusted Signing are listed as "Immediate"
  ([electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)).
  Treat the "EV = instant reputation" claim as vendor/docs folklore, not a
  Microsoft commitment — the two sources conflict, and per this document's
  sourcing rules both are shown.
- **Practical expectation for us.** Any freshly-issued certificate (OV or
  Azure) will likely still trip "Windows protected your PC" for the first
  users until reputation builds. Signing removes "Unknown publisher",
  enables the reputation clock to start ticking under a stable identity, and
  is a prerequisite for ever getting out of the warning state — but it is not
  an instant warning-killer, and the operator should set expectations
  accordingly.
- **EV market state (verification result, 2026-10-17).** This work order's
  brief noted EV certificates are "increasingly discontinued/merged by CAs."
  What the reachable sources actually show: the CA/B Forum CSBR v3.11.0 still
  defines the EV category (deeper identity validation — verified contract
  signer, etc. — on top of the now-shared hardware requirement)
  ([CSBR](https://github.com/cabforum/code-signing/blob/main/docs/CSBR.md)),
  and Sectigo, SSL.com, and GlobalSign all still list EV code-signing
  products ([Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing),
  [SSL.com](https://www.ssl.com/products/software-integrity/code-signing/)).
  The claim could not be confirmed as a general fact; treat EV SKU
  availability as **verify at purchase time**. For this repo the EV question
  is mostly academic anyway: EV keys live on physical tokens
  ([electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)),
  which GitHub-hosted runners cannot host — the same cloud-signing workaround
  as Option A would be needed, at a higher certificate price.

### 2.6 Where Windows signing slots into `release-desktop.yml`

Same job, different matrix leg: the **`win-x64`** leg of **`build-desktop`**,
at the same **"Bundle desktop installer"** step (that is where
`pnpm --filter @zcode/desktop run bundle -- --os win --arch x64` runs
electron-builder). Azure path: add `AZURE_*` env to that step and an
`azureSignOptions` block to `win` in `electron-builder.config.js`. CA-cloud
path: custom `sign` hook plus the vendor CLI in the runner, or signing as a
post-bundle manual step. The release-notes SmartScreen bullet in the "Render
release notes" step gets updated only after reputation is observed to no
longer warn — not merely the day signing lands.

## 3. Linux — lowest priority, assessed honestly

### 3.1 What Linux users actually have today

No Linux desktop mechanism hard-blocks an unsigned binary: the AppImage runs
with the executable bit set, and the deb/rpm/pacman packages install with
their native tools. Integrity today is provided end-to-end by:

- `SHASUMS256.txt`, generated by the **publish-release** job's "Stage
  installers and generate SHASUMS256.txt" step over every published installer,
  attached to the GitHub Release;
- the quick installers **refuse to install** on checksum mismatch —
  `scripts/install-desktop.sh` dies with "no SHA256 entry … refusing to
  install an unverifiable download" or "SHA256 mismatch", and
  `scripts/install-desktop.ps1` behaves the same;
- the transport itself is HTTPS from GitHub's CDN.

That is tamper-evidence (against corrupted/mirrored downloads) plus
provenance (GitHub Release ↔ tag ↔ commit), which is the realistic threat
model for a developer-tool distribution page.

### 3.2 AppImage GPG signatures

The AppImage type-2 spec allows a signature embedded in the ELF section
`.sha256_sig` — but the operative word is **"MAY"**: signatures are an
optional field of the format, nothing in the runtime verifies them, and the
verification story that exists at all is opt-in tooling (e.g. AppImageUpdate
verifying update signatures when a key is configured)
([AppImageSpec — draft.md](https://github.com/AppImage/AppImageSpec/blob/master/draft.md)).
Who actually verifies: effectively nobody, unless the user deliberately wires
up a keyring. Signing the AppImage would add an optional provenance path
without changing a single user-facing failure mode — the same users who today
skip `sha256sum -c` would equally skip signature verification.

### 3.3 rpm signing (`rpm --sign`)

dnf/rpm verify package signatures when installing **from a configured
repository** with `gpgcheck` enabled (and `localpkg_gpgcheck` for direct
files, which is not the default)
([dnf conf_ref](https://dnf.readthedocs.io/en/latest/conf_ref.html)).
We do not operate a yum repository; users download the `.rpm` from a GitHub
Release and install it directly. Until a real repo exists, an rpm signature is
a field nobody's package manager checks. Verdict: no user-visible change;
defer until/unless we host a repo.

### 3.4 deb signing (`debsign`) + apt repository signing

apt's security model verifies the **repository's** `Release`/`InRelease`
OpenPGP signature against a local keyring and chains per-package checksums
from the signed `Packages` index
([Debian wiki — SecureApt](https://wiki.debian.org/SecureApt)). A directly
downloaded `.deb` installed with `apt install ./zcode…deb` or `dpkg -i` gets
no such verification. `debsign` itself signs source-package control files,
which is irrelevant to binary distribution. As with rpm: valuable only when
an actual apt repository exists, because that is the moment apt starts
enforcing signatures on our users' behalf.

### 3.5 Recommendation for Linux

**Defer — do not spend operator credentials or CI complexity on Linux signing
now.** The grounds, not the fence: (1) no Linux platform gate blocks us, so
the user-visible delta is zero, unlike macOS/Windows; (2) the existing
SHA256 + HTTPS + installer-refusal chain already addresses the realistic
integrity threat; (3) every available signature mechanism (AppImage
`.sha256_sig`, deb, rpm) is only enforced when users consume our artifacts
through infrastructure we do not operate (AppImageUpdate keyrings, apt/yum
repositories) — so the honest sequencing is: *if* we ever add a hosted apt/yum
repository or an in-app Linux auto-updater, *then* repo/signature keying
becomes a real requirement and a small work order; until then it is ceremony.
The zero-cost hygiene step that IS worth doing whenever any signing lands:
keep publishing `SHASUMS256.txt` (it already exists) so the checksum chain
stays the universal floor across all three platforms.

## 4. Decision matrix + operator checklist

### 4.1 Decision matrix

| Path | Cost (USD, list) | Lead time | Operator must provide | CI friction | User-visible improvement |
| --- | --- | --- | --- | --- | --- |
| **macOS — Developer ID + notarization** | $99/yr (membership; certs included) | Membership approval (individual: days; org: D-U-N-S legal verification, longer — no published SLA); cert issuance + P12 export + ASC API key: ~an hour of operator time once the account exists | Apple Developer Program enrollment; CSR + Developer ID Application cert; `.p12` + password; ASC API key (`.p8` + Key ID + Issuer ID) or Apple ID + app-specific password; team ID | **Low** — plain GitHub secrets, existing config seam, one env block (+ either one config line or one extra workflow step) | **Large and immediate**: Gatekeeper clean first launch; no more "Open Anyway" instructions |
| **Windows — Azure Artifact Signing (Basic)** | $9.99/mo ≈ $120/yr | Identity validation **1–20 business days** (portal-only); Azure setup same-day | Azure subscription; Artifact Signing account (Basic SKU); org identity validation (legal entity, monitored email on owned domain, rep govt-ID) or individual (US/CA billing account); App registration + client secret with Certificate Profile Signer role | **Low** — 3 plain secrets + `win.azureSignOptions` config; native electron-builder 26 support; no hardware | **Moderate, improving over time**: "Unknown publisher" gone immediately; SmartScreen warning likely persists until reputation accrues |
| **Windows — OV cert via CA cloud-signing** | CA-dependent; Sectigo advertises "from $536.25/yr on a 5-year plan"; cloud-signing service may cost extra — verify at purchase time | CA org validation (days, CA-dependent) + cloud-signing enrollment — verify at purchase time | CA account + org validation docs; cloud-signing enrollment; API credentials for the signing service | **Medium** — custom `sign` hook shelling out to the vendor CLI inside the runner (or a post-build sign job) | Same as Azure path |
| **Windows — OV/EV cert on hardware token, sign outside CI** | Cert cost as above (+ token shipping) | As above + token shipping | Everything above **plus** the operator personally signing each release | **High** — breaks tag-push automation; every release needs operator hands | Same as Azure path (EV possibly faster reputation per e-builder docs — unverified by Microsoft; see §2.5) |
| **Windows — self-signed** | $0 | Minutes | A keypair (and gets nothing for it) | None | **None** — same warnings as unsigned |
| **Linux — GPG/rpm/deb signing** | $0 | Minutes | GPG keypair + a public-key distribution plan | Low (plain secret) — but see §3.5 | **None** for our distribution model (verification is opt-in and nobody opts in) |

Reading of the matrix: macOS is the only path where a modest, fully-sourced
spend converts a hard user-facing block into a clean experience with plain
secrets and no hardware. Azure is the only Windows path that fits a
GitHub-hosted tag-triggered pipeline without introducing a physical token or
a vendor-specific signing job, and it costs less than any CA certificate —
its gate is eligibility (country + identity validation), not technology.

### 4.2 Operator checklists (literal)

**Path M — "I want macOS signed + notarized." You must obtain and hand over:**

1. Enroll in the Apple Developer Program ($99/yr) — individual or
   organization (org needs D-U-N-S + legal entity)
   ([enroll](https://developer.apple.com/programs/enroll/)).
2. As Account Holder: create a CSR, issue a **Developer ID Application**
   certificate ([Apple Help](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates)),
   export the `.p12` **with its private key**, choose an export password.
3. Create an App Store Connect API key (Users and Access → Keys; Developer
   role is sufficient per the electron-builder docs) and download the `.p8`
   once; note Key ID and Issuer ID.
4. Hand over six values for GitHub secrets: `MACOS_P12_BASE64`
   (`base64` of the `.p12`), `MACOS_P12_PASSWORD`,
   `APPLE_SIGNING_IDENTITY` (the full identity string), `APPLE_API_KEY`
   (base64 of the `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
   (+ `APPLE_TEAM_ID`).
5. The ticket-sized change that follows is §4.3-M: one env block in
   `release-desktop.yml`, either one config line (`notarize` follow-switch)
   or one extra workflow step, plus two comment/notes edits.

**Path W1 — "I want Windows signed via Azure Artifact Signing." You must
obtain and hand over:**

1. Confirm eligibility first: org must be in the supported country list
   (§2.2); individuals must be US/CA. If not eligible, stop — go to W2.
2. Create an Azure subscription, a resource group, an **Artifact Signing
   account (Basic SKU)**, complete **identity validation** in the portal
   (org: legal entity name, monitored email on the entity's domain, a
   representative with government ID; published processing 1–20 business
   days) ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).
3. Create a **certificate profile** (Public Trust) and note the endpoint,
   code-signing account name, and profile name.
4. Create an App registration + client secret; grant it the **Trusted
   Signing Certificate Profile Signer** role (electron-builder docs describe
   this setup; Microsoft documents the role model).
5. Hand over six values: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`, plus the three non-secret config values (endpoint,
   account name, profile name) and the publisher name as it will appear on
   the certificate.
6. The ticket-sized change that follows is §4.3-W1.

**Path W2 — "I want Windows signed via a CA (OV/EV)." You must obtain and
hand over:**

1. Pick a CA and a delivery model **at purchase time** (cloud-signing
   service vs shipped token) — pricing/availability verified against the
   vendor pages in §2.1/§2.5, not against this document.
2. Complete the CA's organization validation.
3. If cloud-signing: hand over the service API credentials + the signing
   CLI's parameters. If token: keep the token yourself and adopt the manual
   post-release signing procedure in §4.3-W2 (operator-time per release).
4. The change that follows is bigger than W1: a custom `sign` hook in
   `electron-builder.config.js` + runner setup, or a signing procedure
   outside CI — estimate accordingly.

**Path L — "I want Linux signed anyway."** Don't, yet — see §3.5. If an
apt/yum repository or a Linux auto-updater ever lands, open a work order to
sign the repo metadata (apt: `aptly`/`reprepro` Release signing; yum: GPG
key + `gpgcheck` enforcement), not the individual artifacts we ship today.

### 4.3 When credentials arrive — implementation sketch (PLAN ONLY)

> **Nothing below is implemented.** This is the minimal-diff sketch per
> platform so the future work order is scoped before it starts. File names,
> step names, and line references were read from the repository at 39cf8b5.

**M — macOS** (files touched: `.github/workflows/release-desktop.yml`,
`packages/desktop/electron-builder.config.js`, README.md,
`docs/release/DESKTOP-RELEASE.md`):

1. Add secrets from §1.6 to the repository (or a `production` environment).
2. In the `build-desktop` job, scope signing env to the mac legs — e.g. a
   step-level `env:` block on "Bundle desktop installer" guarded by
   `if: matrix.target_os == 'mac'`, or per-matrix `env` entries:
   `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `ZCODE_ENABLE_MAC_SIGN: "1"`, plus the notarization credential set.
   **Pitfall:** do *not* set `CSC_LINK` unconditionally at job level —
   `WIN_CSC_LINK` falls back to `CSC_LINK`, so the Windows leg would try to
   Authenticode-sign with the Apple `.p12` and fail (fallback documented at
   [electron.build/v26 — code-signing](https://www.electron.build/v26/docs/features/code-signing/)).
3. Choose the notarization mode:
   - *Built-in (docs-recommended, smallest diff):* change
     `notarize: false` → `notarize: shouldEnableMacSigning` in
     `electron-builder.config.js` (line 677) so the existing switch gates it;
     electron-builder then signs, notarizes, staples in one build. Requires
     the API-key (or Apple-ID) env vars from §1.6.
   - *Two-stage (matches the config's stated design):* keep `notarize:
     false`, add a "Notarize and staple" step after "Bundle desktop
     installer" on the mac legs (`xcrun notarytool submit <dmg or zipped
     .app> --key ... --key-id ... --issuer ... --wait`, then
     `xcrun stapler staple` on the `.app` and the `.dmg`). More moving
     parts, but notarization failures become a separate retryable step
     rather than a failed 40-minute build.
4. Update the workflow header comment ("GITHUB_TOKEN only …") and drop the
   macOS bullet from the release-notes *Unsigned-build disclosure*.
5. Verify with `scripts/doctor-macos-release-app.sh` (it already runs
   `codesign --verify`, `spctl -a -vv -t exec`, `xcrun stapler validate`).
6. Optional hardening: `forceCodeSigning: true` so a missing secret fails
   the build instead of shipping unsigned silently.

**W1 — Windows via Azure Artifact Signing** (files touched:
`packages/desktop/electron-builder.config.js`, `.github/workflows/release-desktop.yml`):

1. Add `azureSignOptions: { endpoint, codeSigningAccountName,
   certificateProfileName, publisherName }` to the `win` block of
   `electron-builder.config.js` (currently only `target` + `artifactName`).
2. Add `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` env to
   the win-x64 leg's "Bundle desktop installer" step.
3. Update the SmartScreen disclosure wording in the release notes only as
   reputation actually improves (see §2.6).

**W2 — Windows via CA cloud-signing** (files touched: same as W1 plus a
new signing helper under `packages/desktop/scripts/`):

1. Implement a custom `win.signtoolOptions.sign` hook that invokes the
   vendor's cloud-signing CLI (pattern: the JSign/PKCS#11 example in the
   v26 Windows-on-Unix tutorial).
2. Add the vendor service credentials as GitHub secrets; document the
   vendor's quota/pricing.
3. If token-based instead: write the operator signing runbook (download
   artifacts from the workflow run, `signtool sign /tr ...`, re-upload, or
   move signing to a self-hosted runner) — and accept the manual step.

**L — Linux:** no change. Keep publishing `SHASUMS256.txt`; revisit only
with a hosted apt/yum repo or a Linux auto-update channel.

## 5. Sources (official documents)

All URLs verified reachable and cited for the claims above on 2026-10-17.

**Apple Developer / Support**

1. [Apple Developer Program — membership and $99 USD/year price](https://developer.apple.com/programs/)
2. [Apple Developer Program enrollment (individual vs organization, D-U-N-S, legal-entity requirements)](https://developer.apple.com/programs/enroll/)
3. [Developer ID certificates — what they are, who can generate them](https://developer.apple.com/developer-id/)
4. [Apple Help — create a certificate signing request (CSR)](https://developer.apple.com/help/account/create-certificates/create-a-certificate-signing-request)
5. [Apple Help — create Developer ID certificates](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates)
6. [Notarizing macOS software before distribution — requirements, notarytool/stapler, altool cutoff](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
7. [Customizing the notarization workflow — notarytool credential options, store-credentials, submit, staple](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
8. [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
9. [Apple Support — open a Mac app from an unidentified developer (Gatekeeper "Open Anyway")](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)

**electron-builder (v26 documentation set — the version family this repo pins, `electron-builder@26.8.1`)**

10. [Code signing overview — CSC_LINK / CSC_KEY_PASSWORD / WIN_CSC_LINK env vars, cert types, forceCodeSigning, GitHub Actions examples](https://www.electron.build/v26/docs/features/code-signing/)
11. [Code signing for macOS — certificate types per target, P12 export, keychain import on CI, identity values](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac)
12. [macOS notarization — notarize: true, hardened runtime, entitlements, Apple-ID vs API-key credentials, required secrets, automatic stapling, verification commands](https://www.electron.build/v26/docs/features/code-signing/notarization)
13. [Code signing for Windows — azureSignOptions, signtoolOptions, certificateSubjectName, AZURE_* env vars](https://www.electron.build/v26/docs/features/code-signing/code-signing-win)
14. [Tutorial — code signing Windows apps on Unix (JSign/PKCS#11 hardware token via custom sign hook)](https://www.electron.build/v26/docs/tutorials/code-signing-windows-apps-on-unix)
15. [macOS platform configuration — identity, hardenedRuntime, notarization status](https://www.electron.build/v26/docs/mac)

**Microsoft Learn / Azure**

16. [Artifact Signing overview (service formerly named Trusted Signing; FIPS 140-3 Level 3 HSMs)](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)
17. [Artifact Signing quickstart — identity validation (org/individual), supported countries, 1–20 business-day processing, SKU creation](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
18. [Artifact Signing FAQ — CSBR common-name rule, identity-validation lifecycle](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
19. [Signing integrations — SignTool client tools, metadata.json, region endpoints, GitHub Actions integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
20. [Artifact Signing pricing — Basic $9.99/mo (5,000 signatures), Premium $99.99/mo (100,000)](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
21. [Microsoft Defender SmartScreen overview — the reputation model](https://learn.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-smartscreen/microsoft-defender-smartscreen-overview)

**CA/Browser Forum**

22. [Code Signing Certificate Baseline Requirements — landing page](https://cabforum.org/baseline-requirements-code-signing/)
23. [CSBR v3.11.0 source (§6.2.7.4.1 — hardware crypto module requirement effective 2023-06-01; EV category definition)](https://github.com/cabforum/code-signing/blob/main/docs/CSBR.md)

**CA vendors (pricing/availability — verify at purchase time)**

24. [Sectigo — code signing certificates ("from $536.25/yr on a 5-year plan", FIPS-compliant token included, EV/OV/HSM lineup)](https://www.sectigo.com/ssl-certificates-tls/code-signing)
25. [DigiCert — code signing certificates](https://www.digicert.com/signing/code-signing-certificates)
26. [SSL.com — code signing products (EV/OV/IV lineups)](https://www.ssl.com/products/software-integrity/code-signing/)

**GitHub**

27. [Using secrets in GitHub Actions — repository/org/environment secrets, fork-run limitations](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)

**Linux packaging ecosystems**

28. [AppImage type-2 spec — optional `.sha256_sig` signature field ("MAY")](https://github.com/AppImage/AppImageSpec/blob/master/draft.md)
29. [Debian wiki — SecureApt (apt verifies repository Release signatures; per-package checks chain from the signed index)](https://wiki.debian.org/SecureApt)
30. [dnf configuration reference — `gpgcheck` / `localpkg_gpgcheck`](https://dnf.readthedocs.io/en/latest/conf_ref.html)

