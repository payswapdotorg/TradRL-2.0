# Third-Party Technology Register

| Technology | Intended role | Initial posture | License/constraint |
|---|---|---|---|
| zai-org/zcode | outer workbench | base | Apache-2.0 |
| TradingView Lightweight Charts | financial charting | integrate | Apache-2.0 |
| Perspective | streaming/analytical grids | integrate | Apache-2.0 |
| Apache Arrow | analytical interchange | integrate | Apache-2.0 |
| Polars | analytical processing | integrate/service boundary | MIT |
| NautilusTrader | high-fidelity replay/execution | adapter/isolated | LGPL-3.0-only; legal review |
| ABIDES | reactive market simulation | adapter/reference | verify exact version license before distribution |
| JAX-LOB | large-scale LOB/RL simulation | training backend | verify exact version license |
| QuantConnect LEAN | domain reference | reference/selective | Apache-2.0 |
| Hummingbot | connectors/market making | reference/candidate | Apache-2.0 |
| CCXT | crypto adapter basis | later adapter | MIT |
| Freqtrade/FreqUI | UX inspiration | inspiration only by default | GPL-3.0 |
| FlexLayout | optional internal advanced docking | conditional | MIT |

## Rules

- Verify exact version/commit license before integration.
- Record source path and provenance for copied code.
- Prefer adapters to forks.
- Isolate incompatible copyleft dependencies.
- Do not copy proprietary UI assets.
- Treat licensing as an architecture constraint.

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
