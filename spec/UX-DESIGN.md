# TradRL Trader World UX

## North star

The user should feel that they are inside a financial world rather than viewing a collection of analytics panels.

## Docking

Trading World is a normal ZCode side-pane surface and must support:

- open
- focus
- resize
- collapse
- reorder
- close
- reopen
- persistence
- workspace/session scoping

Do not introduce a new outer docking framework in Phase 1.

## Default trader cockpit

```
┌───────────────────────────────────────────────────────────────┐
│ Instrument Mode SIMULATED Time Speed P&L World                │
├────────────┬───────────────────────┬─────────────────────────┤
│ Watchlist  │ Main Chart            │ Order Book / DOM        │
│ Movers     │ Candles / volume      │                         │
│ News       │ Indicators            │ Order Ticket             │
│ Events     │ Trade markers         │                         │
├────────────┼───────────────────────┼─────────────────────────┤
│ Research   │ Time & Sales          │ Positions / Orders      │
│ Calendar   │ Flow                  │ Portfolio / Risk        │
├────────────┴───────────────────────┴─────────────────────────┤
│ ◀ time ─────────────●────────────────────────── time ─────▶ │
│ pause step play 0.1x 1x 10x 100x snapshot branch            │
└───────────────────────────────────────────────────────────────┘
```

## Core World Alpha tools

- watchlist
- chart
- DOM/order book
- Time & Sales
- order ticket
- working orders
- fills
- positions
- portfolio
- risk
- simulation clock

## Tool identity

Each tool has a stable id and contract. Layout placement is independent from domain state.

## Simulation disclosure

Persistent visible state:

`SIMULATED · HISTORICAL`

or the appropriate world mode.

Never rely on color alone.

## Clock

The clock is world-owned. UI controls send ClockPort commands.

Supported interactions:

- play
- pause
- step
- speed
- seek
- jump-to-event
- snapshot
- branch

## Responsive behavior

On narrow screens, secondary research moves into tabs/drawers. Primary market state, risk and order controls remain reachable.

## Presets

- Day Trader
- Execution
- Research
- Portfolio
- Risk
- Quant
- Market Maker
- RL Training

Presets are declarative configurations.

## Evidence

Show concise evidence capsules:

`Observed → Action → Result`

Never display hidden chain-of-thought.

## Acceptance journey ids

J-WORLD-01 dock
J-WORLD-02 hidden-panel continuation
J-WORLD-03 order
J-WORLD-04 cross-view synchronization
J-WORLD-05 clock
J-WORLD-06 branch
J-WORLD-07 restore
J-WORLD-08 headless parity
