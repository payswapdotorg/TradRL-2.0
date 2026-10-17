# Desktop Release Runbook (W067)

This runbook governs how the ZCode desktop application (workbench-inherited
identity, per the W066 product identity contract) is cut, built, and published
as downloadable installers from this repository's GitHub Releases page.

Everything here is driven by one pushed git tag. There is no manual artifact
upload step.

## The tag law

Release tags have the form:

```
v<workbench-version>-tradrl.N        # e.g. v3.14.3-tradrl.1
```

- `<workbench-version>` is the upstream ZCode workbench base this repository
  carries (root `package.json` `version`, currently `3.14.3`).
- `N` is the TradRL release counter on that base: `1`, `2`, `3`, … It increments
  on every release cut from the same base; when the workbench base is upgraded
  (e.g. to `3.15.0`), the counter restarts at `v3.15.0-tradrl.1`.

Why this shape:

- **It is valid semver as a pre-release.** `3.14.3-tradrl.1` sorts *below*
  `3.14.3`, which is honest: a TradRL release of the `3.14.3` workbench is a
  derivative of that base, not a newer workbench version.
- **It never impersonates upstream.** Upstream `zai-org/zcode` publishes its
  own `v3.14.3` line; a bare `v3.14.3` tag here would be indistinguishable
  from an upstream release both in git history and in artifact names.

**`v3.14.3` must never be reused.** The tag already exists in this repository
and points at `29628c9`, the upstream fork point — a commit that predates all
TradRL work, including the packaging pipeline itself. Re-pushing it would
either fail (tag exists) or, if forced, fire the release workflow against a
commit that cannot produce a working installer, and produce version-identical
artifacts that collide with upstream's `3.14.3` naming. The first TradRL
release tag is `v3.14.3-tradrl.1`.

## Cut procedure (TL)

1. Merge the release-relevant PRs to `main` and confirm the usual gates are
   green (typecheck, lint, `tradrl:check`, architecture check).
2. Cut the tag from the merged `main` tip:

   ```bash
   git tag v3.14.3-tradrl.1
   git push origin v3.14.3-tradrl.1
   ```

   Only the tag push triggers the workflow — ordinary branch pushes never do.
3. Watch the **Release Desktop** workflow under the repository's *Actions*
   tab. Four build jobs run (`linux-x64`, `win-x64`, `mac-arm64`, `mac-x64`),
   then the publish job aggregates and creates the Release.
4. Verify the release page:
   - the installers below are attached, plus `SHASUMS256.txt`;
   - spot-check one checksum against a locally computed SHA256;
   - install on at least one real machine and launch it.
5. Point users at the [Releases page] and the quick install one-liners in the
   README's *Download & install* section.

If the workflow fails or a release must be re-cut: delete the GitHub Release
(and, if needed, the tag), fix the cause on `main`, then push the **next**
counter (`-tradrl.2`). Never rewrite a tag whose release was already public.

[Releases page]: https://github.com/payswapdotorg/tradrl-2.0/releases

## Asset matrix

| Job (runner) | Bundle target | Installers published |
| --- | --- | --- |
| `ubuntu-latest` | `--os linux --arch x64` | `ZCode-<v>-linux-x86_64.AppImage`, `-linux-amd64.deb`, `-linux-x86_64.rpm`, `-linux-x64.pkg.tar.zst` |
| `windows-latest` | `--os win --arch x64` | `ZCode-<v>-win-x64.exe` (NSIS) |
| `macos-latest` (arm64) | `--os mac --arch arm64` | `ZCode-<v>-mac-arm64.dmg` |
| `macos-latest` (arm64, cross) | `--os mac --arch x64` | `ZCode-<v>-mac-x64.dmg` |

Also attached: `SHASUMS256.txt` — SHA256 of every published installer.

Naming law: electron-builder's arch token differs per Linux target — AppImage
and rpm publish as `x86_64`, deb as `amd64`, pacman as `x64`. Docs name
artifacts as published, not as configured.

Deliberately **not** published: the macOS `.zip` (the auto-update payload that
duplicates the `.dmg`) and the `.exe.blockmap` files (delta-update metadata
for a future auto-update channel).

The mac-x64 job is a cross-packaging build on an arm64 runner:
`ZCODE_TARGET_ARCH=x64` makes the asset prep stage x64 assets (the in-repo
native-search archives cover `x86_64-apple-darwin`, and the macOS
window-bounds helper is compiled for both `-target arm64-apple-macos11` and
`-target x86_64-apple-macos11`), and electron-builder downloads the x64
Electron runtime.

## What the workflow does

`.github/workflows/release-desktop.yml` — triggered by `push: tags: ['v*']`
only, with a concurrency guard keyed on the tag and a workflow-level
`permissions: contents: write` (GITHUB_TOKEN only; no secrets exist in this
workflow).

Per build job, the minimal correct sequence traced from
`packages/desktop/scripts/bundle.mjs`:

1. `ZCODE_APP_VERSION` is derived from the tag (`${GITHUB_REF_NAME#v}`) before
   anything else runs.
2. `pnpm install --frozen-lockfile` (pnpm pinned via `packageManager`,
   Node via `.nvmrc`).
3. `pnpm --filter @zcode/desktop run prepare:runtime-assets` — local asset
   prep with `ZCODE_SKIP_REMOTE_ASSETS=1` (see below).
4. `pnpm build:bootstrap` — builds every workspace package, then the desktop
   production bundles; `prepare:build-meta` bakes the tag-derived version into
   `out/metadata/build-meta.json`.
5. `pnpm --filter @zcode/desktop run bundle -- --os <t> --arch <t>
   --skip-prepare --skip-build` — goes straight to electron-builder (plus the
   bundle pipeline's own asar runtime-dependency verification and size audit).
   `--skip-prepare`/`--skip-build` avoid re-running steps 3–4, which `bundle`
   would otherwise repeat.
6. Installers are uploaded as workflow artifacts.

The linux job installs one extra runner prerequisite right before step 5:
`libarchive-tools` (bsdtar). fpm's pacman target shells out to `bsdtar` to
generate the `.MTREE` manifest inside the `.pkg.tar.zst`, and `ubuntu-latest`
does not ship it; the other three targets never invoke bsdtar, so the
apt-get step is skipped on every non-linux matrix leg.

The publish job then stages all installers, generates `SHASUMS256.txt`,
renders the release notes from a template, and creates the GitHub Release via
the `gh` CLI (if the Release already exists — e.g. after a re-run — it
refreshes the assets with `--clobber` and rewrites the notes instead).

Job-level environment switches and why:

- `ZCODE_ENV=production` — **required**. The desktop identity resolver
  (`packages/desktop/scripts/desktop-product-identity.mjs`) treats an unset
  `ZCODE_ENV` as `test`, which produces the `ZCode Preview` identity
  (`dev.zcode.app.preview`) and a `_TEST` artifact-name suffix. A release must
  build the production identity: productName `ZCode`, appId `dev.zcode.app`
  (W066 identity law — the desktop app identity is workbench-inherited).
- `ZCODE_TARGET_OS` / `ZCODE_TARGET_ARCH` — set before asset prep so
  `prepare:agent-bundle` / `prepare:native-search` stage assets for the
  packaging target rather than the runner host.
- `ZCODE_SKIP_REMOTE_ASSETS=1` — see below.

## Why `ZCODE_SKIP_REMOTE_ASSETS=1`

`prepare:runtime-assets` runs three groups of steps:

1. `prepare:agent-bundle` — builds the agent JS bundle (`zcode.cjs`) locally
   via the repo's turbo setup and stages it under
   `bundled-agents/<platform>-<arch>/glm`. **Fully local.**
2. `prepare:native-search` — unpacks the ripgrep/ugrep/bfs archives that are
   **committed to the repository**
   (`apps/zcode-cli/dependencies/native-search/…`), verifying each archive's
   SHA256. **Fully local.**
3. `prepare:remote-assets` — fetches the REMOTE SSH/WSL agent prebuilds from
   the zcode-internal intranet mirror (`INTRANET_MACHINE_HOST:12345`). This is
   intranet-only infrastructure that GitHub Actions cannot (and must not)
   reach, and the desktop installer does not depend on it — remote
   (SSH/WSL/Docker) sessions download those binaries through their own path.
   `ZCODE_SKIP_REMOTE_ASSETS=1` skips exactly this step.

The electron download mirrors are handled inside `bundle.mjs` (npmmirror
defaults with automatic fallback), so no mirror configuration is needed in CI.

## The version seam

```
pushed tag v3.14.3-tradrl.1
  └─ workflow step: ZCODE_APP_VERSION=3.14.3-tradrl.1   (${GITHUB_REF_NAME#v})
       └─ packages/desktop/scripts/build-metadata.mjs
            collectBuildMetadata():
              appVersion = normalizeVersion(ZCODE_APP_VERSION ?? root package.json version)
            └─ out/metadata/build-meta.json        (written by prepare:build-meta)
                 └─ electron-builder.config.js: extraMetadata.version / ${version} in artifact names
                      └─ ZCode-3.14.3-tradrl.1-mac-arm64.dmg, …
```

- The env override exists so release builds never mutate the root
  `package.json` version (which stays the workbench base, per the tag law).
- `normalizeVersion` strips any leading non-digits, so a stray `v` prefix is
  tolerated.
- Without the env (local dev builds), `appVersion` is the root
  `package.json` version — the workbench base, e.g. `3.14.3`.

## Checksums

`SHASUMS256.txt` is generated by the publish job over every published
installer (`sha256sum`, standard `<hash>  <filename>` lines). Verify after a
manual download:

```bash
sha256sum -c --ignore-missing SHASUMS256.txt        # Linux
shasum -a 256 -c --ignore-missing SHASUMS256.txt    # macOS
```

The quick installers (`scripts/install-desktop.sh`, `scripts/install-desktop.ps1`)
fetch `SHASUMS256.txt` themselves and refuse to install on a mismatch.

## Unsigned builds

No code-signing certificates exist for this project yet, so all published
installers are unsigned. Every user-facing surface (README, release notes,
installer output) discloses this, with the per-OS bypass:

- **macOS**: on first launch, right-click `ZCode.app` → **Open** (or System
  Settings → Privacy & Security → **Open Anyway**).
- **Windows**: if SmartScreen shows *"Windows protected your PC"*, choose
  **More info** → **Run anyway**.
- **Linux**: no OS-level warning; ensure the AppImage is executable
  (`chmod +x`).

## Signed builds — future work (out of scope)

Signing requires credentials that do not exist yet:

- macOS: a **Developer ID Application** certificate plus notarytool
  credentials (App Store Connect API key). The packaging config already
  supports them via `APPLE_SIGNING_IDENTITY` (or `CSC_NAME`) and
  `ZCODE_ENABLE_MAC_SIGN=1`; `notarize` is currently hard-disabled.
- Windows: an OV/EV code-signing certificate (`WIN_CSC_LINK` and friends in
  electron-builder terms).

When those arrive, the changes belong in the workflow's job env and possibly
the signing seam — not in this runbook's tag law.

## Quick installer scripts

- `scripts/install-desktop.sh` — macOS/Linux (bash). Detects OS/arch, queries
  the GitHub API for the latest release (falling back to the release list —
  `/releases/latest` omits pre-releases and the TradRL tag format is one),
  picks the matching asset, verifies its SHA256, installs without sudo
  (`/Applications` with a `~/Applications` fallback on macOS; `~/.local/bin`
  on Linux), and prints launch instructions. Windows users running it under
  WSL/Git-Bash are redirected to the PowerShell installer.
- `scripts/install-desktop.ps1` — Windows (PowerShell 5.1+). Same flow for the
  NSIS installer; supports silent install via `ZCODE_INSTALL_DESKTOP_SILENT=1`
  (passes `/S` to NSIS) and discloses the SmartScreen bypass.
