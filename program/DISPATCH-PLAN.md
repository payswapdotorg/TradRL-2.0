# Initial Three-Worker Dispatch Plan

This is a planning aid. The live graph in program/graph.json remains authoritative.

## Wave 0 — bootstrap

W001 is the repository architecture/governance bootstrap.

After W001 merges:

## Wave 1

Worker A → W002 third-party/license gate

Worker B → W003 canonical world contracts

Worker C → no speculative implementation; hold until W004 or W005 is unblocked

Reason: W004 and W005 depend on W003. We do not invent parallel speculative work just to fill the third lane.

## Wave 2

Worker A → W004 market/event/time/information contracts

Worker B → W005 Trading World side-pane lifecycle contract

Worker C → one of the first independent implementation items only after its dependencies are merged; otherwise audit/review work may be assigned without changing code.

## Wave 3

Worker A → W006 Trading World shell/tool registry

Worker B → W013 deterministic World engine skeleton

Worker C → W002/W004/W005 successor or another newly-ready disjoint contract task

Once W006 and W013 land, the graph should naturally open many independent surfaces.

## Wave 4 — deliberate fan-out

Worker A → W007 Chart
Worker B → W008 Watchlist/market overview
Worker C → W009 DOM/Time & Sales

## Wave 5

Worker A → W010 Orders
Worker B → W011 Portfolio/Risk
Worker C → W012 Clock/Timeline

## Wave 6

Worker A → W014 Matching
Worker B → W015 Account/Portfolio/Risk engine
Worker C → W016 Journal/Snapshot/Branch

## Wave 7

Worker A → W017 Synthetic market
Worker B → W018 Worker/transport adapter
Worker C → W029 Layout presets OR the next independent ready contract

## Wave 8

W019 is an integration gate. Keep one primary worker on the golden journey suite and use the other two only for genuinely disjoint defect fixes/review work.

## Concurrency quality rule

A third worker is optional.

A lane must not be filled with speculative refactors, broad cleanup or shared-file editing. Empty capacity is preferable to integration debt.

## Recovery

Every worker checkpoint is pushed.

If a worker dies, re-entry audits the surviving branch before new implementation begins.
