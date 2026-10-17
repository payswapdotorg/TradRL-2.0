# TradRL

TradRL is a trader operating environment built from the ZCode workbench. The product identity is TradRL's own; the workbench it extends stays visible — **TradRL extends the ZCode workbench rather than replacing it.**

The repository is the **sole source of truth** for product architecture, implementation scope, work-order state, contracts, acceptance criteria, and engineering decisions. Chat history is non-authoritative.

## Download & install

Prebuilt desktop installers are published on the [GitHub Releases](https://github.com/payswapdotorg/tradrl-2.0/releases) page (built by the tag-triggered [Release Desktop](.github/workflows/release-desktop.yml) workflow):

| Platform | Installer |
| --- | --- |
| macOS 12+ (Apple Silicon) | `ZCode-<version>-mac-arm64.dmg` |
| macOS 12+ (Intel) | `ZCode-<version>-mac-x64.dmg` |
| Windows 10/11 (x64) | `ZCode-<version>-win-x64.exe` (NSIS) |
| Linux (x64) | `ZCode-<version>-linux-x86_64.AppImage` (+ `-linux-amd64.deb` / `-linux-x86_64.rpm` / `-linux-x64.pkg.tar.zst`) |

Quick install — macOS / Linux (downloads the latest release, verifies its SHA256 against `SHASUMS256.txt`, installs, and prints launch instructions):

```bash
curl -fsSL https://raw.githubusercontent.com/payswapdotorg/tradrl-2.0/main/scripts/install-desktop.sh | bash
```

Quick install — Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/payswapdotorg/tradrl-2.0/main/scripts/install-desktop.ps1 | iex
```

Manual download: grab the asset for your platform from the [latest release](https://github.com/payswapdotorg/tradrl-2.0/releases/latest) plus `SHASUMS256.txt`, verify it (`sha256sum -c --ignore-missing SHASUMS256.txt` on Linux, `shasum -a 256 -c --ignore-missing SHASUMS256.txt` on macOS), then mount the `.dmg` and drag **ZCode** to `/Applications`, run the `.exe`, or `chmod +x` the `.AppImage`. Behind a shared IP (NAT/VPN/cloud shell/CI) and rate-limited by GitHub? Set `GITHUB_TOKEN` and re-run — see the shared-IP note in [`docs/release/DESKTOP-RELEASE.md`](docs/release/DESKTOP-RELEASE.md).

> **Unsigned builds:** no code-signing certificates exist for this project yet, so macOS Gatekeeper and Windows SmartScreen will warn on first launch. On macOS, right-click the app → **Open** (or System Settings → Privacy & Security → **Open Anyway**). On Windows, choose **More info** → **Run anyway**. The full release runbook — tag law, asset matrix, checksums, cut procedure — lives in [`docs/release/DESKTOP-RELEASE.md`](docs/release/DESKTOP-RELEASE.md).
> Signing is planned and tracked: per-platform certificate paths, costs, and the operator checklist live in [`docs/release/CODE-SIGNING.md`](docs/release/CODE-SIGNING.md).

## Product identity

The product identity is typed data: [`product/`](product/) carries the PRODUCT IDENTITY CONTRACT (W066) — the closed identity-scope vocabulary (`product-name-bearing` / `workbench-inherited` / `license-notice` / `deployment-contract`), the per-surface identity declarations, the migration laws (a TradRL-branded surface carries the product's own name; a workbench-inherited surface preserves the ZCode workbench identity), and the content-addressed `identity-<digest>` record over canonical data, with every citation re-proven against real repository surfaces at the gate.

## Product north star

TradRL turns the ZCode desktop/web workbench into an AI-native trader workspace.

The central primitive is a **Market World** that a human or AI trader can inhabit, observe, control, replay, branch, and eventually train against.

The first implementation milestone is **Trader World Alpha**: a complete dockable simulated trading environment. Agent/RL infrastructure follows only after the world itself is useful.

## Architectural layers

```
ZCode Workbench
  ├─ desktop / Electron
  ├─ web
  ├─ terminal
  ├─ browser
  ├─ workspace / sessions / docking
  └─ shared protocols
          │
          ▼
TradRL World
  ├─ Market World Protocol
  ├─ simulation runtime
  ├─ trader UI
  ├─ clock / replay / branching
  ├─ orders / execution
  ├─ portfolio / risk
  ├─ information world
  └─ evidence / provenance
          │
          ▼
Future learning plane
  ├─ Agent Body
  ├─ Cognitive Substrate
  ├─ Organization
  ├─ RL / other learning
  ├─ evaluation / search integrity
  ├─ Firm Brain
  └─ optional Arena capability provider
```

## Upstream lineage

This repository is based on the public `zai-org/zcode` codebase. The existing ZCode workbench is retained where valuable. TradRL-specific code must remain behind explicit boundaries instead of leaking trading-domain assumptions into generic ZCode infrastructure.

Upstream-inspired infrastructure is not automatically approved for direct code copying. See `spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md`.

## Source of truth

Read:

- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/ARCHITECTURE.md`
- `spec/WORLD-PROTOCOL.md`
- `spec/UX-DESIGN.md`
- `spec/WORK-ITEMS.md`
- `program/graph.json`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/WORKER-RUNBOOK.md`
- `docs/LLM-ARCHITECT-HANDOFF.md`

If chat and repository disagree, **the repository wins**.

## First milestone

Trader World Alpha must prove:

- opens as a normal ZCode dockable surface beside Terminal/Browser;
- has a real simulated market, order book, order entry, execution, account, portfolio and risk;
- has a real simulation clock with play/pause/step/speed/seek;
- supports immutable snapshots and branching;
- is deterministic under fixed engine/version/seed/commands;
- has an event journal and provenance;
- can run headless without the Agent or Arena;
- uses one authoritative world state with UI projections.

## Existing ZCode development

Retain existing upstream commands until corresponding TradRL Work Orders explicitly migrate them. Do not rename or delete upstream subsystems merely for branding.

Maximum concurrent worker count: **3**.
