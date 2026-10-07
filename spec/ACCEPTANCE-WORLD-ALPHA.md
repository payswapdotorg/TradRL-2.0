# Trader World Alpha Acceptance

## A Dock

- opens as a ZCode side-pane tool;
- focuses, closes, resizes, reorders and restores;
- survives panel collapse;
- remains correctly scoped by workspace/session.

## B Market

- instrument opens;
- quote changes;
- order book changes;
- Time & Sales changes;
- deterministic market generator can create multiple regimes.

## C Execution

- market order;
- limit order;
- cancellation;
- replacement;
- partial fill;
- complete fill;
- fees;
- rejection;
- position update.

## D Financial state

- cash;
- buying power;
- positions;
- realized P&L;
- unrealized P&L;
- portfolio;
- risk.

## E Clock

- play;
- pause;
- step;
- speed;
- seek;
- jump;
- snapshot;
- branch.

## F Cross-view consistency

One golden command sequence must produce matching assertions in chart, DOM, T&S, orders, positions, portfolio and risk.

## G Branch safety

Mutating a child world must not alter its parent snapshot/history.

## H Information firewall

An artifact whose `availableAt` is after current simulation time must not be observable.

## I Headless parity

The same command stream run headlessly and through the UI produces the same deterministic result hash.

## J Performance

Target: sustain at least 10,000 synthetic events/second locally in a benchmark while authoritative event count remains lossless and UI stays interactive.

## K Safety

- persistent SIMULATED disclosure;
- no broker credentials in World Alpha;
- no live execution command;
- explicit typed denial for live-only actions.

## L Evidence

Every order lifecycle has causal journal events and provenance.

## Completion rule

All acceptance families and regression gates must pass before World Alpha is marked complete.
