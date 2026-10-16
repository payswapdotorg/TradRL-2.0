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
  linux) asset_regex="ZCode-.*-linux-${arch}\.AppImage$" ;;
esac

extract_asset_urls() {
  # grep exits 1 when the JSON has no assets (e.g. an empty release list) —
  # with pipefail that must not abort the script, an empty result is expected.
  printf '%s' "$1" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed 's/.*"browser_download_url": *"//; s/"$//' \
    || true
}

say "Looking up the latest ${APP_NAME} desktop release ..."
release_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "${API_BASE}/releases/latest" 2>/dev/null || true)"
asset_urls="$(extract_asset_urls "${release_json:-}")"
if [ -z "${asset_urls}" ] \
  || ! printf '%s\n' "${asset_urls}" | grep -Eq -- "${asset_regex}"; then
  # /releases/latest omits pre-releases — and the TradRL tag format
  # (v<workbench>-tradrl.N) is a semver pre-release — or the latest release
  # may not carry this platform's asset yet. Fall back to scanning the
  # newest releases for one that actually has a matching installer.
  release_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "${API_BASE}/releases?per_page=20" \
    || die "could not query GitHub for releases (network error?).
Check ${REPO_URL}/releases and download manually.")"
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
