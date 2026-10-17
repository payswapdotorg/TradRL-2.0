<#
  ZCode desktop quick-installer for Windows (TradRL-2.0).

  Downloads the latest Windows (x64) installer from GitHub Releases, verifies
  its SHA256 against the release's SHASUMS256.txt, runs it, and cleans up.

  Usage (PowerShell 5.1 or newer):
    irm https://raw.githubusercontent.com/payswapdotorg/tradrl-2.0/main/scripts/install-desktop.ps1 | iex

  Or, saved as a file:
    powershell -ExecutionPolicy Bypass -File .\install-desktop.ps1

  Optional silent install (NSIS /S) — set before invoking:
    $env:ZCODE_INSTALL_DESKTOP_SILENT = '1'

  Unsigned-build notice: ZCode desktop builds are currently unsigned. If
  SmartScreen shows "Windows protected your PC", choose "More info" ->
  "Run anyway". See docs/release/DESKTOP-RELEASE.md for details.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'payswapdotorg/tradrl-2.0'
$RepoUrl = "https://github.com/$Repo"
$ApiBase = "https://api.github.com/repos/$Repo"
$RequestHeaders = @{ 'User-Agent' = 'tradrl-install-desktop' }
# W067-R3 — WHY (live evidence 2026-10-17): api.github.com answered HTTP 403
# with x-ratelimit-limit: 60 / x-ratelimit-remaining: 0, body "API rate limit
# exceeded for 47.57.242.119" — that machine's egress IP sits in a shared
# VPN/NAT pool, and unauthenticated core-API quota is 60 requests/hour per IP.
# When GITHUB_TOKEN / GH_TOKEN is set and non-empty, authenticate BOTH release
# API lookups below (the /releases/latest call and the /releases?per_page=20
# fallback both use -Headers $RequestHeaders): Authorization header only —
# the token is never echoed or logged. The Invoke-WebRequest download calls
# (browser_download_url) deliberately do NOT use these headers — they are
# release-asset URLs, not API calls, and must stay token-free.
$ghToken = $env:GITHUB_TOKEN
if (-not $ghToken) { $ghToken = $env:GH_TOKEN }
if ($ghToken) { $RequestHeaders['Authorization'] = "Bearer $ghToken" }

function Write-Info { param($Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn { param($Message) Write-Host "warning: $Message" -ForegroundColor Yellow }
function Die { param($Message) Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

function Get-ApiErrorBody {
  # W067-R3 helper: best-effort extraction of the HTTP error body from a
  # caught Invoke-RestMethod exception, across the PowerShell 5.1
  # (WebException) and PowerShell 7+ (HttpResponseException) shapes.
  # '' when unavailable (the diagnosis then simply stays generic).
  param($ErrorRecord)
  try {
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
      return $ErrorRecord.ErrorDetails.Message
    }
    $response = $ErrorRecord.Exception.Response
    if ($response) {
      $stream = $null
      try { $stream = $response.GetResponseStream() } catch { }
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
      }
    }
  } catch { }
  return ''
}

function Die-IfRateLimited {
  # W067-R3: when the failed API response is a rate-limit 403 — GitHub's
  # answer to an exhausted unauthenticated per-IP quota (60/hour; live
  # evidence 2026-10-17: "API rate limit exceeded for 47.57.242.119" with
  # x-ratelimit-remaining: 0 on a shared VPN/NAT egress IP) — die with the
  # actual cause and cure instead of the generic "network error?" guess.
  # Inspects both the status code and the body; the body is authoritative
  # (-match is case-insensitive), status 0 means "could not extract".
  # Any other failure returns silently and keeps its original handling.
  # The token never appears in any message.
  param($ErrorRecord)
  $body = Get-ApiErrorBody $ErrorRecord
  $status = 0
  try {
    if ($ErrorRecord.Exception.Response) {
      $status = [int]$ErrorRecord.Exception.Response.StatusCode
    }
  } catch { }
  if ($body -match 'rate limit' -and ($status -eq 0 -or $status -eq 403 -or $status -eq 429)) {
    Die "GitHub API rate limit exceeded - this IP's unauthenticated quota (60 requests/hour) is exhausted; typical behind shared NAT/VPN/cloud-shell or CI egress IPs. Wait for the hourly window to reset, or re-run with GITHUB_TOKEN (or GH_TOKEN) set to authenticate and lift the limit - see https://docs.github.com/rest/overview/resources-in-the-rest-api."
  }
}

# Windows PowerShell 5.1 can default to TLS 1.0/1.1; GitHub requires TLS 1.2+.
# (PowerShell 7+ ignores this setting safely.)
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  Write-Verbose "Could not pin TLS 1.2 (non-Windows-PowerShell runtime): $_"
}

# --- architecture check -------------------------------------------------------

$processorArch = $env:PROCESSOR_ARCHITECTURE
if ($processorArch -eq 'ARM64') {
  Die "no Windows installer is published for ARM64 yet (published: win-x64). See $RepoUrl/releases."
}
if ($processorArch -ne 'AMD64') {
  Die "unsupported Windows architecture: $processorArch. See $RepoUrl/releases."
}

# --- find the latest release with a Windows installer --------------------------

function Find-InstallerAsset {
  param($Release)
  if (-not $Release -or -not $Release.assets) { return $null }
  return $Release.assets | Where-Object { $_.name -like 'ZCode-*-win-x64.exe' } | Select-Object -First 1
}

Write-Info 'Looking up the latest ZCode desktop release ...'
$release = $null
try {
  $release = Invoke-RestMethod -Uri "$ApiBase/releases/latest" -Headers $RequestHeaders
} catch {
  # 404 is expected flow here (only pre-releases published — the fallback
  # below scans the release list); a rate-limit 403 dooms BOTH lookups, so
  # die with the specific diagnosis now instead of letting the fallback
  # re-die with the misleading "network error?".
  Die-IfRateLimited $_
  $release = $null
}
if (-not (Find-InstallerAsset $release)) {
  # /releases/latest omits pre-releases, and the TradRL tag format
  # (v<workbench>-tradrl.N) is a semver pre-release — scan the newest
  # releases for one that actually has installers.
  try {
    $releases = Invoke-RestMethod -Uri "$ApiBase/releases?per_page=20" -Headers $RequestHeaders
  } catch {
    Die-IfRateLimited $_
    Die "could not query GitHub for releases (network error?). Check $RepoUrl/releases and download manually."
  }
  $release = $releases | Where-Object { Find-InstallerAsset $_ } | Select-Object -First 1
}

$asset = Find-InstallerAsset $release
if (-not $asset) {
  Die "could not find a release with a Windows x64 installer. Check $RepoUrl/releases."
}
$sumsAsset = $release.assets | Where-Object { $_.name -eq 'SHASUMS256.txt' } | Select-Object -First 1

Write-Info "Found $($asset.name) (tag $($release.tag_name))."

# --- download -------------------------------------------------------------------

$tmp = Join-Path -Path ([IO.Path]::GetTempPath()) -ChildPath ("zcode-install-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
$installerPath = Join-Path $tmp $asset.name

Write-Info "Downloading $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath -UserAgent 'tradrl-install-desktop' -UseBasicParsing

# --- verify ----------------------------------------------------------------------

if ($sumsAsset) {
  Write-Info 'Verifying SHA256 against SHASUMS256.txt ...'
  $sumsPath = Join-Path $tmp 'SHASUMS256.txt'
  Invoke-WebRequest -Uri $sumsAsset.browser_download_url -OutFile $sumsPath -UserAgent 'tradrl-install-desktop' -UseBasicParsing

  $expected = $null
  foreach ($line in Get-Content -Path $sumsPath) {
    $parts = $line -split '\s+'
    if ($parts.Count -ge 2 -and $parts[1] -eq $asset.name) {
      $expected = $parts[0]
      break
    }
  }
  if (-not $expected) {
    Die "no SHA256 entry for $($asset.name) in SHASUMS256.txt - refusing to install an unverifiable download."
  }
  $actual = (Get-FileHash -Path $installerPath -Algorithm SHA256).Hash
  if ($actual -ne $expected) {
    Die "SHA256 mismatch for $($asset.name): expected $expected, got $actual. The download may be corrupted - retry, or report it at $RepoUrl/issues."
  }
  Write-Info "SHA256 OK ($($expected.ToLowerInvariant()))"
} else {
  Write-Warn 'SHASUMS256.txt not found on the release; skipping integrity verification.'
}

# --- run the installer -------------------------------------------------------------

Write-Info 'Launching the installer ...'
Write-Warn 'Unsigned build: if SmartScreen shows "Windows protected your PC", choose "More info" -> "Run anyway".'

$installerArguments = @()
if ($env:ZCODE_INSTALL_DESKTOP_SILENT -eq '1') {
  $installerArguments = @('/S')
}

$process = Start-Process -FilePath $installerPath -ArgumentList $installerArguments -PassThru
$process.WaitForExit()

if ($process.ExitCode -eq 0) {
  Write-Info 'Installation finished. Launch ZCode from the Start menu.'
} elseif ($process.ExitCode -eq 1) {
  Write-Warn 'the installer was cancelled.'
} else {
  Die "the installer exited with code $($process.ExitCode)."
}

Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
