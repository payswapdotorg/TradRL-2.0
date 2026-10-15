# Trading World layout presets / workspace profiles — W029

The declarative preset catalogue for the Trading World cockpit: the eight
UX-DESIGN presets as typed, validated, pure DATA, plus the resolver that
composes them with W006's default trader cockpit.

## Laws

- **R043 — presets are declarative.** Every file here is pure data + pure
  functions. No React, no hooks, no components, no side effects, no clocks,
  no randomness, no environment reads.
- **R044 — risk/order visibility is structural.** At least one of the
  bookkeeping/accounts panels must carry tools in every preset; the
  validator rejects a preset that hides positions/orders/risk entirely.
  The catalogue ships BOTH panels populated in all eight entries.
- **Fail-closed catalogue validation at module load.** `catalogue.ts` runs
  `assertValidTradingWorldPresetCatalogue` while the module evaluates: an
  unknown panel/column id, an out-of-bounds ratio, a missing clock strip, a
  tool docked twice (singleton law), the clock-strip tool docked in a
  panel, an unregistered tool id, a preset that fails R044 — any of these
  aborts the import with a loud `TradingWorldPresetValidationError` naming
  the preset and the violated law. Never a silent default.
- **Never-brick resolver.** `resolveTradingWorldLayoutPreset` answers
  `[W029 presets ∪ W006 default]`. Unknown ids (stale presets,
  not-yet-landed entries) fall back to the default trader cockpit — never
  an error — and the fallback is observable in the resolution shape
  (`source: "default"`, `fellBackToDefault: true`). Requesting `"default"`
  is an explicit default match, NOT a fallback. Outside the catalogue the
  resolver delegates to W006's `resolveTradingWorldLayoutProfile`, so the
  two resolvers cannot drift.
- **Determinism (A9).** The catalogue is deep-frozen at construction; twin
  resolutions of the same id are deep-equal forever. No caller can corrupt
  the shared preset data.
- **Stable docking targets.** Only the nine existing W006 panel ids and
  three column ids appear. The simulation clock tool stays owned by the
  full-width clock strip. Each preset docks every core panel tool exactly
  once — presets re-weight surfaces, they never drop them.

## The catalogue

| id | label | Arrangement (design rationale) |
| --- | --- | --- |
| `day-trader` | Day Trader | Order-flow dominance: tall tape/DOM/ticket, compressed chart, narrow rail; fills-first blotter, risk-first accounts. |
| `execution` | Execution | Ticket + blotter dominance: working-orders-first bookkeeping at double weight, tallest ticket; chart/tape background. |
| `research` | Research | Widest focus column at 5:1 chart-to-tape; tall reserved research dock for future W027 surfaces; execution minimized but present. |
| `portfolio` | Portfolio | Accounts-first: dominant portfolio/risk panel over a positions-heavy blotter; DOM/ticket shrink to one weight each. |
| `risk` | Risk | Risk state as the primary surface: tallest panel is accounts with risk tab first; orders/positions one glance away. |
| `quant` | Quant | Data density: balanced chart+tape, deep DOM, tallest research dock, doubled clock strip. |
| `market-maker` | Market Maker | DOM and tape as primary instruments (5:4); mid-size ticket; working-orders-first blotter for open quotes. |
| `rl-training` | RL Training | Tallest clock strip (the experiment heartbeat); state (watchlist/chart/tape) balanced with action (ticket) and reward (fills/portfolio). |

All ratios are authored inside
`[TRADING_WORLD_RATIO_MIN, TRADING_WORLD_RATIO_MAX]` (0.05–20, mirroring the
layout builders' internal clamp bounds) so the runtime clamp never has to
fire on catalogue data.

## Layout of the module

- `catalogue.ts` — the eight presets as data; validates + deep-freezes at
  module load.
- `validate.ts` — the fail-closed laws and the typed violation error.
- `resolve.ts` — the combined resolver and the observable fallback shape.
- `index.ts` — the public surface.
- `test/` — node:test suites (real relative imports, no shims).

## Tests

From `packages/ui`:

```
npx tsx --test src/trading-world/presets/test/catalogue.test.ts
npx tsx --test src/trading-world/presets/test/validate.test.ts
npx tsx --test src/trading-world/presets/test/resolve.test.ts
```

## Scope honesty

Deliberately NOT in this module: shell wiring (the cockpit toolbar/menu
binding), persistence changes, new panel/column ids, new tool
registration, and any seam flip from W006's resolver to the combined one —
the shell/registry binding is the TL's registration job at merge time.
This module imports `../layout` and `../registry` read-only and never
modifies them.
