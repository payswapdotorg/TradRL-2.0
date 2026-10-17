#!/usr/bin/env bash
#
# ZCode desktop quick-installer (TradRL-2.0).
#
# Downloads the latest desktop installer from GitHub Releases, verifies its
# SHA256 against the release's SHASUMS256.txt, installs it, and prints how to
# launch it. No sudo is required: macOS installs to /Applications (falling back
# to ~/Applications), Linux installs to ~/.local/bin.
#
# Usage (macOS / Linux):
#   curl -fsSL https://raw.githubusercontent.com/payswapdotorg/tradrl-2.0/main/scripts/install-desktop.sh | bash
#
# Windows users: run the PowerShell installer instead (from PowerShell — not
# WSL, not Git Bash):
#   irm https://raw.githubusercontent.com/payswapdotorg/tradrl-2.0/main/scripts/install-desktop.ps1 | iex
#
# Unsigned-build notice: ZCode desktop builds are currently unsigned. On macOS,
# Gatekeeper must be bypassed on first launch (right-click the app -> Open). See
# docs/release/DESKTOP-RELEASE.md for details.

set -euo pipefail

REPO="payswapdotorg/tradrl-2.0"
APP_NAME="ZCode"
REPO_URL="https://github.com/${REPO}"
API_BASE="https://api.github.com/repos/${REPO}"
POWERSHELL_HINT="irm https://raw.githubusercontent.com/${REPO}/main/scripts/install-desktop.ps1 | iex"

say() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- detect platform ----------------------------------------------------------

platform="$(uname -s)"
machine="$(uname -m)"
kernel="$(uname -r 2>/dev/null || true)"

# Windows environments are redirected to the PowerShell installer.
case "${OSTYPE:-}" in
  msys*|mingw*|cygwin*)
    die "this script cannot install the Windows build from Git Bash/MSYS.
Open PowerShell and run:
    ${POWERSHELL_HINT}"
    ;;
esac

if [ "${platform}" = "Linux" ] \
  && { [ -n "${WSL_DISTRO_NAME:-}" ] || printf '%s' "${kernel}" | grep -qiE 'microsoft|wsl'; }; then
  die "WSL detected: the desktop app is a Windows build, so install it from PowerShell, not from WSL.
Open PowerShell and run:
    ${POWERSHELL_HINT}"
fi

case "${platform}" in
  Darwin) plat="mac" ;;
  Linux) plat="linux" ;;
  *)
    die "unsupported operating system: ${platform}.
Prebuilt installers exist for macOS, Windows and Linux — see ${REPO_URL}/releases."
    ;;
esac

case "${machine}" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    die "unsupported CPU architecture: ${machine}.
See ${REPO_URL}/releases for the published asset matrix."
    ;;
esac

if [ "${plat}" = "linux" ] && [ "${arch}" != "x64" ]; then
  die "no Linux installer is published for ${machine} yet (published: linux-x64).
See ${REPO_URL}/releases."
fi

# --- download helper ----------------------------------------------------------

fetch() {
  # fetch <url> <output-path>
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --retry 3 --connect-timeout 30 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --tries=3 --timeout=30 -O "$2" "$1"
  else
    die "neither curl nor wget is available; install one and retry"
  fi
}

# --- find the latest release and its assets -----------------------------------

case "${plat}" in
  mac) asset_regex="ZCode-.*-mac-${arch}\.dmg$" ;;
  # electron-builder's AppImage arch token is x86_64, not x64 (real published name: ZCode-3.14.3-tradrl.2-linux-x86_64.AppImage) — accept both so a rename in either direction cannot re-break installs.
  linux) asset_regex="ZCode-.*-linux-(x64|x86_64)\.AppImage$" ;;
esac

extract_asset_urls() {
  # grep exits 1 when the JSON has no assets (e.g. an empty release list) —
  # with pipefail that must not abort the script, an empty result is expected.
  printf '%s' "$1" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed 's/.*"browser_download_url": *"//; s/"$//' \
    || true
}

# --- GitHub API auth + rate-limit diagnosis (W067-R3) -------------------------
# WHY: live E2E 2026-10-17 (TL run, linux-x64) — api.github.com answered HTTP
# 403 with x-ratelimit-limit: 60 / x-ratelimit-remaining: 0, body "API rate
# limit exceeded for 47.57.242.119": that machine's egress IP sits in a shared
# VPN/NAT pool, and the unauthenticated core-API quota is 60 requests/hour per
# IP — so any user behind corporate NAT, a VPN, a cloud shell, or a shared CI
# runner hits the same wall. The old `curl -fsSL ... || true` swallowed that
# body and the fallback died blaming "network error?" (the network was fine;
# the API was rate-limited). Hence: (1) GITHUB_TOKEN / GH_TOKEN, when set and
# non-empty, authenticates BOTH release-API lookups below — Authorization
# header only, the token is never echoed or logged; release-asset downloads
# (browser_download_url) and the SHASUMS fetch stay token-free (not API
# calls). (2) a failed lookup's response body is captured (api_err_body) so a
# rate-limit 403 dies with the actual cause and cure, not the generic guess.

gh_token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
api_err_body=""
api_response_body=""

github_api() {
  # github_api <url> — on HTTP 2xx set api_response_body to the response
  # body and return 0 (the success semantics of the old `curl -fsSL` call);
  # otherwise return 1 with the response body kept in api_err_body (empty on
  # transport-level failures) for rate-limit diagnosis. No -f: the body must
  # survive a 403.
  #
  # NOTE: call DIRECTLY (never as "$(github_api ...)") — a command
  # substitution runs this function in a subshell and would silently
  # discard both api_* globals on exit; the body must reach the caller's
  # shell through these variables, not stdout.
  local resp
  if [ -n "${gh_token}" ]; then
    resp="$(curl -sSL -H 'Accept: application/vnd.github+json' \
      -H "Authorization: Bearer ${gh_token}" \
      -w '\n%{http_code}' "$1")" || resp=''
  else
    resp="$(curl -sSL -H 'Accept: application/vnd.github+json' \
      -w '\n%{http_code}' "$1")" || resp=''
  fi
  api_err_body="${resp%$'\n'*}"
  case "${resp##*$'\n'}" in
    2*) api_response_body="${api_err_body}"; return 0 ;;
    *) return 1 ;;
  esac
}

die_if_rate_limited() {
  # Die with the shared-IP diagnosis only when GitHub's own error body says
  # "rate limit" (case-insensitive); any other failure returns silently and
  # keeps its original handling (fall through to the list scan / generic
  # die). The token never appears in any message.
  if printf '%s' "${api_err_body}" | grep -qi 'rate limit'; then
    die "GitHub API rate limit exceeded — this IP's unauthenticated quota
(60 requests/hour) is exhausted; typical behind shared NAT/VPN/cloud-shell
or CI egress IPs. Wait for the hourly window to reset, or re-run with
GITHUB_TOKEN (or GH_TOKEN) set to authenticate and lift the limit — see
https://docs.github.com/rest/overview/resources-in-the-rest-api"
  fi
  return 0
}

say "Looking up the latest ${APP_NAME} desktop release ..."
if github_api "${API_BASE}/releases/latest"; then
  release_json="${api_response_body}"
else
  # A failure here is expected flow when only pre-releases are published
  # (404 — the fallback below scans the release list) — but a rate-limit 403
  # dooms BOTH lookups, so diagnose it now instead of falling through to a
  # second doomed request and a misleading "network error?".
  die_if_rate_limited
  release_json=""
fi
asset_urls="$(extract_asset_urls "${release_json:-}")"
if [ -z "${asset_urls}" ] \
  || ! printf '%s\n' "${asset_urls}" | grep -Eq -- "${asset_regex}"; then
  # /releases/latest omits pre-releases — and the TradRL tag format
  # (v<workbench>-tradrl.N) is a semver pre-release — or the latest release
  # may not carry this platform's asset yet. Fall back to scanning the
  # newest releases for one that actually has a matching installer.
  if github_api "${API_BASE}/releases?per_page=20"; then
    release_json="${api_response_body}"
  else
    die_if_rate_limited
    die "could not query GitHub for releases (network error?).
Check ${REPO_URL}/releases and download manually."
  fi
  asset_urls="$(extract_asset_urls "${release_json}")"
fi

[ -n "${asset_urls}" ] \
  || die "no downloadable assets found on the latest release — see ${REPO_URL}/releases"

installer_url="$(printf '%s\n' "${asset_urls}" | grep -E -- "${asset_regex}" | head -n 1 || true)"
[ -n "${installer_url}" ] \
  || die "no installer for ${plat}-${arch} found on the latest release.
Check ${REPO_URL}/releases for the published asset matrix."

sums_url="$(printf '%s\n' "${asset_urls}" | grep -E -- '/SHASUMS256\.txt$' | head -n 1 || true)"

# --- download and verify ------------------------------------------------------

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/zcode-install.XXXXXX")"
cleanup() { rm -rf "${tmpdir}"; }
trap cleanup EXIT INT TERM

fname="$(basename "${installer_url}")"
say "Downloading ${fname} ..."
fetch "${installer_url}" "${tmpdir}/${fname}"

if [ -n "${sums_url}" ]; then
  say "Verifying SHA256 against SHASUMS256.txt ..."
  fetch "${sums_url}" "${tmpdir}/SHASUMS256.txt"
  expected="$(awk -v f="${fname}" '$2 == f {print $1}' "${tmpdir}/SHASUMS256.txt")"
  if [ -z "${expected}" ]; then
    die "no SHA256 entry for ${fname} in SHASUMS256.txt — refusing to install an unverifiable download"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${tmpdir}/${fname}" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${tmpdir}/${fname}" | awk '{print $1}')"
  else
    warn "no SHA256 tool found (sha256sum/shasum); skipping integrity verification"
    actual="${expected}"
  fi
  if [ "${actual}" != "${expected}" ]; then
    die "SHA256 mismatch for ${fname}:
    expected ${expected}
    got      ${actual}
The download may be corrupted — retry, or report it at ${REPO_URL}/issues."
  fi
  say "SHA256 OK (${expected})"
else
  warn "SHASUMS256.txt not found on the release; skipping integrity verification"
fi

# --- install ------------------------------------------------------------------

install_mac() {
  local dmg="${tmpdir}/${fname}"
  local mount_point="${tmpdir}/dmg-mount"
  local app_path app_name dest

  say "Mounting ${fname} ..."
  mkdir -p "${mount_point}"
  hdiutil attach -nobrowse -readonly -mountpoint "${mount_point}" "${dmg}" >/dev/null
  app_path="$(find "${mount_point}" -maxdepth 2 -name '*.app' -print 2>/dev/null | head -n 1 || true)"
  if [ -z "${app_path}" ]; then
    hdiutil detach "${mount_point}" >/dev/null 2>&1 || true
    die "no .app bundle found inside ${fname}"
  fi
  app_name="$(basename "${app_path}")"

  install_app() {
    local target="$1"
    mkdir -p "$(dirname "${target}")"
    if [ -d "${target}" ]; then
      rm -rf "${target}"
    fi
    if command -v ditto >/dev/null 2>&1; then
      ditto "$app_path" "${target}"
    else
      cp -R "$app_path" "${target}"
    fi
  }

  say "Installing ${app_name} ..."
  if install_app "/Applications/${app_name}" 2>/dev/null; then
    dest="/Applications/${app_name}"
  else
    warn "could not install into /Applications (permissions) — using ~/Applications instead"
    install_app "${HOME}/Applications/${app_name}"
    dest="${HOME}/Applications/${app_name}"
  fi
  hdiutil detach "${mount_point}" >/dev/null 2>&1 || true

  say "Installed: ${dest}"
  say "Launch it from Finder, or from a terminal:"
  printf '    open %s\n' "${dest}"
  warn "Unsigned build: on first launch Gatekeeper may block ${app_name}."
  printf '    Right-click the app in Finder and choose "Open" (or System Settings -> Privacy & Security -> "Open Anyway").\n' >&2
}

install_linux() {
  local bindir="${HOME}/.local/bin"
  local target="${bindir}/${fname}"

  mkdir -p "${bindir}"
  say "Installing ${fname} to ${bindir} ..."
  chmod +x "${tmpdir}/${fname}"
  mv "${tmpdir}/${fname}" "${target}"

  case ":${PATH}:" in
    *":${bindir}:"*) ;;
    *)
      warn "${bindir} is not on your PATH."
      printf '    Add it with: echo '\''export PATH="%s:$PATH"'\'' >> ~/.bashrc (or your shell profile)\n' "${bindir}" >&2
      ;;
  esac

  say "Installed: ${target}"
  say "Launch it with:"
  printf '    %s\n' "${target}"
}

case "${plat}" in
  mac) install_mac ;;
  linux) install_linux ;;
esac

say "Done. Docs: ${REPO_URL}#download--install"
