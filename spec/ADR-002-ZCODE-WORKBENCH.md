# ADR-002 — Reuse the ZCode Workbench

Status: Accepted.

TradRL extends ZCode's existing workspace, side pane, terminal, browser, resizable panels and session infrastructure.

Do not introduce a replacement global docking architecture in Phase 1.

Reason: the fork already contains a mature dockable workbench. Reusing it reduces regression surface and keeps Terminal/Browser/Trading World consistent.

Consequence: TradRL adds a narrow trading-world panel type and keeps domain implementation isolated.
