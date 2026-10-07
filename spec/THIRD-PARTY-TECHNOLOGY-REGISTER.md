# Third-Party Technology Register

Status: **VERIFIED REGISTER** (W002). Every row below was verified against an authoritative source (npm registry, PyPI JSON API, GitHub REST API, or a fetched license file). Verification date for all entries: **2026-10-07** (UTC). Evidence sources are per-row; failures and conflicts are recorded honestly in [Verification failures and ambiguities](#verification-failures-and-ambiguities).

## Verification method

- npm: `https://registry.npmjs.org/<pkg>/latest` → `version`, `license`, repository.
- PyPI: `https://pypi.org/pypi/<pkg>/json` → `info.version`, `info.license`/`license_expression`, license classifiers, per-file `upload_time_iso_8601`.
- GitHub: `https://api.github.com/repos/<owner>/<repo>` → detected license `spdx_id`, default branch, `pushed_at`, archived state; `.../commits/<branch>` → HEAD SHA; `.../contents/` → presence of a `LICENSE`/`COPYING` file; `.../license` → decoded license text.
- Local (for the fork base): this repository's `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES.md`, root `package.json`, and git history.
- No versions or licenses are guessed. Where sources conflict or a license is absent, the row is marked `verified-conflict` or `unverified-license` and keeps/escalates the conservative posture.

## Verified register

Machine-readable notes: this table is the stable parse target. The `Technology` column is the frozen row key (names unchanged from the previous register revision). Column order is frozen. Cells are single-line; `;` separates multiple values inside a cell. `pin` values are exact versions or commit SHAs verified on the verified-on date.

| Technology | Canonical id | Intended role | Verified version / pin | License (SPDX, verified) | Verification source | Verified on | Status |
|---|---|---|---|---|---|---|---|
| zai-org/zcode | github.com/zai-org/ZCode (this repo is the fork); local package name `zcode` | outer workbench (base) | 3.14.3; fork point = upstream main HEAD 29628c9acdb81b703bbd4080c207a0e7ce5e276e | Apache-2.0 | local LICENSE file (Apache-2.0, "Copyright 2026 Z.AI Co., Ltd") + NOTICE.md; api.github.com/repos/zai-org/ZCode → spdx Apache-2.0 (default branch `main`, pushed 2026-09-29) | 2026-10-07 | verified |
| TradingView Lightweight Charts | npm `lightweight-charts`; github.com/tradingview/lightweight-charts | financial charting | 5.2.1 (npm latest) | Apache-2.0 | registry.npmjs.org/lightweight-charts/latest (license Apache-2.0); api.github.com/repos/tradingview/lightweight-charts → spdx Apache-2.0 | 2026-10-07 | verified |
| Perspective | npm `@finos/perspective`; repo now github.com/perspective-dev/perspective (moved from finos/perspective) | streaming/analytical grids | 3.8.0 (npm latest) | Apache-2.0 | registry.npmjs.org/@finos/perspective/latest (license Apache-2.0); api.github.com → finos/perspective returns Moved Permanently → perspective-dev/perspective → spdx Apache-2.0 (default branch `master`, HEAD 6dbc6b8eee893fcb56a207f9910e3a8c532117a5) | 2026-10-07 | verified |
| Apache Arrow | npm `apache-arrow`; JS source repo now github.com/apache/arrow-js (split from apache/arrow) | analytical interchange | 21.2.0 (npm latest) | Apache-2.0 | registry.npmjs.org/apache-arrow/latest (license Apache-2.0); api.github.com/repos/apache/arrow-js → spdx Apache-2.0 (default branch `main`, pushed 2026-10-05) | 2026-10-07 | verified |
| Polars | PyPI `polars`; github.com/pola-rs/polars | analytical processing (service boundary) | 2.0.0 (PyPI latest, uploaded 2026-10-06) | MIT | pypi.org/pypi/polars/json → classifier "MIT License"; LICENSE text: Copyright (c) 2025 Ritchie Vink, some portions (c) 2024 NVIDIA; api.github.com/repos/pola-rs/polars → spdx MIT | 2026-10-07 | verified |
| NautilusTrader | PyPI `nautilus_trader`; github.com/nautechsystems/nautilus_trader | high-fidelity replay/execution (adapter/isolated) | 1.231.0 (PyPI latest, uploaded 2026-08-02); develop HEAD a27fe569eebcd66f10b00e0325459db832c17244 | CONFLICT: LGPL-3.0 (GitHub, plain LGPL-3.0 LICENSE text) vs LGPL-3.0-or-later (PyPI author metadata, classifier LGPLv3+) | pypi.org/pypi/nautilus_trader/json; api.github.com/repos/nautechsystems/nautilus_trader → spdx LGPL-3.0; raw LICENSE file = unmodified LGPL v3 text with no "or later" notice | 2026-10-07 | verified-conflict → treat as LGPL-3.0-only until legal review |
| ABIDES | github.com/abides-sim/abides (canonical location drifted; see failures section) | reactive market simulation (adapter/reference) | latest tag v1.1; master HEAD c4bf157678928934417aba6073eb0651aeaf6d15 (commit dated 2020-11-19; last repo push 2023-07-06; no PyPI distribution) | BSD-3-Clause (per LICENSE file text, "Copyright (c) 2019 Georgia Tech Research Corporation"); GitHub API metadata reports NOASSERTION ("Other") | api.github.com/repos/abides-sim/abides + /license endpoint (decoded LICENSE text); /tags → v1.1, v1.0, v0.1.0 | 2026-10-07 | verified-with-discrepancy (license text verified; GitHub metadata mismatch; upstream effectively unmaintained) |
| JAX-LOB | github.com/KangOxford/jax-lob; active successor github.com/KangOxford/AlphaTrade | large-scale LOB/RL simulation (training backend) | jax-lob: default branch `jaxV3`, HEAD d1f596610b04a09941c7a1b609e5bab541ecfc98, last push 2023-10-22 (stale); AlphaTrade: branch `jaxV3`, HEAD 2b1951fb47392db0e6d832c81a21a39a6b5eed05, pushed 2026-03-16; no release tags, no PyPI/npm package | NONE — no LICENSE or COPYING file in either repository (GitHub license = None) | api.github.com/repos/KangOxford/jax-lob and /KangOxford/AlphaTrade (license: null); /contents/ of both repos → no LICENSE/COPYING file present | 2026-10-07 | unverified-license (verification failed) → all-rights-reserved, copying prohibited |
| QuantConnect LEAN | github.com/QuantConnect/Lean | domain reference (reference/selective) | master HEAD 80e7843f645673bcbeaab963049f76f20f6785e1 (no npm/PyPI distribution) | Apache-2.0 | api.github.com/repos/QuantConnect/Lean → spdx Apache-2.0 (default branch `master`, pushed 2026-10-06) | 2026-10-07 | verified |
| Hummingbot | PyPI `hummingbot`; github.com/hummingbot/hummingbot | connectors/market making (reference/candidate) | 20260922 (PyPI latest — date-versioned scheme, uploaded 2026-10-07); master HEAD 9af100d6822da7d2d0291a906c730ef172284ee2 | Apache-2.0 | api.github.com/repos/hummingbot/hummingbot → spdx Apache-2.0; pypi.org/pypi/hummingbot/json → license field "Apache 2.0" (non-SPDX string, normalized against GitHub result) | 2026-10-07 | verified |
| CCXT | npm `ccxt` / PyPI `ccxt`; github.com/ccxt/ccxt | crypto adapter basis (later adapter) | 4.5.85 (npm latest = PyPI latest, identical version on both registries) | MIT | registry.npmjs.org/ccxt/latest (MIT); pypi.org/pypi/ccxt/json (MIT); api.github.com/repos/ccxt/ccxt → spdx MIT | 2026-10-07 | verified |
| Freqtrade/FreqUI | github.com/freqtrade/freqtrade; github.com/freqtrade/frequi | UX inspiration (inspiration only) | freqtrade default branch `develop`; frequi default branch `main` (GitHub-only; `frequi` verified NOT published on npm) | GPL-3.0 (both repos) | api.github.com/repos/freqtrade/freqtrade → spdx GPL-3.0; api.github.com/repos/freqtrade/frequi → spdx GPL-3.0; registry.npmjs.org/frequi/latest → "Not Found" | 2026-10-07 | verified (license is the constraint) |
| FlexLayout | npm `flexlayout-react`; github.com/caplin/FlexLayout | optional internal advanced docking (conditional) | 0.11.1 (npm latest) | MIT | registry.npmjs.org/flexlayout-react/latest (MIT); api.github.com/repos/caplin/FlexLayout → spdx MIT | 2026-10-07 | verified |

## Decisions and constraints

Integration decision per entry. "Direct dependency" = allowed in package manifests at the owning Work Order's discretion (respecting architecture policy). "Adapter" = external engine/process behind the World Protocol. "Reference-only" = read for design, never copy code. "Inspiration-only" = concepts only, no code and no assets.

| Technology | Integration decision | License-driven constraints |
|---|---|---|
| zai-org/zcode | Base (already integrated; this repo is the fork) | Apache-2.0: retain NOTICE.md and THIRD-PARTY-NOTICES.md attribution in all distributions; re-verify upstream license before any upstream rebase/upgrade (fork point pinned at 29628c9 = v3.14.3). |
| TradingView Lightweight Charts | Direct dependency (npm) | Apache-2.0: permissive; record package + exact version in THIRD-PARTY-NOTICES at distribution; re-verify license on major version bumps (current major: 5.x). |
| Perspective | Direct dependency (npm) | Apache-2.0: permissive; upstream repo moved finos → perspective-dev — track the new repo for advisories; npm scope `@finos` unchanged. |
| Apache Arrow | Direct dependency (npm) | Apache-2.0: permissive; JS source-of-record is now apache/arrow-js (split from the apache/arrow monorepo) — file issues/advisory tracking there. |
| Polars | Direct dependency inside Python service/sidecar processes only (not embedded in the Electron renderer) | MIT: permissive; license text carries dual copyright (Ritchie Vink; portions (c) 2024 NVIDIA) — retain verbatim in notices at distribution. The service boundary is technical (Rust/Python runtime), not license-required. |
| NautilusTrader | Adapter only, behind the World Protocol; process/service boundary (W021) | LGPL-3.0-only (conservative reading until legal review resolves the only/or-later conflict): never vendor into this repo; never statically link or bundle into the desktop/Electron build; communicate via subprocess/IPC so TradRL remains an "Application" not a "Combined Work" derivative; if ever co-distributed, LGPL obligations apply (library source availability, relinking, documenting modifications); legal review required before any distribution that includes it. |
| ABIDES | Reference + adapter; prefer clean reimplementation behind the World Protocol (W024) given the unmaintained upstream | BSD-3-Clause (per LICENSE text): attribution required if any code is copied; GitHub metadata mismatch (NOASSERTION) must be resolved at the pinned commit before a copy is permitted; pin the exact commit in the provenance field at copy time; upstream stale (last tag 2020-era, last push 2023) — maintenance burden transfers to us on any copy. |
| JAX-LOB | Reference-only until written permission from the copyright holders is obtained, or clean-room reimplementation from the paper | No license file = all-rights-reserved: copying, vendoring, or deriving from KangOxford/jax-lob or KangOxford/AlphaTrade code is prohibited; W049 must be clean-room (paper-based) or must first obtain and record written permission in this register; do not treat the successor repo (AlphaTrade) as licensed — it is equally unlicensed. |
| QuantConnect LEAN | Reference-only (selective) | Apache-2.0: if code is ever copied, pin the commit and retain Apache-2.0 attribution/NOTICE obligations; C# runtime means any real integration would be a process-boundary adapter regardless. |
| Hummingbot | Reference/candidate; adapter via process boundary if ever integrated | Apache-2.0: permissive; attribution at distribution if code is copied; date-versioned releases (e.g., 20260922) — always pin the full version, never a floating tag. |
| CCXT | Direct dependency for the future crypto adapter (W026; npm flavor preferred for the TS workbench) | MIT: permissive; exchange API terms-of-service apply at runtime and are a compliance surface separate from code licensing; pin exact version (4.x moves fast). |
| Freqtrade/FreqUI | Inspiration-only — never copy, never link, never vendor | GPL-3.0 (both freqtrade and frequi): any code or asset copying would impose GPL-3.0 on TradRL — prohibited; UI/UX concepts and interaction patterns only (ideas are not copyrightable expression); any accidental import of code/assets from these repos must be reverted on sight. |
| FlexLayout | Deferred — evaluate only after World Alpha (per spec/ZCODE-INTEGRATION-MAP.md); not a Phase-1 dependency | MIT: permissive; architectural constraint dominates: ZCode already owns docking — do not introduce a parallel docking system; if adopted post-Alpha, it must wrap inside existing ZCode shell primitives. |

## Verification failures and ambiguities

Honest record of what could NOT be verified cleanly. None of these were resolved by guessing.

1. **NautilusTrader license conflict (LGPL-3.0 vs LGPL-3.0-or-later).** GitHub detects `LGPL-3.0` from a plain LGPL v3 LICENSE file (no "or later" notice in the file); PyPI author metadata for 1.231.0 declares `LGPL-3.0-or-later` (classifier LGPLv3+). The two authoritative sources disagree. Resolution requires reading per-file copyright headers or an authoritative statement from the maintainer; until then TradRL applies the stricter reading (LGPL-3.0-only) and keeps the "legal review" posture from the original register.
2. **ABIDES metadata mismatch and location drift.** The original register's implied home `ABIDES-Market/ABIDES` returns Not Found; `jpmorganchase/abides-jpmc-public` is archived (2024-07) and reports NOASSERTION. The live canonical repo is `abides-sim/abides`, whose LICENSE file text is BSD-3-Clause but whose GitHub API metadata reports NOASSERTION ("Other"). License text was fetched and read (BSD-3-Clause, Georgia Tech Research Corporation); the mismatch is recorded, and any future copy must re-fetch the LICENSE at the pinned commit. Version drift is real: latest tag v1.1, master HEAD commit dated 2020-11-19, last push 2023-07-06, no PyPI distribution — "exact version" means a pinned commit, not a release.
3. **JAX-LOB license verification FAILED.** Neither `KangOxford/jax-lob` (stale since 2023-10-22) nor its active successor `KangOxford/AlphaTrade` contains a LICENSE or COPYING file; the GitHub API reports `license: null`. With no license, the code is all-rights-reserved and cannot be copied. The original posture ("verify exact version license") is escalated to "no license found; copying prohibited pending written permission". Version is likewise unpinnable to a release (no tags, no package registry) — only commit SHAs.
4. **Non-SPDX author strings normalized.** PyPI `hummingbot` declares license `"Apache 2.0"` (not an SPDX expression) with empty classifiers; normalized to Apache-2.0 via the GitHub-detected license for the same project. Polars' PyPI `license` field is a full MIT text block; SPDX id taken from its classifier and the LICENSE file.
5. **Repo moves recorded (not failures).** Perspective moved `finos/perspective` → `perspective-dev/perspective` (API returns Moved Permanently; npm scope unchanged). Apache Arrow JS now lives at `apache/arrow-js` (split from the `apache/arrow` monorepo; npm package `apache-arrow` continues). These affect where advisories and issues are tracked, not the license.

## Rules

Original rules (kept):

- Verify exact version/commit license before integration.
- Record source path and provenance for copied code.
- Prefer adapters to forks.
- Isolate incompatible copyleft dependencies.
- Do not copy proprietary UI assets.
- Treat licensing as an architecture constraint.

Added by W002:

- Every entry must carry verification evidence: source URL plus verified-on date, in the register itself. Unverified entries keep the conservative posture; never invent a version or license.
- Re-verify on every version bump or upstream license change before distribution, and update the row's evidence in this register.
- Unlicensed code (no LICENSE file) is all-rights-reserved: copying is prohibited without written permission from the copyright holders; record the permission (grant, date, scope) in this register before any use.
- Provenance pin: when code is copied, update the row's version/pin field with `repo@commit` and name the destination path in this register before the copy lands.
- SPDX ids are the canonical license identifiers. Author strings such as "Apache 2.0" are normalized against the license text or a second authoritative source.
- A GitHub result of NOASSERTION or `license: null` is a finding, not a pass: resolve it from the actual license text before permitting copies.
- LGPL-licensed components (currently: NautilusTrader under the conservative reading) must remain behind a process/service boundary; they must never be vendored, statically linked, or bundled into the desktop/Electron build, and require legal review before co-distribution.

## Evaluation dimensions

technical fit
performance
determinism
browser/Electron compatibility
license compatibility
maintainability
adapter isolation
data-model compatibility
upgrade strategy
